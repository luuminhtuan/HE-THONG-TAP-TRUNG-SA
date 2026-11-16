// ── constants ──
export const ROAS_GOOD = 2.5;

// Nhãn tiếng Việt cho lý do đơn CHƯA MAP được vào campaign
export const UNMATCH_REASON_LABEL: Record<string, string> = {
    khong_ad_id: "Không có ad_id & không khớp fallback",
    trung_nhieu_campaign: "Trùng ≥2 campaign (không đoán)",
    marketer_ngoai_team: "Marketer ngoài team",
    thieu_page_id: "Đơn thiếu page_id",
    thieu_thi_truong: "Thiếu thị trường",
    khong_co_campaign_khop: "Không campaign nào khớp khoá",
};

// ── date helpers (ad account timezone +4 = Asia/Dubai) ──
export const AD_TZ = 'Asia/Dubai';
export function todayStr() { return new Date().toLocaleDateString('sv-SE', { timeZone: AD_TZ }); }
export function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString('sv-SE', { timeZone: AD_TZ }); }
export const DATE_PRESETS: { label: string; from: () => string; to: () => string }[] = [
    { label: "Hôm nay", from: todayStr, to: todayStr },
    { label: "Hôm qua", from: () => daysAgo(1), to: () => daysAgo(1) },
    { label: "3 ngày", from: () => daysAgo(2), to: todayStr },
    { label: "7 ngày", from: () => daysAgo(6), to: todayStr },
    { label: "14 ngày", from: () => daysAgo(13), to: todayStr },
    { label: "30 ngày", from: () => daysAgo(29), to: todayStr },
];
