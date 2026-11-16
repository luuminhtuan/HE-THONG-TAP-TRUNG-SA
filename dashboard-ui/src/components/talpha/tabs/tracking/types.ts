/* Kiểu dữ liệu của tab Theo dõi vận đơn (/api/talpha/tracking). */

export type Shipment = {
    tracking: string; order_uid: string | null; order_id: string; order_date: string | null;
    customer: string; phone: string; marketer: string | null; sale: string | null;
    cod_local: number; status: string | null; sub_status: string | null;
    status_since: string | null; last_event_time: string | null; last_event: string | null;
    registered: boolean;
    source?: "doi_tac" | "17track" | "weship" | null;
    raw_status?: string | null;
    store_name?: string; store_code?: string; ship_method?: string;
    /** Mã khách đọc khi lấy hàng = mã tracking (máy chủ tính, xem maLayHang). */
    pickup_code?: string | null;
    track17_code?: string | null;
    city?: string | null; fail_count?: number | null;
    /** Link WhatsApp kèm tin xác nhận đơn, dựng ở máy chủ — chỉ UAE (29/09/2026); còn lại null. */
    wa?: string | null;
};
export type Alert = {
    level: "gap" | "canh_bao" | "nhac";
    code: string; title: string; detail: string; days: number | null; shipment: Shipment;
    /** Còn mấy ngày là bị trả về (API tính, âm = quá hạn) — chỉ đơn đang ở cửa hàng. */
    days_left?: number | null;
};

export type LastSync = {
    at: string; ok: boolean; error?: string;
    registered?: number; checked?: number; quota_out?: boolean;
    /** Số mã 17TRACK từ chối đăng ký ở lượt cuối (Sagawa — Nhật, 13/10/2026). */
    register_rejected?: number;
    /** Lượt tra WeShip (UAE): số mã đem tra, trang báo không có, lỗi. */
    targets?: number; not_found?: number; failed?: number;
    quota?: { total: number; used: number; remain: number } | null;
    keys?: { label: string; ok: boolean; error?: string }[];
};
