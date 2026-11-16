/**
 * Kiểu dữ liệu vận đơn + cảnh báo. Tách khỏi tracking.ts (16/11/2026) — tracking.ts re-export
 * nguyên tên. Chỉ kiểu, không có mã chạy.
 */

// ─────────────────────────────────────────────────────────────────────────
// Kiểu dữ liệu
// ─────────────────────────────────────────────────────────────────────────

export type Shipment = {
    tracking: string;
    /** Mã đưa cho 17TRACK — 7-Eleven phải thêm tiền tố 73N, nên KHÁC mã vận đơn. */
    track17_code?: string | null;
    order_uid: string | null;
    order_id: string;
    order_date: string | null;
    customer: string;
    /** Cửa hàng tiện lợi khách ra lấy, và mã lấy hàng — cần để soạn tin nhắn
     *  báo khách. Chỉ file đối tác có, POS không ghi. */
    store_name?: string;
    /** MÃ CỬA HÀNG (7-11 #265155) — KHÔNG phải mã khách đọc khi lấy hàng. */
    store_code?: string;
    /** Mã khách đọc cho nhân viên cửa hàng khi lấy hàng = mã tracking (xem maLayHang). */
    pickup_code?: string | null;
    ship_method?: string;
    phone: string;
    marketer: string | null;
    sale: string | null;
    cod_local: number;              // TWD
    /** 9 mã của 17TRACK, cộng "Returned"/"Cancelled" chỉ file đối tác mới có. */
    status: string | null;
    sub_status: string | null;
    /** Lần đầu thấy đơn ở TRẠNG THÁI HIỆN TẠI — gốc để đếm "nằm ở cửa hàng mấy ngày". */
    status_since: string | null;
    last_event_time: string | null;
    last_event: string | null;
    registered: boolean;
    /** Trạng thái đến từ đâu — để UI nói rõ số này mới tới mức nào. "weship" = tra thẳng
     *  trang của hãng giao UAE (không qua 17TRACK). */
    source?: "doi_tac" | "17track" | "weship" | null;
    raw_status?: string | null;
    /** Ngày xuất kho theo file đối tác — đồng hồ đáng tin hơn status_since. */
    ship_date?: string | null;
    /** Ghi chú của đối tác (vd. "khách muốn nhận ngày 9/10") — sale cần khi gọi hẹn lại. */
    note?: string | null;
    /** Khu vực giao (giao tận nhà — Singapore) để sale biết khách ở đâu khi gọi. */
    city?: string | null;
    /** Trạng thái 17TRACK của đơn mà ĐỐI TÁC đã ghi kết thúc — chỉ để đối chiếu, không đè. */
    t17_status?: string | null;
    t17_sub_status?: string | null;
    t17_event?: string | null;
    /** Số lần giao hỏng hãng đã ghi (UAE/WeShip) — "hẹn lại lần 3" là khách sắp bỏ đơn. */
    fail_count?: number | null;
    /** Link WhatsApp của khách (lib/talpha/whatsapp.ts); null = số không chắc hoặc nước không bật. */
    wa?: string | null;
    /** Cột SKU + số lượng của bảng đối tác (Singapore, Nhật) — chỉ nguồn "partner" có. */
    sku?: string | null;
    quantity?: number | null;
    /** Địa chỉ giao đầy đủ (UAE, từ POS) — để tin xác nhận đơn nhắc khách soát địa chỉ. */
    address?: string | null;
};

/** gấp = sắp mất hàng · canh_bao = cần người xử · nhac = việc thường ngày. */
export type AlertLevel = "gap" | "canh_bao" | "nhac";

export type AlertCode =
    | "sap_bi_tra_ve"      // ở cửa hàng quá lâu, sắp hết hạn lấy
    | "toi_cua_hang"       // vừa tới cửa hàng, giục khách ra lấy
    | "giao_hong"          // DeliveryFailure / Exception
    | "dung_im"            // không nhúc nhích quá lâu
    | "lech_trang_thai"    // đối tác ghi kết thúc, 17TRACK nói khác — kiểu mất tiền COD
    | "chua_dang_ky";      // có mã vận đơn nhưng chưa đăng ký với 17TRACK

export type TrackAlert = {
    level: AlertLevel;
    code: AlertCode;
    title: string;
    detail: string;
    days: number | null;
    /** Còn mấy ngày là hàng ở cửa hàng bị trả về (âm = đã quá hạn). Chỉ có với đơn ở cửa hàng. */
    days_left?: number | null;
    shipment: Shipment;
};
