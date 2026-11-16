import type { Metadata } from "next";
import { adminSectionTitle } from "@/components/admin/admin-sections";

// /admin/<mục> (vd /admin/markets): khung (../layout.tsx) đọc mục từ đường dẫn và dựng nội dung.
// Trang này chỉ khai tên thẻ trình duyệt theo mục.
export async function generateMetadata({ params }: { params: Promise<{ section: string }> }): Promise<Metadata> {
    return { title: adminSectionTitle((await params).section) };
}

export default function AdminSectionPage() {
    return null;
}
