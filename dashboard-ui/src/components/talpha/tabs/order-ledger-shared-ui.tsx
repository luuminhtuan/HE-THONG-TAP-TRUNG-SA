"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, Download, Info, RefreshCw, Search } from "lucide-react";
import { formatNumber, cn } from "../utils";
import { STRIPE, type Light, type DeliveryCounts } from "./ledger-shared";

/* ═══════════════════════════════════════════════════════════════════
   KHỐI GIAO DIỆN CHUNG CỦA SỔ ĐƠN HÀNG — Đài Loan, Singapore, UAE
   (Sỹ Anh duyệt 07/10/2026: phần đầu sổ "nhìn rối quá").

   Trước: dòng chữ giới thiệu + thanh "nạp lúc" + MỖI cảnh báo một khung cam to kèm
   bảng, chiếm gần hết màn trước khi tới đơn; nút lọc thì bé, nằm sát bảng.
   Nay, từ trên xuống:
     1. Thanh công cụ MỘT hàng: chọn nước · nguồn số (chữ nhỏ) · tìm · tải lại · CSV.
     2. Ô số to theo đèn — bấm là lọc. Thứ người ta cần biết đầu tiên: bao nhiêu đơn phải xử.
     3. MỘT khung "N việc cần sửa dữ liệu", mặc định GẬP; mở ra mỗi việc một dòng kèm ai sửa,
        bấm từng việc mới thấy chi tiết.
     4. Danh sách đơn: máy tính giữ bảng cũ; điện thoại thành THẺ (bảng 20+ cột phải kéo ngang).
   ═══════════════════════════════════════════════════════════════════ */

/** Màn hẹp (điện thoại, < 768px) — đổi bảng thành thẻ. Dựng MỘT trong hai, không dựng cả hai
 *  rồi ẩn: sổ Đài 700+ đơn, dựng đôi là điện thoại ì. */
export function useNarrowScreen(): boolean {
    const [narrow, setNarrow] = useState(false);
    useEffect(() => {
        const mq = window.matchMedia("(max-width: 767px)");
        const handleChange = () => setNarrow(mq.matches);
        handleChange();
        mq.addEventListener("change", handleChange);
        return () => mq.removeEventListener("change", handleChange);
    }, []);
    return narrow;
}

// ── 1. Thanh công cụ ──────────────────────────────────────────────
export function LedgerToolbar({ nutNuoc: marketSwitcher, nguon: source, nguonGiaiThich: sourceNote, q, setQ, placeholder, onTaiLai: onReload, dangTai: reloading, onCsv }: {
    nutNuoc?: ReactNode;
    /** Một dòng nguồn số, vd "Bảng đối tác nạp 06:00 07/10 · 778 đơn". */
    nguon?: ReactNode;
    /** Giải thích dài về nguồn — hiện khi rê / chạm vào biểu tượng ⓘ, không chiếm chỗ. */
    nguonGiaiThich?: string;
    q: string; setQ: (s: string) => void; placeholder: string;
    onTaiLai: () => void; dangTai?: boolean; onCsv: () => void;
}) {
    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {marketSwitcher}
            {source && (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" title={sourceNote}>
                    <RefreshCw className="h-3.5 w-3.5 flex-none" />
                    <span>{source}</span>
                    {sourceNote && <Info className="h-3.5 w-3.5 flex-none opacity-60" />}
                </span>
            )}
            <div className="flex w-full items-center gap-1.5 md:ml-auto md:w-auto">
                <div className="relative min-w-0 flex-1 md:flex-none">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder}
                        className="w-full rounded-full border border-border bg-card py-1.5 pl-9 pr-3 text-[13px] md:w-72 md:py-1 md:text-[12.5px]" />
                </div>
                <button onClick={onReload} title="Tải lại" aria-label="Tải lại"
                    className="flex-none rounded-full border border-border px-2.5 py-1.5 hover:bg-muted md:py-1">
                    <RefreshCw className={cn("h-3.5 w-3.5", reloading && "animate-spin")} />
                </button>
                <button onClick={onCsv} title="Tải danh sách đang lọc về file CSV"
                    className="inline-flex flex-none items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[12.5px] hover:bg-muted md:py-1">
                    <Download className="h-3.5 w-3.5" /> CSV
                </button>
            </div>
        </div>
    );
}

// ── 2. Ô số lọc theo đèn ───────────────────────────────────────────
const COUNT_TEXT: Record<Light, string> = {
    do: "text-rose-600 dark:text-rose-400",
    vang: "text-amber-600 dark:text-amber-400",
    xanh: "text-emerald-600 dark:text-emerald-400",
    xam: "text-muted-foreground",
};
const SELECTED_BORDER: Record<Light | "all", string> = {
    all: "border-foreground/40 bg-muted/60",
    do: "border-rose-400 bg-rose-50 dark:bg-rose-500/10",
    vang: "border-amber-400 bg-amber-50 dark:bg-amber-500/10",
    xanh: "border-emerald-400 bg-emerald-50 dark:bg-emerald-500/10",
    xam: "border-slate-400 bg-slate-100 dark:bg-slate-500/15",
};

export type LightFilterItem = { id: Light; label: string; n: number };

/** Bấm ô đang chọn lần nữa là về "Tất cả". `tyLe` thêm hai ô tỉ lệ giao thành công / hoàn ở cuối
 *  hàng (22/10/2026) — chỉ để đọc, không lọc. */
export function LightFilterBar({ muc: filterItems, tong: total, chon: selected, onChon: onSelect, tyLe: rates }: {
    muc: LightFilterItem[]; tong: number; chon: Light | "all"; onChon: (l: Light | "all") => void;
    tyLe?: DeliveryCounts;
}) {
    const o = (id: Light | "all", label: string, n: number, fullWidth?: boolean) => {
        const isSelected = selected === id;
        return (
            <button key={id} onClick={() => onSelect(isSelected && id !== "all" ? "all" : id)}
                aria-pressed={isSelected}
                className={cn("rounded-xl border px-3 py-2 text-left transition hover:bg-muted/50",
                    isSelected ? SELECTED_BORDER[id] : "border-border bg-card",
                    fullWidth && "col-span-full flex items-baseline justify-between md:col-span-1 md:block")}>
                <div className={cn("text-xl font-bold tabular-nums leading-tight md:text-2xl", id === "all" ? "text-foreground" : COUNT_TEXT[id])}>
                    {formatNumber(n)}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {id !== "all" && <span className={cn("h-2 w-2 rounded-full", STRIPE[id])} />}
                    {label}
                </div>
            </button>
        );
    };
    return (
        <div className={cn("grid gap-2",
            // Điện thoại: "Tất cả" một hàng ngang, các đèn chia đều hàng dưới (3 đèn → 3 cột, 4 → 2×2),
            // hai ô tỉ lệ thêm một hàng riêng.
            filterItems.length === 3
                ? (rates ? "grid-cols-3 md:grid-cols-6" : "grid-cols-3 md:grid-cols-4")
                : (rates ? "grid-cols-2 md:grid-cols-7" : "grid-cols-2 md:grid-cols-5"))}>
            {o("all", "Tất cả", total, true)}
            {filterItems.map((m) => o(m.id, m.label, m.n))}
            {rates && (
                <div className="col-span-full grid grid-cols-2 gap-2 md:col-span-2">
                    <RateTile label="Giao thành công" n={rates.giao} t={rates} mau="text-emerald-600 dark:text-emerald-400" cham="bg-emerald-500" />
                    <RateTile label="Hoàn" n={rates.hoan} t={rates} mau="text-slate-600 dark:text-slate-300" cham="bg-slate-400" />
                </div>
            )}
        </div>
    );
}

function RateTile({ label, n, t, mau: colorClass, cham: dotClass }: { label: string; n: number; t: DeliveryCounts; mau: string; cham: string }) {
    const settled = t.giao + t.hoan;
    const pctText = settled ? `${((n / settled) * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%` : "—";
    const explanation = settled
        ? `${label}: ${n}/${settled} đơn đã có kết quả (giao xong hoặc hoàn).`
            + (t.dang_di ? ` ${t.dang_di} đơn còn đang đi / chưa gửi chưa tính.` : "")
            + (t.huy ? ` ${t.huy} đơn huỷ không tính.` : "")
        : "Chưa có đơn nào giao xong hoặc hoàn.";
    return (
        // Màn 1280px chia 7 ô thì mỗi ô chỉ ~130px: số đơn tự xuống dòng thay vì tràn ra ngoài ô.
        <div title={explanation} className="min-w-0 rounded-xl border border-dashed border-border bg-card px-2.5 py-2">
            <div className="flex flex-wrap items-baseline gap-x-1.5">
                <span className={cn("text-xl font-bold tabular-nums leading-tight md:text-2xl", settled ? colorClass : "text-muted-foreground")}>{pctText}</span>
                {settled > 0 && <span className="text-[11px] tabular-nums text-muted-foreground">{formatNumber(n)}/{formatNumber(settled)} đơn</span>}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={cn("h-2 w-2 flex-none rounded-full", dotClass)} />
                <span className="truncate">{label}</span>
            </div>
        </div>
    );
}

// ── 3. Khung "việc cần sửa dữ liệu" ────────────────────────────────
export type FixTask = {
    id: string; level: "canh_bao" | "nhac";
    title: string; detail: string;
    cols?: string[]; items?: (string | number)[][]; fix?: string;
};

/** Nhãn ngắn trên đầu khung + ai phải sửa — theo id cảnh báo của route. Id lạ thì lấy tiêu đề. */
const TASK_LABELS: Record<string, { ngan: string; ai: string }> = {
    "thieu-gia-von": { ngan: "mã chưa có giá vốn", ai: "Khai giá vốn" },
    "trong-o-sku": { ngan: "đơn trống ô SKU", ai: "Sửa Sheet đối tác" },
    "thua-sao-ke": { ngan: "dòng sao kê lạc", ai: "Tra Sheet đơn" },
    "phi-sai": { ngan: "đơn tính sai phí ship", ai: "Hỏi lại NAZA" },
    "trung-van-don": { ngan: "mã vận đơn trùng", ai: "Sửa Sheet đối tác" },
    "thieu-van-don": { ngan: "đơn thiếu mã vận đơn", ai: "Sửa Sheet đối tác" },
    "khong-don": { ngan: "chưa có đơn", ai: "Đọc bảng đối tác" },
    "khong-sao-ke": { ngan: "chưa có sao kê", ai: "Tải sao kê" },
};
/** Số đếm cho nhãn ngắn: mã chưa có giá đếm theo MÃ (items), còn lại theo số đầu tiêu đề. */
const taskCount = (v: FixTask) =>
    v.id === "thieu-gia-von" ? (v.items?.length ?? 0) : (parseInt(v.title, 10) || v.items?.length || 0);

export function FixTasksPanel({ viec: tasks, hep: narrow }: { viec: FixTask[]; hep: boolean }) {
    const [open, setOpen] = useState(false);
    const [openTaskId, setOpenTaskId] = useState<string | null>(null);
    if (!tasks.length) return null;
    const hasWarning = tasks.some((v) => v.level === "canh_bao");

    return (
        <div className={cn("overflow-hidden rounded-xl border bg-card",
            hasWarning ? "border-amber-300 dark:border-amber-500/40" : "border-sky-300 dark:border-sky-500/40")}>
            <button onClick={() => setOpen(!open)} aria-expanded={open}
                className={cn("flex w-full flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-2.5 text-left md:px-4",
                    hasWarning ? "bg-amber-50 dark:bg-amber-500/10" : "bg-sky-50 dark:bg-sky-500/10")}>
                <AlertTriangle className={cn("h-4 w-4 flex-none", hasWarning ? "text-amber-600 dark:text-amber-400" : "text-sky-600 dark:text-sky-400")} />
                <span className={cn("text-sm font-semibold", hasWarning ? "text-amber-900 dark:text-amber-200" : "text-sky-900 dark:text-sky-200")}>
                    {tasks.length} việc cần sửa dữ liệu
                </span>
                {!narrow && tasks.map((v) => {
                    const taskLabel = TASK_LABELS[v.id];
                    return taskLabel ? (
                        <span key={v.id} className="rounded-full border border-border bg-card px-2 py-0.5 text-[11.5px] text-muted-foreground">
                            {taskCount(v) || ""} {taskLabel.ngan}
                        </span>
                    ) : null;
                })}
                <ChevronDown className={cn("ml-auto h-4 w-4 flex-none opacity-60 transition-transform", open && "rotate-180")} />
            </button>

            {open && (
                <div className={cn(narrow && "space-y-2 p-2")}>
                    {tasks.map((v) => {
                        const taskLabel = TASK_LABELS[v.id];
                        const isOpen = openTaskId === v.id;
                        const hasDetails = !!v.items?.length || !!v.fix;
                        return (
                            <div key={v.id} className={cn(narrow ? "rounded-lg border border-border" : "border-t border-border")}>
                                <button onClick={() => hasDetails && setOpenTaskId(isOpen ? null : v.id)} aria-expanded={isOpen}
                                    className={cn("flex w-full items-start gap-2.5 px-3 py-2.5 text-left md:items-center md:px-4",
                                        hasDetails && "hover:bg-muted/40", isOpen && "bg-muted/40")}>
                                    <span className={cn("mt-1.5 h-2 w-2 flex-none rounded-full md:mt-0",
                                        v.level === "canh_bao" ? "bg-amber-500" : "bg-sky-500")} />
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-[13px] font-medium text-foreground">{v.title}</span>
                                        <span className="block text-xs text-muted-foreground">{v.detail}</span>
                                    </span>
                                    {taskLabel && <span className="hidden flex-none rounded-full border border-border px-2 py-0.5 text-[11.5px] text-muted-foreground md:inline">{taskLabel.ai}</span>}
                                    {hasDetails && <ChevronDown className={cn("mt-0.5 h-4 w-4 flex-none opacity-50 transition-transform md:mt-0", isOpen && "rotate-180")} />}
                                </button>
                                {taskLabel && narrow && (
                                    <span className="mx-3 mb-2 inline-block rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">{taskLabel.ai}</span>
                                )}
                                {isOpen && <TaskDetails v={v} hep={narrow} />}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function TaskDetails({ v, hep: narrow }: { v: FixTask; hep: boolean }) {
    const cols = v.cols || [];
    const items = v.items || [];
    const o = (x: string | number) => (typeof x === "number" ? formatNumber(x) : x);
    return (
        <div className="border-t border-border bg-muted/20">
            {items.length > 0 && (narrow ? (
                // Điện thoại: mỗi dòng một thẻ nhỏ — cột đầu đậm, các cột sau "Tên cột: giá trị".
                <div className="max-h-96 space-y-1.5 overflow-auto p-2">
                    {items.map((it, i) => (
                        <div key={i} className="rounded-lg bg-card px-2.5 py-2 text-[12.5px]">
                            <div className="font-mono font-semibold">{o(it[0])}</div>
                            {it.slice(1).map((x, j) => (x === "" || x === null ? null : (
                                <div key={j} className="text-muted-foreground">
                                    <span className="text-muted-foreground/70">{cols[j + 1]}: </span>
                                    <span className="text-foreground">{o(x)}</span>
                                </div>
                            )))}
                        </div>
                    ))}
                </div>
            ) : (
                <div className="max-h-72 overflow-auto">
                    <table className="w-full text-[12px]">
                        <thead className="sticky top-0 bg-muted/90 backdrop-blur">
                            <tr className="text-left text-[10.5px] font-semibold text-muted-foreground">
                                {cols.map((c) => <th key={c} className="px-4 py-1.5">{c}</th>)}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {items.map((it, i) => (
                                <tr key={i}>
                                    {it.map((x, j) => (
                                        <td key={j} className={cn("px-4 py-1", j === 0 && "font-mono font-semibold",
                                            typeof x === "number" && "text-right tabular-nums")}>{o(x)}</td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ))}
            {v.fix && <p className="border-t border-border px-3 py-2 text-xs font-medium text-muted-foreground md:px-4">→ {v.fix}</p>}
        </div>
    );
}

// ── 4. Thẻ đơn cho điện thoại ──────────────────────────────────────
const CARD_BORDER: Record<Light, string> = {
    do: "border-l-rose-500", vang: "border-l-amber-400", xanh: "border-l-emerald-500",
    xam: "border-l-slate-300 dark:border-l-slate-600",
};

/** Một đơn một thẻ: dòng đầu mã + trạng thái + tiền; dưới là khách, việc phải làm; chạm để
 *  mở đủ chi tiết. `nut` (vd WhatsApp) luôn hiện, không phải mở thẻ. */
export function OrderCard({ light, ma: orderNo, trangThai: status, trangThaiCls: statusClass, tien: amount, dong: subtitle, ghiChu: note, nhan: badges, nut: action, chiTiet: details }: {
    light: Light; ma: string; trangThai: string; trangThaiCls: string; tien: string;
    dong: ReactNode; ghiChu?: string; nhan?: ReactNode; nut?: ReactNode;
    chiTiet: [string, ReactNode][];
}) {
    const [open, setOpen] = useState(false);
    return (
        <div className={cn("rounded-lg border border-l-4 border-border bg-card", CARD_BORDER[light], light === "xam" && "opacity-75")}>
            <button onClick={() => setOpen(!open)} aria-expanded={open} className="block w-full px-3 py-2.5 text-left">
                <div className="flex items-center gap-2">
                    <b className="font-mono text-[13.5px]">{orderNo || "·"}</b>
                    <span className={cn("truncate rounded px-1.5 py-px text-[10.5px] font-semibold", statusClass)}>{status || "—"}</span>
                    <span className="ml-auto flex-none font-mono text-[13px] font-bold tabular-nums">{amount}</span>
                </div>
                <div className="mt-1 text-[12.5px] text-muted-foreground">{subtitle}</div>
                {badges && <div className="mt-1.5 flex flex-wrap gap-1">{badges}</div>}
                {note && light !== "xanh" && <div className="mt-1 text-[11.5px] text-muted-foreground/80">{note}</div>}
            </button>
            {action && <div className="px-3 pb-2.5">{action}</div>}
            {open && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-border px-3 py-2.5 text-[12px]">
                    {details.filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== "·").map(([k, v]) => (
                        <div key={k} className="contents">
                            <dt className="text-muted-foreground">{k}</dt>
                            <dd className="min-w-0 break-words">{v}</dd>
                        </div>
                    ))}
                </dl>
            )}
        </div>
    );
}

/** Danh sách thẻ — dựng dần 50 thẻ một lượt, bấm "Hiện thêm" (700+ thẻ một lúc làm điện thoại ì). */
export function CardList<T>({ ds, khoa: getKey, ve: renderItem, tong: total }: {
    ds: T[]; khoa: (x: T) => string; ve: (x: T) => ReactNode; tong: number;
}) {
    const [limit, setLimit] = useState(50);
    const visible = ds.slice(0, limit);
    return (
        <div className="space-y-2">
            {visible.map((x) => <div key={getKey(x)}>{renderItem(x)}</div>)}
            {!ds.length && <p className="py-10 text-center text-sm text-muted-foreground">Không có đơn nào trong nhóm này.</p>}
            {ds.length > limit && (
                <button onClick={() => setLimit(limit + 50)}
                    className="w-full rounded-lg border border-border bg-card py-2.5 text-sm font-medium hover:bg-muted">
                    Hiện thêm {Math.min(50, ds.length - limit)} đơn · còn {formatNumber(ds.length - limit)}
                </button>
            )}
            <p className="text-center font-mono text-[11px] text-muted-foreground">
                {formatNumber(Math.min(limit, ds.length))} / {formatNumber(ds.length)} đơn đang lọc · {formatNumber(total)} đơn tất cả
            </p>
        </div>
    );
}
