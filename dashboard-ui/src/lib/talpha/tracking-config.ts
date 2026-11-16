/**
 * Cấu hình theo dõi vận đơn (talpha_rules.json → tracking), bảng trạng thái, luật mã 17TRACK và
 * luật lệch trạng thái đối tác ↔ 17TRACK. Tách khỏi tracking.ts (16/11/2026) — tracking.ts
 * re-export nguyên tên. Hàm thuần — không gọi mạng, không đọc file.
 */
import { RULES } from "./rules";

// ─────────────────────────────────────────────────────────────────────────
// Cấu hình
// ─────────────────────────────────────────────────────────────────────────
export type TrackingConfig = {
    provider?: string;
    api_base?: string;
    carrier?: number | null;
    pickup_expire_days?: number;
    warn_before_expire_days?: number;
    transit_days_estimate?: number;
    stale_days?: number;
    batch_size?: number;
    rate_limit_per_sec?: number;
    register_max_age_days?: number;
    register_max_per_run?: number;
    register_scope?: string;
    register_reserve_pct?: number;
    register_from_date?: string | null;
    register_terminal?: boolean;
    code_fixes?: { match: string; prefix: string }[];
    markets?: Record<string, MarketCfgRaw | string>;
    carrier_rules?: { match: string; carrier: number }[];
};

export type MarketCfgRaw = {
    label?: string; store?: string; partner_market?: string; currency?: string;
    carrier?: number | null; stale_days?: number; status_map?: Record<string, string>;
    source?: string; pos_market?: string; provider?: string;
    weship?: { url?: string; tz_offset?: string; concurrency?: number; timeout_ms?: number };
    status_rules?: { match: string; status: string; sub_status?: string; vi?: string }[];
};

/** Luật chữ trạng thái của hãng (WeShip) → trạng thái chuẩn; luật trên thắng luật dưới. */
export type StatusRule = { match: RegExp; status: string; sub_status: string | null; vi: string };

/**
 * Thị trường theo dõi vận đơn. "TW" là thị trường gốc (bảng đối tác nạp tay, luật cửa hàng
 * tiện lợi ở phần chung); các nước khác khai ở tracking.markets — sổ riêng, hãng và ngưỡng
 * đứng im riêng. Hai kiểu nguồn:
 *   • source "partner" (Singapore): bảng đối tác partner_orders trong kho số + 17TRACK;
 *   • source "pos" (UAE): đơn đọc thẳng từ POS, trạng thái tra ở trang của hãng (provider
 *     "weship") — không có bảng đối tác, không tốn quota 17TRACK.
 */
export type TrackMarket = {
    code: string; label: string; store: string; partner_market: string | null;
    currency: string; carrier: number | null; stale_days: number;
    status_map: Record<string, string>;
    source: "partner" | "pos";
    provider: "17track" | "weship";
    /** Mã nước trong vw_orders_std.market (source "pos"). */
    pos_market: string | null;
    weship: { url: string; tz_offset: string; concurrency: number; timeout_ms: number } | null;
    status_rules: StatusRule[];
};

/**
 * "canh_bao": chỉ đơn đang có cảnh báo Gấp/Cảnh báo · "tat_ca": mọi đơn chưa kết thúc ·
 * "tu_dong": đơn cảnh báo trước, rồi tới mọi đơn đang đi — phần này chia nhịp theo quota
 * còn lại và số ngày còn lại trong tháng, để quota không cạn giữa tháng.
 */
export type RegisterScope = "canh_bao" | "tat_ca" | "tu_dong";

export const TRACK_CFG: Required<Omit<TrackingConfig, "carrier" | "register_scope" | "carrier_rules" | "register_from_date" | "code_fixes" | "markets">>
    & {
        carrier: number | null; register_scope: RegisterScope; register_from_date: string | null;
        carrier_rules: { match: RegExp; carrier: number }[]; code_fixes: { match: RegExp; prefix: string }[];
    } = (() => {
    const c: TrackingConfig = (RULES as unknown as { tracking?: TrackingConfig }).tracking || {};
    return {
        provider: c.provider ?? "17track",
        api_base: c.api_base ?? "https://api.17track.net/track/v2.4",
        carrier: c.carrier ?? null,
        pickup_expire_days: Number(c.pickup_expire_days ?? 7),
        warn_before_expire_days: Number(c.warn_before_expire_days ?? 2),
        transit_days_estimate: Number(c.transit_days_estimate ?? 3),
        stale_days: Number(c.stale_days ?? 21),
        batch_size: Math.min(Number(c.batch_size ?? 40), 40),   // 17TRACK trần 40
        rate_limit_per_sec: Math.min(Number(c.rate_limit_per_sec ?? 3), 3),
        register_max_age_days: Number(c.register_max_age_days ?? 45),
        register_max_per_run: Number(c.register_max_per_run ?? 300),
        // Khai sai chữ thì về "canh_bao" — hẹp hơn, tốn ít quota hơn.
        register_scope: c.register_scope === "tat_ca" || c.register_scope === "tu_dong" ? c.register_scope : "canh_bao",
        register_reserve_pct: Math.min(0.9, Math.max(0, Number(c.register_reserve_pct ?? 0.1))),
        // Ngày khai sai dạng thì bỏ, quay về luật tuổi — hỏng về phía tốn ÍT quota.
        register_from_date: /^\d{4}-\d{2}-\d{2}$/.test(String(c.register_from_date || "")) ? String(c.register_from_date) : null,
        register_terminal: c.register_terminal === true,
        code_fixes: (c.code_fixes || [])
            .filter((r) => r && r.match && r.prefix)
            .map((r) => ({ match: new RegExp(r.match), prefix: String(r.prefix) })),
        carrier_rules: (c.carrier_rules || [])
            .filter((r) => r && r.match && Number(r.carrier) > 0)
            .map((r) => ({ match: new RegExp(r.match), carrier: Number(r.carrier) })),
    };
})();

// ─────────────────────────────────────────────────────────────────────────
// Trạng thái
// ─────────────────────────────────────────────────────────────────────────

/** 9 trạng thái chính của 17TRACK. */
export type MainStatus =
    | "NotFound" | "InfoReceived" | "InTransit" | "Expired"
    | "AvailableForPickup" | "OutForDelivery" | "DeliveryFailure"
    | "Delivered" | "Exception";

export const STATUS_VI: Record<MainStatus, string> = {
    NotFound: "Chưa có thông tin",
    InfoReceived: "Đã tạo vận đơn",
    InTransit: "Đang vận chuyển",
    Expired: "Quá hạn theo dõi",
    AvailableForPickup: "Đã tới cửa hàng",
    OutForDelivery: "Đang giao",
    DeliveryFailure: "Giao hỏng",
    Delivered: "Đã giao",
    Exception: "Sự cố",
};

/**
 * Đơn đã đi tới đích cuối — không theo dõi tiếp, không cảnh báo.
 *
 * "Returned", "Cancelled" và "Destroyed" chỉ có ở file đối tác, không có trong
 * bảng của 17TRACK. Đơn đã hoàn về kho thì tiền mất rồi, nhắc nữa chỉ làm loãng
 * những đơn còn cứu được — nhưng vẫn ĐẾM để báo cáo tỷ lệ hoàn.
 */
export const TERMINAL: ReadonlySet<string> = new Set([
    "Delivered", "Expired", "Returned", "Cancelled", "Destroyed",
]);

/** Nhãn cho trạng thái chỉ có ở file đối tác. */
export const EXTRA_STATUS_VI: Record<string, string> = {
    Returned: "Đã hoàn về kho",
    Cancelled: "Đã huỷ",
    Destroyed: "Đã tiêu huỷ",
};

export function statusLabel(s?: string | null): string {
    if (!s) return "Chưa rõ";
    return STATUS_VI[s as MainStatus] || EXTRA_STATUS_VI[s] || "Chưa rõ";
}

/**
 * Mã có đáng đưa cho 17TRACK không. Khoá dạng mã đơn "T1304" (dòng đối tác chưa có mã
 * vận đơn) mà đem đăng ký là đốt một quota cho một mã không bao giờ có tin.
 */
export function isTrack17Number(n?: string | null): n is string {
    return !!n && /^[A-Za-z0-9]{8,40}$/.test(n) && /\d{6}/.test(n);
}

/** 17TRACK báo hàng đang/đã hoàn bằng Exception + sub_status Exception_Returning/Returned. */
const RETURN_SUB_RE = /Returning|Returned/i;

/**
 * Đối tác ghi đơn KẾT THÚC mà 17TRACK nói khác theo kiểu MẤT TIỀN → câu cảnh báo; không
 * lệch (hoặc lệch vô hại) → null. Chỉ bắt hai kiểu:
 *   • đối tác ghi ĐÃ GIAO, 17TRACK ghi sự cố / giao hỏng / đang hoàn — tiền COD có thể
 *     không bao giờ về mà sổ đối soát tưởng là về;
 *   • đối tác ghi HOÀN / HUỶ / TIÊU HUỶ, 17TRACK ghi KHÁCH ĐÃ NHẬN — tiền phải về, đòi.
 * Cố ý KHÔNG bắt "đối tác ghi đã giao, 17TRACK còn ở cửa hàng/đang đi": gần như luôn là
 * 17TRACK chưa kịp cập nhật, báo ra là nhiễu.
 */
export function statusMismatch(partner?: string | null, t17?: string | null, t17sub?: string | null): string | null {
    if (!partner || !t17 || t17 === "NotFound") return null;
    if (partner === "Delivered") {
        if (t17 === "Exception" && RETURN_SUB_RE.test(t17sub || "")) {
            return "Đối tác ghi ĐÃ GIAO, 17TRACK ghi hàng đang/đã HOÀN — tiền COD có thể không về.";
        }
        if (t17 === "Exception" || t17 === "DeliveryFailure") {
            return `Đối tác ghi ĐÃ GIAO, 17TRACK ghi “${statusLabel(t17)}” — kiểm lại trước khi đối soát COD.`;
        }
        return null;
    }
    if ((partner === "Returned" || partner === "Cancelled" || partner === "Destroyed") && t17 === "Delivered") {
        return `Đối tác ghi “${statusLabel(partner)}”, 17TRACK ghi KHÁCH ĐÃ NHẬN — tiền COD phải về, hỏi lại đối tác.`;
    }
    return null;
}

/** Sửa mã hỏng theo luật code_fixes (vd. FamilyMart bị Sheet nuốt số 0 đầu). */
export function fixTrack17Code(n?: string | null): string | null {
    if (!n) return null;
    for (const r of TRACK_CFG.code_fixes) if (r.match.test(n)) return r.prefix + n;
    return n;
}

/**
 * MÃ LẤY HÀNG ghi trong tin báo khách = MÃ TRACKING của kiện hàng.
 *
 * Trước 30/09/2026 tin ghi "取貨編號" bằng store_code — đó là mã CỬA HÀNG (7-11
 * 靜安 #265155), khách đọc cho nhân viên thì không tìm ra kiện nào. Sỹ Anh sửa: phải
 * là mã tracking. Lấy bản đã qua code_fixes (FamilyMart có lại số 0 đầu mà Sheet
 * nuốt mất), rồi bỏ tiền tố 73N — tiền tố đó chỉ 17TRACK cần cho mã 7-Eleven.
 */
export function pickupCode(tracking?: string | null, track17Code?: string | null): string {
    return String(track17Code || fixTrack17Code(tracking) || "").trim().replace(/^73N/i, "");
}
