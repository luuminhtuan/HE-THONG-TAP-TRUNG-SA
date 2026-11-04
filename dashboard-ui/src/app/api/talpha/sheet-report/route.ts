// Số báo cáo tháng — CÙNG bảng số với file Google Sheet "TỔNG TEAM THÁNG n".
//
// Vì sao cần: bot từng tự tính lại số rồi gửi lên nhóm, và mỗi lần rule đổi là tin nhắn
// lệch với Sheet (01/09: lệch cả camp test lẫn cách gán đơn; rồi lệch tiếp vì hai bên
// gom ngày theo hai múi giờ khác nhau). Nay chỉ MỘT chỗ tính: format_all.py dựng các tab
// của file TỔNG TEAM rồi ghi vào bảng Postgres bao_cao_tab (04/11/2026 — trước đó route đọc
// thẳng file Sheet); có khoá Google thì ghi thêm lên Sheet. Route đọc bảng đó, ô nào cũng
// đúng như ô trên Sheet.
//
// Hai chế độ:
//   ?date=YYYY-MM-DD          một ngày — bot Zalo (giữ nguyên dạng trả về).
//   ?from=YYYY-MM-DD&to=…     cộng cả khoảng — tab Tổng quan (25/09/2026: tab tự tính từ
//                             BigQuery theo luật riêng nên lệch Sheet; nay đọc cùng bảng số).
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { DISPLAY, MARKETS_PUBLIC, REPORT_START_DATE, UNASSIGNED } from "@/lib/talpha/rules";
import { getAccess } from "@/lib/talpha/access";
import { canMarket, seesAllMarkets, type Access } from "@/lib/talpha/access-rules";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Ô số ghi dạng SỐ (format_all.py). Ô chữ cũ kiểu Sheet vi_VN vẫn đọc được:
// "32.842.574" → 32842574 · "5,9%" → 5.9 · "" → 0 — dấu chấm là phân cách nghìn, dấu phẩy là
// thập phân, đọc nhầm là sai gấp nghìn lần.
function soVN(v: unknown): number {
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    const s = String(v ?? "").replace(/[đ%\s]/g, "").trim();
    if (!s) return 0;
    const n = Number(s.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
}

type Tab = { title: string; head: string[]; rows: unknown[][] };

/** Các tab TỔNG TEAM của một tháng ('YYYY-MM'). Tháng chưa có số (format_all chưa chạy) → null. */
async function docThang(thang: string): Promise<Tab[] | null> {
    const rows = await query<{ ten_tab: string; hang: unknown[][] }>(
        "SELECT ten_tab, hang FROM bao_cao_tab WHERE thang = @thang AND tep = 'tong_team' ORDER BY thu_tu",
        { thang });
    if (!rows.length) return null;
    return rows
        .map((r) => ({ title: r.ten_tab, head: (r.hang[0] || []).map((h) => String(h ?? "").trim()), rows: r.hang.slice(1) }))
        // Chỉ tab SỐ LIỆU (có cột tiền ads).
        .filter((t) => t.head.includes("TỔNG TIỀN ADS"));
}

type So = { ads: number; mess: number; don: number; doanh_so: number; ds_giao_tc: number };
const soRong = (): So => ({ ads: 0, mess: 0, don: 0, doanh_so: 0, ds_giao_tc: 0 });
const cong = (a: So, b: So) => {
    a.ads += b.ads; a.mess += b.mess; a.don += b.don; a.doanh_so += b.doanh_so; a.ds_giao_tc += b.ds_giao_tc;
};
function docDong(head: string[], r: unknown[]): So {
    const g = (ten: string) => soVN(r[head.indexOf(ten)]);
    return { ads: g("TỔNG TIỀN ADS"), mess: g("SỐ TIN NHẮN"), don: g("Số đơn"), doanh_so: g("Doanh Số"), ds_giao_tc: g("DS Giao TC") };
}

// "15/09/2026" → "2026-09-15"; dòng "TỔNG" và dòng lạ → null.
function ngayISO(o: unknown): string | null {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(o ?? "").trim());
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function cacThang(from: string, to: string): string[] {
    const out: string[] = [];
    let [y, m] = from.slice(0, 7).split("-").map(Number);
    const [ty, tm] = to.slice(0, 7).split("-").map(Number);
    while (y < ty || (y === ty && m <= tm)) {
        out.push(`${y}-${String(m).padStart(2, "0")}`);
        m += 1; if (m > 12) { m = 1; y += 1; }
    }
    return out;
}

// Tab trong file TỔNG TEAM (format_all.py): "Tổng" = cả team · một tab mỗi marketer
// (cột 8 là "Tiền (local)") · "(không gán)" nếu có đơn chưa gán · một tab mỗi nước khi
// có từ hai nước có số trở lên (cột 8 là mã tiền địa phương, tên tab là tên nước).
function loaiTab(t: Tab): { loai: "team" | "unassigned" | "marketer" | "market"; code?: string } {
    if (t.title === "Tổng") return { loai: "team" };
    if (t.title === UNASSIGNED) return { loai: "unassigned" };
    if (t.head[7] === "Tiền (local)") return { loai: "marketer" };
    const nuoc = MARKETS_PUBLIC.markets.find((m) => m.display === t.title || m.key === t.title);
    return { loai: "market", code: nuoc?.code };
}

async function theoKhoang(fromIn: string, to: string, a: Access | null) {
    // Không tính trước mốc gốc — kể cả khi ai đó gọi thẳng route với from sớm hơn.
    const from = REPORT_START_DATE && fromIn < REPORT_START_DATE ? REPORT_START_DATE : fromIn;
    const team = soRong();
    const unassigned = soRong();
    const nguoi = new Map<string, So>();
    const nuoc = new Map<string, { code?: string; so: So }>();
    const ngay = new Map<string, So>();
    // Từng ngày của từng tab NƯỚC — để dựng lại "cả team" cho người chỉ xem một phần nước.
    const ngayNuoc = new Map<string, Map<string, So>>();
    const thieuThang: string[] = [];

    if (from <= to) {
        for (const thang of cacThang(from, to)) {
            const tabs = await docThang(thang);
            if (!tabs) { thieuThang.push(thang); continue; }
            for (const t of tabs) {
                const { loai, code } = loaiTab(t);
                for (const r of t.rows) {
                    const d = ngayISO(r?.[0]);
                    if (!d || d < from || d > to) continue;
                    const so = docDong(t.head, r);
                    if (loai === "team") {
                        cong(team, so);
                        const n = ngay.get(d) || soRong(); cong(n, so); ngay.set(d, n);
                    } else if (loai === "unassigned") {
                        cong(unassigned, so);
                    } else if (loai === "marketer") {
                        const n = nguoi.get(t.title) || soRong(); cong(n, so); nguoi.set(t.title, n);
                    } else {
                        const n = nuoc.get(t.title) || { code, so: soRong() }; cong(n.so, so); nuoc.set(t.title, n);
                        if (code) {
                            const m = ngayNuoc.get(code) || new Map<string, So>();
                            const x = m.get(d) || soRong(); cong(x, so); m.set(d, x); ngayNuoc.set(code, m);
                        }
                    }
                }
            }
        }
    }

    // ── Phân quyền theo team (05/10/2026) ──
    // Người chỉ xem một phần nước: "cả team" của họ = cộng các tab NƯỚC họ được xem, theo
    // từng ngày. Tab marketer gộp mọi nước của người đó (Sheet không tách) nên KHÔNG trả —
    // trả là lộ số team khác. "(không gán)" cũng vậy. Tháng nào file chỉ có một nước có số
    // thì format_all.py không dựng tab nước → tháng đó người xem một phần thấy 0.
    const hep = !!a && !seesAllMarkets(a);
    if (hep) {
        ngay.clear();
        for (const [code, m] of ngayNuoc) {
            if (!canMarket(a!, code)) continue;
            for (const [d, so] of m) { const n = ngay.get(d) || soRong(); cong(n, so); ngay.set(d, n); }
        }
    }

    const days = [...ngay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, so]) => ({ date, ...so }));
    const months = new Map<string, So>();
    for (const d of days) {
        const n = months.get(d.date.slice(0, 7)) || soRong(); cong(n, d); months.set(d.date.slice(0, 7), n);
    }
    const teamTraVe = hep ? days.reduce((s, d) => { cong(s, d); return s; }, soRong()) : team;

    return {
        from, to, start_date: REPORT_START_DATE,
        // Tháng trong khoảng mà vòng báo cáo (format_all.py, phút :20 mỗi giờ) chưa ghi số — số
        // tháng đó KHÔNG có trong tổng. Giao diện phải báo ra, không được coi như tháng đó bằng 0.
        missing_months: thieuThang,
        team: teamTraVe,
        // true = số đã cắt theo team của người xem (giao diện ẩn bảng marketer, KPI cả công ty).
        scoped: hep,
        marketers: hep ? [] : [...nguoi.entries()]
            .map(([tab, so]) => ({ tab, display: DISPLAY[tab] || tab, ...so }))
            .sort((a, b) => b.doanh_so - a.doanh_so),
        unassigned: !hep && (unassigned.ads || unassigned.don) ? unassigned : null,
        markets: [...nuoc.entries()]
            .filter(([, v]) => !hep || (!!v.code && canMarket(a!, v.code)))
            .map(([tab, v]) => ({ tab, code: v.code || null, ...v.so }))
            .sort((a, b) => b.doanh_so - a.doanh_so),
        days,
        months: [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, so]) => ({ month, ...so })),
    };
}

export async function GET(req: NextRequest) {
    const sp = req.nextUrl.searchParams;
    const from = sp.get("from") || "";
    const to = sp.get("to") || "";
    const a = await getAccess(req);
    if (from || to) {
        if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
            return NextResponse.json({ error: "from/to phải dạng YYYY-MM-DD" }, { status: 400 });
        }
        try {
            return NextResponse.json(await theoKhoang(from, to, a));
        } catch (e: any) {
            console.error("sheet-report (khoảng):", e?.message || e);
            return NextResponse.json({ error: `đọc số báo cáo lỗi: ${e?.message || e}` }, { status: 500 });
        }
    }

    // Chế độ một ngày là của bot Zalo: trả nguyên mọi tab (cả tab marketer gộp mọi nước).
    // Người chỉ xem một phần nước dùng chế độ khoảng ở trên, đã cắt theo team.
    if (!a || !seesAllMarkets(a)) {
        return NextResponse.json({ error: "Chế độ ?date= chỉ dành cho bot — dùng ?from=&to=" }, { status: 403 });
    }
    const date = sp.get("date") || "";
    if (!DATE_RE.test(date)) {
        return NextResponse.json({ error: "date phải dạng YYYY-MM-DD" }, { status: 400 });
    }
    const thang = date.slice(0, 7);
    try {
        const tabs = await docThang(thang);
        if (!tabs) {
            return NextResponse.json(
                { error: `chưa có số báo cáo tháng ${Number(thang.slice(5))} — vòng báo cáo (phút :20 mỗi giờ) chưa chạy` },
                { status: 404 });
        }
        const [y, m, d] = date.split("-");
        const nhan = `${d}/${m}/${y}`;
        const out: Record<string, any> = {};
        for (const t of tabs) {
            const r = t.rows.find((x) => String(x?.[0] || "").trim() === nhan);
            if (!r) continue;
            const g = (ten: string) => soVN(r[t.head.indexOf(ten)]);
            out[t.title] = {
                ads: g("TỔNG TIỀN ADS"), mess: g("SỐ TIN NHẮN"), don: g("Số đơn"),
                doanh_so: g("Doanh Số"), ds_giao_tc: g("DS Giao TC"),
                ty_le_chot: g("Tỷ lệ chốt"), phan_tram_ads: g("% Ads/DT"),
            };
        }

        const team = out["Tổng"] || null;
        const marketers = Object.entries(out)
            .filter(([t]) => t !== "Tổng")
            .map(([tab, v]) => ({ tab, ...v }))
            .sort((a, b) => b.doanh_so - a.doanh_so);

        return NextResponse.json({ date, team, marketers });
    } catch (e: any) {
        console.error("sheet-report:", e?.message || e);
        return NextResponse.json({ error: `đọc số báo cáo lỗi: ${e?.message || e}` }, { status: 500 });
    }
}
