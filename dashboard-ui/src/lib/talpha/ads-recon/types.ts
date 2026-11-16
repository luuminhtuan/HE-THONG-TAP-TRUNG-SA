/**
 * KIỂU DỮ LIỆU CHUNG của engine đối soát chi phí quảng cáo — dùng chung route
 * /api/talpha/ads-recon (dashboard) và bản dòng lệnh ads-reconciliation-cli.
 *
 * Engine chạy được hai đường: Next.js đóng gói, và Node nạp THẲNG file .ts (bỏ kiểu lúc chạy,
 * Node ≥ 22.18). Vì vậy trong thư mục này chỉ dùng cú pháp TypeScript "xoá được": không enum,
 * không namespace, không tham số kiểu `constructor(private x)`; import kiểu luôn viết `import type`;
 * import giữa các file luôn ghi đuôi `.ts`.
 *
 * Tên khoá của kết quả (ky, chay_luc, ket_luan, nguon, so_dong…) GIỮ NGUYÊN: kết quả mỗi kỳ được
 * lưu trong bảng app_documents (dòng ads_recon, ads_recon_kho) và màn Thanh toán quảng cáo đọc
 * lại — đổi khoá là kỳ cũ hiện trống. Đổi chúng là việc của migration dữ liệu, không phải ở đây.
 */

/** Một ô bảng tính sau khi đọc: chuỗi, số, ngày, đúng/sai, hoặc trống. */
export type Cell = string | number | boolean | Date | null;
export type Row = Cell[];
export type Sheet = { name: string; rows: Row[] };

export type SideKind = "fb" | "bank";
export type SourceKind = SideKind | "unknown";
export type Severity = "critical" | "warn" | "info";
export type PaymentStatus = "paid" | "failed" | "pending" | "other" | "unknown";

export type FbColumn =
    | "date" | "amount" | "currency" | "transaction_id" | "account_id"
    | "account_name" | "method" | "status" | "campaign";
export type BankColumn = "date" | "debit" | "credit" | "amount" | "balance" | "desc" | "ref" | "card";

export type MatchConfig = {
    date_window_days?: number;
    amount_tolerance_abs?: number;
    amount_tolerance_pct?: number;
    prefer_card_match?: boolean;
};

/** Khối `ads_settlement` trong config/talpha_rules.json. */
export type AdsSettlementConfig = {
    currency?: string;
    match: MatchConfig;
    sanity?: { max_amount_row?: number; max_bad_ratio?: number };
    fee: {
        expected_pct?: number;
        warn_over_pct?: number;
        critical_over_pct?: number;
        standalone_fee_max_abs?: number;
    };
    duplicate?: { window_days?: number; amount_tolerance_abs?: number };
    budget?: {
        weekly_cap?: number | null;
        spike_warn_pct?: number;
        spike_critical_pct?: number;
        daily_spike_warn_pct?: number;
    };
    cards?: { strict?: boolean; list?: { last4?: string | number }[] };
    ad_accounts?: { strict?: boolean; roster_file?: string; extra_allowed?: string[] };
    bank_filter: { fb_keywords?: string[]; other_ads_keywords?: string[]; ignore_keywords?: string[] };
    columns: { fb: Record<FbColumn, string[]>; bank: Record<BankColumn, string[]> };
    notify?: {
        min_severity?: Severity;
        report_url?: string;
        telegram?: { enabled?: boolean; bot_token_env?: string; chat_id?: string };
        webhook?: { enabled?: boolean; url?: string };
    };
};

/** Một dòng chi phí trong bản kê thanh toán của TKQC Facebook. */
export type FbRow = {
    src: "fb";
    file: string;
    line: number;
    txn_id: string;
    date: string;
    amount: number;
    currency: string;
    account_id: string;
    account_name: string;
    method: string;
    card4: string | null;
    status: string;
    status_norm: PaymentStatus;
    raw?: Row;
    /** Số thứ tự bản tải lên — chỉ dùng lúc chạy để phân biệt hai lần tải, không lưu xuống. */
    _doc?: number;
    /** Khoá chống đếm hai lần trong kho dòng (storage.ts). */
    _key?: string;
};

/** Một dòng ghi nợ trong sao kê thẻ ngân hàng. */
export type BankRow = {
    src: "bank";
    file: string;
    line: number;
    date: string;
    ref: string;
    desc: string;
    amount: number;
    balance: number | null;
    card4: string | null;
    is_fb: boolean;
    is_other_ads: boolean;
    raw?: Row;
    _doc?: number;
    _key?: string;
};

export type TxnRow = FbRow | BankRow;

export type SkippedRow = { file: string; line: number; reason: string; raw?: Row };

export type IngestMeta = {
    sheet: string;
    header_row: number;
    headers: string[];
    columns: Record<string, number>;
    warnings: string[];
};

export type FbIngest = { rows: FbRow[]; skipped: SkippedRow[]; meta: IngestMeta };
export type BankIngest = {
    rows: BankRow[];
    other_ads: BankRow[];
    other: BankRow[];
    skipped: SkippedRow[];
    meta: IngestMeta;
};

/** Một file của một phía, như kết quả mỗi kỳ lưu lại (khoá giữ tiếng Việt — xem đầu file). */
export type SourceFileInfo = { ten: string; sheet: string; dong_tieu_de: number; so_dong: number };

/** Một phía đã đọc xong (có thể gộp nhiều file). */
export type Side<R extends TxnRow> = {
    rows: R[];
    /** Dòng có mặt ở hai file khác nhau: giữ bản gặp trước, bỏ bản sau. */
    duplicatesAcrossFiles: { kept: R; dropped: R }[];
    /** File tải lên mà không đọc được — báo đỏ, lượt chạy vẫn tiếp. */
    failedFiles: { name: string; reason: string }[];
    other_ads: BankRow[];
    skipped: SkippedRow[];
    meta: { files: SourceFileInfo[]; warnings: string[] };
};

/** Phần của một phía mà luật cảnh báo cần — phép thử dựng tay được bản tối thiểu. */
export type AlertSide<R extends TxnRow> = Pick<Side<R>, "rows"> & Partial<Omit<Side<R>, "rows">>;

export type Confidence = "cao" | "vua" | "thap";

export type MatchPair = {
    fb: FbRow;
    bank: BankRow;
    date_diff: number;
    amount_diff: number;
    amount_diff_pct: number;
    exact: boolean;
    ambiguous: boolean;
    card_ok: boolean;
    confidence: Confidence;
    score: number;
};

export type MatchStats = {
    fb_total: number;
    fb_chargeable: number;
    bank_total: number;
    matched: number;
    ambiguous: number;
    candidates: number;
};

export type MatchResult = {
    pairs: MatchPair[];
    fb_unmatched: FbRow[];
    bank_unmatched: BankRow[];
    fb_failed: FbRow[];
    stats: MatchStats;
};

export type AlertRef = { src: SideKind; line: number; date: string; amount: number; label: string };

export type Alert = {
    code: string;
    severity: Severity;
    title: string;
    detail: string;
    amount: number;
    items: AlertRef[];
    hint: string;
    /** Chỉ có ở cảnh báo đã gom nhiều cái cùng loại. */
    count?: number;
};

/** Một dòng kết luận đặt trên mọi con số (khoá giữ tiếng Việt — xem đầu file). */
export type Verdict = {
    muc: "khong_tin" | "co_van_de" | "can_xem" | "sach";
    tieu_de: string;
    giai_thich: string;
    viec: { code: string; title: string; hint: string }[];
};

export type Summary = {
    fb_total: number;
    bank_total: number;
    fee_total: number;
    matched_amount: number;
    gap: number;
    at_risk: number;
    counts: Record<Severity, number>;
    so_dong_canh_bao: number;
    ket_luan: Verdict;
    period: { bank_start?: string; bank_end?: string; fb_start?: string; fb_end?: string };
};

/** Roster TKQC dạng {projects: {…: {accounts}}} — route dựng từ bảng tkqc, CLI đọc từ roster_file. */
export type Roster = {
    projects?: Record<string, { accounts?: { id?: string; name?: string; status?: string }[] }>;
};

/** Một kỳ đối soát TRƯỚC — để bắt chi tăng vọt. */
export type HistoryEntry = {
    ky?: string;
    chay_luc?: string;
    summary?: { bank_total?: number; fb_total?: number };
    files?: unknown;
};

export type ReconcileOptions = { roster?: Roster | null; history?: HistoryEntry[] };

export type SlimFbRow = {
    src: "fb"; file: string; line: number; date: string; amount: number; card4: string | null;
    txn_id: string; account_id: string; account_name: string; method: string; status: string;
    status_norm: PaymentStatus;
};
export type SlimBankRow = {
    src: "bank"; file: string; line: number; date: string; amount: number; card4: string | null;
    desc: string; ref: string; balance: number | null;
};

export type SlimPair = Omit<MatchPair, "fb" | "bank" | "score"> & { fb: SlimFbRow; bank: SlimBankRow };

/** Kết quả một lượt đối soát — đúng thứ được lưu thành một kỳ. */
export type ReconResult = {
    ky: string;
    chay_luc: string;
    files: { fb: SourceFileInfo[]; bank: SourceFileInfo[] };
    summary: Summary;
    stats: MatchStats;
    alerts: Alert[];
    pairs: SlimPair[];
    fb_unmatched: SlimFbRow[];
    bank_unmatched: SlimBankRow[];
    fb_failed: SlimFbRow[];
    other_ads: SlimBankRow[];
    meta: {
        fb: Side<FbRow>["meta"];
        bank: Side<BankRow>["meta"];
        skipped: { fb: SkippedRow[]; bank: SkippedRow[] };
    };
    history: { ky?: string; bank_total: number; fb_total: number }[];
    /** Bản dòng lệnh: thư mục đã lưu kỳ. */
    saved_to?: string;
};

/** Một file đã tải lên, chưa phân phía. */
export type SourceDoc = { sheets: Sheet[]; name?: string; kind?: SourceKind };
