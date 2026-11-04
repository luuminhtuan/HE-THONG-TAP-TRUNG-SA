// ═══════════════════════════════════════════════════════════════════
// Khoá kết nối nhập ở /admin (04/11/2026) — phần THUẦN: đọc, sửa, che file khoá.
// Phần đụng đĩa và mạng ở lib/talpha/khoa.ts. Có test: tests/khoa.test.cjs.
//
// File khoá có dạng .env (mỗi dòng TÊN=giá trị) vì systemd đọc thẳng nó qua EnvironmentFile:
// sync và vòng ghi Sheet nhận khoá mới ở lần chạy kế tiếp mà không phải sửa code Python.
// Hai luật của systemd quyết định cách ghi:
//   • nó KHÔNG cắt ghi chú cuối dòng (xem from-mac.sh) → ghi chú luôn nằm ở dòng riêng;
//   • nó coi dấu nháy, khoảng trắng là một phần giá trị → khoá có mấy ký tự đó bị từ chối.
// ═══════════════════════════════════════════════════════════════════

const DONG = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;
const DAU_GHI_CHU = (ten: string) => `# ${ten}:`;

/** Các dòng TÊN=giá trị → Map. Bỏ dòng trống, ghi chú, dấu nháy bọc ngoài. */
export function docEnv(text: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const dong of text.split(/\r?\n/)) {
        const m = DONG.exec(dong);
        if (m) out.set(m[1], m[2].trim().replace(/^(["'])(.*)\1$/, "$2"));
    }
    return out;
}

/** Ghi chú "ai lưu, lúc nào" nằm ở dòng `# TÊN: …` ngay trên khoá. */
export function docGhiChu(text: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const dong of text.split(/\r?\n/)) {
        const m = /^# ([A-Za-z_][A-Za-z0-9_]*): (.*)$/.exec(dong);
        if (m) out.set(m[1], m[2].trim());
    }
    return out;
}

/**
 * Đặt (`giaTri` là chuỗi) hoặc bỏ (`null`) một khoá, giữ nguyên mọi dòng khác.
 * Khoá được đặt lại luôn chuyển xuống cuối file, kèm dòng ghi chú của nó.
 */
export function suaEnv(text: string, ten: string, giaTri: string | null, ghiChu = ""): string {
    const giu = (text ? text.split(/\r?\n/) : []).filter((dong) => {
        if (dong.startsWith(DAU_GHI_CHU(ten))) return false;
        const m = DONG.exec(dong);
        return !(m && m[1] === ten);
    });
    while (giu.length && giu[giu.length - 1].trim() === "") giu.pop();
    if (giaTri !== null) {
        const gc = ghiChu.replace(/\s+/g, " ").trim();
        if (gc) giu.push(`${DAU_GHI_CHU(ten)} ${gc}`);
        giu.push(`${ten}=${giaTri}`);
    }
    return giu.length ? giu.join("\n") + "\n" : "";
}

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
