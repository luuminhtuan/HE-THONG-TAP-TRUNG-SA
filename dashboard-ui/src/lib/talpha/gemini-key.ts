// ═══════════════════════════════════════════════════════════════════
// Khoá Gemini RIÊNG của một trình duyệt (16/11/2026) — trang Hỏi AI.
//
// Khoá mặc định của hệ thống nằm ở Quản trị → Khoá kết nối → tab Gemini (bảng api_credentials, dùng
// chung cả công ty). Hết hạn mức thì người hỏi dán khoá khác ngay ở trang Hỏi AI: khoá đó CHỈ lưu ở
// localStorage của trình duyệt đó — máy khác, trình duyệt khác không thấy, nên hai người không vô tình
// dùng chung một khoá. Mỗi câu hỏi gửi khoá kèm header dưới đây; máy chủ dùng cho đúng câu đó, không
// lưu, không ghi log. Có khoá riêng thì dùng khoá riêng; không có thì dùng khoá mặc định.
//
// File thuần (không import gì của máy chủ) — trang và route dùng chung.
// ═══════════════════════════════════════════════════════════════════

/** Header mang khoá riêng từ trình duyệt lên /api/talpha/ceo-ask. */
export const GEMINI_KEY_HEADER = "x-gemini-key";

/** Chỗ lưu trong localStorage của trình duyệt. */
export const GEMINI_KEY_STORAGE = "talpha-gemini-key";

/** Khoá đi từ trình duyệt: dùng khoá riêng hay khoá mặc định của hệ thống. */
export type NguonKhoaGemini = "trinh_duyet" | "mac_dinh";

/** Dạng khoá chấp nhận — khoá Gemini hiện là "AIza…" 39 ký tự; nới rộng để khỏi chặn nhầm dạng mới. */
export const laKhoaGeminiHopLe = (k: string | null | undefined): k is string =>
    /^[A-Za-z0-9_-]{20,200}$/.test(String(k || ""));

/** Che khoá để hiện trên màn hình: "AIza…wxyz". */
export const cheKhoa = (k: string) => (k.length > 10 ? `${k.slice(0, 4)}…${k.slice(-4)}` : "••••");
