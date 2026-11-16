// ═══════════════════════════════════════════════════════════════════
// Bản số theo NƯỚC × NGÀY × NGƯỜI — phần ĐỌC KHO (bảng market_monthly_reports, 15/11/2026).
// Phần thuần (cacThang, gomMess, kiểu BanNuoc) ở ./ban-nuoc.ts.
// ═══════════════════════════════════════════════════════════════════
import { query } from "@/lib/db";
import { monthsInRange, sumMessByPerson, type MarketMonthlyReport } from "./ban-nuoc";
import { MESS_PANCAKE } from "./rules";

/** Bản số của một tháng "YYYY-MM", hoặc null nếu vòng ghi Sheet chưa ghi tháng đó. */
export async function readMonthlyReport(month: string): Promise<MarketMonthlyReport | null> {
    try {
        const rows = await query<{ content: MarketMonthlyReport }>("SELECT content FROM market_monthly_reports WHERE month = @thang", { thang: month });
        return rows[0]?.content ?? null;
    } catch (e) {
        console.error("ban-nuoc: không đọc được market_monthly_reports:", e);
        return null;
    }
}

/**
 * Mess Pancake (nước MESS_PANCAKE mà người xem được thấy — `choXem(khoá nước)`) theo người trong
 * khoảng [tu, den]. `thieu_thang`: tháng không có bản (vòng ghi Sheet chưa chạy) — số tháng đó
 * không có trong tổng, màn hình phải nói ra.
 */
export async function pancakeMessFromReports(from: string, to: string, canView: (key: string) => boolean = () => true): Promise<{
    tong: number; theoNguoi: Record<string, number>; nuoc: string[]; ghi_luc: string | null; thieu_thang: string[];
}> {
    const keys = MESS_PANCAKE.filter(canView);
    const bans: MarketMonthlyReport[] = [];
    const missingMonths: string[] = [];
    let writtenAt: string | null = null;
    if (keys.length) {
        for (const t of monthsInRange(from, to)) {
            const b = await readMonthlyReport(t);
            if (!b) { missingMonths.push(t); continue; }
            bans.push(b);
            if (b.ghi_luc && (!writtenAt || b.ghi_luc < writtenAt)) writtenAt = b.ghi_luc;
        }
    }
    return { ...sumMessByPerson(bans, from, to, keys), nuoc: keys, ghi_luc: writtenAt, thieu_thang: missingMonths };
}
