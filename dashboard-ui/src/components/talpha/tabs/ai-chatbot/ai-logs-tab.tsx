"use client";

// 🧠 AI Chatbot → Nhật ký AI (25/11/2026): mỗi lượt khách AI đã xét — câu hỏi, phân loại, dữ liệu truy xuất, câu trả lời,
// provider / model, token, chi phí, độ tin cậy, thời gian, quyết định + các bước. Lọc theo quyết định, lý do, page, hội thoại,
// chữ. Link ?conversation_id= / ?page_id= (từ Telegram, Tổng quan) mở đúng hội thoại. Nguồn: /api/talpha/ai-chatbot/logs.
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, PauseCircle, PlayCircle, RefreshCw, Search, X, XCircle, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import {
    ActionButton, Card, DecisionBadge, Empty, ErrorBox, Loading, Pager, api, btnCls, fmtNum, fmtTime, fmtUsd, inputCls, reasonLabel, useApi, useFlash, ymd,
} from "./shared";

type Row = {
    id: number; created_at: string; page_id: string; page_name: string; market: string | null; conversation_id: string;
    customer_text: string; language: string | null; intent: string | null; decision: string; reason: string; answer: string | null;
    provider: string | null; model: string | null; input_tokens: number; output_tokens: number; cost_usd: number; confidence: number | null;
    duration_ms: number | null; mode: string | null; tag_status: string | null;
};

export default function AiLogsTab({ dateRange }: { dateRange?: { from: Date; to: Date } }) {
    const sp = useSearchParams();
    const [decision, setDecision] = useState("");
    const [q, setQ] = useState("");
    const [qInput, setQInput] = useState("");
    const [page, setPage] = useState(1);
    const [conv, setConv] = useState(sp.get("conversation_id") || "");
    const [pageId, setPageId] = useState(sp.get("page_id") || "");
    const [openId, setOpenId] = useState<number | null>(null);
    // Mở theo hội thoại (link Telegram) thì bỏ lọc ngày — tìm đúng hội thoại dù cũ.
    const from = conv ? undefined : ymd(dateRange?.from), to = conv ? undefined : ymd(dateRange?.to);
    const url = useMemo(() => `/api/talpha/ai-chatbot/logs?${new URLSearchParams({
        page: String(page), size: "25",
        ...(decision ? { decision } : {}), ...(q ? { q } : {}), ...(conv ? { conversation_id: conv } : {}),
        ...(pageId ? { page_id: pageId } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}),
    })}`, [page, decision, q, conv, pageId, from, to]);
    const { data, error, loading, reload } = useApi<{ rows: Row[]; total: number; page: number; size: number }>(url);

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <select className={cn(inputCls, "w-40")} value={decision} onChange={(e) => { setDecision(e.target.value); setPage(1); }} aria-label="Quyết định">
                    <option value="">Mọi quyết định</option>
                    <option value="answered">Đã trả lời</option>
                    <option value="shadow">Thử (không gửi)</option>
                    <option value="escalated">Chuyển Sale</option>
                    <option value="skipped">Bỏ qua</option>
                    <option value="error">Lỗi</option>
                </select>
                <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); setQ(qInput.trim()); setPage(1); }}>
                    <input className={cn(inputCls, "w-56")} placeholder="Tìm trong câu hỏi / trả lời" value={qInput} onChange={(e) => setQInput(e.target.value)} />
                    <button type="submit" className={btnCls} aria-label="Tìm"><Search className="h-4 w-4" /></button>
                </form>
                {(conv || pageId) && (
                    <button type="button" className={btnCls} onClick={() => { setConv(""); setPageId(""); setPage(1); }}>
                        <X className="h-3.5 w-3.5" /> {conv ? `Hội thoại ${conv.slice(0, 18)}…` : `Page ${pageId}`}
                    </button>
                )}
                <button type="button" className={cn(btnCls, "ml-auto")} onClick={reload}><RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Tải lại</button>
            </div>
            {error && <ErrorBox>{error}</ErrorBox>}
            {!data && !error && <Loading />}
            {data && (data.rows.length ? (
                <Card>
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[860px] text-sm">
                            <thead className="text-left text-xs text-muted-foreground">
                                <tr><th className="py-1.5 pr-2">Lúc</th><th className="pr-2">Page</th><th className="pr-2">Khách hỏi</th><th className="pr-2">Ý định</th>
                                    <th className="pr-2">Quyết định</th><th className="pr-2">Câu trả lời</th><th className="text-right">Tin cậy</th><th className="text-right">Chi phí</th></tr>
                            </thead>
                            <tbody>
                                {data.rows.map((r) => (
                                    <tr key={r.id} onClick={() => setOpenId(r.id)} className="cursor-pointer border-t border-border/50 align-top hover:bg-muted/50">
                                        <td className="whitespace-nowrap py-1.5 pr-2 text-xs text-muted-foreground">{fmtTime(r.created_at)}</td>
                                        <td className="max-w-[140px] truncate pr-2 text-xs">{r.page_name}{r.market ? ` · ${r.market}` : ""}</td>
                                        <td className="max-w-[260px] pr-2"><span className="line-clamp-2">{r.customer_text}</span></td>
                                        <td className="pr-2 text-xs">{r.intent || "—"}{r.language ? ` · ${r.language}` : ""}</td>
                                        <td className="pr-2"><DecisionBadge decision={r.decision} /><div className="mt-0.5 text-[11px] text-muted-foreground">{reasonLabel(r.reason)}</div></td>
                                        <td className="max-w-[260px] pr-2 text-xs text-muted-foreground"><span className="line-clamp-2">{r.answer || "—"}</span></td>
                                        <td className="text-right tabular-nums">{r.confidence === null ? "—" : r.confidence.toFixed(2)}</td>
                                        <td className="text-right tabular-nums text-xs">{r.cost_usd ? fmtUsd(r.cost_usd) : "—"}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <Pager page={data.page} size={data.size} total={data.total} onPage={setPage} />
                </Card>
            ) : <Empty>Chưa có lượt nào khớp bộ lọc.</Empty>)}
            {openId !== null && <RunDetail id={openId} onClose={() => setOpenId(null)} />}
        </div>
    );
}

function RunDetail({ id, onClose }: { id: number; onClose: () => void }) {
    const { data, error } = useApi<{ run: any }>(`/api/talpha/ai-chatbot/logs?id=${id}`);
    const flash = useFlash();
    const r = data?.run;
    const act = async (action: string, extra: Record<string, unknown> = {}) => {
        try {
            await api("/api/talpha/ai-chatbot/conversation", { json: { action, page_id: r.page_id, conversation_id: r.conversation_id, ...extra } });
            flash.ok(action === "pause" ? "Đã tạm dừng AI ở hội thoại này 24 giờ" : action === "resume" ? "Đã bật lại AI ở hội thoại này" : "Đã đưa vào hàng chờ xử lý");
        } catch (e) { flash.err(e); }
    };
    return (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
            <aside className="h-full w-full max-w-2xl overflow-y-auto bg-background p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
                <div className="mb-3 flex items-center gap-2">
                    <h3 className="text-base font-semibold">Lượt #{id}</h3>
                    <button type="button" className={cn(btnCls, "ml-auto")} onClick={onClose}><X className="h-4 w-4" /> Đóng</button>
                </div>
                {error && <ErrorBox>{error}</ErrorBox>}
                {!r && !error && <Loading />}
                {r && (
                    <div className="space-y-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                            <DecisionBadge decision={r.decision} />
                            <span className="text-muted-foreground">{reasonLabel(r.reason)}</span>
                            <span className="ml-auto text-xs text-muted-foreground">{fmtTime(r.created_at)} · {r.mode || "—"}</span>
                        </div>
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs md:grid-cols-3">
                            <div><dt className="text-muted-foreground">Page</dt><dd>{r.page_name} {r.market ? `· ${r.market}` : ""}</dd></div>
                            <div><dt className="text-muted-foreground">Hội thoại</dt><dd className="break-all">{r.conversation_id}</dd></div>
                            <div><dt className="text-muted-foreground">Ngôn ngữ · ý định</dt><dd>{r.language || "—"} · {r.intent || "—"}</dd></div>
                            <div><dt className="text-muted-foreground">Provider · model</dt><dd>{r.provider || "—"} · {r.model || "—"}</dd></div>
                            <div><dt className="text-muted-foreground">Token · chi phí</dt><dd>{fmtNum(r.input_tokens)} + {fmtNum(r.output_tokens)} · {fmtUsd(r.cost_usd)}</dd></div>
                            <div><dt className="text-muted-foreground">Tin cậy · thời gian</dt><dd>{r.confidence ?? "—"} · {r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : "—"}</dd></div>
                            <div><dt className="text-muted-foreground">Tag</dt><dd>{r.tag_status || "—"}</dd></div>
                            <div><dt className="text-muted-foreground">Tin đã gửi</dt><dd className="break-all">{r.sent_message_id || "—"}</dd></div>
                        </dl>
                        <section><h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Khách hỏi (đã che SĐT / email)</h4>
                            <p className="whitespace-pre-wrap rounded-lg bg-muted/50 p-2">{r.customer_text}</p></section>
                        <section><h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Câu trả lời {r.decision === "answered" ? "(đã gửi)" : "(nháp — không gửi)"}</h4>
                            <p className="whitespace-pre-wrap rounded-lg bg-muted/50 p-2">{r.answer || "—"}</p></section>
                        <section><h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Dữ liệu truy xuất</h4>
                            {(r.retrieved || []).length ? (
                                <ul className="space-y-0.5 text-xs">{r.retrieved.map((x: any) => (
                                    <li key={x.id}>#{x.id} {x.title} — điểm {x.score}{x.stale ? " · giá/tồn kho CŨ" : ""}</li>
                                ))}</ul>
                            ) : <p className="text-xs text-muted-foreground">Không có</p>}</section>
                        <section><h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Các bước</h4>
                            <ol className="space-y-0.5 text-xs">{(r.trace || []).map((s: any, i: number) => (
                                <li key={i} className="flex items-start gap-1.5">
                                    {s.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />}
                                    <span><b>{s.step}</b>{s.detail ? ` — ${s.detail}` : ""}</span>
                                </li>
                            ))}</ol></section>
                        {r.classification && (
                            <details><summary className="cursor-pointer text-xs text-muted-foreground">Kết quả phân loại (JSON)</summary>
                                <pre className="mt-1 max-h-64 overflow-auto rounded-lg bg-muted/50 p-2 text-[11px]">{JSON.stringify(r.classification, null, 2)}</pre></details>
                        )}
                        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                            <ActionButton onClick={() => act("pause", { minutes: 1440 })}><PauseCircle className="h-4 w-4" /> Sale tiếp nhận (dừng AI 24h)</ActionButton>
                            <ActionButton onClick={() => act("resume")}><PlayCircle className="h-4 w-4" /> Bật lại AI</ActionButton>
                            <ActionButton onClick={() => act("process_now")}><Zap className="h-4 w-4" /> Xét lại ngay</ActionButton>
                        </div>
                        {flash.node}
                    </div>
                )}
            </aside>
        </div>
    );
}
