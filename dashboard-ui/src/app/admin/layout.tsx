import { Suspense } from "react";
import AdminShell from "@/components/admin/admin-shell";

// Khung Quản trị dùng chung cho /admin và /admin/<mục> (15/11/2026): nằm ở layout nên chuyển mục chỉ
// đổi đường dẫn, khung không dựng lại. proxy.ts vẫn chặn /admin/* với người không phải giám đốc.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
    return (
        <>
            {/* Suspense: trang Khoá kết nối đọc tham số trên địa chỉ (?tab=…, useSearchParams). */}
            <Suspense fallback={null}>
                <AdminShell />
            </Suspense>
            {children}
        </>
    );
}
