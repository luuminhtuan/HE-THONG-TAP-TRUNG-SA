// Soi đối thủ — thư viện spy: lọc theo nhóm + thẻ từng sản phẩm (ảnh, số kho, offer, video top, link spy).
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { PRODUCT_GROUPS, returnLevel, compactNumber, type CompetitorProduct } from "@/lib/talpha/competitor-research";
import { TITLE, RETURN_TEXT, fmtNum, returnLabel, productCardId, type Filter } from "./shared";

export function ProductLibrary({ products, filter, setFilter }: { products: CompetitorProduct[]; filter: Filter; setFilter: (f: Filter) => void }) {
    const counts = useMemo(() => {
        const d: Record<string, number> = { all: products.length };
        for (const p of products) d[p.group] = (d[p.group] || 0) + 1;
        return d;
    }, [products]);
    const groups = PRODUCT_GROUPS.filter((n) => counts[n.id]);
    const chips: { id: Filter; name: string }[] = [{ id: "all", name: "Tất cả" }, ...groups.map((n) => ({ id: n.id as Filter, name: n.name }))];
    return (
        <section className="space-y-3">
            <div>
                <h3 className="text-base font-semibold text-foreground">Thư viện spy: {products.length} sản phẩm</h3>
                <p className="mt-1 max-w-4xl text-xs text-muted-foreground">
                    Ảnh lấy từ kho POS của nhóm kia, phần lớn là ảnh quảng cáo có in offer. Link mở kênh TikTok, video nhiều view nhất, ô tìm kiếm TikTok hoặc Meta Ad Library.
                </p>
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Lọc theo nhóm">
                {chips.map((c) => (
                    <button key={c.id} type="button" onClick={() => setFilter(c.id)} aria-pressed={filter === c.id}
                        className={cn("rounded-full border px-3 py-1 text-sm font-medium",
                            filter === c.id ? "border-blue-600 bg-blue-600 text-white dark:border-blue-500 dark:bg-blue-500" : "border-border bg-background text-foreground hover:bg-muted")}>
                        {c.name} <span className="tabular-nums opacity-70">{counts[c.id]}</span>
                    </button>
                ))}
            </div>
            {groups.filter((n) => filter === "all" || filter === n.id).map((n) => (
                <div key={n.id} className="space-y-2 pt-2">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                        <h4 className={TITLE}>{n.name}</h4>
                        <span className="text-xs text-muted-foreground">{n.description}</span>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                        {products.filter((p) => p.group === n.id).map((p) => <ProductCard key={p.id} p={p} />)}
                    </div>
                </div>
            ))}
        </section>
    );
}

function ProductCard({ p }: { p: CompetitorProduct }) {
    const level = returnLevel(p);
    const fourth: [string, string] = p.on_order > 0 ? ["Đặt thêm", fmtNum(p.on_order)] : ["Tồn", fmtNum(p.stock)];
    const stats: [string, string, string?][] = [
        ["Đã xuất", fmtNum(p.shipped)],
        ["7 ngày", fmtNum(p.shipped_7d)],
        ["Hoàn", returnLabel(p), RETURN_TEXT[level]],
        fourth,
    ];
    return (
        <article id={productCardId(p.id)} className="flex scroll-mt-24 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="flex aspect-square items-center justify-center border-b border-border bg-white">
                {p.image
                    // eslint-disable-next-line @next/next/no-img-element -- ảnh tĩnh trong public/, không qua next/image
                    ? <img src={p.image} alt={`Ảnh sản phẩm ${p.name}`} loading="lazy" className="h-full w-full object-contain" />
                    : <span className="text-xs text-neutral-500">Kho chưa có ảnh</span>}
            </div>
            <div className="flex flex-1 flex-col gap-2 p-3">
                <div>
                    <h5 className="text-sm font-semibold text-foreground">{p.name}</h5>
                    <p className="text-xs leading-snug text-muted-foreground">{p.description}</p>
                </div>
                <span className="text-[11px] font-semibold text-blue-700 dark:text-blue-300">{p.audience}</span>
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border">
                    {stats.map(([label, value, color]) => (
                        <div key={label} className="flex min-w-0 items-baseline justify-between gap-2 bg-muted/40 px-2 py-1">
                            <p className="whitespace-nowrap text-[11px] text-muted-foreground">{label}</p>
                            <p className={cn("text-sm font-semibold tabular-nums text-foreground", color)}>{value}</p>
                        </div>
                    ))}
                </div>
                <p className="text-xs leading-snug text-muted-foreground">{p.offer}</p>
                {p.top_video && (
                    <div className="space-y-0.5 border-l-2 border-blue-600 pl-2 dark:border-blue-500">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Video top{p.top_video.views ? ` · ${compactNumber(p.top_video.views)} view` : ""}
                        </p>
                        <p className="break-words text-xs font-medium text-foreground">{p.top_video.title}</p>
                        <p className="text-xs text-muted-foreground">{p.top_video.meaning}</p>
                    </div>
                )}
                <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                    {p.links.map((l) => (
                        <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer"
                            className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:border-blue-600 hover:text-blue-600 dark:hover:border-blue-400 dark:hover:text-blue-400">
                            {l.label}
                        </a>
                    ))}
                </div>
            </div>
        </article>
    );
}
