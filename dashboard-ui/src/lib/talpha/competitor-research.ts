// ═══════════════════════════════════════════════════════════════════
// SOI ĐỐI THỦ — kết quả soi nhóm bán khác / đối thủ (bản đầu: Team 5 KIOT Taiwan, 12/11/2026).
//
// Đây là số THAM CHIẾU đọc từ kho POS của nhóm khác, kênh TikTok và Meta Ad Library — không
// phải số bán hàng của công ty. Số nằm ở config/competitor_research.json: mỗi lần soi là một bản trong
// `snapshots`, MỚI NHẤT ĐỨNG ĐẦU, không sửa bản cũ. Ảnh sản phẩm ở public/competitor-research/<nguồn>/.
//
// File này THUẦN: kiểu dữ liệu + hàm tính — không đụng `fs`, để tab (client component) dùng
// chung được. Đọc đĩa nằm ở route /api/talpha/competitor-research.
// ═══════════════════════════════════════════════════════════════════

export type ProductGroup = "running" | "best_seller" | "restocking" | "testing" | "avoid";

export const PRODUCT_GROUPS: { id: ProductGroup; name: string; description: string }[] = [
    { id: "running", name: "Đang chạy mạnh", description: "Xuất nhiều nhất 7 ngày gần nhất." },
    { id: "best_seller", name: "Bán nhiều nhất từ trước đến nay", description: "Hàng đã chạy lâu, một số đã chững." },
    { id: "restocking", name: "Đang đặt thêm hàng", description: "Nhóm kia nhập thêm nghĩa là đã có lời." },
    { id: "testing", name: "Đang test", description: "Bán khi chưa nhập hàng, nên tồn kho đang âm." },
    { id: "avoid", name: "Nên tránh", description: "Hoàn cao hoặc ôm tồn: xem để biết, không làm theo." },
];

export type SpyLink = { label: string; url: string };
export type TopVideo = { title: string; meaning: string; views: number | null };
export type SamplePhrase = { text: string; meaning: string };

export type CompetitorProduct = {
    id: string; group: ProductGroup; name: string; description: string; audience: string;
    /** Đường dẫn ảnh trong public/ (vd. /competitor-research/kiot-tw/simwood.jpg) hoặc null nếu kho không có ảnh. */
    image: string | null;
    created_on: string;
    shipped: number; shipped_7d: number; returning: number;
    /** returning / shipped; null khi chưa xuất cái nào. */
    return_rate: number | null;
    /** Tạo chưa đủ 4 tuần: hàng hoàn chưa kịp về nên tỉ lệ hoàn chưa có nghĩa. */
    is_new: boolean;
    on_order: number; stock: number; in_delivery: number;
    offer: string;
    top_video: TopVideo | null;
    links: SpyLink[];
};

export type TikTokChannel = {
    user: string; product: string; audience: string; videos: number; total_views: number; followers: number | null;
    top_video: { id: string; views: number; title: string; meaning: string };
};

export type ResearchSnapshot = {
    date: string; source: string;
    /** Mã nước của dashboard (TW · SG · AE · JP · VN) — dùng để cắt theo team. */
    market: string;
    researched_by: string; method: string; report_url?: string; follow_up?: string;
    summary: string[];
    overview: {
        products: number; skus: number; stocked_in: number; shipped: number; shipped_7d: number;
        returning: number; gifts: number; tiktok_channel_count: number; facebook_channel_count: number; started_on: string;
    };
    audiences: { name: string; title: string; examples: string[]; sample_phrase: string }[];
    signals: {
        restocking: { name: string; qty: number }[];
        testing: { name: string; qty: number; since: string }[];
        high_returns: { name: string; rate: number }[];
        overstock: { name: string; stock: number; stocked_in: number }[];
        gift_note: string;
    };
    ad_formulas: { label: string; title: string; body: string; sample_phrases?: SamplePhrase[] }[];
    tiktok_channels: TikTokChannel[];
    facebook: { note: string; items: { label: string; title: string; ad_count: number | null; body: string; link: string }[] };
    playbook: {
        note: string;
        test_list: { product: string; why: string; audience: string; caveat: string }[];
        plan: { when: string; title: string; tasks: string[] }[];
        sample_hooks: SamplePhrase[];
    };
    limitations: string[];
    products: CompetitorProduct[];
};

export type CompetitorResearchFile = { snapshots: ResearchSnapshot[] };

export type ReturnLevel = "good" | "fair" | "bad" | "new";

/** Mức tỉ lệ hoàn để tô màu: dưới 8% tốt, 8–15% vừa, trên 15% xấu; hàng mới chưa xếp. */
export function returnLevel(p: Pick<CompetitorProduct, "return_rate" | "is_new">): ReturnLevel {
    if (p.is_new || p.return_rate === null) return "new";
    if (p.return_rate < 0.08) return "good";
    if (p.return_rate <= 0.15) return "fair";
    return "bad";
}

/** Số gọn kiểu TikTok: 1.400.000 → "1,4M", 62.000 → "62K", 950 → "950". */
export function compactNumber(n: number): string {
    if (n >= 1e6) return `${(Math.round(n / 1e5) / 10).toString().replace(".", ",")}M`;
    if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
    return String(Math.round(n));
}

/** Sản phẩm xếp theo xuất 7 ngày (nhiều → ít) trong một nhóm. */
export function sortByLast7Days(products: CompetitorProduct[], group: ProductGroup): CompetitorProduct[] {
    return products.filter((p) => p.group === group).sort((a, b) => b.shipped_7d - a.shipped_7d);
}

/** Sản phẩm bán nhiều nhất từ trước đến nay (mọi nhóm trong thư viện). */
export function topSellers(products: CompetitorProduct[], n: number): CompetitorProduct[] {
    return [...products].sort((a, b) => b.shipped - a.shipped).slice(0, n);
}

/**
 * Chỉ giữ bản soi của thị trường người xem được phép (phân quyền theo team). `allowed(code)` do
 * route truyền vào (canMarket) để file này không kéo theo luật phân quyền.
 */
export function filterByMarket(f: CompetitorResearchFile, allowed: (code: string) => boolean): CompetitorResearchFile {
    return { ...f, snapshots: f.snapshots.filter((s) => allowed(s.market)) };
}
