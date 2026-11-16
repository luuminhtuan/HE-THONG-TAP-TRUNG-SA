// Các mục Quản trị, mỗi mục một đường dẫn /admin/<slug> (15/11/2026). File THƯỜNG (không "use client")
// để cả khung (admin-shell.tsx) lẫn route phía máy chủ (app/admin/[section]/page.tsx → tên thẻ trình
// duyệt) cùng đọc. Đổi slug là link cũ người ta đã gửi nhau hết mở được.
export const ADMIN_SECTIONS = [
    { id: "ad-accounts", slug: "ad-accounts", label: "TKQC" },
    { id: "users", slug: "users", label: "Quản lý User" },
    { id: "markets", slug: "markets", label: "Thị trường" },
    { id: "credentials", slug: "credentials", label: "Khoá kết nối" },
] as const;

export type AdminSectionId = (typeof ADMIN_SECTIONS)[number]["id"];

export function adminSectionTitle(slug: string): string {
    const m = ADMIN_SECTIONS.find((x) => x.slug === slug) ?? ADMIN_SECTIONS[0];
    return `${m.label} · Quản trị · ANTALO`;
}
