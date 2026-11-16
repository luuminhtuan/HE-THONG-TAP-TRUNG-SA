/**
 * TIỀN COD ĐANG CHỜ BAO LÂU + COD ĐI ĐÂU (13/11/2026) — dùng chung màn Đài và các nước khác.
 *
 * Hai ô "Còn phải gửi" / "Chưa giao xong" chỉ nói BAO NHIÊU; phần này nói BAO LÂU — tiền NAZA giữ
 * quá 2 kỳ là phải đòi, đơn nằm đường quá 30 ngày gần như hoàn. Đơn đã giao chia theo số KỲ sao kê
 * đã qua (cùng thước đèn Sổ đơn hàng: 0 kỳ = đúng nhịp, 1 kỳ = theo dõi, ≥2 kỳ = quá hạn); chưa có
 * kỳ nào (UAE WeShip) thì chia theo ngày. Đơn chưa giao chia theo ngày từ lúc gửi.
 *
 * Khoá JSON (`da_giao`, `dung_nhip`…) là dạng dữ liệu API trả cho màn — giữ nguyên tên.
 * Hàm thuần — để test được (tests/cod-statement-market.test.cjs).
 */
import type { CodOrder } from "./cod-market";
import type { MarketCashFlow } from "./cod-market-ledger";

export type AgeBucket = { so_don: number; cod: number; vnd_uoc: number | null };
export type MoneyAge = {
    /** theo "ky" = số kỳ sao kê đã qua; "ngay" = chưa có kỳ nào → ≤14 / 15–30 / >30 ngày. */
    da_giao: { theo?: "ky" | "ngay"; dung_nhip: AgeBucket; qua_1_ky: AgeBucket; qua_han: AgeBucket; lau_nhat_ngay: number | null };
    chua_giao: { duoi_15: AgeBucket; tu_15_30: AgeBucket; tren_30: AgeBucket; lau_nhat_ngay: number | null };
};
/** COD các kỳ đã có sao kê đi đâu: phí giao hàng · tiền hàng bị trừ · về tay (VND). */
export type CodComposition = { so_ky: number; cod_quy_vnd: number; phi_vnd: number; tien_hang_vnd: number; ve_tay_vnd: number; ty_le_ve_tay: number };

const DAY_MS = 86_400_000;

/** Số ngày từ một ngày (yyyy-mm-dd…) tới hết ngày `asOf`; ngày hỏng → null. */
export function daysSince(date: string | null | undefined, asOf: string): number | null {
    const t = Date.parse(String(date || "").slice(0, 10));
    if (Number.isNaN(t)) return null;
    return Math.max(0, Math.floor((Date.parse(asOf + "T23:59:59") - t) / DAY_MS));
}

/** Ngày lâu nhất trong một nhóm (null = không đơn nào có ngày). */
export function oldestDays<T>(rows: T[], days: (r: T) => number | null): number | null {
    return rows.reduce<number | null>((m, r) => { const d = days(r); return d == null ? m : Math.max(m ?? 0, d); }, null);
}

/** Chia đơn chưa giao xong theo ngày nằm đường: ≤14 · 15–30 · >30. */
export function undeliveredAge<T>(rows: T[], days: (r: T) => number | null, bucket: (rs: T[]) => AgeBucket): MoneyAge["chua_giao"] {
    const d = (r: T) => days(r) ?? 0;
    return {
        duoi_15: bucket(rows.filter((r) => d(r) <= 14)),
        tu_15_30: bucket(rows.filter((r) => d(r) > 14 && d(r) <= 30)),
        tren_30: bucket(rows.filter((r) => d(r) > 30)),
        lau_nhat_ngay: oldestDays(rows, days),
    };
}

/**
 * Nước ngoài Đài: đơn không có ngày gửi riêng → đếm từ ngày lên đơn. Đơn đã giao chia theo số kỳ
 * sao kê chốt SAU ngày lên đơn. Trả kèm danh sách đơn quá hạn (≥2 kỳ) cho "Việc hôm nay" — chưa
 * có kỳ nào thì không báo quá hạn (đếm ngày không đủ căn cứ để đòi).
 */
export function marketMoneyAge(
    remaining: CodOrder[], periodDates: string[], asOf: string,
    estimate: (ds: CodOrder[]) => { so_don: number; cod_local: number; vnd_uoc: number | null },
): { age: MoneyAge; overdue: CodOrder[] } {
    const days = (d: CodOrder) => daysSince(d.order_date, asOf);
    const periodsPassed = (d: CodOrder) =>
        d.order_date ? periodDates.filter((n) => n > String(d.order_date).slice(0, 10)).length : 0;
    const bucket = (ds: CodOrder[]): AgeBucket => { const u = estimate(ds); return { so_don: u.so_don, cod: u.cod_local, vnd_uoc: u.vnd_uoc }; };
    const delivered = remaining.filter((d) => d.nhom === "da_giao");
    const inTransit = remaining.filter((d) => d.nhom === "chua_giao");
    const byPeriod = periodDates.length > 0;
    const level = (d: CodOrder) => byPeriod ? Math.min(2, periodsPassed(d))
        : ((n: number) => n <= 14 ? 0 : n <= 30 ? 1 : 2)(days(d) ?? 0);
    return {
        age: {
            da_giao: {
                theo: byPeriod ? "ky" : "ngay",
                dung_nhip: bucket(delivered.filter((d) => level(d) === 0)),
                qua_1_ky: bucket(delivered.filter((d) => level(d) === 1)),
                qua_han: bucket(delivered.filter((d) => level(d) === 2)),
                lau_nhat_ngay: oldestDays(delivered, days),
            },
            chua_giao: undeliveredAge(inTransit, days, bucket),
        },
        overdue: byPeriod ? delivered.filter((d) => periodsPassed(d) >= 2) : [],
    };
}

/**
 * COD các kỳ đi đâu: phí (tệ → đ) · tiền hàng · về tay = cộng phải nhận (kể cả kỳ âm). Chỉ cộng kỳ
 * có đơn VÀ đọc được đủ luồng (mẫu sao kê cũ 05/10 Sing không có sheet TỔNG → bỏ, nói rõ số kỳ đã
 * cộng). Kỳ âm không đơn (chỉ phí/tiền hàng, có khi đã trừ ở Đài) không cộng.
 */
export function marketCodComposition(periods: { so_dong: number; luong: MarketCashFlow | null }[]): CodComposition | null {
    const usable = periods.filter((x) => x.so_dong > 0 &&
        x.luong?.rmb != null && x.luong.ty_gia_vnd != null && x.luong.phai_nhan_vnd != null);
    if (!usable.length) return null;
    let cod = 0, fees = 0, goods = 0, received = 0;
    for (const x of usable) {
        const l = x.luong!;
        cod += l.rmb! * l.ty_gia_vnd!;
        fees += l.tru_rmb.reduce((t, d) => t + d.so, 0) * l.ty_gia_vnd!;
        goods += l.tru_vnd.filter((d) => d.loai !== "ky_truoc").reduce((t, d) => t + d.so, 0);
        received += l.phai_nhan_vnd!;
    }
    if (cod <= 0) return null;
    return {
        so_ky: usable.length, cod_quy_vnd: Math.round(cod), phi_vnd: Math.round(fees),
        tien_hang_vnd: Math.round(goods), ve_tay_vnd: Math.round(received), ty_le_ve_tay: received / cod,
    };
}
