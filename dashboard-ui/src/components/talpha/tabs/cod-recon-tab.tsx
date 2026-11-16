"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { format } from "date-fns";
import {
    Upload, AlertTriangle, Download, Copy, CheckCircle2, ChevronDown, Check, X,
    FileSpreadsheet, Landmark, ArrowRight, ArrowDown, Info,
    CalendarDays, Layers, ReceiptText, BadgeCheck, SearchCheck, PenLine,
    type LucideIcon,
} from "lucide-react";
import {
    ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";
import TabSkeleton, { ErrorState } from "@/components/ui/tab-skeleton";
import { useUrlParam } from "../url-state";
import { formatNumber, cn } from "../utils";
import { TWD, VND, type UnpaidOrder } from "./ledger-shared";
import PartnerSheetImporter, { isSheetStale, shortImportLabel, type PartnerSheetImport } from "@/components/talpha/nhap-bang-don";
import { useNarrowScreen } from "./so-don-ui";

interface Props { dateRange?: { from: Date; to: Date }; projectId?: string }

/* ═══════════════════════════════════════════════════════════════════
   TIỀN COD VỀ (mục Kế toán) — MỘT QUY TRÌNH, KHÔNG PHẢI MỘT ĐỐNG KẾT QUẢ KIỂM TRA

   07/10/2026 Sỹ Anh chốt tách mục KẾ TOÁN: tab này (tên cũ "Đối soát COD") + Thanh toán
   quảng cáo. Leader nước đó và giám đốc kiểm soát chung — leader xem, tải sao kê, nhập tiền
   về. Phần đòi NAZA tiền đơn quá hạn (khối ④ cũ) chuyển sang Sổ đơn hàng: đó là việc
   theo từng đơn, cần tên khách + số điện thoại ngay cạnh, và sale cũng phải làm được.

   Bản trước xếp tám mục soát cạnh nhau rồi để người dùng tự hiểu. Sỹ Anh chỉ
   ra bốn chỗ khó chịu, và cả bốn cùng một gốc: màn hình không mang hình dạng
   của công việc thật.

     "không biết số nào của kỳ nào"      → mỗi khối đóng dấu PHẠM VI
     "việc làm xong rồi vẫn hiện"        → mỗi việc có nút đóng, máy nhớ ngày
     "báo lỗi không biết làm gì tiếp"    → mỗi lỗi kèm đúng nút cần bấm
     "không biết tiền thật về đủ chưa"   → thêm hẳn khâu tiền-về-tài-khoản

   Nên bố cục nay chạy đúng thứ tự việc xảy ra ngoài đời:

     Σ  tiền về             — tổng cả vụ: NAZA đã gửi bao nhiêu, còn phải gửi bao nhiêu
     ①  việc hôm nay        — mở lên là biết phải làm gì
     ②  bảng các kỳ         — xương sống: kỳ nào đang ở đâu trong quy trình
     ③  kỳ đang mở          — tám mục soát, CHỈ của kỳ này
     ④  tỷ giá              — nó đã lấy của mình bao nhiêu tiền
     (đơn quá hạn phải đòi  — khung "Đòi tiền NAZA" ở Sổ đơn hàng)

   Thứ tự trong ③ (A trước B) không đảo được: file sai thì mọi so sánh về sau
   đều vô nghĩa. Và một kỳ chưa biết tiền về hay chưa thì chưa xong, dù tám
   mục xanh hết — đó là lý do ② đứng trước ③.
   ═══════════════════════════════════════════════════════════════════ */

type DoneKind = "da_doi" | "da_hoi" | "bo_qua" | "nhap_bank";
type Task = {
    id: string; muc: "gap" | "soat" | "ghi"; tieu_de: string;
    so: number; don_vi: string; chi_tiet: string;
    done_key: string; nut: DoneKind[]; ghi_chu: string;
    /** Màn nước khác: mọi khoá của nhóm — một lần bấm ghi cả nhóm. */
    done_keys?: string[];
};
type Check = { nhom: "A" | "B"; ten: string; ok: boolean | null; chi_tiet: string };
type Bank = { thuc_nhan_vnd: number; ngay_ve: string; ghi_chu?: string; luc: string };
type PeriodState = "thieu_file" | "cho_nhap" | "khop" | "lech";
/** Luồng tiền một kỳ, đi đúng từng bước sheet TỔNG của NAZA. */
type MoneyFlow = {
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
type Estimate = { so_don: number; cod_twd: number; don_chua_tru_phi: number; phi_uoc_rmb: number; vnd_uoc: number | null };
type ReceivedSummary = {
    da_gui_ve_vnd: number; phai_nhan_theo_file_vnd: number;
    so_ky: number; ky_da_doi_chieu_bank: number; thuc_nhan_vnd: number;
    ty_gia: { twd_rmb: number | null; rmb_vnd: number | null; ngay_sao_ke: string | null };
    con_lai_da_giao: Estimate; con_lai_chua_giao: Estimate;
    khong_tinh: { hoan: number; huy: number; tieu_huy: number; cod_twd: number };
    tien_hang: { loi: string | null; so_dot: number; doc_luc: string };
};
type Period = {
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
type Pending = UnpaidOrder;
type FxRow = {
    filename: string; period_date: string;
    rate_twd_rmb: number | null; rate_rmb_vnd: number | null;
    cod_twd: number; vnd_per_twd: number | null; thiet_vnd: number | null; tot_nhat: boolean;
};
type Fx = { best_vnd_per_twd: number | null; best_period: string | null; total_thiet_vnd: number; rows: FxRow[] };
type Overview = {
    ky_cho_nhap: number; tien_cho_nhap_vnd: number;
    ky_lech: number; tien_lech_vnd: number; ky_khop: number; bank_tolerance_vnd: number;
};
type StatementMeta = { id: string; filename: string };

const shortFile = (f: string) => f.replace(/ĐỐI SOÁT COD|TAIWAN|\.xlsx?$/gi, "").trim() || f;
const dmy = (s: string) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "—");

function discrepancyMessage(p: Period, lang: "vi" | "zh"): string {
    if (lang === "zh") {
        const lines = p.lech_tien.map((l) =>
            `${l.order_no} · ${l.tracking} · 訂單 ${Math.round(l.cod_twd).toLocaleString("vi-VN")} NT$ / ` +
            `實付 ${Math.round(l.paid_twd ?? 0).toLocaleString("vi-VN")} NT$`).join("\n");
        return `您好，${shortFile(p.filename)} 這期對帳單中，以下訂單的撥款金額與我方訂單金額不符：\n\n` +
            `${lines}\n\n麻煩協助核對，謝謝！`;
    }
    const lines = p.lech_tien.map((l) =>
        `${l.order_no} · ${l.tracking} · đơn ${Math.round(l.cod_twd).toLocaleString("vi-VN")} NT$ / ` +
        `trả ${Math.round(l.paid_twd ?? 0).toLocaleString("vi-VN")} NT$`).join("\n");
    return `Chào bạn, kỳ sao kê ${shortFile(p.filename)} có mấy đơn số tiền trả về không khớp ` +
        `với số trên đơn của mình:\n\n${lines}\n\nNhờ bạn kiểm tra lại giúp mình nhé. Cảm ơn bạn!`;
}

/**
 * Nút chọn nước (Sỹ Anh chốt 26/09/2026): Đài Loan giữ nguyên toàn bộ quy trình sao kê NAZA;
 * Singapore, UAE cùng bố cục Đài từ 08/10/2026 (CodNuocKhac): tải sao kê, việc hôm nay, các kỳ + ngân hàng,
 * luồng tiền + máy soát, tỷ giá. Danh sách nước
 * lấy từ /api/talpha/markets — không gõ cứng ở giao diện.
 *
 * Phân quyền theo team (05/10/2026): danh sách chỉ còn nước của team, nên chờ có danh sách rồi
 * mới dựng màn và mở ở nước đầu tiên được xem (xem cùng chỗ ở order-ledger-tab.tsx).
 */
export default function TALPHACodReconTab(props: Props) {
    const [marketParam, setMarketParam] = useUrlParam("market");
    const [ds, setDs] = useState<{ code: string; display: string }[] | null>(null);
    useEffect(() => {
        fetch("/api/talpha/markets").then((r) => r.json())
            .then((d: { markets?: { code: string; display: string; status?: string }[] }) => {
                // Nước đã tắt VẪN có ở đây (04/11/2026): tắt rồi đối tác còn chuyển tiền đơn cũ về vài tuần.
                const list = (d.markets || []).filter((m) => m.status !== "sap_chay").map((m) => ({ code: m.code, display: m.display }));
                setDs(list);
            })
            .catch(() => setDs([]));   // không lấy được danh sách nước thì vẫn hiện màn Đài như cũ
    }, []);
    if (ds === null) return <TabSkeleton />;
    // Nước đang xem nằm trên địa chỉ (?market=SG, 15/11/2026) — tải lại / gửi link là mở đúng nước.
    // Mã lạ hoặc nước ngoài team → nước đầu tiên được xem.
    const market = marketParam && ds.some((m) => m.code === marketParam.toUpperCase()) ? marketParam.toUpperCase() : (ds[0]?.code ?? "TW");
    // Nút chọn nước nằm CÙNG hàng với thanh công cụ (07/10/2026, cùng kiểu Sổ đơn hàng).
    const marketSwitcher = ds.length > 1 ? (
        <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1">
            {ds.map((m) => (
                <button key={m.code} onClick={() => setMarketParam(m.code)}
                    className={cn("rounded-md px-3.5 py-1 text-sm font-medium transition-colors",
                        market === m.code ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                    {m.display}
                </button>
            ))}
        </div>
    ) : null;
    return market === "TW"
        ? <TwCodRecon {...props} nutNuoc={marketSwitcher} />
        : <MarketCodRecon key={market} code={market} nutNuoc={marketSwitcher} dateRange={props.dateRange} />;
}

/** Hàng đầu tab: chọn nước · nguồn số (chữ nhỏ) · nút bên phải. */
function HeaderBar({ nutNuoc: marketSwitcher, nguon: source, phai: actions }: { nutNuoc?: ReactNode; nguon?: ReactNode; phai?: ReactNode }) {
    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {marketSwitcher}
            {source && <span className="text-xs leading-relaxed text-muted-foreground">{source}</span>}
            {actions && <div className="flex w-full items-center gap-2 md:ml-auto md:w-auto">{actions}</div>}
        </div>
    );
}

/** Ô số tiền gọn (thay ba thẻ to + banner ngân hàng): nhãn · số · một dòng phụ. */
const TILE_COLORS = {
    xanh: "text-emerald-600 dark:text-emerald-400",
    vang: "text-amber-600 dark:text-amber-400",
    cam: "text-orange-600 dark:text-orange-400",
    xanhduong: "text-sky-700 dark:text-sky-300",
    do: "text-rose-600 dark:text-rose-400",
} as const;
function MoneyTile({ mau: color, nhan: caption, so: figure, phu: subtitle, uoc: estimated, className }: {
    mau: keyof typeof TILE_COLORS; nhan: string; so: string; phu?: ReactNode; uoc?: boolean; className?: string;
}) {
    return (
        <div className={cn("min-w-0 rounded-xl border border-border bg-card px-3 py-2.5 shadow-sm md:px-4 md:py-3", className)}>
            <div className="text-[11.5px] font-medium leading-snug text-muted-foreground">{caption}</div>
            <div className={cn("mt-1 whitespace-nowrap text-[19px] font-extrabold leading-tight tracking-tight tabular-nums md:text-[22px]", TILE_COLORS[color])}>
                {estimated && <span className="mr-0.5 text-[0.75em] font-bold opacity-60">≈</span>}{figure}
            </div>
            {subtitle && <div className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{subtitle}</div>}
        </div>
    );
}

type MarketBucket = { so_don: number; cod_local: number; vnd_uoc: number | null };
type MarketOrder = {
    order_id: string; tracking: string; order_date: string | null; trang_thai: string;
    nhom: "da_giao" | "chua_giao" | "khong_tinh"; cod_local: number; khach: string;
    /** Đơn đã thấy trên một kỳ sao kê (08/10/2026). */
    da_tra?: { ky: string; so_tien: number };
};
type ColumnMap = Partial<Record<"tracking" | "order_id" | "amount" | "fee" | "paid_date" | "status", string>>;
type DeductionLine = { nhan: string; so: number; ghi?: string };
/** Luồng tiền một kỳ, đi đúng thứ tự sheet TỔNG của NAZA (lib/talpha/cod-so-nuoc.ts). */
type MarketMoneyFlow = {
    so_don: number; cod_local: number; ty_gia_rmb: number | null; rmb: number | null; tru_rmb: DeductionLine[];
    rmb_rong: number | null; ty_gia_vnd: number | null; vnd: number | null; tru_vnd: DeductionLine[];
    chenh_vnd: number; phai_nhan_vnd: number | null;
};
type MarketPeriod = {
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
type MarketEstimate = { so_don: number; cod_local: number; don_chua_tru_phi: number; phi_uoc_rmb: number; vnd_uoc: number | null };
type MarketLedger = {
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
type MarketData = {
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

const COLUMN_LABELS: Record<string, string> = { tracking: "mã vận đơn", order_id: "mã đơn", amount: "tiền", paid_date: "ngày" };
const periodName = (f: string) => f.replace(/\.(xlsx|csv|tsv|txt)$/i, "").trim() || f;

/** Tin hỏi khoản trả lệch — như tinLech của Đài, đúng đồng tiền của nước. */
function marketDiscrepancyMessage(k: MarketPeriod, lang: "vi" | "zh", sym: string): string {
    const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString("vi-VN");
    if (lang === "zh") {
        const lines = k.lech_tien.map((l) => `${l.order_no} · ${l.tracking} · 訂單 ${fmt(l.cod)} ${sym} / 實付 ${fmt(l.tra)} ${sym}`).join("\n");
        return `您好，${periodName(k.filename)} 這期對帳單中，以下訂單的撥款金額與我方訂單金額不符：\n\n${lines}\n\n麻煩協助核對，謝謝！`;
    }
    const lines = k.lech_tien.map((l) => `${l.order_no} · ${l.tracking} · đơn ${fmt(l.cod)} ${sym} / trả ${fmt(l.tra)} ${sym}`).join("\n");
    return `Chào bạn, kỳ sao kê ${periodName(k.filename)} có mấy đơn số tiền trả về không khớp với số trên đơn của mình:\n\n${lines}\n\nNhờ bạn kiểm tra lại giúp mình nhé. Cảm ơn bạn!`;
}

/**
 * Tiền COD về nước ngoài Đài — CÙNG bố cục màn Đài (Sỹ Anh 08/10/2026: "sao giao diện phần đối
 * soát COD Sing không giống như Đài Loan").
 *
 *   Σ  tiền về          — bốn ô: đã gửi về · còn phải gửi · chưa giao xong · ngân hàng
 *   ①  việc hôm nay     — KhoiViec dùng chung với Đài
 *   ②  bảng các kỳ      — phải nhận · thực nhận (nhập số ngân hàng) · lệch · tình trạng
 *   ③  kỳ đang mở       — luồng tiền S$ → ¥ → đ đúng thứ tự sheet TỔNG + máy soát A/B
 *   ④  tỷ giá           — KhoiTyGia dùng chung với Đài (cần từ 2 kỳ có tỷ giá)
 *   rồi hai khối gập: đơn đã giao chưa thấy tiền · đơn chưa giao xong.
 *
 * Số dựng ở lib/talpha/cod-so-nuoc.ts; việc người làm ghi qua /api/talpha/cod-recon/market/actions
 * (kho riêng từng nước, cùng luật ghi với Đài). Sao kê dạng bảng (đối tác ngoài NAZA) không có
 * sheet TỔNG — màn tự lùi về "ước theo tỷ giá khai".
 */
function MarketCodRecon({ code, nutNuoc: marketSwitcher, dateRange }: { code: string; nutNuoc?: ReactNode; dateRange?: { from: Date; to: Date } }) {
    const [d, setD] = useState<MarketData | null>(null);
    const narrow = useNarrowScreen();
    const [err, setErr] = useState("");
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [upErr, setUpErr] = useState("");
    const [upOk, setUpOk] = useState("");
    const [dragging, setDragging] = useState(false);
    const [busy, setBusy] = useState("");
    const [copied, setCopied] = useState("");
    const [bankEntryFile, setBankEntryFile] = useState("");
    const [pid, setPid] = useState("");
    const fileRef = useRef<HTMLInputElement>(null);
    const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");
    const api = `/api/talpha/cod-recon/market?market=${code}`;

    const load = useCallback(async () => {
        setErr("");
        try {
            const res = await fetch(`${api}&to=${to}`);
            const j = await res.json();
            if (!res.ok) throw new Error(j.error || "Không tải được đơn");
            setD(j);
        } catch (e) {
            setErr(e instanceof Error ? e.message : "Lỗi không rõ");
        } finally { setLoading(false); }
    }, [api, to]);
    useEffect(() => { load(); }, [load]);

    const copyText = (id: string, text: string) => {
        navigator.clipboard?.writeText(text);
        setCopied(id); setTimeout(() => setCopied(""), 2200);
    };

    /** Ghi việc đã xử / tiền về — kho việc của nước này. Bỏ qua thì BẮT ghi lý do (quyết định mất tiền). */
    const recordMarketTask = async (key: string, kind: "da_hoi" | "bo_qua") => {
        if (!key) return;
        let reason = "";
        if (kind === "bo_qua") {
            reason = (window.prompt("Bỏ qua khoản này vì sao? (bắt buộc — sau còn tra lại được)") || "").trim();
            if (!reason) return;
        }
        // Một lần bấm ghi CẢ NHÓM (12 đơn phí sai là một tin hỏi NAZA), lần lượt từng khoá —
        // kho ghi bằng khoá file, gửi song song dễ giành nhau.
        const v = d?.so.viec.find((x) => x.done_key === key);
        const keys = v?.done_keys?.length ? v.done_keys : [key];
        setBusy(key);
        try {
            for (const k of keys) {
                await fetch(`/api/talpha/cod-recon/market/actions?market=${code}`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ kind: "done", key: k, viec: kind, ghi_chu: reason }),
                });
            }
            await load();
        } finally { setBusy(""); }
    };
    const saveBankReceipt = async (filename: string, figure: number, date: string) => {
        setBusy(filename); setUpErr("");
        try {
            const res = await fetch(`/api/talpha/cod-recon/market/actions?market=${code}`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ kind: "bank", filename, thuc_nhan_vnd: figure, ngay_ve: date }),
            });
            const j = await res.json();
            if (!res.ok) { setUpErr(j.error || "Không ghi được số tiền về"); return; }
            setBankEntryFile(""); await load();
        } finally { setBusy(""); }
    };

    const upload = async (f: File) => {
        setUploading(true); setUpErr(""); setUpOk("");
        try {
            const fd = new FormData(); fd.append("file", f);
            const res = await fetch(api, { method: "POST", body: fd });
            const j = await res.json();
            if (!res.ok) throw new Error(j.error || "Tải lên thất bại");
            const s = j.statement as { filename: string; so_dong: number; kieu: string; cot?: Record<string, string> };
            const columnsNote = s.cot ? Object.entries(s.cot).filter(([k]) => COLUMN_LABELS[k]).map(([k, v]) => `${COLUMN_LABELS[k]} = “${v}”`).join(", ") : "";
            const replacedNote = (j.thay as string[] | undefined)?.length ? ` Đã THAY bản cũ cùng kỳ: ${(j.thay as string[]).map((x) => `“${x}”`).join(", ")}.` : "";
            setUpOk(`Đã đọc ${formatNumber(s.so_dong)} dòng từ “${s.filename}”${s.kieu === "naza" ? " (mẫu NAZA)" : columnsNote ? ` — cột ${columnsNote}` : ""}.${replacedNote}` +
                ((j.canh_bao as string[] | undefined)?.length ? ` ${(j.canh_bao as string[]).join(" ")}` : ""));
            setPid("");
            await load();
        } catch (e) {
            setUpErr(e instanceof Error ? e.message : "Tải lên thất bại");
        } finally {
            setUploading(false);
            if (fileRef.current) fileRef.current.value = "";
        }
    };

    const deletePeriod = async (k: MarketPeriod) => {
        if (!window.confirm(`Xoá kỳ “${k.filename}”? Đơn của kỳ này quay về “còn phải gửi”.`)) return;
        setBusy(k.id); setUpErr(""); setUpOk("");
        try {
            const res = await fetch(`${api}&statement=${encodeURIComponent(k.id)}`, { method: "DELETE" });
            if (!res.ok) {
                const j = await res.json().catch(() => ({}));
                setUpErr((j as { error?: string }).error || "Không xoá được kỳ này");
                return;
            }
            setPid(""); await load();
        } finally { setBusy(""); }
    };

    if (loading && !d) return <div className="space-y-4">{marketSwitcher}<TabSkeleton cards={3} rows={6} showChart={false} /></div>;
    if (err || !d) return <div className="space-y-4">{marketSwitcher}<ErrorState message={err || "Không tải được đơn"} onRetry={load} /></div>;

    const m = d.market, t = d.tong, ledger = d.so;
    const formatAmount = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString("vi-VN")} ${m.symbol}`;
    const currency: Currency = { ky: m.symbol, ma: m.currency, fmt: formatAmount };
    const marketPeriods = ledger.ky;
    const period = marketPeriods.find((k) => k.id === pid) || marketPeriods[0];
    const latest = marketPeriods[0];
    const isNaza = marketPeriods.some((k) => k.kieu === "naza");
    const partnerName = isNaza ? "NAZA" : "bên giao hàng";
    // Mới nhất lên đầu (15/11/2026): ngày lên đơn, cùng ngày mã đơn lớn trước.
    const deliveredUnpaid = d.don.filter((x) => x.nhom === "da_giao" && !x.da_tra)
        .sort((a, b) => String(b.order_date || "").localeCompare(String(a.order_date || ""))
            || String(b.order_id).localeCompare(String(a.order_id), "vi", { numeric: true }));
    const updatedAt = d.nguon.cap_nhat ? (() => {
        const x = new Date(d.nguon.cap_nhat);
        const p = (n: number) => String(n).padStart(2, "0");
        return `${p(x.getHours())}:${p(x.getMinutes())} ngày ${p(x.getDate())}/${p(x.getMonth() + 1)}`;
    })() : null;

    // Số khối liền nhau dù khối nào bị ẩn (chưa có kỳ nào thì không có ② ③).
    const hasFx = ledger.fx.rows.length > 1;
    const sectionNumbers = { ky: "2", mo: "3", tyGia: String(1 + (marketPeriods.length ? 2 : 0) + 1) };
    const deliveredSectionNo = String(1 + (marketPeriods.length ? 2 : 0) + (hasFx ? 1 : 0) + 1);
    const undeliveredSectionNo = String(Number(deliveredSectionNo) + 1);

    /** Nút "Nhập số" ở Việc hôm nay: mở ô nhập ở đúng dòng kỳ đó trong bảng ② rồi cuộn tới. */
    const openBankEntry = (filename: string) => {
        setBankEntryFile(filename);
        const k = marketPeriods.find((x) => x.filename === filename);
        if (k) setTimeout(() => document.getElementById(`kyn-${k.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
    };

    const payableCell = (k: MarketPeriod) => k.phai_nhan_vnd != null && k.phai_nhan_vnd < 0 ? (
        // Kỳ âm (chỉ có phí + tiền hàng): KHÔNG cộng vào "đã gửi về" — NAZA trừ khoản này ở chỗ khác.
        <span className="inline-flex flex-col items-end text-right">
            <span className="font-bold tabular-nums text-rose-600 dark:text-rose-400">âm {VND(-k.phai_nhan_vnd)}</span>
            <span className="text-[11px] leading-snug text-muted-foreground">
                {k.tru_vao_dai ? `đã trừ vào COD Đài ${dmy(k.tru_vao_dai).slice(0, 5)}` : "NAZA trừ vào kỳ sau"}
            </span>
        </span>
    ) : k.phai_nhan_vnd != null ? (
        <span className="text-[14px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{VND(k.phai_nhan_vnd)}</span>
    ) : k.uoc_vnd != null ? (
        <span className="font-semibold tabular-nums text-amber-600 dark:text-amber-400" title={`Sao kê không ghi số phải nhận — ước = tiền COD × ${m.rate_vnd.toLocaleString("vi-VN")}đ/${m.currency}, chưa trừ phí`}>
            ≈ {VND(k.uoc_vnd)}
        </span>
    ) : <span className="text-muted-foreground">—</span>;

    const receivedCell = (k: MarketPeriod) => k.trang_thai === "am" ? <span className="text-muted-foreground">—</span>
        : bankEntryFile === k.filename ? (
            <FormBank goiY={k.phai_nhan_vnd} busy={busy === k.filename}
                onHuy={() => setBankEntryFile("")} onGhi={(n, date) => saveBankReceipt(k.filename, n, date)} />
        ) : k.bank ? (
            <button onClick={() => setBankEntryFile(k.filename)} className="rounded-lg px-1.5 py-0.5 text-right transition-colors hover:bg-muted">
                <div className="font-semibold tabular-nums text-foreground">{VND(k.bank.thuc_nhan_vnd)}</div>
                <div className="text-[11.5px] text-muted-foreground">về {dmy(k.bank.ngay_ve)}</div>
            </button>
        ) : (
            <button onClick={() => setBankEntryFile(k.filename)}
                className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border px-2.5 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:border-sky-400 hover:bg-sky-50 hover:text-sky-700 dark:hover:bg-sky-500/10 dark:hover:text-sky-300">
                <PenLine className="h-3.5 w-3.5" />chưa nhập
            </button>
        );

    const diffCell = (k: MarketPeriod) => (
        <span className={cn("font-semibold tabular-nums",
            k.lech_bank_vnd == null ? "text-muted-foreground"
                : k.trang_thai === "khop" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
            {k.lech_bank_vnd == null ? "·"
                : Math.round(k.lech_bank_vnd) === 0 ? "0đ"
                    : `${k.lech_bank_vnd > 0 ? "+" : "−"}${VND(Math.abs(k.lech_bank_vnd))}`}
        </span>
    );
    const goodsCell = (k: MarketPeriod) => k.tien_hang_vnd ? (
        <>
            <div className="font-semibold tabular-nums text-orange-600 dark:text-orange-400">{VND(k.tien_hang_vnd)}</div>
            <div className="text-[11.5px] text-muted-foreground">NAZA trừ vào COD</div>
        </>
    ) : <span className="text-muted-foreground">—</span>;
    const columnMapping = (k: MarketPeriod) => k.kieu === "naza" ? "" : k.cot
        ? Object.entries(k.cot).filter(([c]) => COLUMN_LABELS[c]).map(([c, v]) => `${COLUMN_LABELS[c]}: ${v}`).join(" · ") : "";
    const deleteButton = (k: MarketPeriod) => (
        <button onClick={(e) => { e.stopPropagation(); deletePeriod(k); }} disabled={busy === k.id} title="Xoá kỳ này (tải nhầm file)"
            className="grid h-7 w-7 flex-none place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40 dark:hover:bg-rose-500/10 dark:hover:text-rose-400">
            <X className="h-4 w-4" />
        </button>
    );

    /** Xuất đúng thứ cần gửi lại bên giao hàng — khoản lệch của kỳ đang mở + đơn đã giao chưa thấy tiền. */
    const exportForPartner = () => {
        if (!period) return;
        const rows: (string | number)[][] = [];
        for (const l of period.lech_tien) rows.push(["Trả khác số trên đơn", l.order_no, l.tracking, l.cod, l.tra, l.chenh, ""]);
        for (const x of period.thua_sao_ke) rows.push(["Trả cho đơn mình không có", x.order_no, x.tracking, "", x.so_tien, "", ""]);
        for (const f of period.phi_sai) rows.push([f.chenh > 0 ? "Phí thu cao hơn bảng giá" : "Phí thu thấp hơn bảng giá", f.order_id, f.tracking, "", "", "", `${f.thu}¥ / bảng ${f.dung}¥ — ${f.ly_do}`]);
        for (const x of deliveredUnpaid) rows.push(["Đã giao, chưa thấy trên sao kê", x.order_id, x.tracking, x.cod_local, "", "", x.order_date || ""]);
        const head = ["Loại", "Mã đơn", "Mã vận đơn", `COD đơn (${m.currency})`, `Trả (${m.currency})`, `Lệch (${m.currency})`, "Ghi chú"];
        const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const blob = new Blob(["﻿" + [head.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n")],
            { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `gui-${code.toLowerCase()}_${period.filename.replace(/\.[^.]+$/, "")}.csv`;
        a.click(); URL.revokeObjectURL(a.href);
    };

    return (
        // Kéo file sao kê thả vào bất cứ đâu trên màn — như màn Đài.
        <div className="relative space-y-3 md:space-y-4"
            onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); if (!dragging) setDragging(true); } }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
            onDrop={(e) => {
                if (!e.dataTransfer.files?.length) return;
                e.preventDefault(); setDragging(false);
                upload(e.dataTransfer.files[0]);
            }}>
            {dragging && (
                <div className="pointer-events-none absolute inset-0 z-30 grid place-items-start justify-center rounded-2xl border-2 border-dashed border-orange-400 bg-orange-50/85 pt-24 dark:bg-orange-500/15">
                    <div className="flex items-center gap-2 rounded-xl bg-card px-4 py-3 text-[15px] font-bold text-orange-700 shadow-lg dark:text-orange-300">
                        <FileSpreadsheet className="h-5 w-5" />Thả file sao kê {m.display} để tải lên
                    </div>
                </div>
            )}
            <input ref={fileRef} type="file" accept=".xlsx,.csv,.tsv,.txt" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />

            <HeaderBar nutNuoc={marketSwitcher}
                nguon={<>
                    {marketPeriods.length} bản sao kê{latest ? ` · mới nhất “${periodName(latest.filename)}”${latest.ngay ? ` (chốt ${dmy(latest.ngay)})` : ""}` : ""}
                    {` · Đơn ${m.display}: ${d.nguon.nhan}${updatedAt ? ` ${d.nguon.loai === "weship" ? "tra" : "nạp"} lúc ${updatedAt}` : ""}`}
                </>}
                phai={<>
                    <span className="hidden text-[11.5px] text-muted-foreground lg:inline">hoặc kéo thả file .xlsx · .csv vào màn</span>
                    <span title={`Sao kê COD của bên giao hàng ${m.display}: file NAZA, hoặc bảng .xlsx/.csv có cột mã vận đơn (hoặc mã đơn) + tiền COD. Tải lại cùng một kỳ thì THAY, không cộng thêm.`}>
                        <ActionButton kieu="chinh" busy={uploading} busyText="Đang đọc và soát…" onClick={() => fileRef.current?.click()}>
                            <Upload className="h-4 w-4" />Tải sao kê {isNaza || code === "SG" ? "NAZA" : m.display}
                        </ActionButton>
                    </span>
                </>} />
            {upErr && (
                <p className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />{upErr}
                </p>
            )}
            {upOk && (
                <p className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" />{upOk}
                </p>
            )}

            {/* ═══ Σ TIỀN VỀ — bốn ô số, như Đài ═══ */}
            <MarketMoneySummary so={ledger} t={t} m={m} tien={formatAmount} ben={partnerName} />

            {/* ═══ ① VIỆC HÔM NAY ═══ */}
            <TasksSection viec={ledger.viec} busy={busy} copied={copied} onChep={copyText}
                tinLech={(() => {
                    const firstDiffPeriod = marketPeriods.find((k) => k.lech_tien.length);
                    return firstDiffPeriod ? { vi: marketDiscrepancyMessage(firstDiffPeriod, "vi", m.symbol), zh: marketDiscrepancyMessage(firstDiffPeriod, "zh", m.symbol) } : null;
                })()}
                onNhapBank={openBankEntry} onGhi={recordMarketTask} hoiAi={partnerName === "NAZA" ? "NAZA" : "bên giao hàng"}
                rongChu={marketPeriods.length ? "Mọi kỳ đã soát xong, tiền đã về khớp." : `Chưa có sao kê nào — bấm Tải sao kê để bắt đầu đối soát ${m.display}.`} />

            {/* ═══ ② BẢNG CÁC KỲ ═══ */}
            {marketPeriods.length > 0 && (
                <Section so={sectionNumbers.ky} ten={`${marketPeriods.length} kỳ sao kê`} phamVi="all" phu="bấm một dòng để mở chi tiết kỳ đó · tải nhầm thì bấm ✕">
                    {narrow ? (
                        <ul className="divide-y divide-border/60">
                            {marketPeriods.map((k) => {
                                const selected = k.id === period?.id;
                                return (
                                    <li key={k.id} id={`kyn-${k.id}`} onClick={() => setPid(k.id)}
                                        className={cn("cursor-pointer px-3.5 py-3", selected && "bg-orange-50/70 shadow-[inset_3px_0_0_0_#FF7312] dark:bg-orange-500/[0.07]")}>
                                        <div className="flex items-center gap-2">
                                            <b className="tabular-nums text-foreground">{k.ngay ? dmy(k.ngay) : "—"}</b>
                                            <span className="min-w-0 truncate text-[11.5px] text-muted-foreground">{periodName(k.filename)}</span>
                                            <span className="ml-auto flex-none"><StatusBadge p={k} /></span>
                                            {deleteButton(k)}
                                        </div>
                                        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-[12.5px]">
                                            <div>
                                                <div className="text-[11px] text-muted-foreground">Tiền COD · {k.so_dong} đơn</div>
                                                <div className="font-semibold tabular-nums text-sky-700 dark:text-sky-300">{formatAmount(k.cod_local)}</div>
                                            </div>
                                            <div>
                                                <div className="text-[11px] text-muted-foreground">Phải nhận</div>
                                                {payableCell(k)}
                                            </div>
                                            {k.trang_thai !== "am" && (
                                                <div className="col-span-2 flex flex-wrap items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
                                                    <div>
                                                        <div className="text-[11px] text-muted-foreground">Thực nhận (ngân hàng)</div>
                                                        <div className="-ml-1.5">{receivedCell(k)}</div>
                                                    </div>
                                                    <div className="text-right">
                                                        <div className="text-[11px] text-muted-foreground">Lệch</div>
                                                        {diffCell(k)}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[900px] whitespace-nowrap text-[13px]">
                                <thead>
                                    <tr className="border-b border-border/70 bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                        <th className="px-5 py-2.5 text-left">Kỳ chốt</th>
                                        <th className="px-3 py-2.5 text-right">Đơn</th>
                                        <th className="px-3 py-2.5 text-right">Tiền COD</th>
                                        <th className="px-3 py-2.5 text-right">Tiền hàng</th>
                                        <th className="px-3 py-2.5 text-right">Phải nhận</th>
                                        <th className="px-3 py-2.5 text-right">Thực nhận</th>
                                        <th className="px-3 py-2.5 text-right">Lệch</th>
                                        <th className="px-3 py-2.5 text-left">Tình trạng</th>
                                        <th className="w-8 px-1 py-2.5" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/60">
                                    {marketPeriods.map((k) => {
                                        const selected = k.id === period?.id;
                                        return (
                                            <tr key={k.id} id={`kyn-${k.id}`} onClick={() => setPid(k.id)}
                                                className={cn("cursor-pointer transition-colors", selected ? "bg-orange-50/70 dark:bg-orange-500/[0.07]" : "hover:bg-muted/40")}>
                                                <td className={cn("px-5 py-3", selected && "shadow-[inset_3px_0_0_0_#FF7312]")}>
                                                    <div className="font-semibold tabular-nums text-foreground">{k.ngay ? dmy(k.ngay) : `tải ${dmy(format(new Date(k.uploaded_at), "yyyy-MM-dd"))}`}</div>
                                                    <div className="max-w-[16rem] truncate text-[12px] text-muted-foreground" title={k.filename}>{periodName(k.filename)}</div>
                                                    {columnMapping(k) && <div className="max-w-[16rem] truncate text-[11px] text-muted-foreground/80" title={columnMapping(k)}>{columnMapping(k)}</div>}
                                                </td>
                                                <td className="px-3 py-3 text-right tabular-nums text-foreground/80">{k.so_dong || <span className="text-muted-foreground" title={`Chưa thu COD — phí ${k.don_phi ?? 0} đơn`}>0</span>}</td>
                                                <td className="px-3 py-3 text-right font-semibold tabular-nums text-sky-700 dark:text-sky-300">{formatAmount(k.cod_local)}</td>
                                                <td className="px-3 py-3 text-right">{goodsCell(k)}</td>
                                                <td className="px-3 py-3 text-right">{payableCell(k)}</td>
                                                <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>{receivedCell(k)}</td>
                                                <td className="px-3 py-3 text-right">{diffCell(k)}</td>
                                                <td className="px-3 py-3"><StatusBadge p={k} /></td>
                                                <td className="px-1 py-3 text-right">{deleteButton(k)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                    <p className="flex items-start gap-2 border-t border-border/70 bg-muted/30 px-3.5 py-2 text-[12px] leading-relaxed text-muted-foreground md:px-5">
                        <Info className="mt-0.5 h-3.5 w-3.5 flex-none" />
                        <span>
                            Kỳ chỉ <b className="font-semibold text-foreground">xong</b> khi tiền thật về khớp số sao kê tính ra
                            (lệch dưới {VND(ledger.tong_quan.bank_tolerance_vnd)} bỏ qua) — không phải khi các mục soát xanh hết.
                            Kỳ âm (chỉ có phí + tiền hàng) không có tiền về, nên không cần nhập.
                        </span>
                    </p>
                </Section>
            )}

            {/* ═══ ③ KỲ ĐANG MỞ ═══ */}
            {period && (
                <Section so={sectionNumbers.mo} ten={period.ngay ? `Kỳ chốt ${dmy(period.ngay)}` : periodName(period.filename)} phamVi="one" phu={periodName(period.filename)}
                    phai={
                        <>
                            <div className="relative max-w-full">
                                <select value={period.id} onChange={(e) => setPid(e.target.value)}
                                    className="h-8 max-w-[18rem] appearance-none truncate rounded-lg border border-border bg-card pl-3 pr-8 text-[13px] font-medium text-foreground shadow-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:[color-scheme:dark]">
                                    {marketPeriods.map((k, i) => (
                                        <option key={k.id} value={k.id}>{i === 0 ? "★ " : ""}{periodName(k.filename)}{k.ngay ? ` — chốt ${dmy(k.ngay)}` : ""}</option>
                                    ))}
                                </select>
                                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            </div>
                            <ActionButton onClick={exportForPartner}><Download className="h-4 w-4" />Xuất file gửi {partnerName}</ActionButton>
                        </>
                    }>
                    {period.luong ? (() => {
                        const l = period.luong;
                        const fees = l.tru_rmb.reduce((a, x) => a + x.so, 0);
                        const isNegative = (l.phai_nhan_vnd ?? 0) < 0;
                        return (
                            <>
                                <div className="grid grid-cols-2 gap-px border-b border-border/70 bg-border/60 sm:grid-cols-3 xl:grid-cols-5">
                                    <Kpi label="Đơn trong sao kê" value={formatNumber(l.so_don)}
                                        sub={l.so_don ? `${period.khop + period.lech} đơn khớp sổ đơn` : `chưa thu COD · phí ${period.don_phi ?? 0} đơn`} />
                                    <Kpi label="Tiền COD" value={formatAmount(l.cod_local)} sub={`${partnerName} thu trong kỳ`} tone="twd" />
                                    <Kpi label={`Phí ${partnerName} trừ`} value={RMB2(fees)} sub={l.tru_rmb.map((x) => x.nhan.toLowerCase()).join(" · ") || "không có"} tone="rmb" />
                                    <Kpi label="Tiền hàng" value={l.tru_vnd.length ? VND(l.tru_vnd.reduce((a, x) => a + x.so, 0)) : "—"}
                                        sub={l.tru_vnd.length ? "NAZA trừ vào COD" : "kỳ này không trừ"} tone="hang" />
                                    {isNegative
                                        ? <Kpi label="Phải nhận" value={`âm ${VND(-(l.phai_nhan_vnd ?? 0))}`} tone="red" className="col-span-2 xl:col-span-1"
                                            sub={period.tru_vao_dai ? `đã trừ vào kỳ Đài ${dmy(period.tru_vao_dai).slice(0, 5)}` : "NAZA trừ vào kỳ sau"} />
                                        : <Kpi label="Phải nhận" value={l.phai_nhan_vnd != null ? VND(l.phai_nhan_vnd) : "—"}
                                            sub="sau khi trừ hết" tone="green" className="col-span-2 xl:col-span-1" />}
                                </div>
                                <MarketMoneyFlowPanel l={l} ky={period} m={m} tien={formatAmount} />
                            </>
                        );
                    })() : (
                        <div className="flex items-center gap-2 px-5 py-4 text-[13px] text-muted-foreground">
                            <Info className="h-4 w-4 flex-none" />
                            {period.kieu === "bang"
                                ? "Sao kê dạng bảng không có sheet TỔNG nên không dựng được luồng tiền — số ở bảng ② là ước theo tỷ giá khai."
                                : "Bản tải lên trước 08/10/2026 chưa lưu sheet TỔNG — tải lại file kỳ này (thay bản cũ) để thấy luồng tiền và máy soát."}
                        </div>
                    )}
                    {period.canh_bao.length > 0 && (
                        <ul className="space-y-1 border-t border-border/70 bg-amber-50/50 px-3.5 py-2.5 text-[12.5px] text-amber-800 md:px-5 dark:bg-amber-500/[0.06] dark:text-amber-300">
                            {period.canh_bao.map((c, i) => (
                                <li key={i} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" /><span>{c}</span></li>
                            ))}
                        </ul>
                    )}
                    <ChecksPanel checks={ledger.checks} kyKhac={!!latest && period.id !== latest.id}>
                        <div className="grid items-start gap-4 border-t border-border/70 bg-muted/20 p-3 md:p-4 xl:grid-cols-2">
                            {latest && period.id !== latest.id && (
                                <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-amber-800 xl:col-span-2 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                                    <Info className="mt-0.5 h-4 w-4 flex-none" />
                                    <span>
                                        Hai nhóm soát dưới đây là của <b className="font-semibold">kỳ mới nhất</b>{latest.ngay ? ` — chốt ${dmy(latest.ngay)}` : ""} ({periodName(latest.filename)}).
                                        Máy chỉ soát kỳ mới nhất; số tiền phía trên mới là của kỳ đang chọn.
                                    </span>
                                </p>
                            )}
                            <CheckGroup nhom="A" ten="Soát bên trong file" hoi="tin được số trong đó không" checks={ledger.checks.filter((c) => c.nhom === "A")} />
                            <CheckGroup nhom="B" ten="Soát file với đơn của mình" hoi="họ trả đủ và đúng chưa" checks={ledger.checks.filter((c) => c.nhom === "B")} />
                        </div>
                    </ChecksPanel>
                </Section>
            )}

            {/* ═══ ④ TỶ GIÁ ═══ */}
            {hasFx && <FxSection so={sectionNumbers.tyGia} fx={ledger.fx} kyDangXem={period?.filename} te={currency} />}

            {/* Hai khối gập — chưa có ở màn Đài (đơn từng đơn của Đài nằm ở Sổ đơn hàng). */}
            <Section so={deliveredSectionNo} ten={marketPeriods.length ? "Đơn đã giao — chưa thấy tiền trên sao kê" : "Đơn đã giao — tiền bên giao hàng đang giữ"}
                phamVi="all" dem={`${formatNumber(deliveredUnpaid.length)} đơn`} gap={{ mo: false }}>
                {!deliveredUnpaid.length ? (
                    <p className="px-5 py-4 text-sm text-muted-foreground">
                        {marketPeriods.length ? "Mọi đơn đã giao đều đã có trên sao kê." : "Chưa có đơn nào giao thành công."}
                    </p>
                ) : narrow ? (
                    <ul className="divide-y divide-border/60">
                        {deliveredUnpaid.map((x) => (
                            <li key={`${x.order_id}-${x.tracking}`} className="px-3.5 py-2.5">
                                <div className="flex items-baseline gap-2">
                                    <b className="font-mono text-[13px]">{x.order_id || "—"}</b>
                                    <span className="ml-auto font-mono text-[13px] font-bold tabular-nums">{formatAmount(x.cod_local)}</span>
                                </div>
                                <div className="text-[12px] text-muted-foreground">
                                    {x.khach || "—"}{x.order_date ? ` · ${x.order_date.slice(8, 10)}/${x.order_date.slice(5, 7)}` : ""}
                                    {x.tracking ? <> · <span className="font-mono">{x.tracking}</span></> : null}
                                </div>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border text-left text-[12px] uppercase tracking-wide text-muted-foreground">
                                    <th className="px-4 py-2 font-medium">Mã đơn</th>
                                    <th className="px-4 py-2 font-medium">Mã vận đơn</th>
                                    <th className="px-4 py-2 font-medium">Ngày đơn</th>
                                    <th className="px-4 py-2 font-medium">Khách</th>
                                    <th className="px-4 py-2 text-right font-medium">COD</th>
                                </tr>
                            </thead>
                            <tbody>
                                {deliveredUnpaid.map((x) => (
                                    <tr key={`${x.order_id}-${x.tracking}`} className="border-b border-border/60 last:border-0">
                                        <td className="px-4 py-2 font-mono text-[13px]">{x.order_id || "—"}</td>
                                        <td className="px-4 py-2 font-mono text-[12px] text-muted-foreground">{x.tracking || "—"}</td>
                                        <td className="px-4 py-2 tabular-nums">{x.order_date ? `${x.order_date.slice(8, 10)}/${x.order_date.slice(5, 7)}` : "—"}</td>
                                        <td className="px-4 py-2">{x.khach || "—"}</td>
                                        <td className="px-4 py-2 text-right font-mono tabular-nums">{formatAmount(x.cod_local)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Section>

            <Section so={undeliveredSectionNo} ten="Đơn chưa giao xong — tiền còn ngoài đường" phamVi="all"
                dem={`${formatNumber(t.chua_giao.so_don)} đơn`} gap={{ mo: false }}>
                {t.chua_giao.theo_trang_thai.length ? (
                    <ul className="divide-y divide-border/60">
                        {t.chua_giao.theo_trang_thai.map((x) => (
                            <li key={x.trang_thai} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                                <span>{x.trang_thai}</span>
                                <span className="tabular-nums text-muted-foreground">
                                    {formatNumber(x.so_don)} đơn · <span className="font-mono text-sky-700 dark:text-sky-300">{formatAmount(x.cod_local)}</span>
                                </span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="px-5 py-4 text-sm text-muted-foreground">Không còn đơn nào ngoài đường.</p>
                )}
            </Section>
        </div>
    );
}

/** Σ tiền về nước ngoài Đài — bốn ô như TomTatTien của Đài; cách tính cất sau một nút. */
function MarketMoneySummary({ so: ledger, t, m, tien: formatAmount, ben: partnerName }: {
    so: MarketLedger; t: MarketData["tong"]; m: MarketData["market"]; tien: (n: number) => string; ben: string;
}) {
    const [showMethod, setShowMethod] = useState(false);
    const received = ledger.tien_ve, overview = ledger.tong_quan;
    const remainingDelivered = received.con_lai_da_giao, remainingUndelivered = received.con_lai_chua_giao;
    const g = received.ty_gia;
    const pct = (n: number | null) => n == null ? "—" : `${(n * 100).toFixed(1).replace(".", ",")}%`;
    return (
        <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                <MoneyTile mau="xanh" uoc={received.co_uoc} nhan={`${partnerName === "NAZA" ? "NAZA" : "Bên giao hàng"} đã gửi về`}
                    so={received.so_ky ? VND(received.da_gui_ve_vnd) : "—"}
                    phu={received.so_ky ? `${formatNumber(received.so_ky)} kỳ sao kê${received.ky_am ? ` · không cộng ${received.ky_am} kỳ âm` : ""}` : "chưa có sao kê nào"} />
                <MoneyTile mau="vang" uoc nhan="Còn phải gửi · đơn đã giao"
                    so={remainingDelivered.vnd_uoc != null ? VND(remainingDelivered.vnd_uoc) : "—"} phu={`${formatNumber(remainingDelivered.so_don)} đơn · ${formatAmount(remainingDelivered.cod_local)}`} />
                <MoneyTile mau="cam" uoc nhan="Chưa giao xong"
                    so={remainingUndelivered.vnd_uoc != null ? VND(remainingUndelivered.vnd_uoc) : "—"} phu={`${formatNumber(remainingUndelivered.so_don)} đơn · ${formatAmount(remainingUndelivered.cod_local)}`} />
                {overview.ky_lech > 0
                    ? <MoneyTile mau="do" nhan="Tiền về lệch ngân hàng" so={VND(overview.tien_lech_vnd)} phu={`${overview.ky_lech} kỳ không khớp`} />
                    : overview.ky_cho_nhap > 0
                        ? <MoneyTile mau="xanhduong" nhan="Chưa đối chiếu ngân hàng" so={VND(overview.tien_cho_nhap_vnd)} phu={`${overview.ky_cho_nhap} kỳ chưa nhập tiền về`} />
                        : <MoneyTile mau="xanh" nhan="Đối chiếu ngân hàng" so={overview.ky_khop ? `${overview.ky_khop} kỳ khớp` : "—"}
                            phu={overview.ky_khop ? "không kỳ nào lệch" : "chưa có kỳ nào có tiền về"} />}
            </div>
            <button onClick={() => setShowMethod(!showMethod)} aria-expanded={showMethod}
                className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground">
                <Info className="h-3.5 w-3.5" />Cách tính các số này
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showMethod && "rotate-180")} />
            </button>
            {showMethod && (
                <div className="space-y-1.5 rounded-xl border border-border bg-muted/30 px-4 py-3 text-[12.5px] leading-relaxed text-muted-foreground">
                    <p><b className="font-semibold text-foreground">Đã gửi về</b> = cộng số phải nhận {partnerName} ghi trên từng sao kê
                        ({received.ky_da_doi_chieu_bank === 0 ? "chưa kỳ nào đối chiếu ngân hàng" : `${received.ky_da_doi_chieu_bank} kỳ đã đối chiếu ngân hàng`}).
                        {received.ky_am ? ` Không cộng ${received.ky_am} kỳ âm (âm ${VND(-received.am_vnd)} — kỳ chỉ có phí + tiền hàng): NAZA trừ khoản đó vào tiền chuyển ở chỗ khác, xem cột Phải nhận ở bảng ②.` : ""}
                        {received.co_uoc ? ` Kỳ nào sao kê không ghi số phải nhận thì ước = tiền COD × ${m.rate_vnd.toLocaleString("vi-VN")}đ/${m.currency}, chưa trừ phí.` : ""}</p>
                    <p><b className="font-semibold text-foreground">Hai ô giữa không trùng nhau</b> — là đơn CHƯA thấy trên kỳ sao kê nào:
                        đơn đã giao là tiền {partnerName} đang giữ, đơn chưa giao là tiền còn ở ngoài đường.
                        Đã bỏ {t.khong_tinh.hoan} đơn hoàn + {t.khong_tinh.huy} đơn huỷ{t.khong_tinh.tieu_huy ? ` + ${t.khong_tinh.tieu_huy} đơn tiêu huỷ` : ""} ({formatAmount(t.khong_tinh.cod_local)}) vì không bao giờ trả tiền.</p>
                    {received.cach_uoc === "naza" ? (
                        <p>Số dự tính đi đúng luồng NAZA kỳ {g.ngay ? dmy(g.ngay).slice(0, 5) : "gần nhất"}: COD × {g.rmb} → tệ, trừ phí thu hộ {pct(g.thu_ho_pct)},
                            trừ phí giao hàng cho đơn chưa bị NAZA trừ phí ở kỳ nào ({remainingDelivered.don_chua_tru_phi + remainingUndelivered.don_chua_tru_phi} đơn — lấy mức trung bình NAZA đã tính),
                            rồi × {g.vnd?.toLocaleString("vi-VN")}. <b className="font-semibold text-foreground">Chưa trừ tiền hàng các kỳ tới</b> — chưa biết trước được.</p>
                    ) : (
                        <p>Chưa có kỳ sao kê NAZA nào có tỷ giá, nên số dự tính = tiền COD × tỷ giá khai {m.rate_vnd.toLocaleString("vi-VN")}đ/{m.currency},
                            <b className="font-semibold text-foreground"> chưa trừ phí ship và phí thu hộ</b>.</p>
                    )}
                    <p><b className="font-semibold text-foreground">Ngân hàng:</b> kỳ chỉ coi là xong khi tiền thật về khớp số sao kê tính ra.
                        Lệch trong {VND(overview.bank_tolerance_vnd)} thì bỏ qua (quy đổi {m.currency} → ¥ → đ có làm tròn, ngân hàng còn thu phí chuyển).
                        Nhập số tiền về của từng kỳ ở bảng ② bên dưới.</p>
                </div>
            )}
        </div>
    );
}

/**
 * Luồng tiền một kỳ nước ngoài Đài — ba chặng như LuongTien của Đài, nhưng các dòng trừ đọc
 * thẳng từ sheet TỔNG (mẫu Sing: phí thu hộ, phí ship, phí hàng hoàn lên kệ, tiền hàng).
 */
function MarketMoneyFlowPanel({ l, ky: statementPeriod, m, tien: formatAmount }: { l: MarketMoneyFlow; ky: MarketPeriod; m: MarketData["market"]; tien: (n: number) => string }) {
    const isNegative = (l.phai_nhan_vnd ?? 0) < 0;
    return (
        <div className="px-5 py-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h4 className="text-[12px] font-bold uppercase tracking-wider text-foreground/70">Luồng tiền kỳ này</h4>
                <span className="text-[12px] text-muted-foreground">theo đúng thứ tự sheet TỔNG của NAZA — đặt cạnh file mà dò từng dòng</span>
            </div>
            <div className="grid items-stretch gap-2 xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
                <MoneyStage te="twd" ky={m.symbol} ten={m.display} mo="khách trả khi nhận hàng">
                    <MoneyLine nhan="Số đơn NAZA thu được" so={formatNumber(l.so_don)} ghi={!l.so_don ? `kỳ này chưa thu COD — chỉ có phí ${statementPeriod.don_phi ?? 0} đơn` : undefined} />
                    <MoneyLine nhan="Tổng COD thu về" so={formatAmount(l.cod_local)} tong lon mau={STAGES.twd.so} />
                </MoneyStage>
                <RateArrow chu={l.ty_gia_rmb != null ? `× ${l.ty_gia_rmb}` : "—"} />
                <MoneyStage te="rmb" ten="Trung Quốc" mo="NAZA trừ phí">
                    <MoneyLine nhan="Quy ra nhân dân tệ" so={l.rmb != null ? RMB2(l.rmb) : "—"} />
                    {l.tru_rmb.map((x) => <MoneyLine key={x.nhan} nhan={`− ${x.nhan}`} so={RMB2(-x.so)} tru ghi={x.ghi} />)}
                    <MoneyLine nhan="= COD còn lại" so={l.rmb_rong != null ? RMB2(l.rmb_rong) : "—"} tong
                        mau={(l.rmb_rong ?? 0) < 0 ? "text-rose-600 dark:text-rose-400" : STAGES.rmb.so} />
                </MoneyStage>
                <RateArrow chu={`× ${l.ty_gia_vnd != null ? l.ty_gia_vnd.toLocaleString("vi-VN") : "—"}`} />
                <MoneyStage te="vnd" ten="Việt Nam" mo="về tài khoản">
                    <MoneyLine nhan="Quy ra tiền Việt" so={l.vnd != null ? VND(l.vnd) : "—"} />
                    {l.tru_vnd.map((x) => <MoneyLine key={x.nhan} nhan={`− ${x.nhan}`} so={VND(-x.so)} tru ghi="theo sao kê NAZA" />)}
                    {l.chenh_vnd !== 0 && <MoneyLine nhan="± Điều chỉnh" so={VND(l.chenh_vnd)} tru={l.chenh_vnd < 0} ghi="NAZA ghi thêm, sheet TỔNG không tách dòng" />}
                    <MoneyLine nhan="= Phải nhận" tong lon
                        so={l.phai_nhan_vnd == null ? "—" : isNegative ? `âm ${VND(-l.phai_nhan_vnd)}` : VND(l.phai_nhan_vnd)}
                        ghi={isNegative ? (statementPeriod.tru_vao_dai ? `đã trừ vào tiền COD Đài kỳ ${dmy(statementPeriod.tru_vao_dai)} (bản gộp) — không có tiền về` : "NAZA trừ vào kỳ sau") : undefined}
                        mau={isNegative || l.phai_nhan_vnd == null ? "text-rose-600 dark:text-rose-400" : STAGES.vnd.so} />
                </MoneyStage>
            </div>
        </div>
    );
}

function TwCodRecon({ dateRange, nutNuoc: marketSwitcher }: Props & { nutNuoc?: ReactNode }) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [upErr, setUpErr] = useState("");
    const [uploading, setUploading] = useState(false);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [checks, setChecks] = useState<Check[]>([]);
    const [periods, setPeriods] = useState<Period[]>([]);
    const [pending, setPending] = useState<Pending[]>([]);
    const [fx, setFx] = useState<Fx | null>(null);
    const [overview, setOverview] = useState<Overview | null>(null);
    const [receivedSummary, setReceivedSummary] = useState<ReceivedSummary | null>(null);
    const [partnerImport, setPartnerImport] = useState<PartnerSheetImport | null>(null);
    const [stms, setStms] = useState<StatementMeta[]>([]);
    const [pid, setPid] = useState("");
    const [copied, setCopied] = useState("");
    const [busy, setBusy] = useState("");
    const [bankEntryFile, setBankEntryFile] = useState("");       // tên file kỳ đang nhập tiền về
    const [dragging, setDragging] = useState(false);              // đang kéo file đè lên màn
    const fileRef = useRef<HTMLInputElement>(null);
    const narrow = useNarrowScreen();

    const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

    const load = useCallback(async () => {
        setError("");
        try {
            const [a, b] = await Promise.all([
                fetch(`/api/talpha/order-ledger?to=${to}`).then((r) => r.json()),
                fetch(`/api/talpha/cod-recon?from=2000-01-01&to=${to}`).then((r) => r.json()),
            ]);
            if (a.error) throw new Error(a.error);
            setTasks(a.viec || []); setChecks(a.checks || []);
            setPeriods(a.periods || []); setPending(a.chua_ve_tien || []);
            setFx(a.fx || null); setOverview(a.tong_quan || null); setReceivedSummary(a.tien_ve || null);
            setPartnerImport(a.nhap_bang_don || null);
            setStms(b.statements || []);
            if (a.periods?.length) setPid((p) => p || a.periods[0].id);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Lỗi không rõ");
        } finally { setLoading(false); }
    }, [to]);

    useEffect(() => { load(); }, [load]);

    const copyText = (id: string, text: string) => {
        navigator.clipboard?.writeText(text);
        setCopied(id); setTimeout(() => setCopied(""), 2200);
    };

    /** Ghi một việc đã xử. Bỏ qua thì BẮT ghi lý do — đây là quyết định mất tiền. */
    const recordTask = async (key: string, kind: "da_doi" | "da_hoi" | "bo_qua") => {
        if (!key) return;
        let reason = "";
        if (kind === "bo_qua") {
            reason = (window.prompt("Bỏ qua khoản này vì sao? (bắt buộc — sau còn tra lại được)") || "").trim();
            if (!reason) return;
        }
        setBusy(key);
        try {
            await fetch("/api/talpha/cod-actions", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ kind: "done", key, viec: kind, ghi_chu: reason }),
            });
            await load();
        } finally { setBusy(""); }
    };

    const saveBankReceipt = async (filename: string, figure: number, date: string) => {
        setBusy(filename); setUpErr("");
        try {
            const res = await fetch("/api/talpha/cod-actions", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ kind: "bank", filename, thuc_nhan_vnd: figure, ngay_ve: date }),
            });
            const d = await res.json();
            if (!res.ok) { setUpErr(d.error || "Không ghi được số tiền về"); return; }
            setBankEntryFile(""); await load();
        } finally { setBusy(""); }
    };

    /** Nút "Nhập số" ở Việc hôm nay: mở ô nhập ở đúng dòng kỳ đó trong bảng ② rồi cuộn tới, khỏi phải tìm. */
    const openBankEntry = (filename: string) => {
        setBankEntryFile(filename);
        const p = periods.find((x) => x.filename === filename);
        if (p) setTimeout(() => document.getElementById(`ky-${p.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
    };

    const upload = async (f: File) => {
        setUploading(true); setUpErr("");
        try {
            const fd = new FormData(); fd.append("file", f);
            const res = await fetch("/api/talpha/cod-recon", { method: "POST", body: fd });
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || "Tải lên thất bại");
            await load();
        } catch (e) {
            setUpErr(e instanceof Error ? e.message : "Tải lên thất bại");
        } finally {
            setUploading(false);
            if (fileRef.current) fileRef.current.value = "";
        }
    };

    const period = periods.find((p) => p.id === pid) || periods[0];
    // Đòi NAZA tiền đơn quá hạn là việc THEO ĐƠN → khung "Đòi tiền NAZA" ở Sổ đơn hàng (07/10/2026,
    // tách mục Kế toán). Ở đây chỉ còn việc theo KỲ: soát sao kê, hỏi khoản lệch, nhập tiền về.
    const accountingTasks = tasks.filter((v) => v.id !== "doi-naza");

    /** Xuất đúng thứ cần gửi lại 3PL — bốn loại lệch trong một file. */
    const exportForPartner = () => {
        if (!period) return;
        const rows: (string | number)[][] = [];
        for (const l of period.lech_tien)
            rows.push(["Trả khác số trên đơn", l.order_no, l.tracking, l.cod_twd, l.paid_twd ?? "", l.diff_twd ?? "", ""]);
        for (const t of period.thua_sao_ke)
            rows.push(["Trả cho đơn mình không có", t.order_no, t.tracking, "", t.amount_twd, "", ""]);
        for (const f of period.phi_sai)
            rows.push(["Phí thu sai bảng giá", f.order_no, f.tracking, "", "", "", `${f.ship_fee_rmb ?? ""}¥`]);
        for (const p of pending)
            rows.push([p.qua_han ? "QUÁ HẠN chưa trả tiền" : "Chưa trả tiền", p.order_no, p.tracking,
                p.cod_twd, "", "", `đã qua ${p.ky_da_qua} kỳ · ${p.doi_chu}`]);
        const head = ["Loại", "Mã đơn", "Mã vận đơn", "COD đơn (NT$)", "3PL trả (NT$)", "Lệch (NT$)", "Ghi chú"];
        const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const blob = new Blob(["﻿" + [head.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n")],
            { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `gui-3pl_${period.filename.replace(/\.[^.]+$/, "")}.csv`;
        a.click(); URL.revokeObjectURL(a.href);
    };

    if (loading && !periods.length) return <div className="space-y-4">{marketSwitcher}<TabSkeleton cards={3} rows={8} showChart={false} /></div>;
    if (error) return <div className="space-y-4">{marketSwitcher}<ErrorState message={error} onRetry={load} /></div>;

    const latest = periods[0];
    const sheetStale = isSheetStale(partnerImport);

    const payableCell = (p: Period) => p.luong?.phai_nhan_vnd != null ? (
        <span className="text-[14px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{VND(p.luong.phai_nhan_vnd)}</span>
    ) : (p.luong?.rmb_rong ?? 0) < 0 ? (
        <span className="font-semibold tabular-nums text-amber-600 dark:text-amber-400" title="NAZA mang số âm sang trừ vào kỳ sau">
            âm {RMB2(p.luong!.rmb_rong!)} → kỳ sau
        </span>
    ) : <span className="text-muted-foreground">không tính được</span>;

    const receivedCell = (p: Period) => bankEntryFile === p.filename ? (
        <FormBank goiY={p.settlement?.payable_vnd ?? null} busy={busy === p.filename}
            onHuy={() => setBankEntryFile("")} onGhi={(figure, date) => saveBankReceipt(p.filename, figure, date)} />
    ) : p.bank ? (
        <button onClick={() => setBankEntryFile(p.filename)} className="rounded-lg px-1.5 py-0.5 text-right transition-colors hover:bg-muted">
            <div className="font-semibold tabular-nums text-foreground">{VND(p.bank.thuc_nhan_vnd)}</div>
            <div className="text-[11.5px] text-muted-foreground">về {dmy(p.bank.ngay_ve)}</div>
        </button>
    ) : (
        <button onClick={() => setBankEntryFile(p.filename)}
            className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border px-2.5 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:border-sky-400 hover:bg-sky-50 hover:text-sky-700 dark:hover:bg-sky-500/10 dark:hover:text-sky-300">
            <PenLine className="h-3.5 w-3.5" />chưa nhập
        </button>
    );

    const diffCell = (p: Period) => (
        <span className={cn("font-semibold tabular-nums",
            p.lech_bank_vnd == null ? "text-muted-foreground"
                : p.trang_thai === "khop" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
            {p.lech_bank_vnd == null ? "·"
                : Math.round(p.lech_bank_vnd) === 0 ? "0đ"
                    : `${p.lech_bank_vnd > 0 ? "+" : "−"}${VND(Math.abs(p.lech_bank_vnd))}`}
        </span>
    );
    const importLabel = sheetStale ? null : shortImportLabel(partnerImport);

    return (
        // Kéo file sao kê thả vào BẤT CỨ ĐÂU trên màn (07/10/2026): trước là một thẻ to "Kéo file vào
        // đây" chiếm đầu tab mỗi lần mở, trong khi tải file chỉ là việc tuần một lần.
        <div className="relative space-y-3 md:space-y-4"
            onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); if (!dragging) setDragging(true); } }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
            onDrop={(e) => {
                if (!e.dataTransfer.files?.length) return;
                e.preventDefault(); setDragging(false);
                upload(e.dataTransfer.files[0]);
            }}>
            {dragging && (
                <div className="pointer-events-none absolute inset-0 z-30 grid place-items-start justify-center rounded-2xl border-2 border-dashed border-orange-400 bg-orange-50/85 pt-24 dark:bg-orange-500/15">
                    <div className="flex items-center gap-2 rounded-xl bg-card px-4 py-3 text-[15px] font-bold text-orange-700 shadow-lg dark:text-orange-300">
                        <FileSpreadsheet className="h-5 w-5" />Thả file sao kê NAZA để tải lên
                    </div>
                </div>
            )}
            <input ref={fileRef} type="file" accept=".xlsx,.csv,.tsv,.txt" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />

            <HeaderBar
                nutNuoc={marketSwitcher}
                nguon={<>
                    {stms.length} bản sao kê{latest ? ` · mới nhất “${shortFile(latest.filename)}” (chốt đơn tới ${dmy(latest.period_date)})` : ""}
                    {importLabel ? ` · ${importLabel}` : ""}
                </>}
                phai={<>
                    <span className="hidden text-[11.5px] text-muted-foreground lg:inline">hoặc kéo thả file .xlsx vào màn</span>
                    <span title="File .xlsx ba sheet của NAZA — máy tự đọc, tự soát 8 mục, tự cập nhật Sổ đơn hàng. Tải lại cùng một file thì THAY, không cộng thêm.">
                        <ActionButton kieu="chinh" busy={uploading} busyText="Đang đọc và soát…" onClick={() => fileRef.current?.click()}>
                            <Upload className="h-4 w-4" />Tải sao kê NAZA
                        </ActionButton>
                    </span>
                </>}
            />
            {upErr && (
                <p className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />{upErr}
                </p>
            )}

            {/* Bảng đối tác đã cũ → khung đỏ to như trước: số trên màn KHÔNG phải của hôm nay. */}
            {sheetStale && <PartnerSheetImporter n={partnerImport} />}

            {/* ═══ Σ TIỀN VỀ — bốn ô số; giải thích cách tính cất sau một nút ═══ */}
            {receivedSummary && <MoneySummary t={receivedSummary} tq={overview} />}

            {/* ═══ ① VIỆC HÔM NAY ═══ */}
            <TasksSection viec={accountingTasks} busy={busy} copied={copied} onChep={copyText}
                tinLech={period ? { vi: discrepancyMessage(period, "vi"), zh: discrepancyMessage(period, "zh") } : null}
                onNhapBank={openBankEntry} onGhi={recordTask}
                rongChu="Mọi kỳ đã soát xong, tiền đã về khớp. Đơn quá hạn phải đòi xem ở Sổ đơn hàng." />

            {/* ═══ ② BẢNG CÁC KỲ — xương sống của tab ═══ */}
            {periods.length > 0 && (
                <Section so="2" ten={`${periods.length} kỳ sao kê`} phamVi="all"
                    phu="bấm một dòng để mở chi tiết kỳ đó">
                    {narrow ? (
                        // Điện thoại: mỗi kỳ một thẻ — bảng 8 cột phải kéo ngang mới thấy cột "Thực nhận".
                        <ul className="divide-y divide-border/60">
                            {periods.map((p) => {
                                const selected = p.id === period?.id;
                                return (
                                    <li key={p.id} id={`ky-${p.id}`} onClick={() => setPid(p.id)}
                                        className={cn("cursor-pointer px-3.5 py-3",
                                            selected && "bg-orange-50/70 shadow-[inset_3px_0_0_0_#FF7312] dark:bg-orange-500/[0.07]")}>
                                        <div className="flex items-center gap-2">
                                            <b className="tabular-nums text-foreground">{dmy(p.period_date)}</b>
                                            <span className="min-w-0 truncate text-[11.5px] text-muted-foreground">{shortFile(p.filename)}</span>
                                            <span className="ml-auto flex-none"><StatusBadge p={p} /></span>
                                        </div>
                                        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-[12.5px]">
                                            <div>
                                                <div className="text-[11px] text-muted-foreground">Tiền COD · {p.luong?.so_dong_sao_ke ?? p.orders_paid} đơn</div>
                                                <div className="font-semibold tabular-nums text-sky-700 dark:text-sky-300">{TWD(p.luong?.cod_twd ?? p.total_twd)}</div>
                                            </div>
                                            <div>
                                                <div className="text-[11px] text-muted-foreground">Phải nhận</div>
                                                {payableCell(p)}
                                            </div>
                                            <div className="col-span-2 flex flex-wrap items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
                                                <div>
                                                    <div className="text-[11px] text-muted-foreground">Thực nhận (ngân hàng)</div>
                                                    <div className="-ml-1.5">{receivedCell(p)}</div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="text-[11px] text-muted-foreground">Lệch</div>
                                                    {diffCell(p)}
                                                </div>
                                            </div>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[900px] whitespace-nowrap text-[13px]">
                            <thead>
                                <tr className="border-b border-border/70 bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                    <th className="px-5 py-2.5 text-left">Kỳ chốt</th>
                                    <th className="px-3 py-2.5 text-right">Đơn</th>
                                    <th className="px-3 py-2.5 text-right">Tiền COD</th>
                                    <th className="px-3 py-2.5 text-right">Tiền hàng</th>
                                    <th className="px-3 py-2.5 text-right">Phải nhận</th>
                                    <th className="px-3 py-2.5 text-right">Thực nhận</th>
                                    <th className="px-3 py-2.5 text-right">Lệch</th>
                                    <th className="px-5 py-2.5 text-left">Tình trạng</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/60">
                                {periods.map((p) => {
                                    const selected = p.id === period?.id;
                                    const goods = p.luong?.tien_hang;
                                    return (
                                        <tr key={p.id} id={`ky-${p.id}`} onClick={() => setPid(p.id)}
                                            className={cn("cursor-pointer transition-colors",
                                                selected ? "bg-orange-50/70 dark:bg-orange-500/[0.07]" : "hover:bg-muted/40")}>
                                            <td className={cn("px-5 py-3", selected && "shadow-[inset_3px_0_0_0_#FF7312]")}>
                                                <div className="font-semibold tabular-nums text-foreground">{dmy(p.period_date)}</div>
                                                <div className="text-[12px] text-muted-foreground">{shortFile(p.filename)}</div>
                                            </td>
                                            <td className="px-3 py-3 text-right tabular-nums text-foreground/80">
                                                {p.luong?.so_dong_sao_ke ?? p.orders_paid}
                                            </td>
                                            <td className="px-3 py-3 text-right font-semibold tabular-nums text-sky-700 dark:text-sky-300">
                                                {TWD(p.luong?.cod_twd ?? p.total_twd)}
                                            </td>
                                            <td className="px-3 py-3 text-right">
                                                {goods?.sing_vnd ? (
                                                    // Kỳ gộp Sing: tiền hàng NAZA trừ gồm cả Đài lẫn Sing.
                                                    <>
                                                        <div className="font-semibold tabular-nums text-orange-600 dark:text-orange-400">
                                                            {VND(goods.trong_luong_vnd)}
                                                        </div>
                                                        <div className="text-[11.5px] text-muted-foreground">
                                                            Đài {VND(goods.dai_vnd ?? 0)} · Sing {VND(goods.sing_vnd)}
                                                        </div>
                                                    </>
                                                ) : goods?.file ? (
                                                    <>
                                                        <div className="font-semibold tabular-nums text-orange-600 dark:text-orange-400">
                                                            {VND(goods.file.tong_vnd)}
                                                        </div>
                                                        <div className="text-[11.5px] text-muted-foreground">
                                                            {goods.cach_tra === "naza_tru" ? "NAZA trừ vào COD" : "tự chuyển khoản riêng"}
                                                        </div>
                                                    </>
                                                ) : <span className="text-muted-foreground">—</span>}
                                            </td>
                                            <td className="px-3 py-3 text-right">{payableCell(p)}</td>
                                            <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>{receivedCell(p)}</td>
                                            <td className="px-3 py-3 text-right">{diffCell(p)}</td>
                                            <td className="px-5 py-3"><StatusBadge p={p} /></td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    )}
                    {overview && (
                        <p className="flex items-start gap-2 border-t border-border/70 bg-muted/30 px-3.5 py-2 text-[12px] leading-relaxed text-muted-foreground md:px-5">
                            <Info className="mt-0.5 h-3.5 w-3.5 flex-none" />
                            <span>
                                Kỳ chỉ <b className="font-semibold text-foreground">xong</b> khi tiền thật về khớp số sao kê tính ra
                                (lệch dưới {VND(overview.bank_tolerance_vnd)} bỏ qua) — không phải khi tám mục soát xanh hết.
                            </span>
                        </p>
                    )}
                </Section>
            )}

            {/* ═══ ③ KỲ ĐANG MỞ ═══ */}
            {period && (
                <Section so="3" ten={`Kỳ chốt ${dmy(period.period_date)}`} phamVi="one" phu={shortFile(period.filename)}
                    phai={
                        <>
                            <div className="relative max-w-full">
                                <select value={period.id} onChange={(e) => setPid(e.target.value)}
                                    className="h-8 max-w-[18rem] appearance-none truncate rounded-lg border border-border bg-card pl-3 pr-8 text-[13px] font-medium text-foreground shadow-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:[color-scheme:dark]">
                                    {periods.map((p, i) => (
                                        <option key={p.id} value={p.id}>
                                            {i === 0 ? "★ " : ""}{shortFile(p.filename)} — chốt {dmy(p.period_date)}
                                        </option>
                                    ))}
                                </select>
                                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            </div>
                            <ActionButton onClick={exportForPartner}>
                                <Download className="h-4 w-4" />Xuất file gửi 3PL
                            </ActionButton>
                        </>
                    }>
                    {period.luong ? (() => {
                        const l = period.luong;
                        const goods = l.tien_hang;
                        const isNegative = l.phai_nhan_vnd == null && (l.rmb_rong ?? 0) < 0;
                        return (
                            <>
                                <div className="grid grid-cols-2 gap-px border-b border-border/70 bg-border/60 sm:grid-cols-3 xl:grid-cols-5">
                                    <Kpi label="Đơn trong sao kê" value={formatNumber(l.so_dong_sao_ke)}
                                        sub={`${period.orders_paid} đơn khớp sổ đơn`} />
                                    <Kpi label="Tiền COD" value={l.cod_twd != null ? TWD(l.cod_twd) : "—"}
                                        sub="NAZA thu trong kỳ" tone="twd" />
                                    <Kpi label="Phí NAZA trừ" value={RMB2(l.phi_thao_tac_rmb + l.phi_ship_rmb)}
                                        sub={l.sg_gop?.don
                                            ? `gồm ${l.sg_gop.don} đơn Sing ${RMB2(l.sg_gop.phi_rmb)}`
                                            : l.phi_gop ? "ship + thao tác (gộp)" : `thao tác ${RMB2(l.phi_thao_tac_rmb)} · ship ${RMB2(l.phi_ship_rmb)}`}
                                        tone="rmb" />
                                    <Kpi label="Tiền hàng"
                                        value={goods.sing_vnd ? VND(goods.trong_luong_vnd)
                                            : goods.file ? VND(goods.file.tong_vnd) : goods.naza_tru_vnd != null ? VND(goods.naza_tru_vnd) : "—"}
                                        sub={goods.sing_vnd ? `Đài ${VND(goods.dai_vnd ?? 0)} · Sing ${VND(goods.sing_vnd)}`
                                            : goods.cach_tra === "naza_tru" ? "NAZA trừ vào COD"
                                            : (goods.con_no_vnd ?? 0) > 0 ? `tự chuyển · còn nợ ${VND(goods.con_no_vnd!)}` : "tự chuyển khoản riêng"}
                                        tone={(goods.con_no_vnd ?? 0) > 0 ? "red" : "hang"} />
                                    {isNegative
                                        ? <Kpi label="Phải nhận" value={RMB2(l.rmb_rong!)} sub="âm → NAZA trừ vào kỳ sau" tone="red"
                                            className="col-span-2 xl:col-span-1" />
                                        : <Kpi label="Phải nhận" value={l.phai_nhan_vnd != null ? VND(l.phai_nhan_vnd) : "—"}
                                            sub="sau khi trừ hết" tone="green" className="col-span-2 xl:col-span-1" />}
                                </div>
                                <MoneyFlowPanel l={l} />
                            </>
                        );
                    })() : (
                        <div className="flex items-center gap-2 px-5 py-4 text-[13px] text-muted-foreground">
                            <Info className="h-4 w-4 flex-none" />
                            Kỳ này không có sheet TỔNG của NAZA nên không dựng được luồng tiền.
                        </div>
                    )}
                    <ChecksPanel checks={checks} kyKhac={!!latest && period.id !== latest.id}>
                    <div className="grid items-start gap-4 border-t border-border/70 bg-muted/20 p-3 md:p-4 xl:grid-cols-2">
                        {/* Tám mục soát máy chỉ chạy cho kỳ MỚI NHẤT. Đang xem kỳ khác thì nói
                            thẳng ra, kẻo tưởng dấu tích xanh kia là của kỳ đang chọn. */}
                        {latest && period.id !== latest.id && (
                            <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-amber-800 xl:col-span-2 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                                <Info className="mt-0.5 h-4 w-4 flex-none" />
                                <span>
                                    Hai nhóm soát dưới đây là của <b className="font-semibold">kỳ mới nhất</b> — chốt {dmy(latest.period_date)} ({shortFile(latest.filename)}).
                                    Máy chỉ soát kỳ mới nhất; số tiền phía trên mới là của kỳ đang chọn.
                                </span>
                            </p>
                        )}
                        <CheckGroup nhom="A" ten="Soát bên trong file" hoi="tin được số trong đó không"
                            checks={checks.filter((c) => c.nhom === "A")} />
                        <CheckGroup nhom="B" ten="Soát file với đơn của mình" hoi="họ trả đủ và đúng chưa"
                            checks={checks.filter((c) => c.nhom === "B")} />
                    </div>
                    </ChecksPanel>
                </Section>
            )}

            {/* ═══ ④ TỶ GIÁ — quy ra tiền, không quy ra phần trăm ═══ */}
            {fx && fx.rows.length > 1 && <FxSection so="4" fx={fx} kyDangXem={period?.filename} te={TW_CURRENCY} />}
        </div>
    );
}

/* ═══════════════════════ mảnh dùng lại ═══════════════════════
   Màu chữ đi theo NGHĨA của con số, cả tab một luật — nhìn màu là biết loại tiền:
     xanh dương = NT$ (tiền Đài)      tím = ¥ (tiền Trung)      xanh lá = tiền về tay
     cam        = tiền hàng           đỏ  = khoản bị trừ / thiếu / nợ
     vàng hổ phách = số dự tính, số còn chờ
   Số tiền dùng chính font chữ với chữ số thẳng cột (tabular-nums) — font mono cũ
   làm bảng trông như màn hình dòng lệnh. Font mono chỉ còn cho mã vận đơn và số
   điện thoại, là thứ phải dò từng ký tự. */

/** Đồng tiền của một màn (Đài NT$, Sing S$…) — khối tỷ giá + biểu đồ ghi đúng tên tiền. */
type Currency = { ky: string; ma: string; fmt: (n: number) => string };
const TW_CURRENCY: Currency = { ky: "NT$", ma: "TWD", fmt: TWD };

/** ④ Tỷ giá đã lấy của mình bao nhiêu — dùng chung màn Đài và các nước khác (08/10/2026). */
function FxSection({ so: figure, fx, kyDangXem: viewedFile, te: currency }: { so: string; fx: Fx; kyDangXem?: string; te: Currency }) {
    return (
        <Section so={figure} ten="Tỷ giá đã lấy của mình bao nhiêu" phamVi="all" gap={{ mo: false }}
            dem={fx.total_thiet_vnd > 0 ? `thiệt ${VND(fx.total_thiet_vnd)}` : undefined}>
            <div className="grid gap-px border-b border-border/70 bg-border/60 sm:grid-cols-3">
                <Kpi label="Thiệt vì tỷ giá" value={VND(fx.total_thiet_vnd)}
                    sub={`qua ${fx.rows.filter((r) => r.thiet_vnd != null).length} kỳ đã có sao kê`} tone="red" />
                <Kpi label="Tỷ giá tốt nhất NAZA từng đặt"
                    value={fx.best_vnd_per_twd != null ? `${fx.best_vnd_per_twd.toFixed(2)}đ/${currency.ky}` : "—"}
                    sub={fx.best_period ? `kỳ chốt ${dmy(fx.best_period)}` : ""} tone="green" />
                <WorstPeriodKpi rows={fx.rows} />
            </div>
            <p className="flex items-start gap-2 border-b border-border/70 bg-muted/30 px-5 py-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 flex-none" />
                <span>
                    Tỷ giá NAZA tự đặt, mình phải chịu — nên chỉ hỏi: <b className="font-semibold text-foreground">nó đã lấy của mình bao nhiêu tiền</b>.
                    Mốc là kỳ tốt nhất chính NAZA từng đặt; tiền thiệt = chênh đồng/{currency.ky} × tiền COD cả kỳ. Rê chuột lên từng kỳ để xem số.
                </span>
            </p>
            <FxChart fx={fx} kyDangXem={viewedFile} te={currency} />
            <details className="group border-t border-border/70">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 px-5 py-2.5 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
                    <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                    Xem bảng số từng kỳ
                </summary>
                <div className="overflow-x-auto border-t border-border/70">
                    <table className="w-full min-w-[720px] whitespace-nowrap text-[13px]">
                        <thead>
                            <tr className="border-b border-border/70 bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                <th className="px-5 py-2.5 text-left">Kỳ chốt</th>
                                <th className="px-3 py-2.5 text-right">{currency.ma}→RMB</th>
                                <th className="px-3 py-2.5 text-right">RMB→VND</th>
                                <th className="px-3 py-2.5 text-right">Đồng / {currency.ky}</th>
                                <th className="px-3 py-2.5 text-right">Tiền COD</th>
                                <th className="px-5 py-2.5 text-right">Thiệt so kỳ tốt nhất</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60">
                            {(() => {
                                const maxLoss = Math.max(0, ...fx.rows.map((r) => r.thiet_vnd ?? 0));
                                return fx.rows.map((r) => (
                                    <tr key={r.filename}
                                        className={cn("transition-colors",
                                            r.filename === viewedFile ? "bg-orange-50/70 dark:bg-orange-500/[0.07]" : "hover:bg-muted/30")}>
                                        <td className="px-5 py-2.5 font-semibold tabular-nums text-foreground">{dmy(r.period_date)}</td>
                                        <td className="px-3 py-2.5 text-right tabular-nums text-sky-700 dark:text-sky-300">{r.rate_twd_rmb ?? "—"}</td>
                                        <td className="px-3 py-2.5 text-right tabular-nums text-violet-700 dark:text-violet-300">{r.rate_rmb_vnd ?? "—"}</td>
                                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-foreground">
                                            {r.vnd_per_twd != null ? r.vnd_per_twd.toFixed(2) : "—"}
                                        </td>
                                        <td className="px-3 py-2.5 text-right tabular-nums text-foreground/80">{currency.fmt(r.cod_twd)}</td>
                                        <td className="px-5 py-2.5 text-right">
                                            {r.thiet_vnd == null ? <span className="text-muted-foreground">—</span>
                                                : r.tot_nhat ? (
                                                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[12px] font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
                                                        <BadgeCheck className="h-3.5 w-3.5" />tốt nhất
                                                    </span>
                                                ) : (
                                                    <div className="flex items-center justify-end gap-3">
                                                        <span className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-rose-100 sm:block dark:bg-rose-500/15">
                                                            <span className="block h-full rounded-full bg-rose-500"
                                                                style={{ width: `${maxLoss > 0 ? Math.max(4, (r.thiet_vnd / maxLoss) * 100) : 0}%` }} />
                                                        </span>
                                                        <span className="font-semibold tabular-nums text-rose-600 dark:text-rose-400">
                                                            −{VND(r.thiet_vnd)}
                                                        </span>
                                                    </div>
                                                )}
                                        </td>
                                    </tr>
                                ));
                            })()}
                        </tbody>
                    </table>
                </div>
            </details>
        </Section>
    );
}

/** ① Việc hôm nay — dùng chung màn Đài và các nước khác (08/10/2026). */
function TasksSection({ viec: tasks, busy, copied, onChep: onCopy, tinLech: discrepancyMessage, onNhapBank: onBankEntry, onGhi: onSave, rongChu: emptyText, hoiAi: counterparty = "NAZA" }: {
    viec: Task[]; busy: string; copied: string;
    onChep: (id: string, text: string) => void;
    /** Tin nhắn soạn sẵn cho khoản trả lệch (Việt + Trung). */
    tinLech: { vi: string; zh: string } | null;
    onNhapBank: (key: string) => void;
    onGhi: (key: string, kind: "da_hoi" | "bo_qua") => void;
    rongChu: string;
    hoiAi?: string;
}) {
    return (
        <Section so="1" ten="Việc hôm nay" phamVi="all" dem={tasks.length ? `${tasks.length} việc` : ""}
            phu="soát sao kê, hỏi khoản lệch, nhập tiền về">
            {tasks.length === 0 ? (
                <div className="flex items-center gap-3 px-5 py-6">
                    <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="h-5 w-5" />
                    </span>
                    <div>
                        <div className="text-[14.5px] font-semibold text-emerald-700 dark:text-emerald-400">Không có việc gì cần làm</div>
                        <div className="text-[13px] text-muted-foreground">{emptyText}</div>
                    </div>
                </div>
            ) : (
                <ul className="divide-y divide-border/70">
                    {tasks.map((v) => {
                        const m = TASK_LEVEL_STYLES[v.muc];
                        return (
                            <li key={v.id} className="relative flex flex-wrap items-start gap-x-4 gap-y-3 px-5 py-4 transition-colors hover:bg-muted/30">
                                <span className={cn("absolute inset-y-4 left-0 w-1 rounded-r-full", m.vach)} />
                                <span className={cn("grid h-9 w-9 flex-none place-items-center rounded-xl", m.nen)}>
                                    <m.Icon className="h-[18px] w-[18px]" />
                                </span>
                                <div className="min-w-[14rem] flex-1">
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                        <span className="text-[14.5px] font-semibold text-foreground">{v.tieu_de}</span>
                                        <span className={cn("rounded-full px-2 py-0.5 text-[12px] font-bold tabular-nums", m.the)}>
                                            {v.don_vi === "đ" ? VND(v.so) : `${formatNumber(v.so)} ${v.don_vi}`}
                                        </span>
                                    </div>
                                    <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{v.chi_tiet}</p>
                                </div>
                                <div className="flex flex-none flex-wrap items-center gap-2">
                                    {v.id === "lech-tien" && discrepancyMessage && (
                                        <>
                                            <ActionButton kieu="chinh" onClick={() => onCopy("l-vi", discrepancyMessage.vi)}>
                                                <Copy className="h-3.5 w-3.5" />
                                                {copied === "l-vi" ? "Đã chép" : "Chép tin (Việt)"}
                                            </ActionButton>
                                            <ActionButton onClick={() => onCopy("l-zh", discrepancyMessage.zh)}>
                                                {copied === "l-zh" ? "Đã chép" : "中文"}
                                            </ActionButton>
                                        </>
                                    )}
                                    {v.nut.includes("nhap_bank") && (
                                        <ActionButton kieu="chinh" onClick={() => onBankEntry(v.done_key)}>
                                            <PenLine className="h-3.5 w-3.5" />Nhập số
                                        </ActionButton>
                                    )}
                                    {v.nut.includes("da_hoi") && v.done_key && (
                                        <ActionButton busy={busy === v.done_key} onClick={() => onSave(v.done_key, "da_hoi")}>
                                            Đã hỏi {counterparty}
                                        </ActionButton>
                                    )}
                                    {v.nut.includes("bo_qua") && v.done_key && (
                                        <ActionButton busy={busy === v.done_key} onClick={() => onSave(v.done_key, "bo_qua")}>
                                            <X className="h-3.5 w-3.5" />Bỏ qua
                                        </ActionButton>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </Section>
    );
}

const TASK_LEVEL_STYLES: Record<Task["muc"], { Icon: LucideIcon; vach: string; nen: string; the: string }> = {
    gap: {
        Icon: AlertTriangle, vach: "bg-rose-500",
        nen: "bg-rose-500/10 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400",
        the: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
    },
    soat: {
        Icon: SearchCheck, vach: "bg-amber-400",
        nen: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
        the: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
    },
    ghi: {
        Icon: Landmark, vach: "bg-sky-500",
        nen: "bg-sky-500/10 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400",
        the: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
    },
};

/**
 * Một bước trong quy trình.
 *
 * `phamVi` là thứ sửa đúng lời chê nặng nhất của Sỹ Anh — "không biết số nào
 * của kỳ nào". Mỗi khối phải TỰ KHAI số của nó thuộc một kỳ hay cộng dồn, đóng
 * dấu ngay góc phải, không để người đọc tự đoán.
 */
function Section({ so: figure, ten: title, phamVi: scope, phu: subtitle, dem: countLabel, phai: actions, gap: collapsible, children }: {
    so: string; ten: string; phamVi: "one" | "all";
    phu?: string; dem?: string; phai?: React.ReactNode;
    /** Khối gập được (07/10/2026): `mo` là trạng thái ban đầu; bấm tiêu đề để mở/gập. */
    gap?: { mo: boolean };
    children: React.ReactNode;
}) {
    const [open, setOpen] = useState(collapsible ? collapsible.mo : true);
    return (
        <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <header
                onClick={collapsible ? () => setOpen(!open) : undefined}
                className={cn("flex flex-wrap items-center gap-x-2.5 gap-y-2 px-3.5 py-3 md:px-5",
                    open && "border-b border-border/70", collapsible && "cursor-pointer hover:bg-muted/30")}>
                {/* Số bước nhỏ, màu trầm — trước là ô gradient cam to, sáu khối sáu ô cam nên rối mắt. */}
                <span className="grid h-6 w-6 flex-none place-items-center rounded-md bg-muted text-[12px] font-bold text-muted-foreground">
                    {figure}
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-[15px] font-bold leading-tight text-foreground">{title}</h3>
                        {countLabel && (
                            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[12px] font-bold tabular-nums text-orange-700 dark:bg-orange-500/15 dark:text-orange-300">
                                {countLabel}
                            </span>
                        )}
                        {/* "Cộng dồn / chỉ kỳ này" — sửa lời chê "không biết số nào của kỳ nào"; giữ, nhưng nhỏ. */}
                        <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10.5px] font-medium",
                            scope === "one" ? "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300"
                                : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300")}>
                            {scope === "one" ? <CalendarDays className="h-3 w-3" /> : <Layers className="h-3 w-3" />}
                            {scope === "one" ? "chỉ kỳ này" : "cộng dồn"}
                        </span>
                    </div>
                    {subtitle && <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{subtitle}</p>}
                </div>
                {actions && <div className="flex max-w-full flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>{actions}</div>}
                {collapsible && <ChevronDown className={cn("h-4 w-4 flex-none text-muted-foreground transition-transform", open && "rotate-180")} />}
            </header>
            {open && children}
        </section>
    );
}

function ActionButton({ children, onClick, kieu: variant, busy, busyText, lon: large }: {
    children: React.ReactNode; onClick?: () => void;
    kieu?: "chinh" | "xong"; busy?: boolean; busyText?: string; lon?: boolean;
}) {
    return (
        <button onClick={onClick} disabled={busy}
            className={cn("inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-semibold transition-all active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
                large ? "h-10 px-4 text-[14px]" : "h-8 px-3 text-[13px]",
                variant === "chinh" ? "bg-gradient-to-b from-orange-500 to-orange-600 text-white shadow-sm shadow-orange-600/25 hover:from-orange-600 hover:to-orange-700"
                    : variant === "xong" ? "border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/20"
                        : "border border-border bg-card text-foreground/80 shadow-sm hover:bg-muted hover:text-foreground")}>
            {busy ? (busyText || "Đang ghi…") : children}
        </button>
    );
}

const RMB2 = (n: number) => `${n.toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}¥`;

/** Ba chặng tiền, mỗi chặng một màu — khớp đúng ba đồng tiền trong sheet TỔNG. */
const STAGES = {
    twd: {
        ky: "NT$", chip: "bg-sky-600 text-white", ten: "text-sky-800 dark:text-sky-200",
        khung: "border-sky-200 bg-sky-50/60 dark:border-sky-500/25 dark:bg-sky-500/[0.06]",
        vach: "border-sky-200/80 dark:border-sky-500/20", so: "text-sky-700 dark:text-sky-300",
    },
    rmb: {
        ky: "¥", chip: "bg-violet-600 text-white", ten: "text-violet-800 dark:text-violet-200",
        khung: "border-violet-200 bg-violet-50/60 dark:border-violet-500/25 dark:bg-violet-500/[0.06]",
        vach: "border-violet-200/80 dark:border-violet-500/20", so: "text-violet-700 dark:text-violet-300",
    },
    vnd: {
        ky: "đ", chip: "bg-emerald-600 text-white", ten: "text-emerald-800 dark:text-emerald-200",
        khung: "border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/25 dark:bg-emerald-500/[0.06]",
        vach: "border-emerald-200/80 dark:border-emerald-500/20", so: "text-emerald-700 dark:text-emerald-400",
    },
} as const;

function MoneyStage({ te: currency, ten: title, mo: description, ky: symbol, children }: {
    te: keyof typeof STAGES; ten: string; mo: string;
    /** Ký hiệu thay cho chặng đầu — Sing là S$ (08/10/2026). */
    ky?: string;
    children: React.ReactNode;
}) {
    const c = STAGES[currency];
    return (
        <div className={cn("flex min-w-0 flex-col overflow-hidden rounded-xl border", c.khung)}>
            <div className={cn("flex items-center gap-2.5 border-b px-3.5 py-2", c.vach)}>
                <span className={cn("min-w-[2.25rem] flex-none rounded-md px-1.5 py-0.5 text-center text-[11.5px] font-bold", c.chip)}>{symbol ?? c.ky}</span>
                <div className="min-w-0 leading-tight">
                    <div className={cn("text-[13px] font-bold", c.ten)}>{title}</div>
                    <div className="truncate text-[11.5px] text-muted-foreground">{description}</div>
                </div>
            </div>
            <div className="flex flex-1 flex-col gap-2 px-3.5 py-3">{children}</div>
        </div>
    );
}

function MoneyLine({ nhan: caption, so: figure, ghi: note, tru: isDeduction, tong: isTotal, mau: color, lon: large }: {
    nhan: string; so: string; ghi?: string; tru?: boolean; tong?: boolean; mau?: string; lon?: boolean;
}) {
    return (
        <div className={cn("flex items-start justify-between gap-3", isTotal && "mt-auto border-t border-border/80 pt-2.5")}>
            <div className="min-w-0">
                <div className={cn("text-[13px]", isTotal ? "font-bold text-foreground" : "text-foreground/75")}>{caption}</div>
                {note && <div className="text-[11.5px] leading-snug text-muted-foreground">{note}</div>}
            </div>
            <div className={cn("whitespace-nowrap text-right tabular-nums",
                isTotal ? cn("font-extrabold tracking-tight", large ? "text-[18px]" : "text-[15px]", color) : "text-[13.5px] font-semibold text-foreground/90",
                isDeduction && "text-rose-600 dark:text-rose-400")}>
                {figure}
            </div>
        </div>
    );
}

function RateArrow({ chu: rateLabel }: { chu: string }) {
    return (
        <div className="flex items-center justify-center gap-2 xl:flex-col xl:gap-1 xl:px-0.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">tỷ giá</span>
            <span className="whitespace-nowrap rounded-full border border-border bg-card px-2.5 py-1 text-[12px] font-bold tabular-nums text-foreground/85 shadow-sm">
                {rateLabel}
            </span>
            <ArrowDown className="h-4 w-4 text-muted-foreground xl:hidden" />
            <ArrowRight className="hidden h-4 w-4 text-muted-foreground xl:block" />
        </div>
    );
}

/**
 * Luồng tiền — chép đúng thứ tự sheet TỔNG của NAZA, để người đọc đặt cạnh file
 * NAZA gửi mà dò từng dòng. Chia ba chặng theo ba đồng tiền, đúng như tiền thật
 * đi: COD Đài → đổi sang tệ, NAZA trừ phí → đổi sang tiền Việt, trừ tiền hàng.
 */
function MoneyFlowPanel({ l }: { l: MoneyFlow }) {
    const goods = l.tien_hang;
    const noConversion = l.vnd == null && (l.rmb_rong ?? 0) < 0;
    // Kỳ gộp Sing (24/09/2026): tiền hàng Sing là một dòng riêng, trừ theo số NAZA —
    // file tiền hàng Đài không có khoản này. Trong trong_luong_vnd đã gồm nó.
    const sgGoodsVnd = goods.sing_vnd ?? 0;
    const twGoodsInFlow = goods.dai_vnd ?? (goods.trong_luong_vnd - sgGoodsVnd);
    const carryOverAdjustment = l.vnd != null && l.phai_nhan_vnd != null
        ? l.phai_nhan_vnd - (l.vnd - (goods.cach_tra === "naza_tru" ? goods.trong_luong_vnd : sgGoodsVnd)) : 0;
    const batchLabel = goods.file ? `${goods.file.ngay.slice(8, 10)}/${goods.file.ngay.slice(5, 7)}` : "";
    return (
        <div className="px-5 py-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h4 className="text-[12px] font-bold uppercase tracking-wider text-foreground/70">Luồng tiền kỳ này</h4>
                <span className="text-[12px] text-muted-foreground">theo đúng thứ tự sheet TỔNG của NAZA — đặt cạnh file mà dò từng dòng</span>
            </div>
            <div className="grid items-stretch gap-2 xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
                <MoneyStage te="twd" ten="Đài Loan" mo="khách trả tại cửa hàng">
                    <MoneyLine nhan="Số đơn NAZA thu được" so={formatNumber(l.so_dong_sao_ke)} />
                    <MoneyLine nhan="Tổng COD thu về" so={l.cod_twd != null ? TWD(l.cod_twd) : "—"} tong lon mau={STAGES.twd.so} />
                </MoneyStage>
                <RateArrow chu={`× ${l.ty_gia_twd_rmb ?? "—"}`} />
                <MoneyStage te="rmb" ten="Trung Quốc" mo="NAZA trừ phí">
                    <MoneyLine nhan="Quy ra nhân dân tệ" so={l.rmb != null ? RMB2(l.rmb) : "—"} />
                    <MoneyLine nhan="− Phí thao tác" so={l.phi_gop ? "(gộp vào phí ship)" : RMB2(-l.phi_thao_tac_rmb)} tru={!l.phi_gop} />
                    <MoneyLine nhan="− Phí vận chuyển" so={RMB2(-l.phi_ship_rmb)} tru
                        ghi={l.sg_gop?.don ? `gồm ${l.sg_gop.don} đơn Sing ${RMB2(l.sg_gop.phi_rmb)} (kỳ gộp)` : undefined} />
                    <MoneyLine nhan="= COD còn lại" so={l.rmb_rong != null ? RMB2(l.rmb_rong) : "—"} tong
                        mau={(l.rmb_rong ?? 0) < 0 ? "text-rose-600 dark:text-rose-400" : STAGES.rmb.so} />
                </MoneyStage>
                <RateArrow chu={noConversion ? "không quy đổi" : `× ${l.ty_gia_rmb_vnd != null ? l.ty_gia_rmb_vnd.toLocaleString("vi-VN") : "—"}`} />
                <MoneyStage te="vnd" ten="Việt Nam" mo="về tài khoản">
                    <MoneyLine nhan="Quy ra tiền Việt" so={noConversion ? "không quy đổi" : l.vnd != null ? VND(l.vnd) : "—"}
                        ghi={noConversion ? "số âm — NAZA mang sang trừ kỳ sau" : undefined} />
                    {goods.cach_tra === "naza_tru" ? (
                        <MoneyLine nhan={sgGoodsVnd ? "− Tiền hàng Đài" : "− Phí mua hàng"} so={VND(-twGoodsInFlow)} tru
                            ghi={goods.lech_naza_vnd && Math.abs(goods.lech_naza_vnd) >= 1
                                ? `theo file tiền hàng · NAZA ghi ${VND(goods.naza_tru_vnd!)}`
                                : goods.file ? `đợt ${batchLabel}` : "theo sao kê NAZA"} />
                    ) : (
                        <MoneyLine nhan="− Phí mua hàng" so="không trừ"
                            ghi={goods.file ? `tự chuyển khoản riêng ${VND(goods.file.tong_vnd)}` : "kỳ này NAZA không trừ"} />
                    )}
                    {sgGoodsVnd > 0 && (
                        <MoneyLine nhan="− Tiền hàng Sing" so={VND(-sgGoodsVnd)} tru
                            ghi="kỳ gộp Singapore · theo sao kê NAZA" />
                    )}
                    {Math.abs(carryOverAdjustment) >= 1 && (
                        <MoneyLine nhan="± Điều chỉnh kỳ trước" so={VND(carryOverAdjustment)} tru={carryOverAdjustment < 0}
                            ghi="NAZA mang số âm kỳ trước sang" />
                    )}
                    <MoneyLine nhan="= Phải nhận" tong lon
                        so={l.phai_nhan_vnd != null ? VND(l.phai_nhan_vnd) : (l.rmb_rong ?? 0) < 0 ? "0đ — trừ kỳ sau" : "—"}
                        mau={l.phai_nhan_vnd != null ? STAGES.vnd.so : "text-rose-600 dark:text-rose-400"} />
                </MoneyStage>
            </div>
            {goods.file && goods.cach_tra === "tu_chuyen" && (
                <div className={cn("mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border px-3.5 py-2.5 text-[13px]",
                    (goods.con_no_vnd ?? 0) > 0
                        ? "border-rose-200 bg-rose-50/70 dark:border-rose-500/30 dark:bg-rose-500/10"
                        : "border-border bg-muted/30")}>
                    <ReceiptText className="h-4 w-4 flex-none text-muted-foreground" />
                    <span className="font-semibold text-foreground">Tiền hàng đợt {batchLabel}:</span>
                    <span className="font-semibold tabular-nums text-orange-600 dark:text-orange-400">{VND(goods.file.tong_vnd)}</span>
                    <span className="text-muted-foreground">· đã trả</span>
                    <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{VND(goods.da_tra_vnd ?? 0)}</span>
                    {(goods.con_no_vnd ?? 0) > 0 && (
                        <>
                            <span className="text-muted-foreground">· còn nợ</span>
                            <span className="font-bold tabular-nums text-rose-600 dark:text-rose-400">{VND(goods.con_no_vnd!)}</span>
                        </>
                    )}
                    {goods.file.no_ky_truoc_vnd > 0 && (
                        <span className="text-muted-foreground">· gồm {VND(goods.file.no_ky_truoc_vnd)} nợ kỳ trước</span>
                    )}
                </div>
            )}
        </div>
    );
}

/**
 * Tiền về — con số Sỹ Anh xin 13/09/2026: NAZA đã gửi bao nhiêu, và còn phải gửi
 * bao nhiêu theo hai cách đếm đơn còn lại.
 *
 * 07/10/2026: ba thẻ to + banner "chưa đối chiếu ngân hàng" → bốn ô số một hàng; đoạn giải
 * thích cách tính cất sau nút "Cách tính" (vẫn đủ chữ). Cảnh báo lệch thì luôn hiện.
 */
function MoneySummary({ t, tq: overview }: { t: ReceivedSummary; tq: Overview | null }) {
    const [showMethod, setShowMethod] = useState(false);
    const rateText = t.ty_gia.twd_rmb != null && t.ty_gia.rmb_vnd != null
        ? `tỷ giá kỳ ${t.ty_gia.ngay_sao_ke ? t.ty_gia.ngay_sao_ke.slice(8, 10) + "/" + t.ty_gia.ngay_sao_ke.slice(5, 7) : "mới nhất"}: ${t.ty_gia.twd_rmb} × ${t.ty_gia.rmb_vnd.toLocaleString("vi-VN")}`
        : "chưa có tỷ giá";
    const fileGap = t.phai_nhan_theo_file_vnd - t.da_gui_ve_vnd;
    const totalOrders = t.con_lai_da_giao.so_don + t.con_lai_chua_giao.so_don;
    const totalCod = t.con_lai_da_giao.cod_twd + t.con_lai_chua_giao.cod_twd;
    const remainingDelivered = t.con_lai_da_giao, remainingUndelivered = t.con_lai_chua_giao;
    return (
        <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                <MoneyTile mau="xanh" nhan="NAZA đã gửi về" so={VND(t.da_gui_ve_vnd)}
                    phu={`${formatNumber(t.so_ky)} kỳ sao kê`} />
                <MoneyTile mau="vang" uoc nhan="Còn phải gửi · đơn đã giao"
                    so={remainingDelivered.vnd_uoc != null ? VND(remainingDelivered.vnd_uoc) : "—"}
                    phu={`${formatNumber(remainingDelivered.so_don)} đơn · ${TWD(remainingDelivered.cod_twd)}`} />
                <MoneyTile mau="cam" uoc nhan="Chưa giao xong"
                    so={remainingUndelivered.vnd_uoc != null ? VND(remainingUndelivered.vnd_uoc) : "—"}
                    phu={`${formatNumber(remainingUndelivered.so_don)} đơn · ${TWD(remainingUndelivered.cod_twd)}`} />
                {overview && (overview.ky_lech > 0
                    ? <MoneyTile mau="do" nhan="Tiền về lệch ngân hàng" so={VND(overview.tien_lech_vnd)} phu={`${overview.ky_lech} kỳ không khớp`} />
                    : overview.ky_cho_nhap > 0
                        ? <MoneyTile mau="xanhduong" nhan="Chưa đối chiếu ngân hàng" so={VND(overview.tien_cho_nhap_vnd)}
                            phu={`${overview.ky_cho_nhap} kỳ chưa nhập tiền về`} />
                        : <MoneyTile mau="xanh" nhan="Đối chiếu ngân hàng" so={`${overview.ky_khop} kỳ khớp`} phu="không kỳ nào lệch" />)}
            </div>
            {Math.abs(fileGap) >= 1 && (
                <p className="text-[12.5px] font-semibold text-rose-600 dark:text-rose-400">
                    Theo file tiền hàng, NAZA lẽ ra gửi {VND(t.phai_nhan_theo_file_vnd)} — {fileGap > 0 ? "trừ dư" : "trừ thiếu"} {VND(Math.abs(fileGap))}.
                </p>
            )}
            {t.tien_hang.loi && <p className="text-[12.5px] font-semibold text-rose-600 dark:text-rose-400">{t.tien_hang.loi}</p>}
            <button onClick={() => setShowMethod(!showMethod)} aria-expanded={showMethod}
                className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground">
                <Info className="h-3.5 w-3.5" />Cách tính các số này
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showMethod && "rotate-180")} />
            </button>
            {showMethod && (
                <div className="space-y-1.5 rounded-xl border border-border bg-muted/30 px-4 py-3 text-[12.5px] leading-relaxed text-muted-foreground">
                    <p><b className="font-semibold text-foreground">Đã gửi về</b> = cộng số phải trả NAZA ghi trên từng sao kê
                        ({t.ky_da_doi_chieu_bank === 0 ? "chưa kỳ nào đối chiếu ngân hàng" : `${t.ky_da_doi_chieu_bank} kỳ đã đối chiếu ngân hàng`}).</p>
                    <p><b className="font-semibold text-foreground">Hai ô giữa không trùng nhau</b> — cộng lại là {formatNumber(totalOrders)} đơn
                        ({TWD(totalCod)}) chưa thấy tiền trên sao kê nào: đơn đã giao là tiền NAZA đang giữ ({remainingDelivered.don_chua_tru_phi} đơn chưa bị trừ phí ship),
                        đơn chưa giao là tiền còn ở ngoài đường. Đơn đã giao qua từ 2 kỳ mà chưa được trả thì đòi ở khung
                        “Đòi tiền NAZA” của Sổ đơn hàng. Đã bỏ {t.khong_tinh.hoan} đơn hoàn + {t.khong_tinh.huy} đơn huỷ
                        {t.khong_tinh.tieu_huy ? ` + ${t.khong_tinh.tieu_huy} đơn tiêu huỷ` : ""} ({TWD(t.khong_tinh.cod_twd)}) vì không bao giờ trả tiền.</p>
                    <p>Số dự tính đi đúng luồng NAZA: COD × {rateText} − phí. Đơn đã bị NAZA trừ phí ship ở kỳ trước thì không trừ lại;
                        đơn chưa bị trừ thì trừ phí ship theo bảng giá kênh giao (kg đầu) + phí thao tác.
                        <b className="font-semibold text-foreground"> Chưa trừ tiền hàng các kỳ tới</b> — chưa biết trước được.</p>
                    {overview && <p><b className="font-semibold text-foreground">Ngân hàng:</b> kỳ chỉ coi là xong khi tiền thật về khớp số sao kê tính ra.
                        Lệch trong {VND(overview.bank_tolerance_vnd)} thì bỏ qua (quy đổi NT$ → ¥ → đ có làm tròn, ngân hàng còn thu phí chuyển).
                        Nhập số tiền về của từng kỳ ở bảng ② bên dưới.</p>}
                </div>
            )}
        </div>
    );
}

const KPI_TONE = {
    twd: "text-sky-700 dark:text-sky-300",
    rmb: "text-violet-700 dark:text-violet-300",
    hang: "text-orange-600 dark:text-orange-400",
    green: "text-emerald-600 dark:text-emerald-400",
    red: "text-rose-600 dark:text-rose-400",
    cho: "text-amber-600 dark:text-amber-400",
} as const;

function Kpi({ label, value, sub, tone, className }: {
    label: string; value: string; sub?: string; tone?: keyof typeof KPI_TONE; className?: string;
}) {
    return (
        <div className={cn("bg-card px-5 py-3.5", className)}>
            <div className="text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className={cn("mt-1 text-[20px] font-extrabold leading-tight tracking-tight tabular-nums text-foreground",
                tone && KPI_TONE[tone])}>{value}</div>
            {sub && <div className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">{sub}</div>}
        </div>
    );
}

function WorstPeriodKpi({ rows }: { rows: FxRow[] }) {
    const w = rows.filter((r) => r.thiet_vnd != null && !r.tot_nhat)
        .sort((a, b) => (b.thiet_vnd ?? 0) - (a.thiet_vnd ?? 0))[0];
    return (
        <Kpi label="Kỳ tệ nhất" value={w ? VND(w.thiet_vnd ?? 0) : "—"}
            sub={w ? `kỳ chốt ${dmy(w.period_date)}` : "chưa đủ kỳ để so"} tone={w ? "cho" : undefined} />
    );
}

/* ④ Tỷ giá qua các kỳ — MỘT đường, MỘT trục.
   Đường = đồng thực nhận trên mỗi NT$ (tích hai chặng). Nét đứt = kỳ tốt nhất chính
   NAZA từng đặt. Vùng đỏ giữa hai đường = phần tỷ giá lấy của mình. Tiền thiệt từng
   kỳ còn tuỳ tiền COD kỳ đó nên nằm trong ô rê chuột, không in lên từng điểm.
   Màu đã chạy bộ kiểm mù màu: xanh–đỏ đạt, xanh lá–đỏ KHÔNG đạt (ΔE 5,8) — nên mốc
   tốt nhất là nét đứt xám có nhãn chứ không tô xanh lá. */
type FxPoint = FxRow & { nhan: string; vung: [number, number] };

function FxChart({ fx, kyDangXem: viewedFile, te: currency = TW_CURRENCY }: { fx: Fx; kyDangXem?: string; te?: Currency }) {
    const best = fx.best_vnd_per_twd;
    const data: FxPoint[] = [...fx.rows].reverse()
        .filter((r) => r.vnd_per_twd != null)
        .map((r) => ({
            ...r,
            nhan: r.period_date ? `${r.period_date.slice(8, 10)}/${r.period_date.slice(5, 7)}` : r.filename,
            vung: [r.vnd_per_twd!, best ?? r.vnd_per_twd!],
        }));
    if (best == null || data.length < 2) return null;

    const lowest = Math.min(...data.map((d) => d.vnd_per_twd!));
    const step = best - lowest > 8 ? 4 : 2;
    const axisMin = Math.floor((lowest - 1) / step) * step;
    const axisMax = Math.ceil((best + 1) / step) * step;
    const ticks = Array.from({ length: (axisMax - axisMin) / step + 1 }, (_, i) => axisMin + i * step);
    const last = data[data.length - 1];

    return (
        <div className="px-3 pb-2 pt-3 [--fx-line:#0284c7] [--fx-loss:#e11d48] dark:[--fx-loss:#f43f5e] sm:px-5">
            <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 px-2 text-[12px] text-muted-foreground sm:px-0">
                <span className="inline-flex items-center gap-1.5">
                    <span className="h-0.5 w-4 rounded-full" style={{ background: "var(--fx-line)" }} />
                    Đồng thực nhận / {currency.ky}
                </span>
                <span className="inline-flex items-center gap-1.5">
                    <span className="w-4 border-t-2 border-dashed border-muted-foreground/70" />
                    Kỳ tốt nhất NAZA từng đặt
                </span>
                <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-4 rounded-sm" style={{ background: "var(--fx-loss)", opacity: 0.22 }} />
                    Phần tỷ giá lấy của mình
                </span>
            </div>
            <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={data} margin={{ top: 22, right: 16, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="nhan" tickLine={false} axisLine={false} interval="preserveStartEnd"
                        tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickMargin={8} />
                    <YAxis domain={[axisMin, axisMax]} ticks={ticks} width={40} tickLine={false} axisLine={false}
                        tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip content={<FxTooltip te={currency} />} cursor={{ stroke: "hsl(var(--muted-foreground))", strokeOpacity: 0.4, strokeWidth: 1 }} />
                    <Area type="linear" dataKey="vung" stroke="none" fill="var(--fx-loss)" fillOpacity={0.14}
                        isAnimationActive={false} activeDot={false} />
                    <ReferenceLine y={best} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.8}
                        strokeDasharray="5 4" strokeWidth={1.5} ifOverflow="extendDomain"
                        label={{ value: `tốt nhất ${best.toFixed(2)}`, position: "insideBottomLeft", offset: 6,
                            fontSize: 11, fontWeight: 600, fill: "hsl(var(--muted-foreground))" }} />
                    <Line type="linear" dataKey="vnd_per_twd" stroke="var(--fx-line)" strokeWidth={2}
                        isAnimationActive={false}
                        activeDot={{ r: 6, fill: "var(--fx-line)", stroke: "hsl(var(--card))", strokeWidth: 2 }}
                        dot={(p: { cx?: number; cy?: number; index?: number; payload?: FxPoint }) => {
                            const { cx, cy, payload } = p;
                            if (cx == null || cy == null || !payload) return <g key={`d${p.index}`} />;
                            const selected = payload.filename === viewedFile;
                            return (
                                <g key={payload.filename}>
                                    {selected && <circle cx={cx} cy={cy} r={10} fill="var(--fx-line)" fillOpacity={0.15} />}
                                    <circle cx={cx} cy={cy} r={selected ? 5.5 : 4} fill="var(--fx-line)"
                                        stroke="hsl(var(--card))" strokeWidth={2} />
                                    {payload === last && (
                                        <text x={cx + 6} y={cy - 12} textAnchor="end" fontSize={11.5} fontWeight={700}
                                            fill="hsl(var(--foreground))">
                                            {payload.vnd_per_twd!.toFixed(2)}
                                        </text>
                                    )}
                                </g>
                            );
                        }} />
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
}

function FxTooltip({ active, payload, te: currency = TW_CURRENCY }: { active?: boolean; payload?: { payload: FxPoint }[]; te?: Currency }) {
    const d = active ? payload?.[0]?.payload : undefined;
    if (!d) return null;
    return (
        <div className="min-w-[210px] rounded-xl border border-border bg-card px-3.5 py-2.5 text-[12.5px] shadow-lg">
            <div className="mb-1.5 font-semibold text-foreground">Kỳ chốt {dmy(d.period_date)}</div>
            <div className="flex items-baseline justify-between gap-4">
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <span className="h-2 w-2 rounded-full" style={{ background: "var(--fx-line)" }} />Đồng / {currency.ky}
                </span>
                <span className="font-bold tabular-nums text-foreground">{d.vnd_per_twd?.toFixed(2)}</span>
            </div>
            <div className="mt-0.5 text-right text-[11.5px] tabular-nums text-muted-foreground">
                {d.rate_twd_rmb} × {d.rate_rmb_vnd}
            </div>
            <div className="mt-1.5 flex items-baseline justify-between gap-4 border-t border-border/70 pt-1.5">
                <span className="text-muted-foreground">Tiền COD</span>
                <span className="tabular-nums text-foreground">{currency.fmt(d.cod_twd)}</span>
            </div>
            <div className="mt-0.5 flex items-baseline justify-between gap-4">
                <span className="text-muted-foreground">Thiệt so kỳ tốt nhất</span>
                {d.tot_nhat
                    ? <span className="font-semibold text-emerald-700 dark:text-emerald-300">kỳ tốt nhất</span>
                    : <span className="font-bold tabular-nums text-rose-600 dark:text-rose-400">−{VND(d.thiet_vnd ?? 0)}</span>}
            </div>
        </div>
    );
}

function StatusBadge({ p }: { p: { trang_thai: PeriodState | "am"; trang_thai_chu: string } }) {
    const style: Record<PeriodState | "am", string> = {
        am: "bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-500/10 dark:text-slate-300 dark:ring-slate-400/25",
        khop: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/25",
        lech: "bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/25",
        cho_nhap: "bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/25",
        thieu_file: "bg-amber-50 text-amber-800 ring-amber-600/25 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/25",
    };
    return (
        <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-semibold ring-1 ring-inset",
            style[p.trang_thai])}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {p.trang_thai_chu}
        </span>
    );
}

/**
 * Ô nhập tiền thật về — số và ngày, gọn trong một dòng của bảng.
 *
 * Gợi ý sẵn số sao kê tính ra làm placeholder, nhưng KHÔNG điền sẵn vào ô: điền
 * sẵn thì người ta chỉ việc bấm Enter, và cả khâu đối chiếu hoá ra vô nghĩa vì
 * số "thực nhận" chính là số "phải nhận" chép lại.
 */
function FormBank({ goiY: suggested, busy, onGhi: onSave, onHuy: onCancel }: {
    goiY: number | null; busy: boolean;
    onGhi: (figure: number, date: string) => void; onHuy: () => void;
}) {
    const [figure, setFigure] = useState("");
    const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
    const num = Number(figure.replace(/\D/g, ""));
    const o = "h-8 rounded-lg border border-border bg-card text-[13px] shadow-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:[color-scheme:dark]";
    return (
        <div className="flex flex-wrap items-center justify-end gap-1.5">
            <input autoFocus inputMode="numeric" value={figure}
                placeholder={suggested != null ? Math.round(suggested).toLocaleString("vi-VN") : "số tiền"}
                onChange={(e) => setFigure(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter" && num > 0) onSave(num, date);
                    if (e.key === "Escape") onCancel();
                }}
                className={cn(o, "w-32 px-2.5 text-right font-semibold tabular-nums")} />
            <input type="date" value={date} max={format(new Date(), "yyyy-MM-dd")}
                onChange={(e) => setDate(e.target.value)}
                className={cn(o, "px-2 tabular-nums")} />
            <button disabled={busy || !(num > 0)} onClick={() => onSave(num, date)} title="Ghi số tiền về"
                className="grid h-8 w-8 place-items-center rounded-lg bg-orange-500 text-white shadow-sm hover:bg-orange-600 disabled:opacity-40">
                <Check className="h-4 w-4" />
            </button>
            <button onClick={onCancel} title="Huỷ"
                className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-muted-foreground hover:bg-muted">
                <X className="h-4 w-4" />
            </button>
        </div>
    );
}

/** Tám mục máy soát — gập lại thành một dòng tóm tắt; có mục lỗi thì mở sẵn (07/10/2026). */
function ChecksPanel({ checks, kyKhac: isOlderPeriod, children }: { checks: Check[]; kyKhac: boolean; children: ReactNode }) {
    const failedCount = checks.filter((c) => c.ok === false).length;
    const passedCount = checks.filter((c) => c.ok === true).length;
    const [open, setOpen] = useState(failedCount > 0);
    if (!checks.length) return null;
    return (
        <>
            <button onClick={() => setOpen(!open)} aria-expanded={open}
                className="flex w-full items-center gap-2 border-t border-border/70 px-3.5 py-2.5 text-left text-[13px] hover:bg-muted/30 md:px-5">
                <SearchCheck className="h-4 w-4 flex-none text-muted-foreground" />
                <span className="font-semibold text-foreground">Máy soát {checks.length} mục{isOlderPeriod ? " · kỳ mới nhất" : ""}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[11.5px] font-bold",
                    failedCount ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                        : "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300")}>
                    {passedCount} đạt{failedCount ? ` · ${failedCount} cần xử` : ""}
                </span>
                {checks.length - passedCount - failedCount > 0 && (
                    <span className="text-[11.5px] text-muted-foreground">{checks.length - passedCount - failedCount} chưa soát được</span>
                )}
                <ChevronDown className={cn("ml-auto h-4 w-4 flex-none text-muted-foreground transition-transform", open && "rotate-180")} />
            </button>
            {open && children}
        </>
    );
}

function CheckGroup({ nhom: group, ten: title, hoi: question, checks }: { nhom: "A" | "B"; ten: string; hoi: string; checks: Check[] }) {
    if (!checks.length) return null;
    const failedCount = checks.filter((c) => c.ok === false).length;
    return (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/70 px-4 py-2.5">
                <span className="grid h-6 w-6 flex-none place-items-center rounded-md bg-foreground/[0.07] text-[12px] font-extrabold text-foreground/75">
                    {group}
                </span>
                <span className="text-[13.5px] font-bold text-foreground">{title}</span>
                <span className="text-[12.5px] text-muted-foreground">— {question}</span>
                <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[11.5px] font-bold",
                    failedCount ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                        : "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300")}>
                    {failedCount ? `${failedCount} mục cần xử` : "sạch"}
                </span>
            </div>
            <ul className="divide-y divide-border/60">
                {checks.map((c) => (
                    <li key={c.ten} className={cn("flex items-start gap-3 px-4 py-2.5",
                        c.ok === false && "bg-rose-50/60 dark:bg-rose-500/[0.06]")}>
                        <span className={cn("mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-full",
                            c.ok === true ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                                : c.ok === false ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                                    : "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300")}>
                            {c.ok === true ? <Check className="h-3.5 w-3.5" strokeWidth={3} />
                                : c.ok === false ? <AlertTriangle className="h-3.5 w-3.5" />
                                    : <Info className="h-3.5 w-3.5" />}
                        </span>
                        <div className="min-w-0">
                            <div className={cn("text-[13.5px] font-semibold",
                                c.ok === false ? "text-rose-700 dark:text-rose-300" : "text-foreground")}>{c.ten}</div>
                            <div className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{c.chi_tiet}</div>
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
}
