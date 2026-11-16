/**
 * Cấu hình đọc sao kê NAZA (talpha_rules.json → cod_settlement, shipping_fees.TW) + bảng giá ship.
 * Tách khỏi naza-statement.ts (16/11/2026) — naza-statement.ts re-export nguyên tên.
 */
import { RULES } from "./rules";

// ─────────────────────────────────────────────────────────────────────────
// Cấu hình
// ─────────────────────────────────────────────────────────────────────────
export type Channel = { code: string; name: string; first_kg: number; tokens: string[] };
type FeeTable = {
    partner?: string;
    currency?: string;
    declared?: boolean;
    channels?: Channel[];
    extra_kg?: { under_3kg?: number; over_3kg?: number };
    op_fee_per_parcel?: number;
};
type SettlementCfg = {
    statement_sheets?: { summary?: string[]; cod?: string[]; fee?: string[] };
    header_anchors?: Record<string, string[]>;
    order_id_strip?: string[];
    amount_tolerance_local?: number;
    pending_alert_days?: number;
};

export const CFG: SettlementCfg =
    (RULES as unknown as { cod_settlement?: SettlementCfg }).cod_settlement || {};
const FEES: FeeTable =
    (RULES as unknown as { shipping_fees?: Record<string, FeeTable> }).shipping_fees?.TW || {};

export const SHEETS = CFG.statement_sheets || {};
export const ANCHORS = CFG.header_anchors || {};

export const FEE_TABLE_DECLARED = FEES.declared === true;
export const OP_FEE_PER_PARCEL = Number(FEES.op_fee_per_parcel ?? 0);
export const PENDING_ALERT_DAYS = Number(CFG.pending_alert_days ?? 30);

// ─────────────────────────────────────────────────────────────────────────
// Bảng giá
// ─────────────────────────────────────────────────────────────────────────

/** Nhận kênh giao hàng từ chuỗi tự do. Mỗi file gọi một kiểu:
 *  'STWCOD专线-711', '7 ELEVEN', 'Family mart', 'STWCOD专线-新竹', 'GIAO TẠI NHÀ'. */
export function matchChannel(raw: string): Channel | null {
    const s = String(raw || "").toUpperCase();
    if (!s) return null;
    for (const ch of FEES.channels || []) {
        if ((ch.tokens || []).some((t) => s.includes(t.toUpperCase()))) return ch;
    }
    return null;
}

/** Phí đúng theo bảng giá: kg đầu theo kênh, phần dôi tính theo bậc kg. */
export function expectedShipFee(channel: Channel | null, kg: number | null): number | null {
    if (!channel) return null;
    const w = kg ?? 0;
    if (w <= 1) return channel.first_kg;
    const extraKg = Math.ceil(w - 1);
    const rate = w < 3 ? Number(FEES.extra_kg?.under_3kg ?? 0) : Number(FEES.extra_kg?.over_3kg ?? 0);
    return channel.first_kg + extraKg * rate;
}
