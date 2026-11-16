// Soi đối thủ — kênh bán + quảng cáo của nhóm kia và phần áp dụng cho công ty: kênh TikTok, công thức
// quảng cáo, tệp khách họ nhắm, Facebook / Ad Library, sản phẩm nên test + kế hoạch + hook mẫu.
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { compactNumber, type ResearchSnapshot } from "@/lib/talpha/competitor-research";
import { CARD, TITLE, LINK_CLS, fmtNum, SamplePhraseView } from "./shared";

export function TikTokChannels({ s }: { s: ResearchSnapshot }) {
    const rows = s.tiktok_channels;
    const max = Math.max(1, ...rows.map((k) => k.total_views));
    return (
        <div className={CARD}>
            <h3 className={TITLE}>Kênh TikTok: tổng lượt xem lúc soi</h3>
            <p className="mb-3 mt-1 max-w-4xl text-xs text-muted-foreground">
                Follower chỉ vài trăm đến vài nghìn mà view hàng triệu: lượt xem chủ yếu đến từ quảng cáo. Lần soi sau, video tăng view mạnh là video đang được đổ tiền.
            </p>
            <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                    <thead>
                        <tr className="border-b border-border text-left text-xs text-muted-foreground">
                            <th className="py-1.5 pr-3 font-medium">Kênh</th>
                            <th className="py-1.5 pr-3 font-medium">Sản phẩm</th>
                            <th className="w-[28%] py-1.5 pr-3 font-medium">Tổng view</th>
                            <th className="py-1.5 pr-3 text-right font-medium">Video</th>
                            <th className="py-1.5 pr-3 text-right font-medium">Follower</th>
                            <th className="min-w-[16rem] py-1.5 font-medium">Video top</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((k) => (
                            <tr key={k.user} className="border-b border-border/60 align-top last:border-0">
                                <td className="py-2 pr-3">
                                    <a href={`https://www.tiktok.com/@${k.user}`} target="_blank" rel="noopener noreferrer" className={LINK_CLS}>@{k.user}</a>
                                    <p className="text-[11px] text-muted-foreground">{k.audience}</p>
                                </td>
                                <td className="py-2 pr-3 text-foreground">{k.product}</td>
                                <td className="py-2 pr-3">
                                    <div className="flex items-center gap-2">
                                        <div className="h-2.5 flex-1 overflow-hidden rounded bg-muted">
                                            <div className="h-full rounded bg-blue-600 dark:bg-blue-500" style={{ width: `${Math.max(2, (k.total_views / max) * 100)}%` }} />
                                        </div>
                                        <span className="w-12 text-right text-xs font-semibold tabular-nums text-foreground">{compactNumber(k.total_views)}</span>
                                    </div>
                                </td>
                                <td className="py-2 pr-3 text-right tabular-nums">{k.videos}</td>
                                <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{k.followers === null ? "–" : fmtNum(k.followers)}</td>
                                <td className="py-2">
                                    <a href={`https://www.tiktok.com/@${k.user}/video/${k.top_video.id}`} target="_blank" rel="noopener noreferrer" className={cn(LINK_CLS, "text-xs font-medium")}>
                                        {compactNumber(k.top_video.views)} · {k.top_video.title}
                                    </a>
                                    <p className="text-[11px] text-muted-foreground">{k.top_video.meaning}</p>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export function AdFormulas({ s }: { s: ResearchSnapshot }) {
    return (
        <section className="space-y-3">
            <h3 className="text-base font-semibold text-foreground">Công thức quảng cáo của họ</h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {s.ad_formulas.map((c) => (
                    <div key={c.label} className={cn(CARD, "space-y-2")}>
                        <span className="inline-block rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">{c.label}</span>
                        <h4 className={TITLE}>{c.title}</h4>
                        <p className="text-sm leading-relaxed text-muted-foreground">{c.body}</p>
                        {c.sample_phrases && c.sample_phrases.map((x) => <SamplePhraseView key={x.text} text={x.text} meaning={x.meaning} />)}
                    </div>
                ))}
            </div>
        </section>
    );
}

export function Audiences({ s }: { s: ResearchSnapshot }) {
    return (
        <section className="space-y-3">
            <h3 className="text-base font-semibold text-foreground">Họ bán cho ai</h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                {s.audiences.map((t) => (
                    <div key={t.name} className={cn(CARD, "space-y-2")}>
                        <span className="inline-block rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground">{t.name}</span>
                        <h4 className={TITLE}>{t.title}</h4>
                        <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                            {t.examples.map((v) => <li key={v}>{v}</li>)}
                        </ul>
                        <p className="rounded-md border border-border bg-muted/40 px-2 py-1 font-mono text-xs text-foreground">{t.sample_phrase}</p>
                    </div>
                ))}
            </div>
        </section>
    );
}

export function FacebookPanel({ s }: { s: ResearchSnapshot }) {
    return (
        <section className="space-y-3">
            <div>
                <h3 className="text-base font-semibold text-foreground">Facebook</h3>
                <p className="mt-1 max-w-4xl text-xs text-muted-foreground">{s.facebook.note}</p>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {s.facebook.items.map((m) => (
                    <div key={m.title} className={cn(CARD, "space-y-2")}>
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-block rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground">{m.label}</span>
                            {m.ad_count !== null && <span className="text-xs tabular-nums text-muted-foreground">{m.ad_count} ads đang chạy lúc soi</span>}
                        </div>
                        <h4 className={TITLE}>{m.title}</h4>
                        <p className="text-sm leading-relaxed text-muted-foreground">{m.body}</p>
                        <a href={m.link} target="_blank" rel="noopener noreferrer" className={cn(LINK_CLS, "inline-flex items-center gap-1 text-sm")}>
                            Xem trên Ad Library <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                    </div>
                ))}
            </div>
        </section>
    );
}

export function Playbook({ s }: { s: ResearchSnapshot }) {
    const a = s.playbook;
    return (
        <section className="space-y-3">
            <div>
                <h3 className="text-base font-semibold text-foreground">Áp dụng cho công ty</h3>
                <p className="mt-1 max-w-4xl text-xs text-muted-foreground">{a.note}</p>
            </div>
            <div className={CARD}>
                <h4 className={cn(TITLE, "mb-2")}>Sản phẩm nên test</h4>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                        <thead>
                            <tr className="border-b border-border text-left text-xs text-muted-foreground">
                                <th className="py-1.5 pr-3 font-medium">Sản phẩm</th>
                                <th className="py-1.5 pr-3 font-medium">Vì sao</th>
                                <th className="py-1.5 pr-3 font-medium">Tệp hợp nhất</th>
                                <th className="py-1.5 font-medium">Lưu ý</th>
                            </tr>
                        </thead>
                        <tbody>
                            {a.test_list.map((d) => (
                                <tr key={d.product} className="border-b border-border/60 align-top last:border-0">
                                    <td className="py-2 pr-3 font-medium text-foreground">{d.product}</td>
                                    <td className="py-2 pr-3 text-muted-foreground">{d.why}</td>
                                    <td className="py-2 pr-3 text-foreground">{d.audience}</td>
                                    <td className="py-2 text-muted-foreground">{d.caveat}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                {a.plan.map((k) => (
                    <div key={k.when} className={cn(CARD, "space-y-2")}>
                        <span className="inline-block rounded-md bg-blue-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">{k.when}</span>
                        <h4 className={TITLE}>{k.title}</h4>
                        <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                            {k.tasks.map((v) => <li key={v}>{v}</li>)}
                        </ul>
                    </div>
                ))}
            </div>
            <div className={CARD}>
                <h4 className={TITLE}>Hook mẫu cho trang sức bán cho người Phi</h4>
                <p className="mb-3 mt-1 text-xs text-muted-foreground">Nhờ người Phi đọc lại câu chữ trước khi chạy.</p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {a.sample_hooks.map((h) => <SamplePhraseView key={h.text} text={h.text} meaning={h.meaning} />)}
                </div>
            </div>
        </section>
    );
}
