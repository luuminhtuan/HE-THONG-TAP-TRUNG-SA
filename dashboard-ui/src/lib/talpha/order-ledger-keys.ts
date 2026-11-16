/**
 * Khoá ghép của sổ đơn hàng (mã vận đơn, mã đơn, mã gốc đơn giao lại, mã sản phẩm) + thứ tự hiển thị.
 * Tách khỏi order-ledger.ts (16/11/2026) — order-ledger.ts re-export nguyên tên.
 * Hàm thuần — không đọc file, không gọi mạng, không đọc luật.
 */

// ─────────────────────────────────────────────────────────────────────────
// Chuẩn hoá khoá — phải giống hệt cod-recon.ts, lệch một chữ là hai bên
// khoá khác nhau và không đơn nào ghép được.
// ─────────────────────────────────────────────────────────────────────────
/**
 * Mới nhất lên đầu (15/11/2026 — mọi danh sách có thời gian xếp giảm dần): theo ngày lên đơn, không có
 * thì ngày gửi hãng, cùng ngày thì mã đơn lớn trước (T1467 trên T1465). Đơn không có ngày xuống cuối.
 * Trả MẢNG MỚI, không sửa mảng truyền vào.
 */
export function sortNewestFirst<T extends { order_date?: string | null; ship_date?: string | null; order_no?: string | null }>(ds: T[]): T[] {
    const date = (x: T) => String(x.order_date || x.ship_date || "");
    return [...ds].sort((a, b) => date(b).localeCompare(date(a))
        || String(b.order_no || "").localeCompare(String(a.order_no || ""), "vi", { numeric: true }));
}

export function trackKey(v?: string | null): string {
    const s = String(v ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    return /^\d+$/.test(s) ? s.replace(/^0+/, "") || s : s;
}

const STRIP = [/^TAIWAN[-\s]*/i, /[-\s]*Z$/i, /-\d+$/];
export function orderKey(v?: string | null): string {
    let s = String(v ?? "").trim().toUpperCase().replace(/\s*\([^)]*\)\s*/g, " ").trim();
    for (const re of STRIP) s = s.replace(re, "");
    return s.trim();
}

/**
 * Mã vận đơn GỐC của một ĐƠN GIAO LẠI (hàng hoàn gửi cho khách khác, 转寄).
 * Hai bên ghi hai kiểu, và mã gốc là thứ DUY NHẤT cả hai cùng ghi:
 *
 *   Sheet:  mã đơn "T1467 (7564042426-z)"  → mã gốc nằm trong ngoặc
 *   NAZA:   mã đơn "7564042426-Z"           → kèm mã vận đơn MỚI do NAZA cấp
 *
 * Mã vận đơn Sheet ghi cho loại đơn này thì không tin được: cả ba đơn giao lại
 * của kỳ 9.11 đều ghi sai, T1467 còn chép nhầm mã của T1465.
 */
export function redeliveryOrigin(orderNo?: string | null): string {
    const m = String(orderNo ?? "").match(/\(\s*([0-9A-Z]+)\s*-\s*Z\s*\)/i);
    return m ? trackKey(m[1]) : "";
}

/** Phía NAZA của cùng loại đơn: "7564042426-Z" → "7564042426". */
export function nazaRedeliveryOrigin(orderNo?: string | null): string {
    const m = String(orderNo ?? "").trim().replace(/^TAIWAN[-\s]*/i, "").match(/^([0-9A-Z]+)\s*-\s*Z$/i);
    return m ? trackKey(m[1]) : "";
}

/** Mã sản phẩm trong chuỗi SKU. Một đơn có thể GHÉP nhiều mã:
 *  "042 - BLACK + 043 - COFFEE" là hai sản phẩm, phải cộng cả hai giá vốn. */
export function productCodes(sku?: string | null): string[] {
    return [...new Set(String(sku ?? "").match(/\b\d{3}\b/g) || [])];
}
