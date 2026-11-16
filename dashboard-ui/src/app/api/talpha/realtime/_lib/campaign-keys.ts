// ═══ RULE CHUNG: import từ src/lib/talpha/rules.ts (data = config/talpha_rules.json).
// Golden-test 29/07 = 100% khớp bản inline cũ. Sửa rule → sửa JSON, KHÔNG thêm map ở đây.
import { MARKET_CANON, CAMP_MARKETS, PAGE_ID_RE, marketTokenIndex, normCampMarketer } from "@/lib/talpha/rules";

export function normalizeMarket(label?: string | null): string {
    const s = String(label || "").trim();
    if (!s) return "Unknown";
    return MARKET_CANON[s.toUpperCase()] || s;
}
// campaign_name → { mkt, nv, pageId } (mỗi field có thể null)
export function parseCampaign(campaignName?: string | null): { mkt: string | null; nv: string | null; pageId: string | null } {
    const parts = String(campaignName || "").split("/").map((x) => x.trim());
    let mkt: string | null = null;
    let marketerKey: string | null = null;
    const mi = marketTokenIndex(parts);
    if (mi >= 0) {
        mkt = CAMP_MARKETS[parts[mi].toUpperCase()];
        marketerKey = mi + 1 < parts.length ? normCampMarketer(parts[mi + 1]) : null;
    }
    let pageId: string | null = null;
    for (let i = 0; i < parts.length; i++) {
        const seg = parts[i].replace(/ /g, "");
        if (PAGE_ID_RE.test(seg) && i + 1 < parts.length && parts[i + 1].trim()) { pageId = seg; break; }
    }
    return { mkt, nv: marketerKey, pageId };
}
// khoá nối đơn↔campaign: marketer||market||page_id (cả 3 phải có)
export function fallbackKey(marketerKey?: string | null, mkt?: string | null, pageId?: string | null): string | null {
    if (!marketerKey || !mkt || !pageId) return null;
    return `${marketerKey}||${mkt}||${pageId}`;
}
