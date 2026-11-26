"use client";

// 🧠 AI Chatbot → Kiến thức (25/11/2026): Knowledge Base mà AI được phép dùng. Sản phẩm đồng bộ từ POS (dữ liệu CHÍNH THỨC —
// chỉ bật / tắt ở đây); chính sách, dịch vụ, FAQ, thông tin page do admin bổ sung (sửa / xoá được, có lịch sử). AI chỉ trả
// lời từ các mục đang bật, đúng phạm vi (page → nước → chung). Khung "Chạy thử" chạy đủ quy trình AI trên hội thoại giả —
// không gửi gì cho khách. Nguồn: /api/talpha/ai-chatbot/knowledge, /sandbox.
import { useEffect, useMemo, useState } from "react";
import { Bot, History, Pencil, Plus, RefreshCw, Search, Send, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
    ActionButton, Card, DecisionBadge, Empty, ErrorBox, Loading, Notice, Pager, Pill, api, btnCls, btnPrimary, fmtTime, fmtUsd, inputCls,
    reasonLabel, useApi, useFlash,
} from "./shared";

const KIND_LABELS: Record<string, string> = {
    product: "Sản phẩm", service: "Dịch vụ", policy: "Chính sách", faq: "FAQ", page_info: "Thông tin page", pos_rule: "Luật POS (văn bản)", document: "Tài liệu",
};
const SOURCE_LABELS: Record<string, string> = { pos_sync: "POS (chính thức)", admin: "Admin bổ sung", learning: "FAQ đã duyệt" };

type Row = {
    id: number; scope: string; market: string | null; page_id: string | null; kind: string; source: string; is_official: boolean;
    title: string; content: string; keywords: string[]; enabled: boolean; disabled_reason: string | null; synced_at: string | null;
    valid_until: string | null; updated_at: string; updated_by: string | null; variants: { name: string; price: number | null; stock: number | null }[] | null; currency: string | null;
};
type Meta = { pages: { page_id: string; name: string; market: string | null }[]; markets: string[]; full: boolean };

export default function AiKnowledgeTab() {
    const [q, setQ] = useState(""), [qInput, setQInput] = useState("");
    const [kind, setKind] = useState(""), [source, setSource] = useState(""), [enabled, setEnabled] = useState("");
    const [page, setPage] = useState(1);
    const [editing, setEditing] = useState<Row | "new" | null>(null);
    const [historyId, setHistoryId] = useState<number | null>(null);
    const flash = useFlash();
    const url = useMemo(() => `/api/talpha/ai-chatbot/knowledge?${new URLSearchParams({
        page: String(page), size: "25", ...(q ? { q } : {}), ...(kind ? { kind } : {}), ...(source ? { source } : {}), ...(enabled ? { enabled } : {}),
    })}`, [page, q, kind, source, enabled]);
    const { data, error, loading, reload } = useApi<{ rows: Row[]; total: number; page: number; size: number; sync_running: boolean; can_write_global: boolean }>(url);
    const meta = useApi<Meta>("/api/talpha/ai-chatbot/knowledge?meta=1");

    const toggle = async (r: Row) => {
        try { await api("/api/talpha/ai-chatbot/knowledge", { json: { action: "toggle", id: r.id, enabled: !r.enabled } }); reload(); }
        catch (e) { flash.err(e); }
    };
    const remove = async (r: Row) => {
        if (!window.confirm(`Xoá mục "${r.title}"? (xoá mềm — lịch sử vẫn giữ)`)) return;
        try { await api(`/api/talpha/ai-chatbot/knowledge?id=${r.id}`, { method: "DELETE" }); flash.ok("Đã xoá"); reload(); }
        catch (e) { flash.err(e); }
    };
    const sync = async () => {
        try {
            const r = await api<{ results: { market: string; fetched: number; inserted: number; updated: number; disabled: number; error: string | null }[] }>(
                "/api/talpha/ai-chatbot/knowledge", { json: { action: "sync" } });
            flash.ok(`Đồng bộ POS xong: ${r.results.map((x) => `${x.market} ${x.fetched} SP (+${x.inserted} ~${x.updated} -${x.disabled})${x.error ? ` ⚠ ${x.error}` : ""}`).join(" · ") || "không shop nào"}`);
            reload();
        } catch (e) { flash.err(e); }
    };

    return (
        <div className="space-y-3">
            <Notice>AI <b>chỉ</b> trả lời bằng các mục đang bật dưới đây. Câu hỏi không có dữ liệu → AI không đoán, chuyển Sale và đưa vào <b>AI Learning</b>.
                Giá / tồn kho sản phẩm cũ hơn hạn trong Cài đặt AI thì AI không được báo giá.</Notice>
            <div className="flex flex-wrap items-center gap-2">
                <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); setQ(qInput.trim()); setPage(1); }}>
                    <input className={cn(inputCls, "w-56")} placeholder="Tìm (không dấu được)" value={qInput} onChange={(e) => setQInput(e.target.value)} />
                    <button type="submit" className={btnCls} aria-label="Tìm"><Search className="h-4 w-4" /></button>
                </form>
                <select className={cn(inputCls, "w-36")} value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }} aria-label="Loại">
                    <option value="">Mọi loại</option>{Object.entries(KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <select className={cn(inputCls, "w-40")} value={source} onChange={(e) => { setSource(e.target.value); setPage(1); }} aria-label="Nguồn">
                    <option value="">Mọi nguồn</option>{Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <select className={cn(inputCls, "w-32")} value={enabled} onChange={(e) => { setEnabled(e.target.value); setPage(1); }} aria-label="Trạng thái">
                    <option value="">Bật + tắt</option><option value="1">Đang bật</option><option value="0">Đang tắt</option>
                </select>
                <div className="ml-auto flex flex-wrap gap-2">
                    {data?.can_write_global && <ActionButton onClick={sync} disabled={data?.sync_running}><RefreshCw className="h-3.5 w-3.5" /> Đồng bộ sản phẩm POS</ActionButton>}
                    <button type="button" className={btnPrimary} onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> Thêm kiến thức</button>
                </div>
            </div>
            {flash.node}
            {error && <ErrorBox>{error}</ErrorBox>}
            {!data && !error && <Loading />}
            {data && (data.rows.length ? (
                <Card>
                    {loading && <p className="mb-2 text-xs text-muted-foreground">Đang tải…</p>}
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[820px] text-sm">
                            <thead className="text-left text-xs text-muted-foreground">
                                <tr><th className="py-1.5 pr-2">Tiêu đề</th><th className="pr-2">Loại · nguồn</th><th className="pr-2">Phạm vi</th><th className="pr-2">Cập nhật</th><th className="pr-2">Trạng thái</th><th /></tr>
                            </thead>
                            <tbody>
                                {data.rows.map((r) => (
                                    <tr key={r.id} className={cn("border-t border-border/50 align-top", !r.enabled && "opacity-60")}>
                                        <td className="max-w-[340px] py-1.5 pr-2">
                                            <div className="font-medium">{r.title}</div>
                                            <div className="line-clamp-2 text-xs text-muted-foreground">{r.content}</div>
                                            {r.variants && r.variants.length > 0 && (
                                                <div className="mt-0.5 text-[11px] text-muted-foreground">
                                                    {r.variants.slice(0, 4).map((v) => `${v.name}${v.price !== null ? ` ${v.price} ${r.currency || ""}` : ""}${v.stock !== null ? ` (${v.stock > 0 ? "còn" : "hết"})` : ""}`).join(" · ")}
                                                    {r.variants.length > 4 ? ` · +${r.variants.length - 4}` : ""}
                                                </div>
                                            )}
                                        </td>
                                        <td className="pr-2 text-xs">{KIND_LABELS[r.kind] || r.kind}<div className="text-muted-foreground">{SOURCE_LABELS[r.source] || r.source}</div></td>
                                        <td className="pr-2 text-xs">{r.scope === "global" ? "Chung" : r.scope === "market" ? `Nước ${r.market}` : `Page ${r.page_id}`}</td>
                                        <td className="whitespace-nowrap pr-2 text-xs text-muted-foreground">{fmtTime(r.updated_at)}{r.synced_at ? <div>POS: {fmtTime(r.synced_at)}</div> : null}</td>
                                        <td className="pr-2">
                                            <button type="button" onClick={() => toggle(r)} title="Bật / tắt">
                                                {r.enabled ? <Pill tone="green">Đang bật</Pill> : <Pill tone="slate">Tắt{r.disabled_reason === "not_in_pos" ? " · hết trên POS" : ""}</Pill>}
                                            </button>
                                            {r.valid_until && <div className="mt-0.5 text-[11px] text-muted-foreground">hạn {fmtTime(r.valid_until)}</div>}
                                        </td>
                                        <td className="whitespace-nowrap text-right">
                                            <button type="button" className="p-1 text-muted-foreground hover:text-foreground" title="Lịch sử" onClick={() => setHistoryId(r.id)}><History className="h-4 w-4" /></button>
                                            {r.source !== "pos_sync" && <>
                                                <button type="button" className="p-1 text-muted-foreground hover:text-foreground" title="Sửa" onClick={() => setEditing(r)}><Pencil className="h-4 w-4" /></button>
                                                <button type="button" className="p-1 text-muted-foreground hover:text-rose-500" title="Xoá" onClick={() => remove(r)}><Trash2 className="h-4 w-4" /></button>
                                            </>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <Pager page={data.page} size={data.size} total={data.total} onPage={setPage} />
                </Card>
            ) : <Empty>Chưa có mục kiến thức nào khớp. Bấm <b>Thêm kiến thức</b> hoặc <b>Đồng bộ sản phẩm POS</b>.</Empty>)}

            <Sandbox meta={meta.data} />
            {editing && <KbForm entry={editing === "new" ? null : editing} meta={meta.data} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); flash.ok("Đã lưu"); reload(); }} />}
            {historyId !== null && <KbHistory id={historyId} onClose={() => setHistoryId(null)} />}
        </div>
    );
}

function KbForm({ entry, meta, onClose, onSaved }: { entry: Row | null; meta: Meta | null; onClose: () => void; onSaved: () => void }) {
    const [f, setF] = useState(() => ({
        scope: entry?.scope || (meta?.full ? "global" : "market"), market: entry?.market || meta?.markets[0] || "", page_id: entry?.page_id || "",
        kind: entry?.kind || "faq", title: entry?.title || "", content: "", keywords: (entry?.keywords || []).join(", "),
        valid_until: entry?.valid_until ? entry.valid_until.slice(0, 10) : "", enabled: entry ? entry.enabled : true,
    }));
    const [loaded, setLoaded] = useState(!entry);
    const [err, setErr] = useState("");
    const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v }));
    // Danh sách chỉ có 240 ký tự đầu — mở sửa thì đọc đủ nội dung.
    useEffect(() => {
        if (!entry) return;
        let cancelled = false;
        api<any>(`/api/talpha/ai-chatbot/knowledge?id=${entry.id}`)
            .then((d) => { if (!cancelled) { setF((x) => ({ ...x, content: d.entry.content })); setLoaded(true); } })
            .catch((e) => { if (!cancelled) setErr(String(e?.message || e)); });
        return () => { cancelled = true; };
    }, [entry]);
    const save = async () => {
        setErr("");
        try {
            const body = { ...f, id: entry?.id, market: f.scope === "market" ? f.market : null, page_id: f.scope === "page" ? f.page_id : null, valid_until: f.valid_until || null };
            await api("/api/talpha/ai-chatbot/knowledge", { method: entry ? "PUT" : "POST", json: body });
            onSaved();
        } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    };
    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4" onClick={onClose}>
            <div className="w-full max-w-2xl rounded-xl bg-background p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
                <div className="mb-3 flex items-center"><h3 className="text-base font-semibold">{entry ? "Sửa kiến thức" : "Thêm kiến thức"}</h3>
                    <button type="button" className={cn(btnCls, "ml-auto")} onClick={onClose}><X className="h-4 w-4" /></button></div>
                {!loaded ? <Loading /> : (
                    <div className="grid gap-3 md:grid-cols-2">
                        <label className="text-sm">Loại
                            <select className={inputCls} value={f.kind} onChange={(e) => set("kind", e.target.value)}>
                                {Object.entries(KIND_LABELS).filter(([k]) => k !== "product").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                            </select></label>
                        <label className="text-sm">Phạm vi
                            <select className={inputCls} value={f.scope} onChange={(e) => set("scope", e.target.value)}>
                                {meta?.full && <option value="global">Chung — mọi page</option>}
                                <option value="market">Theo nước</option><option value="page">Một page</option>
                            </select></label>
                        {f.scope === "market" && <label className="text-sm">Nước
                            <select className={inputCls} value={f.market} onChange={(e) => set("market", e.target.value)}>
                                {(meta?.markets || []).map((m) => <option key={m} value={m}>{m}</option>)}</select></label>}
                        {f.scope === "page" && <label className="text-sm md:col-span-2">Page
                            <select className={inputCls} value={f.page_id} onChange={(e) => set("page_id", e.target.value)}>
                                <option value="">— chọn page —</option>
                                {(meta?.pages || []).map((p) => <option key={p.page_id} value={p.page_id}>{p.name}{p.market ? ` · ${p.market}` : ""}</option>)}</select></label>}
                        <label className="text-sm md:col-span-2">Tiêu đề / câu hỏi
                            <input className={inputCls} value={f.title} maxLength={300} onChange={(e) => set("title", e.target.value)} placeholder="VD: Chính sách đổi trả" /></label>
                        <label className="text-sm md:col-span-2">Nội dung (AI chỉ nói những gì viết ở đây)
                            <textarea className={cn(inputCls, "min-h-[160px]")} value={f.content} maxLength={8000} onChange={(e) => set("content", e.target.value)} /></label>
                        <label className="text-sm">Từ khoá (phẩy ngăn cách)
                            <input className={inputCls} value={f.keywords} onChange={(e) => set("keywords", e.target.value)} placeholder="doi tra, hoan tien, return" /></label>
                        <label className="text-sm">Hết hiệu lực (tuỳ chọn)
                            <input type="date" className={inputCls} value={f.valid_until} onChange={(e) => set("valid_until", e.target.value)} /></label>
                        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.enabled} onChange={(e) => set("enabled", e.target.checked)} /> Bật cho AI dùng</label>
                    </div>
                )}
                {err && <div className="mt-3"><ErrorBox>{err}</ErrorBox></div>}
                <div className="mt-4 flex justify-end gap-2"><button type="button" className={btnCls} onClick={onClose}>Huỷ</button>
                    <ActionButton primary onClick={save} disabled={!loaded}>Lưu</ActionButton></div>
            </div>
        </div>
    );
}

function KbHistory({ id, onClose }: { id: number; onClose: () => void }) {
    const { data, error } = useApi<any>(`/api/talpha/ai-chatbot/knowledge?id=${id}`);
    return (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
            <aside className="h-full w-full max-w-xl overflow-y-auto bg-background p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
                <div className="mb-3 flex items-center"><h3 className="text-base font-semibold">Nguồn + lịch sử cập nhật</h3>
                    <button type="button" className={cn(btnCls, "ml-auto")} onClick={onClose}><X className="h-4 w-4" /></button></div>
                {error && <ErrorBox>{error}</ErrorBox>}
                {!data && !error && <Loading />}
                {data && (
                    <div className="space-y-3 text-sm">
                        <div><div className="font-medium">{data.entry.title}</div>
                            <div className="text-xs text-muted-foreground">#{data.entry.id} · {SOURCE_LABELS[data.entry.source] || data.entry.source}{data.entry.sourceRef ? ` · ${data.entry.sourceRef}` : ""} · tạo {fmtTime(data.entry.createdAt)} bởi {data.entry.createdBy || "—"}</div></div>
                        <p className="whitespace-pre-wrap rounded-lg bg-muted/50 p-2 text-xs">{data.entry.content}</p>
                        <ol className="space-y-2">
                            {data.revisions.map((r: any) => (
                                <li key={r.id} className="rounded-lg border border-border p-2 text-xs">
                                    <div className="flex gap-2"><b>{r.action}</b><span className="text-muted-foreground">{fmtTime(r.at)} · {r.actor || "—"}</span></div>
                                    {r.after?.content && r.before?.content && r.after.content !== r.before.content && (
                                        <div className="mt-1 grid gap-1 md:grid-cols-2"><p className="whitespace-pre-wrap text-rose-600 line-through dark:text-rose-400">{r.before.content.slice(0, 400)}</p>
                                            <p className="whitespace-pre-wrap text-emerald-700 dark:text-emerald-400">{r.after.content.slice(0, 400)}</p></div>
                                    )}
                                </li>
                            ))}
                            {!data.revisions.length && <li className="text-xs text-muted-foreground">Chưa có lịch sử.</li>}
                        </ol>
                    </div>
                )}
            </aside>
        </div>
    );
}

/** Chạy thử AI trên hội thoại giả — không đọc / gửi Pancake, không ghi nhật ký. Có gọi AI thật (tính tiền). */
function Sandbox({ meta }: { meta: Meta | null }) {
    const [pageId, setPageId] = useState("");
    const [market, setMarket] = useState("");
    const [lines, setLines] = useState<{ from: "customer" | "page"; text: string }[]>([]);
    const [text, setText] = useState("");
    const [res, setRes] = useState<any>(null);
    const [err, setErr] = useState("");
    const run = async () => {
        const messages = [...lines, ...(text.trim() ? [{ from: "customer" as const, text: text.trim() }] : [])];
        if (!messages.length) return;
        setErr(""); setRes(null);
        try {
            const r = await api("/api/talpha/ai-chatbot/sandbox", { json: { page_id: pageId || undefined, market: market || meta?.markets[0], messages } });
            setRes(r); setLines(messages); setText("");
        } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    };
    return (
        <Card title={<span className="flex items-center gap-2"><Bot className="h-4 w-4 text-orange-500" /> Chạy thử AI (không gửi cho khách)</span>}
            actions={lines.length ? <button type="button" className={btnCls} onClick={() => { setLines([]); setRes(null); }}>Xoá hội thoại</button> : null}>
            <div className="mb-2 flex flex-wrap gap-2">
                <select className={cn(inputCls, "w-64")} value={pageId} onChange={(e) => setPageId(e.target.value)} aria-label="Page">
                    <option value="">— không chọn page (dùng nước) —</option>
                    {(meta?.pages || []).map((p) => <option key={p.page_id} value={p.page_id}>{p.name}{p.market ? ` · ${p.market}` : ""}</option>)}
                </select>
                {!pageId && <select className={cn(inputCls, "w-28")} value={market} onChange={(e) => setMarket(e.target.value)} aria-label="Nước">
                    {(meta?.markets || []).map((m) => <option key={m} value={m}>{m}</option>)}</select>}
            </div>
            {lines.length > 0 && (
                <div className="mb-2 space-y-1 rounded-lg bg-muted/40 p-2 text-sm">
                    {lines.map((l, i) => <div key={i} className={l.from === "customer" ? "" : "text-right text-muted-foreground"}>{l.from === "customer" ? "👤 " : "🏪 "}{l.text}</div>)}
                </div>
            )}
            <div className="flex gap-2">
                <input className={inputCls} placeholder="Gõ câu khách hỏi, vd: kem này dùng thế nào?" value={text} onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void run(); } }} />
                <ActionButton primary onClick={run}><Send className="h-4 w-4" /> Chạy</ActionButton>
            </div>
            {err && <div className="mt-2"><ErrorBox>{err}</ErrorBox></div>}
            {res && (
                <div className="mt-3 space-y-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">{res.decision ? <DecisionBadge decision={res.decision} /> : <Pill>{res.outcome}</Pill>}
                        <span className="text-muted-foreground">{reasonLabel(res.reason)}</span>
                        <span className="ml-auto text-xs text-muted-foreground">tin cậy {res.confidence ?? "—"} · {res.tokens} token · {fmtUsd(res.cost_usd)} · kho {res.kb_size} mục</span></div>
                    {res.answer && <p className="whitespace-pre-wrap rounded-lg border border-emerald-300 bg-emerald-50 p-2 dark:border-emerald-500/30 dark:bg-emerald-500/10">{res.answer}</p>}
                    {res.retrieved?.length > 0 && <p className="text-xs text-muted-foreground">Dữ liệu dùng: {res.retrieved.map((x: any) => `#${x.id} ${x.title} (${x.score})`).join(" · ")}</p>}
                    {res.learning?.length > 0 && <p className="text-xs text-amber-700 dark:text-amber-400">Sẽ vào AI Learning: {res.learning.join(" · ")}</p>}
                    <details><summary className="cursor-pointer text-xs text-muted-foreground">Các bước ({res.trace?.length || 0})</summary>
                        <ol className="mt-1 space-y-0.5 text-xs">{(res.trace || []).map((s: any, i: number) => <li key={i}>{s.ok ? "✓" : "✗"} <b>{s.step}</b>{s.detail ? ` — ${s.detail}` : ""}</li>)}</ol></details>
                </div>
            )}
        </Card>
    );
}
