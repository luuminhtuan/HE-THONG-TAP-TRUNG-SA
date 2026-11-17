"use client";

// ═══════════════════════════════════════════════════════════════════
// Tin nhắn (17/11/2026) — hộp thư Pancake CHỈ ĐỌC. Máy chủ kéo hội thoại + tin về database 5 phút một lần
// (sync/talpha/pancake_inbox_sync.py); tab đọc từ database qua /api/talpha/messages — không gọi Pancake lúc xem.
// Leader thấy page thuộc nước của team, giám đốc thấy hết. Trả lời khách vẫn làm trong Pancake.
// ═══════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageSquare, Phone, Search } from "lucide-react";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { cn } from "@/lib/utils";
import type { InboxConversation, InboxMessage, InboxPage } from "@/lib/talpha/pancake-inbox";
import ThreadView, { vnTime } from "./messages/thread-view";

const API = "/api/talpha/messages";
const CARD = "rounded-xl border border-border bg-card shadow-sm";
const REFRESH_MS = 60_000;          // dữ liệu chỉ đổi 5 phút một lần — đọc lại mỗi phút là đủ
const SELECT = "rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground";

async function getJson<T>(url: string): Promise<T> {
    const r = await fetch(url, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j as T;
}

export default function MessagesTab() {
    const [pages, setPages] = useState<InboxPage[] | null>(null);
    const [error, setError] = useState("");
    const [market, setMarket] = useState("");
    const [pageId, setPageId] = useState("");
    const [q, setQ] = useState("");
    const [qDebounced, setQDebounced] = useState("");
    const [rows, setRows] = useState<InboxConversation[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [loadingList, setLoadingList] = useState(false);
    const [selected, setSelected] = useState<InboxConversation | null>(null);
    const [thread, setThread] = useState<{ messages: InboxMessage[]; loading: boolean; error: string }>({ messages: [], loading: false, error: "" });

    useEffect(() => { const t = setTimeout(() => setQDebounced(q.trim()), 350); return () => clearTimeout(t); }, [q]);

    const loadPages = useCallback(() => {
        getJson<{ pages: InboxPage[] }>(API).then((d) => setPages(d.pages)).catch((e) => setError(String(e.message || e)));
    }, []);
    useEffect(() => { loadPages(); const t = setInterval(loadPages, REFRESH_MS); return () => clearInterval(t); }, [loadPages]);

    const listUrl = useCallback((before?: string) => {
        const sp = new URLSearchParams({ list: "1" });
        if (market) sp.set("market", market);
        if (pageId) sp.set("page_id", pageId);
        if (qDebounced) sp.set("q", qDebounced);
        if (before) sp.set("before", before);
        return `${API}?${sp}`;
    }, [market, pageId, qDebounced]);

    // Lượt đầu + mỗi phút đọc lại trang đầu (chưa bấm "Tải thêm" thì thay cả danh sách).
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

    useEffect(() => {
        if (!selected) return;
        let cancelled = false;
        const load = (first: boolean) => {
            if (first) setThread({ messages: [], loading: true, error: "" });
            const sp = new URLSearchParams({ page_id: selected.page_id, conversation_id: selected.conversation_id });
            getJson<{ messages: InboxMessage[] }>(`${API}?${sp}`)
                .then((d) => { if (!cancelled) setThread({ messages: d.messages, loading: false, error: "" }); })
                .catch((e) => { if (!cancelled) setThread((t) => ({ ...t, loading: false, error: String(e.message || e) })); });
        };
        load(true);
        const t = setInterval(() => load(false), REFRESH_MS);
        return () => { cancelled = true; clearInterval(t); };
    }, [selected]);

    const markets = useMemo(() => [...new Set((pages || []).map((p) => p.market).filter(Boolean) as string[])].sort(), [pages]);
    const pageOptions = useMemo(() => (pages || []).filter((p) => !market || p.market === market), [pages, market]);
    const lastSync = useMemo(() => (pages || []).map((p) => p.last_sync_at).filter(Boolean).sort().pop() || null, [pages]);
    const broken = useMemo(() => (pages || []).filter((p) => p.last_error), [pages]);

    if (error && !pages) {
        return <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">Không đọc được hộp thư: {error}</div>;
    }
    if (!pages) return <TabSkeleton cards={1} rows={8} />;

    return (
        <div className="space-y-3">
            <div className={cn(CARD, "space-y-2 p-4")}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground"><MessageSquare className="h-4 w-4" />Tin nhắn Pancake</h2>
                        <p className="text-xs text-muted-foreground">
                            Chỉ xem · máy chủ cập nhật 5 phút một lần{lastSync ? ` (lần gần nhất ${vnTime(lastSync)})` : ""} · giữ 6 tháng · trả lời khách vẫn trong Pancake
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {markets.length > 1 && (
                            <select value={market} onChange={(e) => { setMarket(e.target.value); setPageId(""); }} className={SELECT} aria-label="Nước">
                                <option value="">Mọi nước</option>
                                {markets.map((m) => <option key={m} value={m}>{m}</option>)}
                            </select>
                        )}
                        <select value={pageId} onChange={(e) => setPageId(e.target.value)} className={cn(SELECT, "max-w-[14rem]")} aria-label="Page">
                            <option value="">Mọi page ({pageOptions.length})</option>
                            {pageOptions.map((p) => <option key={p.page_id} value={p.page_id}>{p.name}{p.market ? ` · ${p.market}` : ""}</option>)}
                        </select>
                        <label className="relative">
                            <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
                            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tên, số điện thoại, nội dung…"
                                className={cn(SELECT, "w-56 pl-7")} aria-label="Tìm hội thoại" />
                        </label>
                    </div>
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

            <div className={cn(CARD, "grid h-[70vh] min-h-[420px] grid-cols-1 overflow-hidden md:grid-cols-[minmax(260px,360px)_1fr]")}>
                <div className={cn("min-h-0 overflow-y-auto border-border md:border-r", selected && "hidden md:block")}>
                    {!rows.length && (
                        <div className="p-4 text-sm text-muted-foreground">{loadingList ? "Đang tải…" : "Không có hội thoại nào khớp."}</div>
                    )}
                    {rows.map((c) => {
                        const active = selected?.page_id === c.page_id && selected?.conversation_id === c.conversation_id;
                        return (
                            <button key={`${c.page_id}|${c.conversation_id}`} type="button" onClick={() => setSelected(c)}
                                className={cn("block w-full border-b border-border px-3 py-2 text-left hover:bg-muted/60", active && "bg-muted")}>
                                <div className="flex items-baseline justify-between gap-2">
                                    <span className="truncate text-sm font-medium text-foreground">{c.customer_name || "(khách không tên)"}</span>
                                    <span className="shrink-0 text-[11px] text-muted-foreground">{vnTime(c.updated_at)}</span>
                                </div>
                                <div className="truncate text-xs text-muted-foreground">{c.snippet || "…"}</div>
                                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                                    <span className="truncate">{c.page_name}{c.market ? ` · ${c.market}` : ""}</span>
                                    {c.type === "COMMENT" && <span className="rounded bg-sky-50 px-1 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">bình luận</span>}
                                    {c.phone_numbers.length > 0 && <Phone className="h-3 w-3 shrink-0 text-emerald-600" aria-label="có số điện thoại" />}
                                </div>
                            </button>
                        );
                    })}
                    {hasMore && (
                        <button type="button" onClick={loadMore} disabled={loadingList}
                            className="w-full p-3 text-sm text-primary hover:bg-muted disabled:opacity-50">
                            {loadingList ? "Đang tải…" : "Tải thêm"}
                        </button>
                    )}
                </div>
                <div className={cn("min-h-0", !selected && "hidden md:block")}>
                    <ThreadView conversation={selected} messages={thread.messages} loading={thread.loading} error={thread.error} onBack={() => setSelected(null)} />
                </div>
            </div>
        </div>
    );
}
