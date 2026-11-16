/**
 * Thị trường theo dõi vận đơn (TW + tracking.markets), mã hãng 17TRACK của từng mã, và dòng bảng
 * đối tác → Shipment. Tách khỏi tracking.ts (16/11/2026) — tracking.ts re-export nguyên tên.
 * Khác tracking-market.ts: file đó đọc kho số / sổ của một nước, file này chỉ là luật thuần.
 */
import { RULES } from "./rules";
import {
    TRACK_CFG, TERMINAL, isTrack17Number,
    type MarketCfgRaw, type StatusRule, type TrackingConfig, type TrackMarket,
} from "./tracking-config";
import type { Shipment } from "./tracking-types";

/**
 * Mã hãng 17TRACK cho một mã vận đơn — luật carrier_rules trước, rồi `carrier` chung,
 * không khớp gì thì null (để 17TRACK tự đoán). Tự đoán hỏng thật: 7-Eleven bị từ chối,
 * FamilyMart bị nhận thành Bưu điện Ý — nên khai thẳng được mã nào thì khai.
 */
export function carrierFor(number?: string | null, market: string = "TW"): number | null {
    // Thị trường khai sẵn một hãng (Singapore = J&T SG) thì dùng hãng đó cho mọi mã —
    // luật theo dạng mã ở dưới là của Đài, áp sang nước khác là đoán bừa.
    const m = trackMarket(market);
    if (m.code !== "TW") return m.carrier;
    const n = String(number || "");
    for (const r of TRACK_CFG.carrier_rules) if (r.match.test(n)) return r.carrier;
    return TRACK_CFG.carrier;
}

// ─────────────────────────────────────────────────────────────────────────
// Thị trường
// ─────────────────────────────────────────────────────────────────────────

const RAW_MARKETS: Record<string, MarketCfgRaw> = (() => {
    const c = (RULES as unknown as { tracking?: TrackingConfig }).tracking?.markets || {};
    return Object.fromEntries(Object.entries(c).filter(([k, v]) => !k.startsWith("_") && v && typeof v === "object")) as
        Record<string, MarketCfgRaw>;
})();

const TW_MARKET: TrackMarket = {
    code: "TW", label: "Đài Loan", store: "tracking", partner_market: null,
    currency: "NT$", carrier: TRACK_CFG.carrier, stale_days: TRACK_CFG.stale_days, status_map: {},
    source: "partner", provider: "17track", pos_market: null, weship: null, status_rules: [],
};

/** Luật khai sai (regex hỏng, thiếu trạng thái) thì bỏ luật đó chứ không làm sập cả màn. */
function parseStatusRules(rules: MarketCfgRaw["status_rules"]): StatusRule[] {
    const out: StatusRule[] = [];
    for (const r of rules || []) {
        if (!r || !r.match || !r.status) continue;
        try {
            out.push({ match: new RegExp(r.match, "i"), status: r.status, sub_status: r.sub_status || null, vi: r.vi || r.status });
        } catch (e) {
            console.warn(`tracking: luật trạng thái hỏng "${r.match}":`, e);
        }
    }
    return out;
}

/** Các thị trường theo dõi được: TW trước, rồi các nước khai ở tracking.markets. */
export const TRACK_MARKETS: TrackMarket[] = [TW_MARKET, ...Object.entries(RAW_MARKETS).map(([code, m]): TrackMarket => ({
    code, label: m.label || code, store: m.store || `tracking_${code.toLowerCase()}`,
    partner_market: m.partner_market || null, currency: m.currency || "",
    carrier: m.carrier ?? null, stale_days: Number(m.stale_days ?? TRACK_CFG.stale_days),
    status_map: m.status_map || {},
    source: m.source === "pos" ? "pos" : "partner",
    provider: m.provider === "weship" ? "weship" : m.provider === "pos" ? "pos" : "17track",
    pos_market: m.pos_market || null,
    weship: m.provider === "weship" ? {
        url: m.weship?.url || "https://portal.weshipme.com/tracking",
        tz_offset: /^[+-]\d{2}:\d{2}$/.test(m.weship?.tz_offset || "") ? m.weship!.tz_offset! : "+04:00",
        concurrency: Math.min(5, Math.max(1, Number(m.weship?.concurrency ?? 3))),
        timeout_ms: Math.max(5000, Number(m.weship?.timeout_ms ?? 20000)),
    } : null,
    status_rules: parseStatusRules(m.status_rules),
}))];

/** Mã thị trường lạ → TW (thị trường gốc) — đọc nhầm sổ nước khác là trộn đơn hai nước. */
export function trackMarket(code?: string | null): TrackMarket {
    const c = String(code || "").toUpperCase();
    return TRACK_MARKETS.find((m) => m.code === c) || TW_MARKET;
}

/** Chữ trạng thái của đối tác → trạng thái chuẩn; không khai thì null (hiện nguyên văn). */
export function mapMarketStatus(market: TrackMarket, raw?: string | null): string | null {
    const t = String(raw || "").trim().normalize("NFC");
    if (!t) return null;
    if (market.status_map[t]) return market.status_map[t];
    const low = t.toLowerCase();
    for (const [k, v] of Object.entries(market.status_map)) if (k.normalize("NFC").toLowerCase() === low) return v;
    return null;
}

/** Một dòng bảng đối tác (partner_orders trong kho số) của thị trường ngoài Đài. */
export type PartnerOrderRow = {
    order_no?: string | null; tracking?: string | null; status?: string | null; note?: string | null;
    order_date?: string | null; ship_date?: string | null; contact_name?: string | null; phone?: string | null;
    cod?: number | null; marketer?: string | null; ship_method?: string | null; city?: string | null;
    /** Mã hàng + số lượng (cột SKU bảng đối tác) — tab Lãi lỗ tra giá vốn theo đó. */
    sku?: string | null; quantity?: string | number | null;
};

/** Trạng thái 17TRACK đã lưu trong sổ của thị trường. */
export type SavedTrack = {
    status: string | null; sub_status?: string | null; status_since?: string | null;
    last_event_time?: string | null; last_event?: string | null; source?: string | null;
};

const toIsoMidnight = (d?: string | null) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(0, 10)}T00:00:00Z` : null);

/**
 * Dòng bảng đối tác + trạng thái 17TRACK đã lưu → Shipment. Cùng luật với Đài:
 *   • 17TRACK có tin thì dùng 17TRACK (gần thời gian thực, bảng đối tác trễ);
 *   • TRỪ khi đối tác ghi KẾT THÚC mà 17TRACK chưa — kết thúc không lùi được; lúc đó
 *     giữ trạng thái đối tác và để 17TRACK ở t17_* cho cảnh báo lệch.
 */
export function partnerOrderShipment(
    market: TrackMarket, row: PartnerOrderRow, saved: SavedTrack | undefined, registered: boolean,
): Shipment {
    const tracking = String(row.tracking || "").replace(/\s+/g, "").toUpperCase();
    const raw = String(row.status || "").trim() || null;
    const pStatus = mapMarketStatus(market, raw);
    const anchor = toIsoMidnight(row.ship_date) || toIsoMidnight(row.order_date);
    const co17 = !!saved?.status && saved.source === "17track";
    const partnerTerminal = !!pStatus && TERMINAL.has(pStatus);
    const dung17 = co17 && !(partnerTerminal && !TERMINAL.has(saved!.status as string));
    return {
        tracking: tracking || `DON-${row.order_no || "?"}`,
        track17_code: tracking && isTrack17Number(tracking) ? tracking : null,
        order_uid: null,
        order_id: String(row.order_no || ""),
        order_date: row.order_date ? String(row.order_date).slice(0, 10) : null,
        customer: String(row.contact_name || ""),
        phone: String(row.phone || ""),
        store_name: "", store_code: "",
        ship_method: String(row.ship_method || ""),
        marketer: row.marketer ? String(row.marketer) : null,
        sale: null,
        cod_local: Number(row.cod) || 0,
        status: dung17 ? (saved!.status as string) : pStatus,
        sub_status: dung17 ? (saved!.sub_status ?? null) : null,
        status_since: dung17 ? (saved!.status_since ?? null) : anchor,
        last_event_time: dung17 ? (saved!.last_event_time ?? null) : anchor,
        last_event: dung17 ? (saved!.last_event ?? null) : raw,
        registered,
        source: dung17 ? "17track" : "doi_tac",
        raw_status: raw,
        ship_date: row.ship_date ? String(row.ship_date).slice(0, 10) : null,
        note: row.note ? String(row.note).trim() || null : null,
        city: row.city ? String(row.city).trim() || null : null,
        t17_status: co17 && !dung17 ? saved!.status : null,
        t17_sub_status: co17 && !dung17 ? (saved!.sub_status ?? null) : null,
        t17_event: co17 && !dung17 ? (saved!.last_event ?? null) : null,
    };
}
