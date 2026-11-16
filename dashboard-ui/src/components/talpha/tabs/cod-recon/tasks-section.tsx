import { AlertTriangle, CheckCircle2, Copy, Landmark, PenLine, SearchCheck, X, type LucideIcon } from "lucide-react";
import { formatNumber, cn } from "../../utils";
import { VND } from "../ledger-shared";
import type { Task } from "./types";
import { ActionButton, Section } from "./ui";

/** ① Việc hôm nay — dùng chung màn Đài và các nước khác (08/10/2026). */
export function TasksSection({ viec: tasks, busy, copied, onChep: onCopy, tinLech: discrepancyMessage, onNhapBank: onBankEntry, onGhi: onSave, rongChu: emptyText, hoiAi: counterparty = "NAZA" }: {
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
