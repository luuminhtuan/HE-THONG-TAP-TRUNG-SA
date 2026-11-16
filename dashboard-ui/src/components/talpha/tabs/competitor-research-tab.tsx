"use client";

// ═══════════════════════════════════════════════════════════════════
// Khách hàng → Soi đối thủ (15/11/2026). Kết quả soi nhóm bán khác — bản đầu: Team 5 KIOT Taiwan
// (kho Pancake POS + 24 kênh TikTok + Meta Ad Library Đài Loan, soi 12/11/2026). Số THAM CHIẾU,
// không phải số bán hàng và không theo bộ chọn ngày — mỗi lần soi là một bản trong
// config/competitor_research.json. Thư viện sản phẩm có ảnh + link spy để đội vào xem tiếp.
// Các khung con ở tabs/competitor-research/.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { cn } from "@/lib/utils";
import type { CompetitorResearchFile, ResearchSnapshot } from "@/lib/talpha/competitor-research";
import { CARD, TITLE, MARKET_NAMES, vnDate, type Filter } from "./competitor-research/shared";
import { Overview, TopLast7Days, TopSellers, StockSignals } from "./competitor-research/stock-panels";
import { ProductLibrary } from "./competitor-research/product-library";
import { TikTokChannels, AdFormulas, Audiences, FacebookPanel, Playbook } from "./competitor-research/channel-panels";

type Payload = CompetitorResearchFile & { seen_all?: boolean };

export default function CompetitorResearchTab() {
    const [data, setData] = useState<Payload | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [selected, setSelected] = useState(0);
    const [filter, setFilter] = useState<Filter>("all");

    useEffect(() => {
        let cancelled = false;
        fetch("/api/talpha/competitor-research")
            .then(async (r) => {
                const d = await r.json();
                if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
                return d as Payload;
            })
            .then((d) => { if (!cancelled) setData(d); })
            .catch((e) => { if (!cancelled) setError(String(e?.message || e)); });
        return () => { cancelled = true; };
    }, []);

    if (error) {
        return (
            <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                Không đọc được kết quả soi: {error}
            </div>
        );
    }
    if (!data) return <TabSkeleton cards={3} rows={6} />;

    const snap: ResearchSnapshot | undefined = data.snapshots[selected] ?? data.snapshots[0];
    if (!snap) {
        return <div className={cn(CARD, "text-sm text-muted-foreground")}>Chưa có bản soi nào cho thị trường của team này.</div>;
    }

    return (
        <div className="space-y-6">
            {/* ── Đầu trang: soi ai, ngày nào, cách soi ── */}
            <div className={cn(CARD, "space-y-2")}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <h2 className="text-base font-semibold text-foreground">Soi {snap.source}</h2>
                        <p className="text-xs text-muted-foreground">
                            Soi ngày {vnDate(snap.date)} · thị trường {MARKET_NAMES[snap.market] || snap.market} · số tham chiếu, không theo bộ chọn ngày
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {data.snapshots.length > 1 && (
                            <select
                                id="competitor-research-snapshot"
                                value={selected}
                                onChange={(e) => { setSelected(Number(e.target.value)); setFilter("all"); }}
                                className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                                aria-label="Chọn bản soi"
                            >
                                {data.snapshots.map((s, i) => <option key={`${s.source}-${s.date}`} value={i}>{s.source} · {vnDate(s.date)}</option>)}
                            </select>
                        )}
                        {snap.report_url && (
                            <a href={snap.report_url} target="_blank" rel="noopener noreferrer"
                                title="Trang riêng của Sỹ Anh — người khác cần được chia sẻ mới mở được"
                                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted">
                                Báo cáo đầy đủ <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                        )}
                    </div>
                </div>
                <p className="max-w-4xl text-xs leading-relaxed text-muted-foreground">{snap.method}</p>
                {snap.follow_up && <p className="max-w-4xl text-xs leading-relaxed text-muted-foreground">{snap.follow_up}</p>}
            </div>

            {snap.summary.length > 0 && (
                <div className={CARD}>
                    <h3 className={cn(TITLE, "mb-2")}>Đọc nhanh</h3>
                    <ul className="max-w-4xl list-disc space-y-1.5 pl-5 text-sm text-foreground">
                        {snap.summary.map((t, i) => <li key={i}>{t}</li>)}
                    </ul>
                </div>
            )}

            <Overview s={snap} />

            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                <TopLast7Days products={snap.products} />
                <TopSellers products={snap.products} />
            </div>

            <StockSignals s={snap} />

            <ProductLibrary products={snap.products} filter={filter} setFilter={setFilter} />

            <TikTokChannels s={snap} />

            <AdFormulas s={snap} />

            <Audiences s={snap} />

            <FacebookPanel s={snap} />

            <Playbook s={snap} />

            <div className={CARD}>
                <h3 className={cn(TITLE, "mb-2")}>Giới hạn của số liệu</h3>
                <ul className="max-w-4xl list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
                    {snap.limitations.map((g, i) => <li key={i}>{g}</li>)}
                </ul>
            </div>
        </div>
    );
}
