import { Fragment } from "react";
import { ChevronDown, ChevronRight, TrendingUp, Wallet, ShoppingCart, Package, Coins, Megaphone } from "lucide-react";
import { formatVNDCompact, cn } from "@/components/talpha/utils";
import { ROAS_GOOD } from "./constants";
import { Pill, roasTone } from "./ui";
import type { AdDetail, RealtimeCampaign } from "./types";

/** Một TKQC: dòng tổng của tài khoản + bảng campaign, bấm campaign mở danh sách ads. */
export function AccountCampaigns({ accId, accCampaigns, getAccountName, expandedCampaign, toggleCampaign }: {
    accId: string; accCampaigns: RealtimeCampaign[]; getAccountName: (id: string) => string;
    expandedCampaign: string | null; toggleCampaign: (id: string) => void;
}) {
    const accSpend = accCampaigns.reduce((s, c) => s + c.spend_vnd, 0);
    const accRevenue = accCampaigns.reduce((s, c) => s + c.revenue_vnd, 0);
    const accOrders = accCampaigns.reduce((s, c) => s + c.orders, 0);
    const accPurchases = accCampaigns.reduce((s, c) => s + c.purchases, 0);
    const accRoas = accSpend > 0 ? accRevenue / accSpend : 0;

    return (
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#1B1A17]/80 shadow-xl shadow-black/30">
            {/* Account header */}
            <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-gradient-to-r from-[#201E19] to-[#1B1A17] px-4 py-2.5">
                <div className="flex items-center gap-3">
                    <div className="h-8 w-1.5 rounded-full bg-gradient-to-b from-amber-400 to-orange-500" />
                    <div>
                        <h2 className="text-sm font-bold uppercase tracking-wider text-white">{getAccountName(accId)}</h2>
                        <div className="font-mono text-[9px] text-slate-500">{accId}</div>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                    <Pill className="bg-white/5 text-slate-300"><Megaphone className="h-3 w-3" />{accCampaigns.length} camp</Pill>
                    <Pill className="bg-slate-500/15 text-slate-200"><Wallet className="h-3 w-3" />{formatVNDCompact(accSpend)}</Pill>
                    {accPurchases > 0 && <Pill className="bg-purple-500/15 text-purple-300"><ShoppingCart className="h-3 w-3" />{accPurchases}</Pill>}
                    {accOrders > 0 && <Pill className="bg-blue-500/15 text-blue-300"><Package className="h-3 w-3" />{accOrders}</Pill>}
                    {accRevenue > 0 && <Pill className="bg-emerald-500/15 text-emerald-300"><Coins className="h-3 w-3" />{formatVNDCompact(accRevenue)}</Pill>}
                    <Pill className={cn("border", roasTone(accRoas))}><TrendingUp className="h-3 w-3" />{accRoas.toFixed(2)}x</Pill>
                </div>
            </div>

            {/* Campaign table */}
            <div className="max-h-[600px] overflow-auto">
                <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 z-10 bg-[#16140F]/95 text-[10px] font-semibold uppercase text-slate-400 backdrop-blur">
                        <tr>
                            <th className="w-6 px-2 py-2.5"></th>
                            <th className="px-2 py-2.5">Campaign</th>
                            <th className="px-2 py-2.5 text-right">Spend (₫)</th>
                            <th className="px-2 py-2.5 text-right">CPM / CTR</th>
                            <th className="px-2 py-2.5 text-right">MSG</th>
                            <th className="px-2 py-2.5 text-right text-indigo-300">CPA MSG</th>
                            <th className="px-2 py-2.5 text-right text-purple-300">🛒 META</th>
                            <th className="px-2 py-2.5 text-right text-blue-300">📦 POS</th>
                            <th className="px-2 py-2.5 text-right text-emerald-300" title="Doanh số ĐẶT (mọi đơn) — không phải GTC">💰 DS đặt</th>
                            <th className="px-2 py-2.5 text-right text-emerald-300" title="ROAS blended = DS đặt ÷ spend — không so trực tiếp với ROAS GTC của các tab đọc kho số">📈 ROAS</th>
                        </tr>
                    </thead>
                    <tbody>
                        {accCampaigns.map(c => {
                            const isExpanded = expandedCampaign === c.campaign_id;
                            // Khoá đặt ở Fragment bọc ngoài — đặt ở <tr> bên trong thì React vẫn
                            // báo thiếu key cho từng phần tử của danh sách.
                            return (
                                <Fragment key={c.campaign_id}>
                                    {/* Campaign row */}
                                    <tr
                                        onClick={() => toggleCampaign(c.campaign_id)}
                                        className={cn("group cursor-pointer border-t border-white/5 transition",
                                            isExpanded ? "bg-amber-500/5" : "odd:bg-white/[0.015] hover:bg-white/5")}>
                                        <td className="px-2 py-2.5 text-slate-500">
                                            {isExpanded
                                                ? <ChevronDown className="h-3.5 w-3.5 text-amber-400" />
                                                : <ChevronRight className="h-3.5 w-3.5 group-hover:text-amber-400" />}
                                        </td>
                                        <td className="px-2 py-2.5">
                                            <div className="max-w-[280px] whitespace-normal text-xs font-medium leading-tight text-white">{c.campaign_name}</div>
                                            <div className="mt-0.5 text-[9px] text-slate-500">{c.ads_count} ads</div>
                                        </td>
                                        <td className="px-2 py-2.5 text-right font-mono text-xs text-slate-200">{formatVNDCompact(c.spend_vnd)}</td>
                                        <td className="px-2 py-2.5 text-right font-mono text-[10px]">
                                            <div className="text-slate-400">CPM {formatVNDCompact(c.cpm_vnd)}</div>
                                            <div className="text-indigo-400">CTR {c.ctr.toFixed(2)}%</div>
                                        </td>
                                        <td className="px-2 py-2.5 text-right font-mono text-xs text-indigo-400"
                                            title={c.mess_nguon === "pancake" ? "Meta không báo tin nhắn ở Nhật — số này đếm hội thoại mới trên Pancake của page ghi trong tên camp" : undefined}>
                                            {c.messages || 0}{c.mess_nguon === "pancake" ? <span className="ml-0.5 text-[9px] text-amber-400">P</span> : null}
                                        </td>
                                        <td className="px-2 py-2.5 text-right font-mono text-xs text-indigo-300">
                                            {c.messages > 0 ? formatVNDCompact(c.spend_vnd / c.messages) : '-'}
                                        </td>
                                        <td className={cn("px-2 py-2.5 text-right font-mono font-bold", c.purchases > 0 ? 'text-purple-400' : 'text-slate-600')}>{c.purchases || 0}</td>
                                        <td className={cn("px-2 py-2.5 text-right font-mono font-bold", c.orders > 0 ? 'text-blue-400' : 'text-slate-600')}>{c.orders}</td>
                                        <td className={cn("px-2 py-2.5 text-right font-mono text-xs", c.revenue_vnd > 0 ? 'font-bold text-emerald-400' : 'text-slate-600')}>
                                            {c.revenue_vnd > 0 ? formatVNDCompact(c.revenue_vnd) : '-'}
                                        </td>
                                        <td className="px-2 py-2.5 text-right">
                                            {c.roas > 0
                                                ? <span className={cn("inline-block rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-bold", roasTone(c.roas))}>{c.roas.toFixed(2)}</span>
                                                : <span className="text-slate-600">-</span>}
                                        </td>
                                    </tr>

                                    {/* Expanded ads detail */}
                                    {isExpanded && c.ads.map((ad: AdDetail) => (
                                        <tr key={ad.ad_id} className="border-l-2 border-amber-500/40 bg-[#0F0E0B]/80">
                                            <td className="px-2 py-1.5"></td>
                                            <td className="px-2 py-1.5 pl-6">
                                                <div className="max-w-[260px] whitespace-normal text-[10px] leading-tight text-slate-300">{ad.ad_name}</div>
                                                <div className="text-[9px] text-slate-600">{ad.adset_name} • {ad.ad_id}</div>
                                            </td>
                                            <td className="px-2 py-1.5 text-right font-mono text-[10px] text-slate-400">{formatVNDCompact(ad.spend_vnd)}</td>
                                            <td className="px-2 py-1.5 text-right font-mono text-[9px]">
                                                <div className="text-slate-500">CPM {formatVNDCompact(ad.cpm_vnd)}</div>
                                                <div className="text-indigo-400/70">CTR {ad.ctr.toFixed(2)}%</div>
                                            </td>
                                            <td className="px-2 py-1.5 text-right font-mono text-[10px] text-indigo-400/70">{ad.messages || 0}</td>
                                            <td className="px-2 py-1.5 text-right font-mono text-[10px] text-indigo-300/70">
                                                {ad.messages > 0 ? formatVNDCompact(ad.spend_vnd / ad.messages) : '-'}
                                            </td>
                                            <td className={cn("px-2 py-1.5 text-right font-mono text-[10px]", ad.purchases > 0 ? 'text-purple-400' : 'text-slate-600')}>{ad.purchases || 0}</td>
                                            <td className={cn("px-2 py-1.5 text-right font-mono text-[10px]", ad.orders > 0 ? 'font-bold text-blue-400' : 'text-slate-600')}>{ad.orders}</td>
                                            <td className={cn("px-2 py-1.5 text-right font-mono text-[10px]", ad.revenue_vnd > 0 ? 'text-emerald-400' : 'text-slate-600')}>
                                                {ad.revenue_vnd > 0 ? formatVNDCompact(ad.revenue_vnd) : '-'}
                                            </td>
                                            <td className={cn("px-2 py-1.5 text-right font-mono text-[10px]",
                                                ad.roas >= ROAS_GOOD ? 'text-emerald-400' : ad.roas > 0 ? 'text-rose-400' : 'text-slate-600')}>
                                                {ad.roas > 0 ? ad.roas.toFixed(2) : '-'}
                                            </td>
                                        </tr>
                                    ))}
                                </Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
