"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { Upload, AlertTriangle, Download, CheckCircle2, ChevronDown, X, FileSpreadsheet, Info, PenLine } from "lucide-react";
import TabSkeleton, { ErrorState } from "@/components/ui/tab-skeleton";
import { formatNumber, cn } from "../../utils";
import { VND } from "../ledger-shared";
import { useNarrowScreen } from "../order-ledger-shared-ui";
import type { Currency, MarketData, MarketPeriod } from "./types";
import { COLUMN_LABELS, dmy, marketDiscrepancyMessage, periodName, RMB2 } from "./format";
import { ActionButton, BankDiffCell, FormBank, HeaderBar, Kpi, Section, StatusBadge } from "./ui";
import { TasksSection } from "./tasks-section";
import { ChecksPanel, CheckGroup } from "./checks-panel";
import { MarketMoneyFlowPanel } from "./money-flow";
import { MarketMoneySummary } from "./money-summary";
import { FxSection } from "./fx-section";
import { MarketOrderSections } from "./market-order-sections";

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
 * Số dựng ở lib/talpha/cod-market-ledger.ts; việc người làm ghi qua /api/talpha/cod-recon/market/actions
 * (kho riêng từng nước, cùng luật ghi với Đài). Sao kê dạng bảng (đối tác ngoài NAZA) không có
 * sheet TỔNG — màn tự lùi về "ước theo tỷ giá khai".
 */
export function MarketCodRecon({ code, nutNuoc: marketSwitcher, dateRange }: { code: string; nutNuoc?: ReactNode; dateRange?: { from: Date; to: Date } }) {
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

    // Lệch nhỏ trong ngưỡng: kỳ vẫn khớp → số xám + "bỏ qua", như màn Đài (13/11/2026).
    const diffCell = (k: MarketPeriod) => (
        <BankDiffCell diff={k.lech_bank_vnd} matched={k.trang_thai === "khop"} tolerance={ledger.tong_quan.bank_tolerance_vnd} />
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
                        // Khoản âm kỳ trước NAZA trừ vào kỳ này (mẫu Nhật) không phải tiền hàng.
                        const goods = l.tru_vnd.filter((x) => x.loai !== "ky_truoc");
                        const isNegative = (l.phai_nhan_vnd ?? 0) < 0;
                        return (
                            <>
                                <div className="grid grid-cols-2 gap-px border-b border-border/70 bg-border/60 sm:grid-cols-3 xl:grid-cols-5">
                                    <Kpi label="Đơn trong sao kê" value={formatNumber(l.so_don)}
                                        sub={l.so_don ? `${period.khop + period.lech} đơn khớp sổ đơn` : `chưa thu COD · phí ${period.don_phi ?? 0} đơn`} />
                                    <Kpi label="Tiền COD" value={formatAmount(l.cod_local)} sub={`${partnerName} thu trong kỳ`} tone="twd" />
                                    <Kpi label={`Phí ${partnerName} trừ`} value={RMB2(fees)} sub={l.tru_rmb.map((x) => x.nhan.toLowerCase()).join(" · ") || "không có"} tone="rmb" />
                                    <Kpi label="Tiền hàng" value={goods.length ? VND(goods.reduce((a, x) => a + x.so, 0)) : "—"}
                                        sub={goods.length ? "NAZA trừ vào COD" : "kỳ này không trừ"} tone="hang" />
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
            <MarketOrderSections deliveredUnpaid={deliveredUnpaid} marketPeriods={marketPeriods} narrow={narrow}
                formatAmount={formatAmount} t={t} deliveredSectionNo={deliveredSectionNo} undeliveredSectionNo={undeliveredSectionNo} />
        </div>
    );
}
