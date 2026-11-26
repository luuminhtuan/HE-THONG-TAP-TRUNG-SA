"use client";

// 🧠 AI Chatbot → Tổng quan (25/11/2026): tin AI tiếp nhận / trả lời / chuyển Sale, tỷ lệ tự xử lý, token, chi phí, chủ đề
// câu hỏi, theo page, theo ngày. Nguồn: /api/talpha/ai-chatbot/stats (bảng ai_bot_runs + ai_bot_provider_calls).
import { useMemo } from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, Empty, ErrorBox, Loading, Notice, Stat, fmtNum, fmtPct, fmtUsd, reasonLabel, useApi, ymd } from "./shared";
import { DECISION_LABELS } from "@/lib/ai-chatbot/reasons";

const INTENT_LABELS: Record<string, string> = {
    product_info: "Thông tin SP", product_usage: "Cách dùng", product_comparison: "So sánh SP", service_info: "Dịch vụ",
    warranty: "Bảo hành", shipping: "Giao hàng", return_policy: "Đổi trả", promotion: "Khuyến mãi", price: "Hỏi giá",
    order: "Đặt hàng", greeting: "Chào hỏi", general: "Câu chung", human_support: "Gặp nhân viên", complaint: "Khiếu nại", unknown: "Không rõ",
};

type Stats = {
    from: string; to: string; mode: string; enabled: boolean;
    totals: { received: number; answered: number; shadow: number; escalated: number; skipped: number; errors: number; pos_handled: number;
        sale_handled: number; input_tokens: number; output_tokens: number; cost_usd: number; avg_ms: number | null; auto_rate: number | null };
    daily: { day: string; received: number; answered: number; escalated: number; cost_usd: number }[];
    intents: { intent: string; n: number }[];
    reasons: { reason: string; decision: string; n: number }[];
    pages: { page_id: string; name: string; market: string | null; received: number; answered: number; escalated: number; cost_usd: number }[];
    provider_cost: { cost_usd: number; tokens: number; calls: number; failed_calls: number } | null;
    jobs: { pending: number; running: number; failed: number };
};

export default function AiOverviewTab({ dateRange }: { dateRange?: { from: Date; to: Date } }) {
    const from = ymd(dateRange?.from), to = ymd(dateRange?.to);
    const url = `/api/talpha/ai-chatbot/stats?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) })}`;
    const { data, error, loading } = useApi<Stats>(url);
    const maxIntent = useMemo(() => Math.max(1, ...(data?.intents || []).map((x) => x.n)), [data]);

    if (error) return <ErrorBox>{error}</ErrorBox>;
    if (!data) return <Loading />;
    const t = data.totals;
    return (
        <div className="space-y-4">
            {!data.enabled && <Notice tone="warn">AI Chatbot đang <b>TẮT</b> — bật ở <Link className="underline" href="/talpha/ai-settings">Cài đặt AI</Link>. Số dưới đây là lịch sử.</Notice>}
            {data.enabled && data.mode === "shadow" && <Notice>Chế độ <b>shadow</b>: AI soạn câu trả lời và ghi nhật ký nhưng <b>không gửi</b> cho khách. “Đã trả lời” gồm cả câu chỉ soạn thử.</Notice>}
            {loading && <p className="text-xs text-muted-foreground">Đang cập nhật…</p>}

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
                <Stat label="AI tiếp nhận" value={fmtNum(t.received)} hint="lượt khách đã xét" />
                <Stat label="AI trả lời" value={fmtNum(t.answered + t.shadow)} hint={t.shadow ? `${fmtNum(t.answered)} gửi thật · ${fmtNum(t.shadow)} thử` : "đã gửi cho khách"} tone="green" />
                <Stat label="Chuyển Sale" value={fmtNum(t.escalated)} tone="amber" hint="thiếu dữ liệu / cần người" />
                <Stat label="Tỷ lệ tự xử lý" value={fmtPct(t.auto_rate)} hint="trả lời ÷ (trả lời + chuyển Sale)" tone="blue" />
                <Stat label="POS / Sale đã lo" value={`${fmtNum(t.pos_handled)} · ${fmtNum(t.sale_handled)}`} hint="AI không chen" />
                <Stat label="Chi phí (lượt khách)" value={fmtUsd(t.cost_usd)} hint={`${fmtNum(Number(t.input_tokens) + Number(t.output_tokens))} token · TB ${t.avg_ms ? `${(t.avg_ms / 1000).toFixed(1)}s` : "—"}`} />
            </div>
            {data.provider_cost && (
                <p className="text-xs text-muted-foreground">
                    Tổng gọi model trong kỳ (cả thử kết nối, chạy thử): {fmtNum(data.provider_cost.calls)} lượt · {fmtNum(data.provider_cost.tokens)} token ·
                    {" "}<b>{fmtUsd(data.provider_cost.cost_usd)}</b>{data.provider_cost.failed_calls ? ` · ${data.provider_cost.failed_calls} lượt lỗi` : ""}
                    {" "}· hàng chờ: {data.jobs?.pending ?? 0} chờ, {data.jobs?.running ?? 0} đang chạy{data.jobs?.failed ? `, ${data.jobs.failed} hỏng` : ""}
                </p>
            )}

            <Card title="Theo ngày">
                {data.daily.length ? (
                    <div className="h-64 w-full">
                        <ResponsiveContainer>
                            <BarChart data={data.daily} margin={{ left: -16, right: 8, top: 4, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
                                <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} fontSize={11} />
                                <YAxis allowDecimals={false} fontSize={11} />
                                <Tooltip />
                                <Legend wrapperStyle={{ fontSize: 12 }} />
                                <Bar dataKey="answered" name="AI trả lời" stackId="a" fill="#10b981" />
                                <Bar dataKey="escalated" name="Chuyển Sale" stackId="a" fill="#f59e0b" />
                                <Bar dataKey="received" name="Tiếp nhận" fill="#94a3b8" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                ) : <Empty>Chưa có lượt nào trong khoảng ngày này.</Empty>}
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
                <Card title="Chủ đề câu hỏi">
                    {data.intents.length ? (
                        <ul className="space-y-1.5">
                            {data.intents.map((x) => (
                                <li key={x.intent} className="flex items-center gap-2 text-sm">
                                    <span className="w-28 shrink-0 truncate text-muted-foreground">{INTENT_LABELS[x.intent] || x.intent}</span>
                                    <div className="h-2 flex-1 rounded-full bg-muted"><div className="h-2 rounded-full bg-orange-400" style={{ width: `${(x.n / maxIntent) * 100}%` }} /></div>
                                    <span className="w-10 text-right tabular-nums">{x.n}</span>
                                </li>
                            ))}
                        </ul>
                    ) : <Empty>Chưa có câu hỏi nào được phân loại.</Empty>}
                </Card>
                <Card title="Lý do (quyết định)">
                    {data.reasons.length ? (
                        <table className="w-full text-sm">
                            <tbody>
                                {data.reasons.map((r) => (
                                    <tr key={`${r.reason}-${r.decision}`} className="border-b border-border/50 last:border-0">
                                        <td className="py-1 pr-2">{reasonLabel(r.reason)}</td>
                                        <td className="py-1 pr-2 text-xs text-muted-foreground">{DECISION_LABELS[r.decision] || r.decision}</td>
                                        <td className="py-1 text-right tabular-nums">{r.n}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : <Empty>Chưa có dữ liệu.</Empty>}
                </Card>
            </div>

            <Card title="Theo page">
                {data.pages.length ? (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[520px] text-sm">
                            <thead className="text-left text-xs text-muted-foreground">
                                <tr><th className="py-1.5 pr-2">Page</th><th>Nước</th><th className="text-right">Tiếp nhận</th><th className="text-right">Trả lời</th><th className="text-right">Chuyển Sale</th><th className="text-right">Chi phí</th></tr>
                            </thead>
                            <tbody>
                                {data.pages.map((p) => (
                                    <tr key={p.page_id} className="border-t border-border/50">
                                        <td className="py-1.5 pr-2"><Link className="hover:underline" href={`/talpha/ai-logs?page_id=${encodeURIComponent(p.page_id)}`}>{p.name}</Link></td>
                                        <td>{p.market || "—"}</td>
                                        <td className="text-right tabular-nums">{p.received}</td>
                                        <td className="text-right tabular-nums">{p.answered}</td>
                                        <td className="text-right tabular-nums">{p.escalated}</td>
                                        <td className="text-right tabular-nums">{fmtUsd(p.cost_usd)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : <Empty>Chưa page nào có lượt AI trong khoảng này.</Empty>}
            </Card>
        </div>
    );
}
