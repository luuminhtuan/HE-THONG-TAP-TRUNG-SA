import { formatNumber } from "../../utils";
import type { MarketData, MarketOrder, MarketPeriod } from "./types";
import { Section } from "./ui";

/**
 * Hai khối gập cuối màn nước ngoài Đài: đơn đã giao chưa thấy tiền trên sao kê · đơn chưa giao xong.
 * Tách khỏi market-cod-recon.tsx cho file gọn — số và chữ y như cũ.
 */
export function MarketOrderSections({ deliveredUnpaid, marketPeriods, narrow, formatAmount, t, deliveredSectionNo, undeliveredSectionNo }: {
    deliveredUnpaid: MarketOrder[]; marketPeriods: MarketPeriod[]; narrow: boolean;
    formatAmount: (n: number) => string; t: MarketData["tong"];
    deliveredSectionNo: string; undeliveredSectionNo: string;
}) {
    return (
        <>
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
        </>
    );
}
