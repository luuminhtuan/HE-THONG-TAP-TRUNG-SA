import WaLink from "@/components/talpha/wa-link";
import { cn } from "../../utils";
import { STATUS_VI, STATUS_STYLE } from "./status-styles";
import type { Shipment } from "./types";

/** Bảng "Tất cả vận đơn" — mọi đơn có mã vận đơn trong kỳ, mới nhất lên đầu. */
export function ShipmentTable({ shipments, money, posSource }: {
    shipments: Shipment[]; money: (n: number) => string; posSource: boolean;
}) {
    return (
        <div className="rounded-xl border border-border bg-card shadow-sm">
            <div className="max-h-[560px] overflow-auto">
                <table className="w-full min-w-[880px] text-sm">
                    <thead className="sticky top-0 bg-card">
                        <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                            <th className="px-3 py-2.5 text-left font-medium">Mã đơn</th>
                            <th className="px-3 py-2.5 text-left font-medium">Vận đơn</th>
                            <th className="px-3 py-2.5 text-left font-medium">Trạng thái</th>
                            <th className="px-3 py-2.5 text-right font-medium">COD</th>
                            <th className="px-3 py-2.5 text-left font-medium">Khách</th>
                            <th className="px-3 py-2.5 text-left font-medium">Sale</th>
                            <th className="px-3 py-2.5 text-left font-medium">Nguồn</th>
                        </tr>
                    </thead>
                    <tbody>
                        {/* Mới nhất lên đầu (15/11/2026): ngày lên đơn, cùng ngày mã đơn lớn trước. */}
                        {[...shipments].sort((a, b) => String(b.order_date || "").localeCompare(String(a.order_date || ""))
                            || String(b.order_id).localeCompare(String(a.order_id), "vi", { numeric: true })).map((s) => (
                            // Khoá = mã đơn + mã vận đơn: một mã vận đơn có thể nằm ở hai đơn (lỗi bảng đối tác).
                            <tr key={`${s.order_id}|${s.tracking}`} className="border-b border-border/40 last:border-0 hover:bg-muted/40">
                                <td className="px-3 py-2 font-mono text-xs">{s.order_id}</td>
                                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{s.tracking}</td>
                                <td className="px-3 py-2">
                                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium",
                                        STATUS_STYLE[s.status || ""] || "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-400")}>
                                        {STATUS_VI[s.status || ""] || (s.raw_status ? `“${s.raw_status}”` : s.registered ? "chưa có tin" : "chưa đăng ký")}
                                    </span>
                                </td>
                                <td className="px-3 py-2 text-right font-mono tabular-nums">{s.cod_local ? money(s.cod_local) : "—"}</td>
                                <td className="px-3 py-2">
                                    <div className="max-w-[160px] truncate">{s.customer || "—"}</div>
                                    <div className="text-xs text-muted-foreground">{s.phone}</div>
                                    {s.wa && <WaLink href={s.wa} className="mt-1" />}
                                </td>
                                <td className={cn("px-3 py-2", !s.sale && "text-muted-foreground")}>{s.sale || "—"}</td>
                                <td className="px-3 py-2 text-xs text-muted-foreground">
                                    {s.source === "17track" ? "17TRACK" : s.source === "weship" ? "WeShip" : s.source === "doi_tac" ? "file đối tác" : posSource ? "POS" : "—"}
                                </td>
                            </tr>
                        ))}
                        {!shipments.length && (
                            <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                                Không có đơn nào có mã vận đơn trong kỳ này.
                            </td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
