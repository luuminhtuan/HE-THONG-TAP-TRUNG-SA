"use client";

// Một cuộc chat của tab Tin nhắn — chỉ đọc. Tin khách bên trái, tin page (nhân viên / bot) bên phải.
import { ArrowLeft, Paperclip, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import type { InboxConversation, InboxMessage } from "@/lib/talpha/pancake-inbox";

export const vnTime = (iso: string | null, withDate = true) => (iso
    ? new Date(iso).toLocaleString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", ...(withDate ? { day: "2-digit", month: "2-digit" } : {}),
    })
    : "");

const isImage = (a: { type: string; url: string }) => /image|photo|sticker/i.test(a.type) || /\.(jpe?g|png|gif|webp)(\?|$)/i.test(a.url);

export default function ThreadView({ conversation, messages, loading, error, onBack }: {
    conversation: InboxConversation | null; messages: InboxMessage[]; loading: boolean; error: string; onBack: () => void;
}) {
    if (!conversation) {
        return <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">Chọn một hội thoại bên trái để xem.</div>;
    }
    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-start gap-2 border-b border-border p-3">
                <button type="button" onClick={onBack} className="rounded-md p-1 text-muted-foreground hover:bg-muted md:hidden" aria-label="Về danh sách">
                    <ArrowLeft className="h-4 w-4" />
                </button>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-foreground">{conversation.customer_name || "(khách không tên)"}</div>
                    <div className="truncate text-xs text-muted-foreground">
                        {conversation.page_name}{conversation.market ? ` · ${conversation.market}` : ""}
                        {conversation.type === "COMMENT" ? " · bình luận" : ""}
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
