// Soi đối thủ — các khung đọc từ KHO của nhóm kia: tổng quan, đang chạy 7 ngày, bán nhiều nhất, tín hiệu kho.
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { returnLevel, sortByLast7Days, topSellers, type CompetitorProduct, type ResearchSnapshot } from "@/lib/talpha/competitor-research";
import {
    CARD, TITLE, ON_ORDER_CLS, RETURN_BG, RETURN_TEXT, fmtNum, pct, vnDate, returnLabel, scrollToProduct, ProductThumb,
} from "./shared";

export function Overview({ s }: { s: ResearchSnapshot }) {
    const t = s.overview;
    const tiles: [string, string, string][] = [
        ["Sản phẩm", fmtNum(t.products), `${fmtNum(t.skus)} mã hàng theo màu, size`],
        ["Đã nhập kho", fmtNum(t.stocked_in), `từ ${vnDate(t.started_on)}`],
        ["Đã xuất kho", fmtNum(t.shipped), "sản phẩm, không phải số đơn"],
        ["Xuất 7 ngày", `~${fmtNum(t.shipped_7d)}`, `khoảng ${fmtNum(t.shipped_7d / 7)} sản phẩm/ngày`],
        ["Đang hoàn", pct(t.returning / t.shipped), `${fmtNum(t.returning)} sản phẩm`],
        ["Hàng tặng kèm", pct(t.gifts / t.shipped, 0), `${fmtNum(t.gifts)} sản phẩm là quà`],
        ["Kênh bán", fmtNum(t.tiktok_channel_count + t.facebook_channel_count), `${t.tiktok_channel_count} TikTok · ${t.facebook_channel_count} Facebook`],
    ];
    return (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4 xl:grid-cols-7">
            {tiles.map(([label, value, sub]) => (
                <div key={label} className="space-y-0.5 bg-card p-3">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-xl font-semibold tabular-nums text-foreground">{value}</p>
                    <p className="text-[11px] leading-snug text-muted-foreground">{sub}</p>
                </div>
            ))}
        </div>
    );
}

export function TopLast7Days({ products }: { products: CompetitorProduct[] }) {
    const rows = useMemo(() => sortByLast7Days(products, "running"), [products]);
    const max = Math.max(1, ...rows.map((p) => p.shipped_7d));
    return (
        <div className={CARD}>
            <h3 className={TITLE}>Đang chạy mạnh: xuất 7 ngày</h3>
            <p className="mb-3 mt-1 text-xs text-muted-foreground">Bấm tên để xem ảnh và link spy. Nhãn bên phải: tỉ lệ hoàn · đặt thêm.</p>
            <div className="space-y-2">
                {rows.map((p) => (
                    <div key={p.id} className="grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-3 max-sm:grid-cols-1 max-sm:gap-1">
                        <button type="button" onClick={() => scrollToProduct(p.id)} className="flex min-w-0 items-center gap-2 text-left hover:text-blue-600 dark:hover:text-blue-400">
                            <ProductThumb p={p} />
                            <span className="min-w-0 truncate text-sm font-medium">{p.name}</span>
                        </button>
                        <div className="h-5 overflow-hidden rounded bg-muted">
                            <div className="flex h-full items-center justify-end rounded bg-blue-600 pr-1.5 dark:bg-blue-500" style={{ width: `${Math.max(8, (p.shipped_7d / max) * 100)}%` }}>
                                <span className="text-[11px] font-semibold tabular-nums text-white">{p.shipped_7d}</span>
                            </div>
                        </div>
                        <div className="flex flex-wrap justify-end gap-1 max-sm:justify-start">
                            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums", RETURN_BG[returnLevel(p)])}>hoàn {returnLabel(p)}</span>
                            {p.on_order > 0 && <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums", ON_ORDER_CLS)}>đặt thêm {p.on_order}</span>}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

export function TopSellers({ products }: { products: CompetitorProduct[] }) {
    const rows = useMemo(() => topSellers(products, 10), [products]);
    return (
        <div className={CARD}>
            <h3 className={cn(TITLE, "mb-3")}>Bán nhiều nhất từ trước đến nay</h3>
            <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-sm">
                    <thead>
                        <tr className="border-b border-border text-left text-xs text-muted-foreground">
                            <th className="py-1.5 pr-2 font-medium">Sản phẩm</th>
                            <th className="py-1.5 pr-2 text-right font-medium">Đã xuất</th>
                            <th className="py-1.5 pr-2 text-right font-medium">7 ngày</th>
                            <th className="py-1.5 text-right font-medium">Hoàn</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((p) => (
                            <tr key={p.id} className="border-b border-border/60 last:border-0">
                                <td className="py-1.5 pr-2">
                                    <button type="button" onClick={() => scrollToProduct(p.id)} className="flex items-center gap-2 text-left hover:text-blue-600 dark:hover:text-blue-400">
                                        <ProductThumb p={p} /><span>{p.name}</span>
                                    </button>
                                </td>
                                <td className="py-1.5 pr-2 text-right tabular-nums">{fmtNum(p.shipped)}</td>
                                <td className="py-1.5 pr-2 text-right tabular-nums">{fmtNum(p.shipped_7d)}</td>
                                <td className={cn("py-1.5 text-right font-medium tabular-nums", RETURN_TEXT[returnLevel(p)])}>{returnLabel(p)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export function StockSignals({ s }: { s: ResearchSnapshot }) {
    const t = s.signals;
    const blocks: { name: string; sub: string; dot: string; rows: [string, string][] }[] = [
        { name: "Đang đặt thêm hàng", sub: "Số lượng chờ nhập về kho — hàng đã có lời.", dot: "bg-[#2a78d6]", rows: t.restocking.map((x) => [x.name, fmtNum(x.qty)]) },
        { name: "Đang test, ra đơn nhanh", sub: "Chưa nhập hàng mà đã bán, tính từ ngày tạo mã.", dot: "bg-emerald-500", rows: t.testing.map((x) => [`${x.name} (từ ${vnDate(x.since).slice(0, 5)})`, fmtNum(x.qty)]) },
        { name: "Hoàn cao, nên tránh", sub: "Đang hoàn / đã xuất, hàng xuất từ 100 trở lên.", dot: "bg-rose-500", rows: t.high_returns.map((x) => [x.name, pct(x.rate)]) },
        { name: "Ôm tồn", sub: "Tồn còn lại / tổng đã nhập.", dot: "bg-amber-500", rows: t.overstock.map((x) => [x.name, `${fmtNum(x.stock)} / ${fmtNum(x.stocked_in)}`]) },
    ];
    return (
        <section className="space-y-3">
            <h3 className="text-base font-semibold text-foreground">Tín hiệu từ kho</h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                {blocks.map((k) => (
                    <div key={k.name} className={cn(CARD, "space-y-2")}>
                        <h4 className={cn(TITLE, "flex items-center gap-2")}><i className={cn("h-2.5 w-2.5 rounded-full", k.dot)} aria-hidden />{k.name}</h4>
                        <p className="text-xs text-muted-foreground">{k.sub}</p>
                        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
                            {k.rows.map(([a, b]) => (
                                <div key={a} className="contents">
                                    <dt className="min-w-0 text-foreground">{a}</dt>
                                    <dd className="text-right tabular-nums text-foreground">{b}</dd>
                                </div>
                            ))}
                        </dl>
                    </div>
                ))}
            </div>
            <p className="rounded-r-lg border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">{t.gift_note}</p>
        </section>
    );
}
