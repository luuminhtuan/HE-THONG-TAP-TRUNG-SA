// Kiểu dữ liệu của config/talpha_rules.json — tách khỏi rules.ts (16/11/2026).
// CHỈ KIỂU, không có mã chạy: rules.ts nhập bằng `import type` nên thứ tự nạp module không đổi.

/** "da_tat" (04/11/2026): ngừng kéo số mới, GIỮ tỷ giá / số chia / đơn cũ — xem MARKET_DA_TAT. */
export type MarketStatus = "dang_ban" | "sap_chay" | "da_tat";
/** Một nước trong `markets`. Nước "sap_chay" chưa có shop/tỷ giá/số chia → các ô đó null. */
export type MarketInfo = {
    shop_label: string; shop_id?: string; currency: string; currency_symbol?: string;
    rate_vnd: number | null; pos_money_divisor: number | null;
    display?: string; status?: MarketStatus; flag?: string;
    orders_from?: string | null; pos_money_divisor_confirmed?: boolean;
    phone?: { cc: string; national_len: number; trunk?: string; whatsapp?: boolean };
    /** "pancake" = Meta không báo số tin nhắn ở nước này (Nhật), đếm ở hộp thư Pancake. */
    mess_source?: string;
};
export type ScanRule = { key: string; substrings?: string[]; word_tokens?: string[]; regex?: string };
export type ShipFee = { partner?: string; packing: number; delivery: number; cod_pct: number; cod_flat: number };
export type Rules = {
    version: string;
    marketers: Record<string, { display: string; full: string; inactive?: boolean }>;
    camp_marketer_tokens: Record<string, string>;
    pos_marketer_rules: { contains: string; key: string }[];
    camp_scan_rules: ScanRule[];
    markets: Record<string, MarketInfo>;
    market_aliases: Record<string, string>;
    camp_market_tokens: string[];
    status: { gtc_category: string; gtc_status_names: string[] };
    test_campaign: { pattern: string; exempt_markets: string[] };
    shipping_fees: Record<string, ShipFee | string>;
    pos_timezone: string;
    page_id_pattern: string;
    products?: Record<string, ProductCost | string>;
    targets?: {
        monthly_revenue_vnd?: Record<string, number | string>;
    };
    report_start_date?: string;
    report_sheets?: { grand_by_month?: Record<string, string> };
};
export type ProductCost = { name: string; cost_price_rmb?: number; cost_price_vnd: number };
