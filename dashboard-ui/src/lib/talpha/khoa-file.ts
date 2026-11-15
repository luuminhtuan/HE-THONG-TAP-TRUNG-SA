// ═══════════════════════════════════════════════════════════════════
// Khoá kết nối nhập ở /admin (04/11/2026) — phần THUẦN: soát khoá vừa dán, che khoá.
// Phần đụng kho và mạng ở lib/talpha/khoa.ts (bảng api_credentials, 15/11/2026 — trước đó file
// .env.khoa.local; đọc file cũ để chép vào kho nay ở sync/core/file_import.py). Có test:
// tests/khoa.test.cjs.
// ═══════════════════════════════════════════════════════════════════

/** Lỗi định dạng của khoá vừa dán, hoặc null nếu ghi được. */
export function loiGiaTri(v: string): string | null {
    if (!v) return "Khoá trống";
    if (v.length > 4096) return "Khoá dài quá 4.096 ký tự — có lẽ đã dán nhầm cả đoạn văn bản";
    if (/\s/.test(v)) return "Khoá có khoảng trắng hoặc xuống dòng — dán lại đúng một khoá";
    if (/["'#\\$`]/.test(v)) return "Khoá có ký tự lạ (nháy, #, \\, $, `) — khoá thật không có các ký tự này";
    return null;
}

/** Che khoá: chỉ lộ 4 ký tự cuối, đủ để nhận ra đang dùng khoá nào. */
export function cheKhoa(v: string): string {
    if (!v) return "";
    return v.length <= 8 ? "••••" : `••••${v.slice(-4)}`;
}
