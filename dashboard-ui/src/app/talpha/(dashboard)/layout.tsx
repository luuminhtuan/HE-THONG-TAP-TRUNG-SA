import { Suspense } from "react";
import TALPHADashboardShell from "@/components/talpha/dashboard-shell";

// Khung dashboard dùng chung cho /talpha và /talpha/<tab> (15/11/2026): nằm ở layout nên chuyển tab
// chỉ đổi đường dẫn, khung (menu, quyền người xem, khoảng ngày) không dựng lại. Trang
// /talpha/ads-command-center nằm NGOÀI nhóm (dashboard) nên không bị bọc khung này.
// Suspense: khung đọc tham số trên địa chỉ (useSearchParams).
export default function TalphaDashboardLayout({ children }: { children: React.ReactNode }) {
    return (
        <Suspense fallback={null}>
            <TALPHADashboardShell />
            {children}
        </Suspense>
    );
}
