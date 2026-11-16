// (Tách khỏi app/api/talpha/sheet-report/route.ts ngày 04/11/2026 để tab Lãi lỗ dùng chung —
// route vẫn trả nguyên như cũ.)
//
// Số báo cáo tháng — CÙNG bảng số với file Google Sheet "TỔNG TEAM THÁNG n".
//
// Vì sao cần: bot từng tự tính lại số rồi gửi lên nhóm, và mỗi lần rule đổi là tin nhắn
// lệch với Sheet (01/09: lệch cả camp test lẫn cách gán đơn; rồi lệch tiếp vì hai bên
// gom ngày theo hai múi giờ khác nhau). Nay chỉ MỘT chỗ tính: format_all.py dựng các tab
// của file TỔNG TEAM rồi ghi vào bảng Postgres bao_cao_tab (04/11/2026 — trước đó đọc thẳng
// file Sheet qua Google Drive); có khoá Google thì ghi thêm lên Sheet. Ô nào cũng đúng như ô
// trên Sheet.
//
// Hai chế độ (route /api/talpha/sheet-report):
//   ?date=YYYY-MM-DD          một ngày — bot Zalo (giữ nguyên dạng trả về).
//   ?from=YYYY-MM-DD&to=…     cộng cả khoảng — tab Tổng quan (25/09/2026: tab tự tính từ
//                             BigQuery theo luật riêng nên lệch Sheet; nay đọc cùng bảng số).
import { query } from "@/lib/db";
import { DISPLAY, MARKETS_PUBLIC, REPORT_START_DATE, UNASSIGNED } from "@/lib/talpha/rules";
import { canMarket, seesAllMarkets, type Access } from "@/lib/talpha/access-rules";

// Ô số ghi dạng SỐ (format_all.py). Ô chữ kiểu Sheet vi_VN vẫn đọc được:
// "32.842.574" → 32842574 · "5,9%" → 5.9 · "" → 0 — dấu chấm là phân cách nghìn, dấu phẩy là
// thập phân, đọc nhầm là sai gấp nghìn lần.
export function parseVnNumber(v: unknown): number {
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    const s = String(v ?? "").replace(/[đ%\s]/g, "").trim();
    if (!s) return 0;
    const n = Number(s.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
}

export type Tab = { title: string; head: string[]; rows: unknown[][] };

/** Các tab TỔNG TEAM của một tháng ('YYYY-MM'). Tháng chưa có số (format_all chưa chạy) → null. */
export async function readMonthTabs(yearMonth: string): Promise<Tab[] | null> {
    const rows = await query<{ ten_tab: string; hang: unknown[][] }>(
        "SELECT ten_tab, hang FROM bao_cao_tab WHERE thang = @thang AND tep = 'tong_team' ORDER BY thu_tu",
        { thang: yearMonth });
    if (!rows.length) return null;
    return rows
        .map((r) => ({ title: r.ten_tab, head: (r.hang[0] || []).map((h) => String(h ?? "").trim()), rows: r.hang.slice(1) }))
        // Chỉ tab SỐ LIỆU (có cột tiền ads).
        .filter((t) => t.head.includes("TỔNG TIỀN ADS"));
}

export type Metrics = { ads: number; mess: number; don: number; doanh_so: number; ds_giao_tc: number };
export const emptyMetrics = (): Metrics => ({ ads: 0, mess: 0, don: 0, doanh_so: 0, ds_giao_tc: 0 });
export const addMetrics = (a: Metrics, b: Metrics) => {
    a.ads += b.ads; a.mess += b.mess; a.don += b.don; a.doanh_so += b.doanh_so; a.ds_giao_tc += b.ds_giao_tc;
};
function readRow(head: string[], r: unknown[]): Metrics {
    const g = (column: string) => parseVnNumber(r[head.indexOf(column)]);
    return { ads: g("TỔNG TIỀN ADS"), mess: g("SỐ TIN NHẮN"), don: g("Số đơn"), doanh_so: g("Doanh Số"), ds_giao_tc: g("DS Giao TC") };
}

// "15/09/2026" → "2026-09-15"; dòng "TỔNG" và dòng lạ → null.
function dmyToIso(o: unknown): string | null {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(o ?? "").trim());
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function monthsInRange(from: string, to: string): string[] {
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
function classifyTab(t: Tab): { loai: "team" | "unassigned" | "marketer" | "market"; code?: string } {
    if (t.title === "Tổng") return { loai: "team" };
    if (t.title === UNASSIGNED) return { loai: "unassigned" };
    if (t.head[7] === "Tiền (local)") return { loai: "marketer" };
    const market = MARKETS_PUBLIC.markets.find((m) => m.display === t.title || m.key === t.title);
    return { loai: "market", code: market?.code };
}

export async function reportForRange(fromIn: string, to: string, a: Access | null) {
    // Không tính trước mốc gốc — kể cả khi ai đó gọi thẳng route với from sớm hơn.
    const from = REPORT_START_DATE && fromIn < REPORT_START_DATE ? REPORT_START_DATE : fromIn;
    const team = emptyMetrics();
    const unassigned = emptyMetrics();
    const byMarketer = new Map<string, Metrics>();
    const byMarket = new Map<string, { code?: string; so: Metrics }>();
    const byDay = new Map<string, Metrics>();
    // Từng ngày của từng tab NƯỚC — để dựng lại "cả team" cho người chỉ xem một phần nước.
    const byMarketDay = new Map<string, Map<string, Metrics>>();
    const missingMonths: string[] = [];

    if (from <= to) {
        for (const yearMonth of monthsInRange(from, to)) {
            const tabs = await readMonthTabs(yearMonth);
            if (!tabs) { missingMonths.push(yearMonth); continue; }
            for (const t of tabs) {
                const { loai: kind, code } = classifyTab(t);
                for (const r of t.rows) {
                    const d = dmyToIso(r?.[0]);
                    if (!d || d < from || d > to) continue;
                    const metrics = readRow(t.head, r);
                    if (kind === "team") {
                        addMetrics(team, metrics);
                        const n = byDay.get(d) || emptyMetrics(); addMetrics(n, metrics); byDay.set(d, n);
                    } else if (kind === "unassigned") {
                        addMetrics(unassigned, metrics);
                    } else if (kind === "marketer") {
                        const n = byMarketer.get(t.title) || emptyMetrics(); addMetrics(n, metrics); byMarketer.set(t.title, n);
                    } else {
                        const n = byMarket.get(t.title) || { code, so: emptyMetrics() }; addMetrics(n.so, metrics); byMarket.set(t.title, n);
                        if (code) {
                            const m = byMarketDay.get(code) || new Map<string, Metrics>();
                            const x = m.get(d) || emptyMetrics(); addMetrics(x, metrics); m.set(d, x); byMarketDay.set(code, m);
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
        byDay.clear();
        for (const [code, m] of byMarketDay) {
            if (!canMarket(a!, code)) continue;
            for (const [d, metrics] of m) { const n = byDay.get(d) || emptyMetrics(); addMetrics(n, metrics); byDay.set(d, n); }
        }
    }

    const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, metrics]) => ({ date, ...metrics }));
    const months = new Map<string, Metrics>();
    for (const d of days) {
        const n = months.get(d.date.slice(0, 7)) || emptyMetrics(); addMetrics(n, d); months.set(d.date.slice(0, 7), n);
    }
    const teamResult = hep ? days.reduce((s, d) => { addMetrics(s, d); return s; }, emptyMetrics()) : team;

    return {
        from, to, start_date: REPORT_START_DATE,
        // Tháng trong khoảng mà vòng báo cáo (format_all.py, phút :20 mỗi giờ) chưa ghi số — số tháng đó
        // KHÔNG có trong tổng. Giao diện phải báo ra, không được coi như tháng đó bằng 0.
        missing_months: missingMonths,
        team: teamResult,
        // true = số đã cắt theo team của người xem (giao diện ẩn bảng marketer, KPI cả công ty).
        scoped: hep,
        marketers: hep ? [] : [...byMarketer.entries()]
            .map(([tab, metrics]) => ({ tab, display: DISPLAY[tab] || tab, ...metrics }))
            .sort((a, b) => b.doanh_so - a.doanh_so),
        unassigned: !hep && (unassigned.ads || unassigned.don) ? unassigned : null,
        markets: [...byMarket.entries()]
            .filter(([, v]) => !hep || (!!v.code && canMarket(a!, v.code)))
            .map(([tab, v]) => ({ tab, code: v.code || null, ...v.so }))
            .sort((a, b) => b.doanh_so - a.doanh_so),
        days,
        // Từng ngày của từng tab NƯỚC (04/11/2026, cho tab Lãi lỗ: so doanh số với kiện đã lên
        // 3PL theo ngày). Cùng luật cắt theo team như `markets`.
        market_days: [...byMarketDay.entries()]
            .filter(([code]) => !hep || canMarket(a!, code))
            .flatMap(([code, m]) => [...m.entries()].map(([date, metrics]) => ({ code, date, ...metrics })))
            .sort((x, y) => x.date.localeCompare(y.date) || x.code.localeCompare(y.code)),
        months: [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, metrics]) => ({ month, ...metrics })),
    };
}
