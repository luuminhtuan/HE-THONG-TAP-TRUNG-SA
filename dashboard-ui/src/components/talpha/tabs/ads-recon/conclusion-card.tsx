import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "../../utils";
import type { Conclusion } from "./types";

/** Khung KẾT LUẬN của một kỳ: tin được không, và phải làm gì (đánh số từng việc). */
export function ConclusionCard({ conclusion }: { conclusion: Conclusion }) {
    return (
        <div className={cn("rounded-xl border-l-4 p-4",
            conclusion.muc === "khong_tin" ? "border-l-rose-600 bg-rose-50/80 dark:bg-rose-500/[0.09]"
            : conclusion.muc === "co_van_de" ? "border-l-amber-500 bg-amber-50/70 dark:bg-amber-500/[0.08]"
            : conclusion.muc === "can_xem" ? "border-l-sky-500 bg-sky-50/60 dark:bg-sky-500/[0.07]"
            : "border-l-emerald-500 bg-emerald-50/60 dark:bg-emerald-500/[0.07]")}>
            <div className="flex items-start gap-2.5">
                {conclusion.muc === "sach"
                    ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    : <AlertTriangle className={cn("mt-0.5 h-5 w-5 shrink-0",
                        conclusion.muc === "khong_tin" ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400")} />}
                <div className="min-w-0 flex-1">
                    <div className="text-base font-bold">{conclusion.tieu_de}</div>
                    {conclusion.giai_thich && (
                        <div className="mt-0.5 text-sm text-muted-foreground">{conclusion.giai_thich}</div>
                    )}
                    {conclusion.viec.length > 0 && (
                        <ol className="mt-3 space-y-2">
                            {conclusion.viec.map((v, i) => (
                                <li key={i} className="flex gap-2.5 text-sm">
                                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black/[0.07] text-[11px] font-bold dark:bg-white/15">
                                        {i + 1}
                                    </span>
                                    <span className="min-w-0">
                                        <span className="font-semibold">{v.title}</span>
                                        {v.hint && <span className="block text-xs text-muted-foreground">{v.hint}</span>}
                                    </span>
                                </li>
                            ))}
                        </ol>
                    )}
                </div>
            </div>
        </div>
    );
}
