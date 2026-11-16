/* Kiểu dữ liệu của màn Đối soát chi phí quảng cáo (/api/talpha/ads-recon). */

export type Sev = "critical" | "warn" | "info";
export type Alert = { code: string; severity: Sev; title: string; detail: string; hint: string; amount: number; count?: number };
export type FbRow = { line: number; file?: string; date: string; amount: number; card4: string | null; txn_id: string; account_id: string; account_name: string; status: string };
export type BankRow = { line: number; file?: string; date: string; amount: number; card4: string | null; desc: string; ref: string; balance: number | null };
export type Pair = {
    fb: FbRow; bank: BankRow; date_diff: number; amount_diff: number;
    exact: boolean; ambiguous: boolean; card_ok: boolean; confidence: "cao" | "vua" | "thap";
};
export type Summary = {
    fb_total: number; bank_total: number; fee_total: number; gap: number; at_risk: number;
    counts: { critical: number; warn: number; info: number };
    so_dong_canh_bao?: number;
    ket_luan?: Conclusion;
    period: { bank_start?: string; bank_end?: string; fb_start?: string; fb_end?: string };
};
export type Result = {
    ky: string; chay_luc: string; summary: Summary;
    stats: { matched: number; fb_chargeable: number; ambiguous: number };
    alerts: Alert[]; pairs: Pair[];
    fb_unmatched: FbRow[]; bank_unmatched: BankRow[]; fb_failed: FbRow[]; other_ads: BankRow[];
    files?: { fb?: FileMeta[]; bank?: FileMeta[] };
    nguon?: StoreSource[];
    nap?: ImportStats;
    kho?: { fb: number; bank: number };
    tkqc_ten?: Record<string, string>;
    chua_du?: boolean;
    thieu?: string;
};
export type FileMeta = { ten: string; sheet?: string; so_dong: number };
export type StoreSource = { ten: string; phia: "fb" | "bank"; so_dong: number; tien: number; tu: string | null; den: string | null; tkqc: string[] };
export type ImportStats = { fb: { them: number; trung: number }; bank: { them: number; trung: number } };
export type Conclusion = {
    muc: "khong_tin" | "co_van_de" | "can_xem" | "sach";
    tieu_de: string; giai_thich: string;
    viec: { code: string; title: string; hint: string }[];
};
export type PeriodMeta = { ky: string; chay_luc: string; summary?: Summary };
