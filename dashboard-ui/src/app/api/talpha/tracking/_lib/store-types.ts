import type { Quota } from "@/lib/talpha/track17";

// Kiểu của sổ vận đơn (kho `tracking`, mỗi nước một sổ — TrackMarket.store) và vài hàm nhỏ dùng chung
// giữa đọc (load-shipments.ts) và đồng bộ 17TRACK (sync-17track.ts).

/** `number` = mã đã đưa cho 17TRACK (7-Eleven có tiền tố 73N, khác khoá sổ). */
export type Registered = {
    order_uid: string | null; registered_at: string; carrier: number | null; number?: string;
    /** Số lần đã đổi hãng vì 17TRACK đoán nhầm — chặn vòng đổi mãi không xong. */
    carrier_changes?: number;
    /** Khoá (tài khoản 17TRACK) đã đăng ký mã này — chỉ khoá đó hỏi được trạng thái. */
    key_id?: string;
};
/** Kết quả một lượt của MỘT khoá — tin Zalo nêu đích danh khoá nào hỏng. */
export type KeySync = {
    label: string; ok: boolean; error?: string;
    registered?: number; checked?: number; quota?: Quota | null;
};
export type LastSync = {
    at: string; ok: boolean; error?: string;
    registered?: number; checked?: number; changed?: number; carrier_fixed?: number;
    register_rejected?: number; over_cap?: number; deferred?: number; quota_out?: boolean;
    /** Quota CỘNG của mọi khoá hỏi được. */
    quota?: Quota | null;
    keys?: KeySync[];
    /** Mã đã đăng ký bằng khoá không còn trong .env — không ai hỏi được nữa. */
    orphaned?: number;
};

export const sumQuotas = (qs: Quota[]): Quota | null => qs.length ? qs.reduce((a, q) => ({
    total: a.total + q.total, used: a.used + q.used, remain: a.remain + q.remain, today_used: a.today_used + q.today_used,
}), { total: 0, used: 0, remain: 0, today_used: 0 }) : null;
export type Saved = {
    status: string | null; sub_status: string | null; status_since: string;
    last_event_time: string | null; last_event: string | null;
    source?: "doi_tac" | "17track"; raw_status?: string | null;
    ship_date?: string | null; order_date?: string | null;
    /** Đơn đối tác đã ghi kết thúc: trạng thái 17TRACK chỉ lưu ĐỂ ĐỐI CHIẾU, không đè. */
    t17_status?: string | null; t17_sub_status?: string | null; t17_event?: string | null; t17_at?: string;
};
export type PartnerMeta = {
    tracking?: string;
    order_no: string; ship_method: string; cod_local: number; marketer: string;
    recon: string; store_name: string; store_code: string;
    ship_date: string | null; track17_code: string | null;
    // Thêm 05 trường cho Sổ đơn hàng: nó cần cả khách lẫn hàng, không chỉ vận đơn.
    order_date?: string | null;
    contact_name?: string; phone?: string;
    sku?: string; quantity?: string;
    return_order_no?: string;
};
export type Store = {
    registered: Record<string, Registered>;
    statuses: Record<string, Saved>;
    partner?: Record<string, PartnerMeta>;
    partner_import?: { imported_at: string };
    last_sync?: LastSync;
};

export const emptyStore = (): Store => ({ registered: {}, statuses: {}, partner: {} });

// Khoá sổ có khi dính ký tự lạ từ Sheet (dấu nháy cong trước/sau mã) — bỏ đi trước khi
// sinh mã 17TRACK, nếu không mã 8 số của 7-Eleven không được thêm tiền tố 73N.
export const clean = (x?: string | null) => String(x || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
