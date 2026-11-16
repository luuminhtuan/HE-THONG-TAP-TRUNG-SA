/**
 * Kiểu dữ liệu vào / ra của sổ đơn hàng. Tách khỏi order-ledger.ts (16/11/2026) —
 * order-ledger.ts re-export nguyên tên. Chỉ kiểu, không có mã chạy.
 */

// ─────────────────────────────────────────────────────────────────────────
// Kiểu dữ liệu vào
// ─────────────────────────────────────────────────────────────────────────
export type OrderSource = {
    order_no: string;
    tracking: string;
    track17_code?: string | null;
    return_order_no?: string | null;
    order_date?: string | null;
    ship_date?: string | null;
    ship_method?: string;
    sku?: string;
    quantity?: string | number;
    contact_name?: string;
    phone?: string;
    cod_twd: number;
    status?: string | null;        // mã trạng thái chuẩn (Delivered, InTransit…)
    status_raw?: string;           // chữ đối tác ghi
    recon_manual?: string;         // cột "Đối soát" người gõ tay
    marketer?: string;
};

export type PaidLine = {
    tracking: string;
    order_no: string;
    amount_twd: number;
    paid_date?: string;
    period?: string;               // tên bản sao kê
    rate_twd_rmb?: number | null;
    rate_rmb_vnd?: number | null;
};

export type FeeLine = {
    tracking: string;
    order_no: string;
    ship_fee_rmb: number;
    op_fee_rmb: number;
    expected_ship_fee?: number | null;
    period?: string;
    rate_rmb_vnd?: number | null;
};

// ─────────────────────────────────────────────────────────────────────────
// Kiểu dữ liệu ra
// ─────────────────────────────────────────────────────────────────────────
export type Light = "xanh" | "vang" | "do" | "xam";

export type Tick = {
    doi_soat: boolean;
    tru_van_chuyen: boolean;
    tru_tien_hang: boolean;
};

export type LedgerRow = {
    // định danh
    order_no: string;
    tracking: string;
    track17_code: string;
    return_order_no: string;
    // thời gian
    order_date: string;
    ship_date: string;
    age_days: number | null;
    /** Số kỳ sao kê đã chốt SAU ngày đơn này giao. >= 2 mà chưa có tiền là quá hạn. */
    ky_da_qua: number;
    // hàng & khách
    ship_method: string;
    sku: string;
    product_codes: string[];
    quantity: number;
    contact_name: string;
    phone: string;
    marketer: string;
    // trạng thái
    status: string;
    status_raw: string;
    recon_manual: string;
    // tiền vào
    cod_twd: number;
    paid_twd: number | null;
    paid_date: string;
    paid_period: string;
    matched_by: "tracking" | "order_id_giao_lai" | null;
    diff_twd: number | null;
    // tiền ra
    ship_fee_rmb: number | null;
    op_fee_rmb: number | null;
    fee_wrong: boolean;
    cogs_vnd: number | null;
    cogs_missing: string[];        // mã sản phẩm chưa khai giá vốn
    // kết quả
    gross_vnd: number | null;      // tiền 3PL trả, quy ra VND
    fee_vnd: number | null;
    net_vnd: number | null;
    /** true khi CHƯA trừ được giá vốn — con số "còn lại" mới là tạm. */
    net_before_cogs: boolean;
    // ô tích & đèn
    tick: Tick;
    light: Light;
    light_note: string;
};

export type LedgerSummary = {
    total: number;
    by_light: Record<Light, number>;
    cod_total_twd: number;
    paid_total_twd: number;
    pending_twd: number;        // đã giao, tiền chưa về
    overdue_twd: number;
    fee_total_rmb: number;
    cogs_known: number;         // số đơn tính được giá vốn
    cogs_missing_orders: number;
    net_total_vnd: number;      // chỉ cộng đơn tính đủ (đã trừ giá vốn)
    net_partial_vnd: number;    // đơn mới trừ được phí, chưa trừ giá vốn
    extra_lines: number;
};
