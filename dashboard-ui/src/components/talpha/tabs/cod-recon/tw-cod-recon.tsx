"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { Upload, AlertTriangle, Download, ChevronDown, FileSpreadsheet, Info, PenLine } from "lucide-react";
import TabSkeleton, { ErrorState } from "@/components/ui/tab-skeleton";
import { formatNumber, cn } from "../../utils";
import { TWD, VND } from "../ledger-shared";
import PartnerSheetImporter, { isSheetStale, shortImportLabel, type PartnerSheetImport } from "@/components/talpha/partner-sheet-importer";
import { useNarrowScreen } from "../order-ledger-shared-ui";
import type { Check, CodReconTabProps, Fx, Overview, Pending, Period, ReceivedSummary, StatementMeta, Task } from "./types";
import { discrepancyMessage, dmy, RMB2, shortFile, TW_CURRENCY } from "./format";
import { ActionButton, BankDiffCell, FormBank, HeaderBar, Kpi, Section, StatusBadge } from "./ui";
import { TasksSection } from "./tasks-section";
import { ChecksPanel, CheckGroup } from "./checks-panel";
import { MoneyFlowPanel } from "./money-flow";
import { MoneySummary } from "./money-summary";
import { FxSection } from "./fx-section";

/** Tiền COD về — màn Đài Loan: toàn bộ quy trình sao kê NAZA (bố cục ở chú thích đầu cod-recon-tab.tsx). */
export function TwCodRecon({ dateRange, nutNuoc: marketSwitcher }: CodReconTabProps & { nutNuoc?: ReactNode }) {
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
    // 13/11/2026: vẫn đòi ở Sổ đơn hàng, nhưng màn này phải NÓI có đơn quá hạn — trước đó
    // "Không có việc gì cần làm" trong khi NAZA đang giữ tiền đơn qua ≥2 kỳ.
    const overdue = pending.filter((x) => x.qua_han);
    const accountingTasks: Task[] = [
        ...(overdue.length ? [{
            id: "qua-han-tom", muc: "gap" as const, tieu_de: "Đơn đã giao quá hạn, NAZA chưa trả",
            so: overdue.length, don_vi: "đơn",
            chi_tiet: `${TWD(overdue.reduce((a, x) => a + x.cod_twd, 0))} — đã qua từ 2 kỳ sao kê mà chưa thấy tiền`
                + `${overdue.some((x) => x.da_doi) ? ` (${overdue.filter((x) => x.da_doi).length} đơn đã đòi)` : ""}.`
                + " Đòi ở khung “Đòi tiền NAZA” của Sổ đơn hàng — có sẵn tin nhắn, tên khách, số điện thoại.",
            done_key: "", nut: [], ghi_chu: "",
        }] : []),
        ...tasks.filter((v) => v.id !== "doi-naza"),
    ];

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
        <BankDiffCell diff={p.lech_bank_vnd} matched={p.trang_thai === "khop"} tolerance={overview?.bank_tolerance_vnd ?? null} />
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
                    {stms.length} bản sao kê
                    {/* Kỳ âm không có số phải trả → không vào ô "n kỳ sao kê" / "n kỳ khớp"; nói ra kẻo tưởng mất một kỳ. */}
                    {(() => {
                        const negative = periods.filter((p) => p.settlement?.payable_vnd == null).length;
                        return negative ? ` (${negative} kỳ không có tiền trả — âm/chuyển sang kỳ sau)` : "";
                    })()}
                    {latest ? ` · mới nhất “${shortFile(latest.filename)}” (chốt đơn tới ${dmy(latest.period_date)})` : ""}
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
                rongChu="Mọi kỳ đã soát xong, tiền đã về khớp, không đơn nào quá hạn." />

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
