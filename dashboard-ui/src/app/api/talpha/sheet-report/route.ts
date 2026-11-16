// Route mỏng: việc đọc file TỔNG TEAM nằm ở lib/talpha/team-summary-sheet.ts (dùng chung với
// tab Lãi lỗ — /api/talpha/income-statement). Hai chế độ:
//   ?date=YYYY-MM-DD          một ngày — bot Zalo (giữ nguyên dạng trả về).
//   ?from=YYYY-MM-DD&to=…     cộng cả khoảng — tab Tổng quan, P&L, Marketing.
import { NextRequest, NextResponse } from "next/server";
import { getAccess } from "@/lib/talpha/access";
import { seesAllMarkets } from "@/lib/talpha/access-rules";
import { readMonthTabs, parseVnNumber, reportForRange } from "@/lib/talpha/team-summary-sheet";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
            return NextResponse.json(await reportForRange(from, to, a));
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
    const month = date.slice(0, 7);
    try {
        const tabs = await readMonthTabs(month);
        if (!tabs) {
            return NextResponse.json(
                { error: `chưa có số báo cáo tháng ${Number(month.slice(5))} — vòng báo cáo (phút :20 mỗi giờ) chưa chạy` },
                { status: 404 });
        }
        const [y, m, d] = date.split("-");
        const dateLabel = `${d}/${m}/${y}`;
        const out: Record<string, any> = {};
        for (const t of tabs) {
            const r = t.rows.find((x) => String(x?.[0] || "").trim() === dateLabel);
            if (!r) continue;
            const g = (column: string) => parseVnNumber(r[t.head.indexOf(column)]);
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
