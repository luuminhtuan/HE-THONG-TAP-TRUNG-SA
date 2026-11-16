// ── types ──
export interface AdDetail {
    ad_id: string; ad_name: string; adset_name: string;
    spend_vnd: number; impressions: number; cpm_vnd: number; cpc_vnd: number; ctr: number;
    messages: number; purchases: number; orders: number; revenue_vnd: number; roas: number;
}

export interface RealtimeCampaign {
    account_id: string; account_name: string; campaign_id: string; campaign_name: string;
    spend_vnd: number; impressions: number; cpm_vnd: number; ctr: number;
    messages: number; purchases: number; orders: number; revenue_vnd: number; roas: number;
    ads_count: number; ads: AdDetail[];
    /** "pancake" = nước Meta không báo tin nhắn (Nhật): mess đếm ở hộp thư Pancake của page. */
    mess_nguon?: string;
}

export interface Summary {
    total_spend_vnd: number; total_revenue_vnd: number; total_orders: number;
    total_messages: number; matched_orders: number; unmatched_orders: number;
    /** Phần mess đếm ở Pancake (Nhật) — null khi không có camp nước đó. */
    mess_pancake?: { nuoc: string[]; tong: number; ok: boolean } | null;
    total_pos_orders: number; total_meta_purchases: number; blended_roas: number;
    matched_via_adid?: number; matched_via_fallback?: number; unmatched_ambiguous?: number;
    accounts_fetched: number; shops_fetched: number;
    matched_revenue_vnd: number; unmatched_revenue_vnd: number;
    // GTC thật (giao thành công) — rule báo cáo Sheet, thay ước lượng 65%
    delivered_revenue_vnd: number; delivered_orders: number; delivered_roas: number;
}

export interface RealtimeData {
    source: string; fetched_at: string; duration_ms: number;
    warnings?: string[]; // cảnh báo cap phân trang từ route (Meta 10 trang / POS 200 trang)
    accounts?: { id: string; name: string }[]; // 14 TKQC từ talpha.yaml (qua realtime route)
    summary: Summary; campaigns: RealtimeCampaign[]; unmatched_orders: any[];
    unmatched_by_shop: Record<string, { count: number; revenue_vnd: number }>;
    unmatched_by_reason?: Record<string, { count: number; revenue_vnd: number }>;
}
