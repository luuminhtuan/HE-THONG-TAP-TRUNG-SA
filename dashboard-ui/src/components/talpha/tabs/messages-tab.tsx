"use client";

// ═══════════════════════════════════════════════════════════════════
// Tin nhắn (17/11/2026) — hộp thư Pancake CHỈ ĐỌC + gán người phụ trách / tag nội bộ để tính KPI. Máy chủ kéo hội thoại
// + tin về database 5 phút một lần (sync/talpha/pancake_inbox_sync.py); tab đọc / ghi qua /api/talpha/messages.
// Leader thấy page thuộc nước của team, giám đốc thấy hết. Trả lời khách vẫn làm trong Pancake.
// ═══════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageSquare, Phone, Search, UserRound } from "lucide-react";
import TabSkeleton from "@/components/ui/tab-skeleton";
import SearchableSelect from "@/components/ui/searchable-select";
import { cn } from "@/lib/utils";
import type { InboxConversation, InboxLabel, InboxMessage, InboxPage } from "@/lib/talpha/pancake-inbox";
import { assignableFor, TAG_COLORS, type InboxUser } from "@/lib/talpha/inbox-rules";
import ThreadView, { LabelChip, vnTime } from "./messages/thread-view";

const API = "/api/talpha/messages";
const CARD = "rounded-xl border border-border bg-card shadow-sm";
const REFRESH_MS = 60_000;          // dữ liệu chỉ đổi 5 phút một lần — đọc lại mỗi phút là đủ

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
    const r = await fetch(url, { cache: "no-store", ...init });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j as T;
}
const postJson = <T,>(body: unknown) => getJson<T>(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

type Meta = { pages: InboxPage[]; tags: InboxLabel[]; users: InboxUser[] };

export default function MessagesTab() {
    const [meta, setMeta] = useState<Meta | null>(null);
    const [error, setError] = useState("");
    const [market, setMarket] = useState("");
    const [pageId, setPageId] = useState("");
    const [label, setLabel] = useState("");
    const [assignee, setAssignee] = useState("");
    const [q, setQ] = useState("");
    const [qDebounced, setQDebounced] = useState("");
    const [rows, setRows] = useState<InboxConversation[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [loadingList, setLoadingList] = useState(false);
    const [selected, setSelected] = useState<InboxConversation | null>(null);
    const [thread, setThread] = useState<{ messages: InboxMessage[]; loading: boolean; error: string }>({ messages: [], loading: false, error: "" });
    const [busy, setBusy] = useState(false);

    useEffect(() => { const t = setTimeout(() => setQDebounced(q.trim()), 350); return () => clearTimeout(t); }, [q]);

    const loadMeta = useCallback(() => {
        getJson<Meta>(API).then(setMeta).catch((e) => setError(String(e.message || e)));
    }, []);
    useEffect(() => { loadMeta(); const t = setInterval(loadMeta, REFRESH_MS); return () => clearInterval(t); }, [loadMeta]);

    const listUrl = useCallback((before?: string) => {
        const sp = new URLSearchParams({ list: "1" });
        for (const [k, v] of [["market", market], ["page_id", pageId], ["label", label], ["assignee", assignee], ["q", qDebounced], ["before", before || ""]]) {
            if (v) sp.set(k, v);
        }
        return `${API}?${sp}`;
    }, [market, pageId, label, assignee, qDebounced]);

    // Lượt đầu + mỗi phút đọc lại trang đầu.
    useEffect(() => {
        let cancelled = false;
        const load = () => {
            setLoadingList(true);
            getJson<{ conversations: InboxConversation[] }>(listUrl())
                .then((d) => { if (!cancelled) { setRows(d.conversations); setHasMore(d.conversations.length >= 50); } })
                .catch((e) => { if (!cancelled) setError(String(e.message || e)); })
                .finally(() => { if (!cancelled) setLoadingList(false); });
        };
        load();
        const t = setInterval(load, REFRESH_MS);
        return () => { cancelled = true; clearInterval(t); };
    }, [listUrl]);

    const loadMore = () => {
        const last = rows[rows.length - 1];
        if (!last?.updated_at) return;
        setLoadingList(true);
        getJson<{ conversations: InboxConversation[] }>(listUrl(last.updated_at))
            .then((d) => { setRows((r) => [...r, ...d.conversations]); setHasMore(d.conversations.length >= 50); })
            .catch((e) => setError(String(e.message || e)))
            .finally(() => setLoadingList(false));
    };

    const selKey = selected ? `${selected.page_id}|${selected.conversation_id}` : "";
    const loadThread = useCallback((c: { page_id: string; conversation_id: string }, first: boolean) => {
        if (first) setThread({ messages: [], loading: true, error: "" });
        const sp = new URLSearchParams({ page_id: c.page_id, conversation_id: c.conversation_id });
        return getJson<{ conversation: InboxConversation; messages: InboxMessage[] }>(`${API}?${sp}`)
            .then((d) => {
                setThread({ messages: d.messages, loading: false, error: "" });
                setSelected(d.conversation);
                setRows((rs) => rs.map((r) => (r.page_id === d.conversation.page_id && r.conversation_id === d.conversation.conversation_id ? d.conversation : r)));
            })
            .catch((e) => setThread((t) => ({ ...t, loading: false, error: String(e.message || e) })));
    }, []);
    useEffect(() => {
        if (!selKey) return;
        const [page_id, conversation_id] = selKey.split("|");
        loadThread({ page_id, conversation_id }, true);
        const t = setInterval(() => loadThread({ page_id, conversation_id }, false), REFRESH_MS);
        return () => clearInterval(t);
    }, [selKey, loadThread]);

    // Gán / gắn tag rồi đọc lại hội thoại (cập nhật cả dòng trong danh sách).
    const act = async (body: Record<string, unknown>) => {
        if (!selected) return;
        setBusy(true);
        try {
            await postJson({ ...body, page_id: selected.page_id, conversation_id: selected.conversation_id });
            await loadThread(selected, false);
        } catch (e) { setThread((t) => ({ ...t, error: String((e as Error).message || e) })); }
        finally { setBusy(false); }
    };
    const createAndTag = async (name: string) => {
        setBusy(true);
        try {
            const color = TAG_COLORS[(meta?.tags.length || 0) % TAG_COLORS.length];
            const { tag } = await postJson<{ tag: InboxLabel }>({ action: "create_tag", name, color });
            setMeta((m) => (m && !m.tags.some((t) => t.id === tag.id) ? { ...m, tags: [...m.tags, tag].sort((x, y) => x.name.localeCompare(y.name, "vi")) } : m));
            if (selected) await postJson({ action: "tag", page_id: selected.page_id, conversation_id: selected.conversation_id, tag_id: tag.id, on: true });
            if (selected) await loadThread(selected, false);
        } catch (e) { setThread((t) => ({ ...t, error: String((e as Error).message || e) })); }
        finally { setBusy(false); }
    };

    const pages = useMemo(() => meta?.pages ?? [], [meta]);
    const markets = useMemo(() => [...new Set(pages.map((p) => p.market).filter(Boolean) as string[])].sort(), [pages]);
    const pageOptions = useMemo(() => pages.filter((p) => !market || p.market === market)
        .map((p) => ({ value: p.page_id, label: p.name, hint: p.market || "—" })), [pages, market]);
    const lastSync = useMemo(() => pages.map((p) => p.last_sync_at).filter(Boolean).sort().pop() || null, [pages]);
    const broken = useMemo(() => pages.filter((p) => p.last_error), [pages]);

    if (error && !meta) {
        return <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">Không đọc được hộp thư: {error}</div>;
    }
    if (!meta) return <TabSkeleton cards={1} rows={8} />;

    return (
        <div className="space-y-3">
            <div className={cn(CARD, "space-y-3 p-4")}>
                <div>
                    <h2 className="flex items-center gap-2 text-base font-semibold text-foreground"><MessageSquare className="h-4 w-4" />Tin nhắn Pancake</h2>
                    <p className="text-xs text-muted-foreground">
                        Chỉ xem tin · máy chủ cập nhật 5 phút một lần{lastSync ? ` (lần gần nhất ${vnTime(lastSync)})` : ""} · giữ 6 tháng ·
                        gán người phụ trách + tag để tính KPI · trả lời khách vẫn trong Pancake
                    </p>
                </div>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                    <SearchableSelect ariaLabel="Nước" placeholder="Mọi nước" value={market}
                        options={[{ value: "", label: "Mọi nước" }, ...markets.map((m) => ({ value: m, label: m }))]}
                        onChange={(v) => { setMarket(v); setPageId(""); }} />
                    <SearchableSelect ariaLabel="Page" placeholder={`Mọi page (${pageOptions.length})`} value={pageId}
                        options={[{ value: "", label: `Mọi page (${pageOptions.length})` }, ...pageOptions]} onChange={setPageId} />
                    <SearchableSelect ariaLabel="Tag" placeholder="Mọi tag" value={label}
                        options={[{ value: "", label: "Mọi tag" }, { value: "none", label: "Chưa gắn tag" }, ...meta.tags.map((t) => ({ value: String(t.id), label: t.name }))]}
                        onChange={setLabel} />
                    <SearchableSelect ariaLabel="Người phụ trách" placeholder="Mọi người" value={assignee}
                        options={[{ value: "", label: "Mọi người" }, { value: "none", label: "Chưa gán" }, ...meta.users.map((u) => ({ value: u.id, label: u.name, hint: u.role }))]}
                        onChange={setAssignee} />
                    <label className="relative col-span-2 md:col-span-1">
                        <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
                        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tên, số điện thoại, nội dung…" aria-label="Tìm hội thoại"
                            className="w-full rounded-lg border border-border bg-background py-1.5 pl-7 pr-2 text-sm text-foreground" />
                    </label>
                </div>
                {!pages.length && (
                    <p className="text-sm text-amber-700 dark:text-amber-300">
                        Chưa có page nào. Nhập token Pancake của tài khoản CÓ GÓI CƯỚC ở Quản trị → Khoá kết nối (ô Token Pancake 2 / 3);
                        máy chủ kéo tin ở lượt 5 phút kế tiếp.
                    </p>
                )}
                {broken.length > 0 && (
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                        {broken.length}/{pages.length} page chưa đọc được: {[...new Set(broken.map((p) => p.last_error))].slice(0, 2).join(" · ")}
                    </p>
                )}
            </div>

            <div className={cn(CARD, "grid h-[70vh] min-h-[420px] grid-cols-1 overflow-hidden md:grid-cols-[minmax(280px,380px)_1fr]")}>
                <div className={cn("min-h-0 overflow-y-auto border-border md:border-r", selected && "hidden md:block")}>
                    {!rows.length && <div className="p-4 text-sm text-muted-foreground">{loadingList ? "Đang tải…" : "Không có hội thoại nào khớp."}</div>}
                    {rows.map((c) => {
                        const key = `${c.page_id}|${c.conversation_id}`;
                        return (
                            <button key={key} type="button" onClick={() => setSelected(c)}
                                className={cn("block w-full border-b border-border px-3 py-2 text-left hover:bg-muted/60", key === selKey && "bg-muted")}>
                                <div className="flex items-baseline justify-between gap-2">
                                    <span className="truncate text-sm font-medium text-foreground">{c.customer_name || "(khách không tên)"}</span>
                                    <span className="shrink-0 text-[11px] text-muted-foreground">{vnTime(c.updated_at)}</span>
                                </div>
                                <div className="truncate text-xs text-muted-foreground">{c.snippet || "…"}</div>
                                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                                    <span className="max-w-[10rem] truncate">{c.page_name}{c.market ? ` · ${c.market}` : ""}</span>
                                    {c.type === "COMMENT" && <span className="rounded bg-sky-50 px-1 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">bình luận</span>}
                                    {c.phone_numbers.length > 0 && <Phone className="h-3 w-3 shrink-0 text-emerald-600" aria-label="có số điện thoại" />}
                                    {c.assignee_name && <span className="inline-flex items-center gap-0.5 text-foreground"><UserRound className="h-3 w-3" />{c.assignee_name}</span>}
                                    {c.labels.map((l) => <LabelChip key={l.id} label={l} />)}
                                </div>
                            </button>
                        );
                    })}
                    {hasMore && (
                        <button type="button" onClick={loadMore} disabled={loadingList} className="w-full p-3 text-sm text-primary hover:bg-muted disabled:opacity-50">
                            {loadingList ? "Đang tải…" : "Tải thêm"}
                        </button>
                    )}
                </div>
                <div className={cn("min-h-0", !selected && "hidden md:block")}>
                    <ThreadView conversation={selected} messages={thread.messages} loading={thread.loading} error={thread.error}
                        onBack={() => setSelected(null)} tags={meta.tags} busy={busy}
                        assignable={selected ? assignableFor(meta.users, selected.market) : []}
                        onAssign={(userId) => act({ action: "assign", user_id: userId })}
                        onToggleTag={(tagId, on) => act({ action: "tag", tag_id: tagId, on })}
                        onCreateTag={createAndTag} />
                </div>
            </div>
        </div>
    );
}
