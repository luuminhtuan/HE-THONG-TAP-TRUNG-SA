"use client";

// 🧠 AI Chatbot → AI Learning (25/11/2026): câu hỏi AI chưa trả lời được (thiếu dữ liệu / độ tin cậy thấp), gom thành nhóm
// câu tương tự + số lần xuất hiện. Admin / Sale nhập câu trả lời chuẩn → Duyệt = tạo FAQ trong Kiến thức → câu tương tự
// về sau AI tự trả lời. AI KHÔNG tự sửa kiến thức. Nguồn: /api/talpha/ai-chatbot/learning.
import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, RotateCcw, Save, Search, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { ActionButton, Card, Empty, ErrorBox, Loading, Pager, Pill, api, btnCls, fmtTime, inputCls, reasonLabel, useApi, useFlash } from "./shared";

const STATUS: Record<string, { label: string; tone: "amber" | "blue" | "green" | "slate" }> = {
    pending: { label: "Chờ xử lý", tone: "amber" }, processing: { label: "Đang xử lý", tone: "blue" },
    approved: { label: "Đã duyệt", tone: "green" }, ignored: { label: "Bỏ qua", tone: "slate" },
};

type Row = {
    id: number; market: string | null; page_name: string | null; sample_text: string; intent: string | null; language: string | null;
    reason: string | null; occurrences: number; status: string; answer: string | null; kb_entry_id: number | null; last_seen_at: string;
};

export default function AiLearningTab() {
    const [status, setStatus] = useState("pending");
    const [q, setQ] = useState(""), [qInput, setQInput] = useState("");
    const [page, setPage] = useState(1);
    const [openId, setOpenId] = useState<number | null>(null);
    const url = useMemo(() => `/api/talpha/ai-chatbot/learning?${new URLSearchParams({
        page: String(page), size: "25", ...(status ? { status } : {}), ...(q ? { q } : {}),
    })}`, [page, status, q]);
    const { data, error, reload } = useApi<{ rows: Row[]; total: number; page: number; size: number; counts: Record<string, number> }>(url);

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                {["pending", "processing", "approved", "ignored", ""].map((s) => (
                    <button key={s || "all"} type="button" onClick={() => { setStatus(s); setPage(1); }}
                        className={cn("rounded-full border px-3 py-1 text-sm", status === s ? "border-orange-400 bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300" : "border-border hover:bg-muted")}>
                        {s ? STATUS[s].label : "Tất cả"}{s && data?.counts?.[s] !== undefined ? ` (${data.counts[s]})` : ""}
                    </button>
                ))}
                <form className="ml-auto flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); setQ(qInput.trim()); setPage(1); }}>
                    <input className={cn(inputCls, "w-56")} placeholder="Tìm câu hỏi" value={qInput} onChange={(e) => setQInput(e.target.value)} />
                    <button type="submit" className={btnCls} aria-label="Tìm"><Search className="h-4 w-4" /></button>
                </form>
            </div>
            {error && <ErrorBox>{error}</ErrorBox>}
            {!data && !error && <Loading />}
            {data && (data.rows.length ? (
                <Card>
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[720px] text-sm">
                            <thead className="text-left text-xs text-muted-foreground">
                                <tr><th className="py-1.5 pr-2">Câu hỏi (nhóm)</th><th className="pr-2 text-right">Số lần</th><th className="pr-2">Lý do</th><th className="pr-2">Nước · page</th><th className="pr-2">Lần cuối</th><th>Trạng thái</th></tr>
                            </thead>
                            <tbody>
                                {data.rows.map((r) => (
                                    <tr key={r.id} onClick={() => setOpenId(r.id)} className="cursor-pointer border-t border-border/50 align-top hover:bg-muted/50">
                                        <td className="max-w-[360px] py-1.5 pr-2">{r.sample_text}{r.answer && <div className="line-clamp-1 text-xs text-muted-foreground">↳ {r.answer}</div>}</td>
                                        <td className="pr-2 text-right font-semibold tabular-nums">{r.occurrences}</td>
                                        <td className="pr-2 text-xs">{reasonLabel(r.reason)}</td>
                                        <td className="pr-2 text-xs">{r.market || "—"}{r.page_name ? ` · ${r.page_name}` : ""}</td>
                                        <td className="whitespace-nowrap pr-2 text-xs text-muted-foreground">{fmtTime(r.last_seen_at)}</td>
                                        <td><Pill tone={STATUS[r.status]?.tone || "slate"}>{STATUS[r.status]?.label || r.status}</Pill></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <Pager page={data.page} size={data.size} total={data.total} onPage={setPage} />
                </Card>
            ) : <Empty>{status === "pending" ? "Không còn câu hỏi nào chờ xử lý 🎉" : "Không có câu hỏi nào."}</Empty>)}
            {openId !== null && <LearningDetail id={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
        </div>
    );
}

function LearningDetail({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
    const { data, error, reload } = useApi<any>(`/api/talpha/ai-chatbot/learning?id=${id}`);
    const [answer, setAnswer] = useState<string | null>(null);
    const [question, setQuestion] = useState<string | null>(null);
    const flash = useFlash();
    const qn = data?.question;
    const ans = answer ?? qn?.answer ?? "";
    const qText = question ?? qn?.sample_text ?? "";
    const post = async (body: Record<string, unknown>, msg: string) => {
        try { await api("/api/talpha/ai-chatbot/learning", { json: { id, ...body } }); flash.ok(msg); reload(); onChanged(); }
        catch (e) { flash.err(e); }
    };
    return (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
            <aside className="h-full w-full max-w-2xl overflow-y-auto bg-background p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
                <div className="mb-3 flex items-center"><h3 className="text-base font-semibold">Câu hỏi #{id}</h3>
                    <button type="button" className={cn(btnCls, "ml-auto")} onClick={onClose}><X className="h-4 w-4" /></button></div>
                {error && <ErrorBox>{error}</ErrorBox>}
                {!qn && !error && <Loading />}
                {qn && (
                    <div className="space-y-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                            <Pill tone={STATUS[qn.status]?.tone || "slate"}>{STATUS[qn.status]?.label}</Pill>
                            <span className="text-muted-foreground">{qn.occurrences} lần · {reasonLabel(qn.reason)} · {qn.market || "chung"}{qn.page_name ? ` · ${qn.page_name}` : ""}</span>
                        </div>
                        <label className="block text-sm">Câu hỏi chuẩn (tiêu đề FAQ)
                            <input className={inputCls} value={qText} maxLength={300} disabled={qn.status === "approved"} onChange={(e) => setQuestion(e.target.value)} /></label>
                        <label className="block text-sm">Câu trả lời chuẩn (AI sẽ trả lời đúng nội dung này)
                            <textarea className={cn(inputCls, "min-h-[140px]")} value={ans} maxLength={4000} disabled={qn.status === "approved"}
                                onChange={(e) => setAnswer(e.target.value)} placeholder="Chỉ ghi thông tin đúng, đã kiểm — giá, thời gian, chính sách…" /></label>
                        <div className="flex flex-wrap gap-2">
                            {(qn.status === "pending" || qn.status === "processing") && <>
                                <ActionButton primary disabled={ans.trim().length < 3} onClick={() => post({ action: "approve", answer: ans, question: qText }, "Đã duyệt — thêm FAQ vào Kiến thức")}>
                                    <CheckCircle2 className="h-4 w-4" /> Duyệt thành FAQ</ActionButton>
                                <ActionButton onClick={() => post({ action: "draft", answer: ans }, "Đã lưu nháp")}><Save className="h-4 w-4" /> Lưu nháp</ActionButton>
                                <ActionButton onClick={() => post({ action: "status", status: "ignored" }, "Đã bỏ qua")}><XCircle className="h-4 w-4" /> Bỏ qua</ActionButton>
                            </>}
                            {(qn.status === "ignored" || qn.status === "approved") &&
                                <ActionButton onClick={() => post({ action: "status", status: "pending" }, "Đã mở lại")}><RotateCcw className="h-4 w-4" /> Mở lại</ActionButton>}
                            {qn.kb_entry_id && <Link className={btnCls} href="/talpha/ai-knowledge">Xem FAQ #{qn.kb_entry_id} trong Kiến thức</Link>}
                        </div>
                        {flash.node}
                        <section><h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Khách đã hỏi ({data.occurrences.length})</h4>
                            <ul className="space-y-2">{data.occurrences.map((o: any, i: number) => (
                                <li key={i} className="rounded-lg border border-border p-2 text-xs">
                                    <div className="text-muted-foreground">{fmtTime(o.at)} · <Link className="hover:underline" href={`/talpha/ai-logs?conversation_id=${encodeURIComponent(o.conversation_id)}`}>hội thoại {String(o.conversation_id).slice(0, 20)}…</Link></div>
                                    <div className="mt-0.5">{o.text}</div>
                                    {o.customer_text && o.customer_text !== o.text && <div className="mt-0.5 whitespace-pre-wrap text-muted-foreground">Nguyên văn: {o.customer_text}</div>}
                                </li>
                            ))}</ul></section>
                        {data.history.length > 0 && (
                            <section><h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Lịch sử</h4>
                                <ul className="space-y-0.5 text-xs">{data.history.map((h: any, i: number) => <li key={i}>{fmtTime(h.at)} · {h.actor || "—"} · {h.action}</li>)}</ul></section>
                        )}
                    </div>
                )}
            </aside>
        </div>
    );
}
