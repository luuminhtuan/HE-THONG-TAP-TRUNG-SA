/* Kiểu dữ liệu của tab Kế toán → Lãi lỗ (/api/talpha/income-statement). */

export type Fees = { di: number; giao: number; hoan: number; ty_gia: number };
export type Scenario = { doanh_thu: number; gia_von: number; phi: Fees };
export type Tally = { n: number; cod: number };
export type ParcelGroup = "giao" | "hoan" | "dang_di" | "cho_gui" | "huy";
export type DeliveryRate = { r: number | null; giao: number; hoan: number; tu: string | null; den: string | null; tam: boolean };
export type MarketResult = {
    code: string; ten: string; nguon: string; co_so: string[]; loi: string | null;
    don: number; doanh_so: number; ads: number;
    ty_le: DeliveryRate | null;
    tk: {
        kien: Record<ParcelGroup, Tally> & { tong: Tally };
        doanh_thu_chac: number; thieu_gia_von: number; phi_uoc: number;
        hoan_con_han: { n: number; gia_von: number };
    } | null;
    cho_len_3pl: { vnd: number; ngay: { date: string; doanh_so: number; kien: number }[] } | null;
    van_hanh: { rieng: number; chung: number };
    du_kien: Scenario; toi_thieu: Scenario;
    loi_nhuan: { du_kien: number | null; toi_thieu: number | null };
};
export type OpexItem = {
    id: string; nhom: string; ten: string; so_tien_thang_vnd: number;
    tu_thang: string; den_thang: string | null; thuoc: string; ghi_chu?: string;
    sua_luc?: string; sua_boi?: string; trong_ky_vnd?: number;
};
export type Data = {
    from: string; to: string; as_of: string; hom_nay: string; scoped: boolean;
    missing_months: string[];
    cfg: { ty_le: { cua_so_ngay: number; bo_gan_ngay: number; mau_toi_thieu: number }; cho_len_3pl_ngay: number; nhom_van_hanh: string[] };
    nuoc: MarketResult[];
    ngoai_nuoc: { ads: number; doanh_so: number; don: number } | null;
    tong: {
        don: number; doanh_so: number; ads: number; van_hanh: number; doanh_thu_chac: number;
        du_kien: Scenario; toi_thieu: Scenario; loi_nhuan: { du_kien: number; toi_thieu: number }; thieu_nuoc: string[];
    };
    van_hanh: {
        ghi_duoc: boolean; items: OpexItem[]; trong_ky: OpexItem[];
        chung: number | null; chung_chua_chia: number; nuoc_khac: number;
    };
    nuoc_ban: { code: string; ten: string }[];
};
