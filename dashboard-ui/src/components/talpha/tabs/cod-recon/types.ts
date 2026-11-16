/** Kiểu dữ liệu dùng chung của tab Tiền COD về — màn Đài (sao kê NAZA) và màn các nước khác. */
import type { UnpaidOrder } from "../ledger-shared";

export interface CodReconTabProps { dateRange?: { from: Date; to: Date }; projectId?: string }

export type DoneKind = "da_doi" | "da_hoi" | "bo_qua" | "nhap_bank";
export type Task = {
    id: string; muc: "gap" | "soat" | "ghi"; tieu_de: string;
    so: number; don_vi: string; chi_tiet: string;
    done_key: string; nut: DoneKind[]; ghi_chu: string;
    /** Màn nước khác: mọi khoá của nhóm — một lần bấm ghi cả nhóm. */
    done_keys?: string[];
};
export type Check = { nhom: "A" | "B"; ten: string; ok: boolean | null; chi_tiet: string };
export type Bank = { thuc_nhan_vnd: number; ngay_ve: string; ghi_chu?: string; luc: string };
export type PeriodState = "thieu_file" | "cho_nhap" | "khop" | "lech";
/** Luồng tiền một kỳ, đi đúng từng bước sheet TỔNG của NAZA. */
export type MoneyFlow = {
    so_dong_sao_ke: number;
    cod_twd: number | null; ty_gia_twd_rmb: number | null; rmb: number | null;
    phi_thao_tac_rmb: number; phi_ship_rmb: number; phi_gop: boolean;
    rmb_rong: number | null; ty_gia_rmb_vnd: number | null; vnd: number | null;
    tien_hang: {
        cach_tra: "naza_tru" | "tu_chuyen";
        naza_tru_vnd: number | null;
        file: { ngay: string; tong_vnd: number; moi_vnd: number; no_ky_truoc_vnd: number; da_ghi_thanh_toan: boolean; dong: number } | null;
        /** Tổng tiền hàng trừ trong luồng = Đài (theo file) + Sing (kỳ gộp, theo NAZA). */
        trong_luong_vnd: number;
        dai_vnd?: number;
        /** Tiền hàng Sing NAZA trừ vào COD Đài — chỉ kỳ gộp 24/09/2026. */
        sing_vnd?: number | null;
        lech_naza_vnd: number | null;
        da_tra_vnd: number | null;
        con_no_vnd: number | null;
    };
    phai_nhan_vnd: number | null;
    /** Phần Singapore NAZA gộp vào kỳ (chỉ kỳ 24/09/2026). */
    sg_gop?: { don: number; phi_rmb: number; phi_vnd: number | null; tien_hang_vnd: number | null; tong_vnd: number | null } | null;
};
export type Estimate = { so_don: number; cod_twd: number; don_chua_tru_phi: number; phi_uoc_rmb: number; vnd_uoc: number | null };
export type ReceivedSummary = {
    da_gui_ve_vnd: number; phai_nhan_theo_file_vnd: number;
    so_ky: number; ky_da_doi_chieu_bank: number; thuc_nhan_vnd: number;
    ty_gia: { twd_rmb: number | null; rmb_vnd: number | null; ngay_sao_ke: string | null };
    con_lai_da_giao: Estimate; con_lai_chua_giao: Estimate;
    khong_tinh: { hoan: number; huy: number; tieu_huy: number; cod_twd: number };
    tien_hang: { loi: string | null; so_dot: number; doc_luc: string };
};
export type Period = {
    id: string; filename: string; period_date: string;
    ngay_sao_ke: string | null; luong: MoneyFlow | null;
    orders_paid: number; total_twd: number; fee_rmb: number;
    lech_tien: { order_no: string; tracking: string; cod_twd: number; paid_twd: number | null; diff_twd: number | null }[];
    phi_sai: { order_no: string; tracking: string; ship_fee_rmb: number | null }[];
    thua_sao_ke: { order_no: string; tracking: string; amount_twd: number }[];
    settlement: { payable_vnd: number | null; purchase_vnd: number | null; math_ok: boolean | null; math_note: string } | null;
    bank: Bank | null;
    trang_thai: PeriodState; trang_thai_chu: string; lech_bank_vnd: number | null;
};
export type Pending = UnpaidOrder;
export type FxRow = {
    filename: string; period_date: string;
    rate_twd_rmb: number | null; rate_rmb_vnd: number | null;
    cod_twd: number; vnd_per_twd: number | null; thiet_vnd: number | null; tot_nhat: boolean;
};
export type Fx = { best_vnd_per_twd: number | null; best_period: string | null; total_thiet_vnd: number; rows: FxRow[] };
export type Overview = {
    ky_cho_nhap: number; tien_cho_nhap_vnd: number;
    ky_lech: number; tien_lech_vnd: number; ky_khop: number; bank_tolerance_vnd: number;
};
export type StatementMeta = { id: string; filename: string };

export type MarketBucket = { so_don: number; cod_local: number; vnd_uoc: number | null };
export type MarketOrder = {
    order_id: string; tracking: string; order_date: string | null; trang_thai: string;
    nhom: "da_giao" | "chua_giao" | "khong_tinh"; cod_local: number; khach: string;
    /** Đơn đã thấy trên một kỳ sao kê (08/10/2026). */
    da_tra?: { ky: string; so_tien: number };
};
export type ColumnMap = Partial<Record<"tracking" | "order_id" | "amount" | "fee" | "paid_date" | "status", string>>;
export type DeductionLine = { nhan: string; so: number; ghi?: string };
/** Luồng tiền một kỳ, đi đúng thứ tự sheet TỔNG của NAZA (lib/talpha/cod-market-ledger.ts). */
export type MarketMoneyFlow = {
    so_don: number; cod_local: number; ty_gia_rmb: number | null; rmb: number | null; tru_rmb: DeductionLine[];
    rmb_rong: number | null; ty_gia_vnd: number | null; vnd: number | null; tru_vnd: DeductionLine[];
    chenh_vnd: number; phai_nhan_vnd: number | null;
};
export type MarketPeriod = {
    id: string; filename: string; uploaded_at: string; kieu: "naza" | "bang"; ngay: string | null;
    so_dong: number; cod_local: number; phai_nhan_vnd: number | null; uoc_vnd: number | null;
    tinh_vao_da_gui?: boolean; tru_vao_dai?: string | null;
    phi_rmb?: number | null; don_phi?: number; tien_hang_vnd?: number | null;
    khop: number; lech: number; khong_co_don: number; cot?: ColumnMap; canh_bao: string[];
    luong: MarketMoneyFlow | null; bank: Bank | null;
    trang_thai: PeriodState | "am"; trang_thai_chu: string; lech_bank_vnd: number | null;
    lech_tien: { order_no: string; tracking: string; cod: number; tra: number; chenh: number }[];
    thua_sao_ke: { order_no: string; tracking: string; so_tien: number }[];
    phi_sai: { tracking: string; order_id: string; kg: number | null; thu: number; dung: number; chenh: number; ly_do: string }[];
};
export type MarketEstimate = { so_don: number; cod_local: number; don_chua_tru_phi: number; phi_uoc_rmb: number; vnd_uoc: number | null };
export type MarketLedger = {
    ky: MarketPeriod[]; viec: Task[]; checks: Check[];
    tien_ve: {
        da_gui_ve_vnd: number; co_uoc: boolean; so_ky: number; ky_am: number; am_vnd: number;
        ky_da_doi_chieu_bank: number; thuc_nhan_vnd: number;
        ty_gia: { rmb: number | null; vnd: number | null; thu_ho_pct: number | null; ngay: string | null };
        cach_uoc: "naza" | "ty_gia_khai";
        con_lai_da_giao: MarketEstimate; con_lai_chua_giao: MarketEstimate;
    };
    tong_quan: Overview;
    fx: Fx;
};
export type MarketData = {
    market: { code: string; display: string; currency: string; symbol: string; rate_vnd: number };
    nguon: { loai: "doi_tac" | "weship" | "pos"; nhan: string; cap_nhat: string | null };
    sao_ke: number;
    tong: {
        da_giao: MarketBucket;
        chua_giao: MarketBucket & { theo_trang_thai: { trang_thai: string; so_don: number; cod_local: number }[] };
        khong_tinh: MarketBucket & { hoan: number; huy: number; tieu_huy: number };
    };
    so: MarketLedger;
    don: MarketOrder[];
};

/** Đồng tiền của một màn (Đài NT$, Sing S$…) — khối tỷ giá + biểu đồ ghi đúng tên tiền. */
export type Currency = { ky: string; ma: string; fmt: (n: number) => string };
