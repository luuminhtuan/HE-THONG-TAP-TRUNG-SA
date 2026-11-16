import { AlertTriangle } from "lucide-react";
import { formatVNDCompact } from "@/components/talpha/utils";
import { UNMATCH_REASON_LABEL } from "./constants";
import type { RealtimeData } from "./types";

/** Đơn CHƯA MAP được vào campaign — gom theo lý do và theo thị trường, không gán bừa. */
export function UnmatchedOrders({ data }: { data: RealtimeData }) {
    return (
        <div className="rounded-2xl border border-white/10 bg-[#1B1A17]/80 p-3">
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                Đơn CHƯA MAP được (không gán bừa) — {data.summary.unmatched_orders} đơn • {formatVNDCompact(data.summary.unmatched_revenue_vnd)}
            </h3>

            {/* Lý do chưa map — để soi, không đoán */}
            {data.unmatched_by_reason && Object.keys(data.unmatched_by_reason).length > 0 && (
                <div className="mb-3">
                    <div className="mb-1 text-[10px] font-bold uppercase text-slate-500">Lý do</div>
                    <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-3">
                        {Object.entries(data.unmatched_by_reason)
                            .sort(([, a], [, b]) => b.count - a.count)
                            .map(([reason, info]) => (
                                <div key={reason} className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-2.5">
                                    <div className="text-[11px] font-semibold text-amber-200">{UNMATCH_REASON_LABEL[reason] || reason}</div>
                                    <div className="mt-0.5 text-[10px] text-slate-400">{info.count} đơn • {formatVNDCompact(info.revenue_vnd)}</div>
                                </div>
                            ))}
                    </div>
                </div>
            )}

            <div className="mb-1 text-[10px] font-bold uppercase text-slate-500">Theo thị trường</div>
            <div className="grid grid-cols-3 gap-2 text-xs md:grid-cols-6">
                {Object.entries(data.unmatched_by_shop)
                    .sort(([, a], [, b]) => b.revenue_vnd - a.revenue_vnd)
                    .map(([shop, info]) => (
                        <div key={shop} className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5 transition hover:border-amber-500/30">
                            <div className="text-xs font-bold text-white">{shop}</div>
                            <div className="font-mono text-sm font-bold text-emerald-400">{formatVNDCompact(info.revenue_vnd)}</div>
                            <div className="text-[10px] text-slate-500">{info.count} đơn</div>
                        </div>
                    ))}
            </div>
        </div>
    );
}
