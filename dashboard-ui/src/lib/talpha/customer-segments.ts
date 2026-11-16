// ═══════════════════════════════════════════════════════════════════
// TỆP KHÁCH — số tham chiếu về người Việt / Phi / Indo ở từng thị trường (14/11/2026).
//
// Đây là NGHIÊN CỨU THỊ TRƯỜNG (thống kê nhà nước + quy mô đối tượng Facebook), không phải
// số bán hàng. Số nằm ở config/customer_segments.json — mỗi lần đo lại thêm một bản vào ĐẦU mảng
// `snapshots`, không sửa bản cũ. Tab Khách hàng → Tệp khách đọc qua /api/talpha/customer-segments.
//
// File này THUẦN: kiểu dữ liệu + hàm tính (lọc nước, điểm giữa) — không đụng `fs`, để tab
// (client component) dùng chung được. Đọc đĩa nằm ở route.
// ═══════════════════════════════════════════════════════════════════

/** Khoảng ước tính của Meta: [thấp, cao], đơn vị tài khoản. */
export type Range = [number, number];
export type SegmentCode = "VN" | "PH" | "ID";
export const AGE_BANDS = ["18-24", "25-34", "35-44", "45+"] as const;

export type Segment = {
    fb: Range; male: Range; female: Range;
    ages: Record<string, Range>;
    /** Số người theo thống kê nhà nước, hoặc ước tính đại sứ quán (`official_kind`). */
    official: number;
    official_kind: "statistic" | "estimate";
    official_note: string;
    highlights: string[];
};
export type TableRow = { name: string; VN: number; PH: number; ID: number; total?: boolean };
export type SegmentTable = { title: string; source: string; share_of_total: boolean; rows: TableRow[] };
export type Trend = { title: string; periods: string[]; VN: number[]; PH: number[]; ID: number[] };
export type MarketSegments = {
    name: string; fb_country: Range; official_source: string;
    segments: Record<SegmentCode, Segment>;
    trend?: Trend;
    tables: SegmentTable[];
    notes: string[];
};
export type SegmentSnapshot = {
    measured_on: string; measured_by: string; method: string; report_url?: string;
    summary: string[];
    /** Khoá = mã nước của dashboard (TW · JP · SG). */
    markets: Record<string, MarketSegments>;
    recommendation: { note: string; ranking: { segment: string; reason: string }[] };
    limitations: string[];
    sources: { name: string; url: string }[];
};
export type SegmentGroup = { name: string; full_name: string; meta_behavior: string; fb_global: Range };
export type CustomerSegmentsFile = { groups: Record<SegmentCode, SegmentGroup>; snapshots: SegmentSnapshot[] };

export const midpoint = (k: Range) => (k[0] + k[1]) / 2;

/** Tỷ lệ nữ tính từ điểm giữa hai khoảng nam / nữ. */
export function femaleShare(t: Pick<Segment, "male" | "female">): number {
    const female = midpoint(t.female), male = midpoint(t.male);
    return female + male > 0 ? female / (female + male) : 0;
}

/** Tỷ trọng từng nhóm tuổi (điểm giữa), cộng lại = 1. */
export function ageShares(t: Pick<Segment, "ages">): number[] {
    const mids = AGE_BANDS.map((k) => (t.ages[k] ? midpoint(t.ages[k]) : 0));
    const sum = mids.reduce((x, y) => x + y, 0);
    return mids.map((x) => (sum > 0 ? x / sum : 0));
}

/**
 * Chỉ giữ thị trường người xem được phép (phân quyền theo team). `allowed(code)` do route truyền
 * vào (canMarket) để file này không kéo theo luật phân quyền. Bản nào hết thị trường thì bỏ.
 */
export function filterByMarket(f: CustomerSegmentsFile, allowed: (code: string) => boolean): CustomerSegmentsFile {
    const snapshots = f.snapshots
        .map((s) => ({
            ...s,
            markets: Object.fromEntries(Object.entries(s.markets).filter(([code]) => allowed(code))),
        }))
        .filter((s) => Object.keys(s.markets).length > 0);
    return { groups: f.groups, snapshots };
}
