/**
 * Kiểu dữ liệu của bản sao kê NAZA đã đọc. Tách khỏi naza-statement.ts (16/11/2026) —
 * naza-statement.ts re-export nguyên tên. Chỉ kiểu, không có mã chạy.
 */

// ─────────────────────────────────────────────────────────────────────────
// Kiểu dữ liệu
// ─────────────────────────────────────────────────────────────────────────
export type NazaCodLine = {
    recv_date: string | null;   // 收货日期 — ngày khách nhận hàng & trả tiền
    order_id: string;           // 原单号 — mã đơn của mình (KHÔNG duy nhất)
    tracking: string;           // 转单号 — mã vận đơn (khoá chính)
    channel: string;            // 产品名称
    cod_twd: number;            // COD金额
    /** Nước của đơn (国家名称 / tên kênh). Kho cũ chưa có trường này = Đài. */
    market?: NazaMarket;
    /** Mẫu Sing (từ kỳ 05/10/2026): tỷ giá SGD→tệ và tiền về sau phí thu hộ, theo từng đơn.
     *  Sao kê Đài không có hai cột này. */
    ty_gia_rmb?: number | null;     // 汇率
    ve_rmb?: number | null;         // 回款金额（RMB)
};

/** NAZA gửi sao kê Đài và Singapore — có kỳ gộp chung một file (24/09/2026). */
export type NazaMarket = "TW" | "SG";

export type NazaFeeLine = {
    ship_date: string | null;   // 出货日期
    order_id: string;
    tracking: string;
    channel: string;            // 运输方式
    chargeable_kg: number | null; // 计费重
    ship_fee: number;           // 速递运费 (RMB)
    op_fee: number;             // 操作费 / 打包费 (RMB)
    /** 头程运费 — phí chặng đầu, chỉ đơn Singapore có. Kho cũ chưa có trường này. */
    first_leg_fee?: number;
    /** Phí đúng theo bảng giá; null khi không nhận ra kênh giao hàng. */
    expected_ship_fee: number | null;
    channel_code: string | null;
    /** Nước của đơn. Kho cũ chưa có trường này = Đài. */
    market?: NazaMarket;
};

/**
 * PHẦN SINGAPORE NAZA GỘP VÀO SAO KÊ ĐÀI.
 *
 * Kỳ 2026.09.24 NAZA gửi một file cho cả hai nước: tiền COD chỉ của Đài, nhưng
 * phí ship đơn Sing và tiền hàng Sing trừ thẳng vào đó. Nên "phải nhận" của kỳ
 * là số SAU khi đã trừ phần Sing — đúng số NAZA chuyển về tài khoản. Bản sửa
 * "TAIWAN 2026.09.24" bỏ phần Sing ra thì phải nhận cao hơn đúng 3.600.206đ, và
 * không khớp tiền thật về. Từ kỳ sau NAZA tách file Sing riêng (Sỹ Anh báo 30/09).
 *
 * Phần này KHÔNG đem so với file tiền hàng Đài: tab đó chỉ ghi tiền hàng Đài.
 */
export type NazaSgPart = {
    don: number;                    // số dòng phí của đơn Sing
    phi_rmb: number;                // phí ship + chặng đầu + đóng gói của các đơn đó
    phi_vnd: number | null;         // quy theo tỷ giá RMB→VND của kỳ
    tien_hang_vnd: number | null;   // 新加坡本期采购费 VND
    tong_vnd: number | null;        // tổng phần Sing đã trừ vào tiền Đài
};

export type NazaSummary = {
    cod_twd: number | null;         // 本期回款金额
    refund_twd: number | null;      // 退款手续费 / 客诉退款
    rate_twd_rmb: number | null;    // 汇率
    ship_fee_rmb: number | null;    // 速递运费
    op_fee_rmb: number | null;      // 操作费
    net_rmb: number | null;         // 本期应退金额RMB
    rate_rmb_vnd: number | null;
    /** 采购费 — phí mua hàng ĐÀI, trừ thẳng vào tiền về. Đây là số đem so với file
     *  tiền hàng Đài, nên KHÔNG gồm dòng tiền hàng Sing ở kỳ gộp. */
    purchase_vnd: number | null;
    /** 新加坡本期采购费 — tiền hàng Sing NAZA trừ vào COD Đài (chỉ kỳ gộp). */
    purchase_sg_vnd?: number | null;
    payable_vnd: number | null;     // 本期应退金额VND
    /** Có file gộp '速递运费 + 操作费' vào MỘT dòng. Khi đó ship_fee_rmb đã
     *  gồm cả phí thao tác và op_fee_rmb là 0 — không được cộng thêm lần nữa. */
    fees_combined: boolean;
};

export type NazaStatement = {
    file: string;
    sheets: { summary: string | null; cod: string | null; fee: string | null };
    summary: NazaSummary;
    cod_lines: NazaCodLine[];
    fee_lines: NazaFeeLine[];
    /** File của nước nào: có dòng COD Đài là file Đài (kể cả kỳ gộp Sing). */
    market: NazaMarket;
    /** Phần Singapore gộp vào file Đài; null nếu file không có gì của Sing. */
    sg_gop: NazaSgPart | null;
    /** Mọi dòng có số của sheet TỔNG, đúng thứ tự file: nhãn Trung · nhãn Việt · số. Màn
     *  Singapore dựng luồng tiền từ đây — mẫu Sing có dòng mà mẫu Đài không có (退仓上架…). */
    summary_lines: { zh: string; vi: string; so: number }[];
    /** Kiểm chéo NỘI BỘ file: chi tiết có cộng ra đúng con số ở sheet TỔNG không. */
    checks: {
        cod_detail_total: number;
        cod_summary_total: number | null;
        cod_gap: number | null;
        ship_fee_detail_total: number;
        ship_fee_summary_total: number | null;
        op_fee_detail_total: number;
        op_fee_summary_total: number | null;
        /** Phép quyết toán TWD→RMB→VND có tự khớp không. */
        math_ok: boolean | null;
        math_note: string;
    };
    /** Soát phí thật với bảng giá 3PL. */
    fee_audit: {
        checked: number;
        ok: number;
        wrong: number;
        unknown_channel: number;
        overcharge_rmb: number;
        lines: { tracking: string; order_id: string; channel: string; kg: number | null; expected: number; charged: number; diff: number }[];
        /** Một mã vận đơn bị tính phí HAI LẦN trở lên trong cùng kỳ. */
        duplicates: { tracking: string; order_ids: string[]; times: number; extra_rmb: number }[];
        duplicate_extra_rmb: number;
        /** Phí thao tác khác mức đã khai (3¥/đơn). */
        op_wrong: { tracking: string; order_id: string; charged: number; expected: number }[];
        op_expected: number;
    };
};
