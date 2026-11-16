"use client";

import { useState } from "react";
import { Check, ChevronDown, Copy, HandCoins } from "lucide-react";
import { cn } from "../../utils";
import { TWD, paymentChaseMessage, type UnpaidOrder } from "../ledger-shared";

/**
 * ĐÒI TIỀN NAZA — đơn đã giao, qua từ 2 kỳ sao kê mà chưa được trả đồng nào.
 *
 * Chuyển từ tab Đối soát COD cũ sang đây khi tách mục Kế toán (Sỹ Anh chốt 07/10/2026): đây là
 * việc THEO ĐƠN — tên khách, số điện thoại phải nằm ngay cạnh (bài học lần tách Đơn hàng /
 * Đối soát đầu tiên), và sale không vào Kế toán vẫn phải đòi được. Máy nhớ đã nhắn ngày nào,
 * mấy lần (/api/talpha/cod-actions, việc "da_doi"); sang kỳ sau tiền vẫn chưa về thì việc tự nổi
 * lại (`canNhan` = máy còn xếp "Nhắn NAZA đòi tiền" vào việc hôm nay).
 */
export function NazaChasePanel({ ds, canNhan: chaseDue, chiTiet: details, onXong: onDone }: {
    ds: UnpaidOrder[]; canNhan: boolean; chiTiet: string; onXong: () => Promise<void> | void;
}) {
    const [open, setOpen] = useState(false);
    const [copiedLang, setCopiedLang] = useState("");
    const [busy, setBusy] = useState(false);
    const [saveError, setSaveError] = useState("");
    if (!ds.length) return null;

    const total = ds.reduce((a, x) => a + x.cod_twd, 0);
    const copyMessage = (lang: "vi" | "zh") => {
        navigator.clipboard?.writeText(paymentChaseMessage(ds, lang));
        setCopiedLang(lang); setTimeout(() => setCopiedLang(""), 2200);
    };
    /** Đòi thì đòi cả danh sách trong một tin — đóng cả mẻ, không đóng lẻ từng đơn. */
    const markMessaged = async () => {
        setBusy(true); setSaveError("");
        try {
            for (const p of ds) {
                const r = await fetch("/api/talpha/cod-actions", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ kind: "done", key: p.doi_key, viec: "da_doi" }),
                });
                if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Không ghi được");
            }
            await onDone();
        } catch (e) {
            setSaveError(e instanceof Error ? e.message : "Không ghi được");
        } finally { setBusy(false); }
    };
    const buttonClass = "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[12.5px] font-medium transition-colors disabled:opacity-60";

    return (
        <div className={cn("overflow-hidden rounded-xl border bg-card",
            chaseDue ? "border-rose-300 dark:border-rose-500/40" : "border-border")}>
            <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 md:px-4",
                chaseDue ? "bg-rose-50 dark:bg-rose-500/10" : "bg-muted/30")}>
                <button onClick={() => setOpen(!open)} aria-expanded={open}
                    className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-left">
                    <HandCoins className={cn("h-4 w-4 flex-none", chaseDue ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground")} />
                    <span className={cn("text-sm font-semibold", chaseDue ? "text-rose-900 dark:text-rose-200" : "text-foreground")}>
                        Đòi tiền NAZA
                    </span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[11.5px] font-bold tabular-nums",
                        chaseDue ? "bg-rose-600 text-white" : "bg-muted text-foreground/75")}>
                        {ds.length} đơn quá hạn · {TWD(total)}
                    </span>
                    {!chaseDue && <span className="text-[12px] text-muted-foreground">đã nhắn — chờ kỳ sao kê sau</span>}
                    <ChevronDown className={cn("h-4 w-4 flex-none opacity-60 transition-transform", open && "rotate-180")} />
                </button>
                <div className="flex flex-wrap items-center gap-1.5">
                    <button onClick={() => copyMessage("vi")}
                        className={cn(buttonClass, "border-transparent bg-orange-500 text-white hover:bg-orange-600")}>
                        <Copy className="h-3.5 w-3.5" />{copiedLang === "vi" ? "Đã chép" : "Chép tin (Việt)"}
                    </button>
                    <button onClick={() => copyMessage("zh")} className={cn(buttonClass, "border-border bg-card text-foreground hover:bg-muted")}>
                        {copiedLang === "zh" ? "Đã chép" : "中文"}
                    </button>
                    {chaseDue && (
                        <button onClick={markMessaged} disabled={busy}
                            className={cn(buttonClass, "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300")}>
                            <Check className="h-3.5 w-3.5" />{busy ? "Đang ghi…" : "Đã nhắn"}
                        </button>
                    )}
                </div>
            </div>
            {saveError && <p className="border-t border-rose-200 px-4 py-2 text-[12.5px] font-medium text-rose-700 dark:border-rose-500/30 dark:text-rose-300">{saveError}</p>}
            {open && (
                <>
                    <p className="border-t border-border/70 px-3.5 py-2 text-[12.5px] leading-relaxed text-muted-foreground md:px-4">
                        {details || "Đã giao thành công, đã qua từ 2 kỳ sao kê mà vẫn chưa được trả đồng nào."}{" "}
                        Chép tin gửi NAZA, gửi xong bấm “Đã nhắn” — máy nhớ ngày; sang kỳ sau tiền vẫn chưa về thì tự nhắc lại.
                    </p>
                    <ul className="divide-y divide-border/60 border-t border-border/70">
                        {ds.map((p) => (
                            /* Khoá = mã đơn + mã vận đơn: bảng NAZA có mã vận đơn gán cho HAI đơn (vd 18008693
                               của T1465 và T1467) — chỉ lấy mã vận đơn là React báo trùng khoá. */
                            <li key={`${p.order_no}|${p.tracking}`} className="px-3.5 py-2 md:px-4">
                                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px]">
                                    <b className="text-foreground">{p.order_no}</b>
                                    <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                                        {p.ky_da_qua} kỳ
                                    </span>
                                    <span className="text-[12px] text-muted-foreground">
                                        {p.contact_name || "—"}
                                        {p.phone ? <> · <a href={`tel:${p.phone}`} className="font-mono text-violet-700 dark:text-violet-300">{p.phone}</a></> : null}
                                        {p.tracking ? <> · <span className="font-mono">{p.tracking}</span></> : null}
                                    </span>
                                    <span className="ml-auto font-bold tabular-nums text-foreground">{TWD(p.cod_twd)}</span>
                                </div>
                                <span className={cn("mt-1 inline-block rounded-full px-2 py-0.5 text-[11.5px] font-medium",
                                    !p.da_doi ? "bg-muted text-muted-foreground"
                                        : p.doi_chu.includes("vẫn im") ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                                            : "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300")}>
                                    {p.doi_chu}
                                </span>
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </div>
    );
}
