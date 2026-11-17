"use client";

// Một cuộc chat của tab Tin nhắn. Tin khách bên trái, tin page (nhân viên / bot) bên phải — chỉ đọc. Đầu khung: người
// phụ trách + tag nội bộ (gán / gắn trên dashboard, ghi nhật ký cho KPI — không đẩy về Pancake).
import { ArrowLeft, Paperclip, Phone, UserRound, X } from "lucide-react";
import { cn } from "@/lib/utils";
import SearchableSelect from "@/components/ui/searchable-select";
import type { InboxConversation, InboxLabel, InboxMessage } from "@/lib/talpha/pancake-inbox";
import type { InboxUser } from "@/lib/talpha/inbox-rules";

export const vnTime = (iso: string | null, withDate = true) => (iso
    ? new Date(iso).toLocaleString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", ...(withDate ? { day: "2-digit", month: "2-digit" } : {}),
    })
    : "");

const LABEL_CLASS: Record<string, string> = {
    slate: "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300",
    red: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
    amber: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
    emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    sky: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
    violet: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
    pink: "bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300",
};

export function LabelChip({ label, onRemove }: { label: InboxLabel; onRemove?: () => void }) {
    return (
        <span className={cn("inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium", LABEL_CLASS[label.color] || LABEL_CLASS.slate)}>
            {label.name}
            {onRemove && (
                <button type="button" onClick={onRemove} aria-label={`Gỡ tag ${label.name}`} className="opacity-60 hover:opacity-100"><X className="h-3 w-3" /></button>
            )}
        </span>
    );
}

const isImage = (a: { type: string; url: string }) => /image|photo|sticker/i.test(a.type) || /\.(jpe?g|png|gif|webp)(\?|$)/i.test(a.url);

type Props = {
    conversation: InboxConversation | null; messages: InboxMessage[]; loading: boolean; error: string; onBack: () => void;
    tags: InboxLabel[]; assignable: InboxUser[]; busy: boolean;
    onAssign: (userId: string | null) => void; onToggleTag: (tagId: number, on: boolean) => void; onCreateTag: (name: string) => void;
};

export default function ThreadView({
    conversation, messages, loading, error, onBack, tags, assignable, busy, onAssign, onToggleTag, onCreateTag,
}: Props) {
    if (!conversation) {
        return <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">Chọn một hội thoại bên trái để xem.</div>;
    }
    const labelIds = conversation.labels.map((l) => String(l.id));
    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="space-y-2 border-b border-border p-3">
                <div className="flex items-start gap-2">
                    <button type="button" onClick={onBack} className="rounded-md p-1 text-muted-foreground hover:bg-muted md:hidden" aria-label="Về danh sách">
                        <ArrowLeft className="h-4 w-4" />
                    </button>
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-foreground">{conversation.customer_name || "(khách không tên)"}</div>
                        <div className="truncate text-xs text-muted-foreground">
                            {conversation.page_name}{conversation.market ? ` · ${conversation.market}` : ""}
                            {conversation.type === "COMMENT" ? " · bình luận" : ""}
                            {conversation.tags.length > 0 && ` · Pancake: ${conversation.tags.join(", ")}`}
                        </div>
                        {conversation.phone_numbers.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-2">
                                {conversation.phone_numbers.map((p) => (
                                    <a key={p} href={`tel:${p}`} className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                                        <Phone className="h-3 w-3" />{p}
                                    </a>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <UserRound className="h-4 w-4 text-muted-foreground" aria-hidden />
                    <SearchableSelect ariaLabel="Người phụ trách" disabled={busy} className="w-48"
                        placeholder="Chưa gán — chọn người" value={conversation.assignee_id || ""}
                        options={[{ value: "", label: "— Bỏ gán —" }, ...assignable.map((u) => ({ value: u.id, label: u.name, hint: u.full ? "giám đốc" : u.codes.join(" ") }))]}
                        onChange={(v) => onAssign(v || null)} />
                    <SearchableSelect ariaLabel="Gắn tag" disabled={busy} className="w-36" multiple values={labelIds}
                        placeholder="+ Gắn tag" searchPlaceholder="Tìm hoặc gõ tag mới…"
                        options={tags.map((t) => ({ value: String(t.id), label: t.name }))}
                        renderOption={(o) => <LabelChip label={tags.find((t) => String(t.id) === o.value) || { id: 0, name: o.label, color: "slate" }} />}
                        onChange={(v) => onToggleTag(Number(v), !labelIds.includes(v))} onCreate={onCreateTag} />
                    {conversation.labels.map((l) => <LabelChip key={l.id} label={l} onRemove={busy ? undefined : () => onToggleTag(l.id, false)} />)}
                </div>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                {error && <div className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</div>}
                {loading && !messages.length && <div className="text-xs text-muted-foreground">Đang tải tin…</div>}
                {!loading && !error && !messages.length && (
                    <div className="text-xs text-muted-foreground">Chưa kéo được tin của hội thoại này — máy chủ kéo lại ở lượt 5 phút sau.</div>
                )}
                {messages.map((m) => (
                    <div key={m.message_id} className={cn("flex", m.from_page ? "justify-end" : "justify-start")}>
                        <div className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-sm",
                            m.from_page ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm bg-muted text-foreground")}>
                            {m.from_page && m.sender_name && <div className="mb-0.5 text-[11px] opacity-75">{m.sender_name}</div>}
                            {m.body && <div className="whitespace-pre-wrap break-words">{m.body}</div>}
                            {m.attachments.map((a, i) => isImage(a) ? (
                                <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" className="mt-1 block">
                                    {/* eslint-disable-next-line @next/next/no-img-element -- ảnh của Facebook/Pancake, đường dẫn ngoài, có thể hết hạn */}
                                    <img src={a.url} alt={a.name || "ảnh"} loading="lazy" className="max-h-56 rounded-lg" />
                                </a>
                            ) : (
                                <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 underline">
                                    <Paperclip className="h-3 w-3" />{a.name || a.type}
                                </a>
                            ))}
                            <div className={cn("mt-0.5 text-right text-[10px]", m.from_page ? "opacity-70" : "text-muted-foreground")}>{vnTime(m.sent_at)}</div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
