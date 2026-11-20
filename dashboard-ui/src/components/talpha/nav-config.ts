// ═══════════════════════════════════════════════════════════════════
// Menu dashboard: mục → tab, mỗi tab một đường dẫn /talpha/<slug> (15/11/2026). File THƯỜNG (không
// "use client") để cả khung trang (dashboard-shell.tsx) lẫn route phía máy chủ
// (app/talpha/(dashboard)/[tab]/page.tsx → tên thẻ trình duyệt) cùng đọc.
// ═══════════════════════════════════════════════════════════════════

/**
 * Điều hướng gom về 5 mục theo đúng cấu trúc AUUS1 (Báo cáo · Sản phẩm ·
 * Marketer · Quảng cáo · Khách hàng). 9 tab cũ không mất tab nào — tab nào cùng
 * chủ đề thì nằm chung một mục và chọn bằng hàng pill ở đầu vùng nội dung.
 */
/** slug = đường dẫn của tab (/talpha/<slug>) — đổi slug là link cũ người ta đã gửi nhau hết mở được. */
export interface NavTab { id: string; label: string; slug: string }
export interface NavGroup { id: string; emoji: string; label: string; tabs: NavTab[] }

export const NAV_GROUPS: NavGroup[] = [
    {
        id: "bao-cao", emoji: "📋", label: "Báo cáo",
        tabs: [
            { id: "overview", label: "Tổng quan", slug: "overview" },
            { id: "pnl", label: "P&L", slug: "pnl" },
            { id: "product-pnl", label: "P&L theo SP", slug: "product-pnl" },
        ],
    },
    // Sổ đơn hàng gánh mọi việc THEO TỪNG ĐƠN — kể cả đòi NAZA tiền đơn quá hạn.
    //
    // Bản đầu tách Đơn hàng / Đối soát, người dùng phải nhảy qua nhảy lại: thấy
    // một đơn quá hạn ở tab Đối soát rồi lại sang tab Đơn hàng tra tên khách và
    // số điện thoại để đi đòi. Cùng một đơn, hai màn hình. Vì thế khi tách mục
    // Kế toán (07/10/2026) phần đòi tiền theo đơn Ở LẠI đây (khung "Đòi tiền
    // NAZA" trong Sổ đơn), chỉ phần tiền theo KỲ sang Kế toán.
    // "Danh sách đơn" đã BỎ, gộp vào Sổ đơn hàng.
    //
    // Hai tab đó chỉ khác nhau ở nguồn: tab cũ đọc POS (200 đơn, mà chỉ 5 đơn
    // có trạng thái giao đúng), Sổ đơn hàng đọc file đối tác (656 đơn, đủ vòng
    // đời tiền). Ba cột riêng của tab cũ thì: Marketer nay đã có trong Sổ,
    // Sale rỗng cho MỌI đơn vì sale_assignment chưa khai, còn Doanh thu VND
    // tính từ POS nên chỉ đúng cho 5 đơn — Sổ tính lại từ tiền 3PL trả thật.
    {
        id: "don-hang", emoji: "🧾", label: "Đơn hàng",
        tabs: [
            { id: "order-ledger", label: "Sổ đơn hàng", slug: "order-ledger" },
            { id: "tracking", label: "Theo dõi vận đơn", slug: "tracking" },
        ],
    },
    // KẾ TOÁN (Sỹ Anh chốt 07/10/2026): hai màn cùng trả lời "tiền thật có khớp không", cùng
    // một cách làm — tải file sao kê, máy soát, gõ số ngân hàng vào — và cùng tính theo KỲ.
    //   • Tiền COD về: tiền VÀO — sao kê NAZA từng kỳ, đối chiếu ngân hàng, tỷ giá. Leader
    //     xem + tải sao kê + nhập tiền về cho nước mình; leader và giám đốc kiểm soát chung,
    //     không có vai trò kế toán riêng. Sale (Thương) không vào mục này.
    //   • Thanh toán quảng cáo: tiền RA — file thanh toán TKQC đối chiếu sao kê thẻ. Thẻ và
    //     TKQC chạy chung cả công ty, không chia được theo team → chỉ giám đốc (CHI_GIAM_DOC).
    // Không gọi là "Chi phí quảng cáo": trùng tên tab trong mục Quảng cáo (tiêu bao nhiêu,
    // ROAS) — trùng tên là sớm muộn có người đem số đối soát đi tính ROAS.
    //   • Lãi lỗ (04/11/2026) đứng ĐẦU mục: kết quả kinh doanh đủ mọi khoản — doanh số → doanh
    //     thu (kiện giao thật, kiện đang đi theo tỉ lệ giao) → giá vốn → chi phí 3PL → chi phí
    //     khai thác (ads + vận hành) → lợi nhuận sau cùng. Mọi vai xem, chỉ nước của team mình.
    {
        id: "ke-toan", emoji: "💼", label: "Kế toán",
        tabs: [
            { id: "income-statement", label: "Lãi lỗ", slug: "income-statement" },
            { id: "cod-recon", label: "Tiền COD về", slug: "cod-recon" },
            { id: "ads-recon", label: "Thanh toán quảng cáo", slug: "ads-recon" },
        ],
    },
    { id: "san-pham", emoji: "📦", label: "Sản phẩm", tabs: [{ id: "products", label: "Sản phẩm & Kho", slug: "products" }] },
    { id: "marketer", emoji: "👤", label: "Marketer", tabs: [{ id: "marketing", label: "Marketing & Ads", slug: "marketing" }] },
    {
        id: "quang-cao", emoji: "🎯", label: "Quảng cáo",
        tabs: [
            { id: "ad-spend", label: "Chi phí quảng cáo", slug: "ad-spend" },
            { id: "ads-command", label: "Ads Command Center", slug: "ads-command" },
            { id: "ad-health", label: "Sức khoẻ quảng cáo", slug: "ad-health" },
        ],
    },
    {
        id: "khach-hang", emoji: "👥", label: "Khách hàng",
        tabs: [
            { id: "customers", label: "Khách hàng", slug: "customers" },
            { id: "market-intel", label: "Market Intel", slug: "market-intel" },
            // Tệp khách (14/11/2026): số THAM CHIẾU về người Việt / Phi / Indo ở từng nước —
            // thống kê nhà nước + quy mô đối tượng Facebook, lưu ở config/customer_segments.json.
            { id: "customer-segments", label: "Tệp khách", slug: "customer-segments" },
            // Soi đối thủ (15/11/2026): kết quả soi nhóm bán khác — kho POS, kênh TikTok, Ad Library —
            // kèm thư viện sản phẩm có ảnh + link spy, lưu ở config/competitor_research.json.
            { id: "competitor-research", label: "Soi đối thủ", slug: "competitor-research" },
        ],
    },
    // Hỏi AI (15/11/2026) — trước là một ô nhỏ ở cuối Tổng quan. Chỉ giám đốc (CHI_GIAM_DOC).
    // Tin nhắn (17/11/2026): hộp thư Pancake kéo về database 5 phút một lần — chỉ đọc; leader + giám đốc.
    { id: "tin-nhan", emoji: "💬", label: "Tin nhắn", tabs: [{ id: "messages", label: "Tin nhắn", slug: "messages" }] },
    { id: "hoi-ai", emoji: "🤖", label: "Hỏi AI", tabs: [{ id: "ask-ai", label: "Hỏi AI", slug: "ask-ai" }] },
    // Chấm công (20/11/2026): ai đăng nhập cũng thấy (PERSONAL_TABS) — tự chấm vào / ra, lịch tháng; giám đốc xem cả công ty.
    { id: "cham-cong", emoji: "🕒", label: "Chấm công", tabs: [{ id: "attendance", label: "Chấm công", slug: "attendance" }] },
];

/** Đường dẫn → tab, tab → (nhãn, đường dẫn, mục). */
export const TAB_BY_SLUG: Record<string, string> = Object.fromEntries(NAV_GROUPS.flatMap(g => g.tabs.map(t => [t.slug, t.id])));
export const TAB_INFO: Record<string, NavTab & { nhom: string }> = Object.fromEntries(
    NAV_GROUPS.flatMap(g => g.tabs.map(t => [t.id, { ...t, nhom: g.id }])));

/** Tên thẻ trình duyệt của một đường dẫn tab. */
export function tabTitle(slug: string): string {
    const id = TAB_BY_SLUG[slug];
    return id ? `${TAB_INFO[id].label} · ANTALO` : "ANTALO Dashboard";
}
