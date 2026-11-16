import { Trash2, Database } from "lucide-react";
import { cn } from "../../utils";
import { d6 } from "../ledger-shared";
import { VND, TH, TD } from "./shared";
import type { StoreSource } from "./types";

/** Khung "Kho dữ liệu" — mỗi file đã nạp một dòng, kèm TKQC của nó và nút rút khỏi kho. */
export function StorePanel({ store, adAccountNames, onRemove: removeSource }: {
    store: { kho: { fb: number; bank: number }; nguon: StoreSource[] };
    adAccountNames: Record<string, string>;
    onRemove: (fileName: string) => void;
}) {
    return (
        <div className="rounded-xl border border-border bg-card p-4 dark:bg-white/[0.03]">
            <div className="mb-3 flex flex-wrap items-center gap-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <Database className="h-4 w-4 text-muted-foreground" /> Kho dữ liệu
                </h3>
                <span className="text-xs text-muted-foreground">
                    {store.kho.fb} dòng chi phí TKQC · {store.kho.bank} dòng sao kê · giữ lại giữa các lần tải
                </span>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="border-b border-border">
                        <tr>{["File", "Phía", "Tài khoản quảng cáo", "Số dòng", "Số tiền", "Khoảng ngày", ""]
                            .map((h) => <th key={h} className={TH}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                        {store.nguon.map((n) => (
                            <tr key={n.phia + n.ten} className="border-b border-border/60">
                                <td className="px-3 py-2 min-w-[220px] font-medium">{n.ten}</td>
                                <td className={TD}>
                                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold",
                                        n.phia === "fb" ? "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300"
                                                        : "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300")}>
                                        {n.phia === "fb" ? "TKQC" : "Sao kê"}
                                    </span>
                                </td>
                                <td className="px-3 py-2 min-w-[160px]">
                                    {n.tkqc.length
                                        ? n.tkqc.map((t) => adAccountNames[t.replace(/^act_/, "")] || t).join(", ")
                                        : <span className="text-muted-foreground">—</span>}
                                </td>
                                <td className={cn(TD, "text-right tabular-nums")}>{n.so_dong}</td>
                                <td className={cn(TD, "text-right tabular-nums")}>{VND(n.tien)}</td>
                                <td className={cn(TD, "text-muted-foreground")}>{d6(n.tu)} → {d6(n.den)}</td>
                                <td className={TD}>
                                    <button
                                        onClick={() => removeSource(n.ten)}
                                        className="text-muted-foreground hover:text-rose-600" title="Rút file này khỏi kho"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
