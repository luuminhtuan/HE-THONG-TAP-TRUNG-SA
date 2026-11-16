import type { Metadata } from "next";
import { tabTitle } from "@/components/talpha/nav-config";

// /talpha/<tab> (vd /talpha/order-ledger): khung trang (../layout.tsx) đọc tab từ đường dẫn và dựng
// nội dung. Trang này không có gì — để chuyển tab không dựng lại cả khung (menu, quyền, khoảng ngày).
// Chỉ khai tên thẻ trình duyệt theo tab (đặt bằng document.title thì tải lại trang bị Next ghi đè).
export async function generateMetadata({ params }: { params: Promise<{ tab: string }> }): Promise<Metadata> {
    return { title: tabTitle((await params).tab) };
}

export default function TalphaTabPage() {
    return null;
}
