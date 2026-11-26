"use client";

// 🧠 AI Chatbot → Cài đặt AI (25/11/2026, CHỈ giám đốc): công tắc tổng, chế độ shadow / live, provider + model, ngưỡng,
// trần chi phí, thời gian xử lý, tag, Telegram, webhook, page bật AI + token page, sổ luật POS, worker.
// Lưu = PUT /api/talpha/ai-chatbot/settings (sai → báo từng lỗi, không lưu gì). Khoá: gọi thử trước khi lưu (mã hoá).
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, Circle, KeyRound, Play, Plus, Power, RefreshCw, Save, ShieldAlert, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ActionButton, Card, ErrorBox, Loading, Notice, Pill, api, btnCls, fmtTime, inputCls, useApi, useFlash } from "./shared";

type Settings = Record<string, any>;
type Data = {
    settings: Settings; override: { settings: Settings; updated_at: string | null; updated_by: string | null }; base: Settings;
    pages: { page_id: string; name: string; market: string | null; mode: "auto" | "on" | "off"; enabled: boolean; status: string; status_label: string;
        has_page_token: boolean; last_poll_at: string | null; health_detail: string | null }[];
    checklist: { key: string; ok: boolean; label: string }[];
    pos_rules: { id: number; page_id: string | null; page_name: string | null; kind: string; pattern: string; note: string | null; enabled: boolean }[];
    providers: { id: string; label: string }[];
    keys: Record<string, { has: boolean; masked: string; via: string | null }>;
    account_tokens: number; webhook_url: string | null; worker: any; queue: Record<string, number>;
};

const NUM_FIELDS: [string, string, string?][] = [
    ["confidence_threshold", "Ngưỡng tin cậy (0–1)", "dưới ngưỡng → chuyển Sale"],
    ["min_retrieval_score", "Điểm khớp kiến thức tối thiểu (0–1)", "câu hỏi khớp thấp hơn = không có dữ liệu"],
    ["temperature", "Temperature", "thấp = ổn định, ít sáng tạo"],
    ["max_tokens", "Max tokens (trả lời)"], ["classifier_max_tokens", "Max tokens (phân loại)"], ["top_k", "Số mục kiến thức tối đa / câu"],
    ["daily_cost_limit_usd", "Trần chi phí / ngày (USD)", "chạm trần → AI dừng, chuyển Sale"], ["monthly_cost_limit_usd", "Trần chi phí / tháng (USD)"],
    ["provider_rpm", "Lượt gọi AI / phút"], ["timeout_seconds", "Timeout gọi AI (giây)"], ["max_retries", "Số lần thử lại khi lỗi"],
];
const FLOW_FIELDS: [string, string, string?][] = [
    ["debounce_seconds", "Chờ khách gõ xong (giây)"], ["pos_grace_seconds", "Chờ luật POS chạy (giây)", "POS trả lời trong lúc chờ → AI im"],
    ["sale_quiet_minutes", "Sale vừa nhắn trong (phút) → AI im"], ["max_turn_age_minutes", "Bỏ tin cũ hơn (phút)"],
    ["escalation_pause_minutes", "Sau khi chuyển Sale, dừng AI (phút)"], ["max_replies_per_conversation_hour", "AI trả lời tối đa / hội thoại / giờ"],
    ["min_seconds_between_sends_page", "Giãn cách gửi cùng page (giây)", "Facebook chặn #2022 nếu gửi dồn"],
    ["poll_interval_seconds", "Quét tin mới mỗi (giây)"], ["max_attempts", "Số lần thử một hội thoại"],
    ["context_messages", "Số tin ngữ cảnh"], ["context_chars", "Ngân sách ký tự ngữ cảnh"], ["max_answer_chars", "Độ dài trả lời tối đa (ký tự)"],
    ["price_max_age_hours", "Giá / tồn kho cũ hơn (giờ) → không báo giá"], ["kb_sync_hours", "Đồng bộ sản phẩm POS mỗi (giờ, 0 = tắt)"],
    ["other_bot_quiet_hours", "Né page / hội thoại có bot khác trong (giờ)"], ["page_error_backoff_minutes", "Page lỗi: nghỉ rồi thử lại sau (phút)"],
];

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
    return <label className="block text-sm"><span className="text-foreground">{label}</span>{children}{hint && <span className="mt-0.5 block text-[11px] text-muted-foreground">{hint}</span>}</label>;
}

export default function AiSettingsTab() {
    const { data, error, reload } = useApi<Data>("/api/talpha/ai-chatbot/settings");
    const [d, setD] = useState<Settings | null>(null);
    const [revealedUrl, setRevealedUrl] = useState<string | null>(null);
    const flash = useFlash();
    useEffect(() => { if (data) setD(structuredClone(data.settings)); }, [data]);
    const dirty = useMemo(() => !!data && !!d && JSON.stringify(d) !== JSON.stringify(data.settings), [d, data]);
    if (error) return <ErrorBox>{error}</ErrorBox>;
    if (!data || !d) return <Loading />;
    const set = (k: string, v: unknown) => setD((x) => ({ ...x!, [k]: v }));
    const setNested = (k: string, sub: string, v: unknown) => setD((x) => ({ ...x!, [k]: { ...(x![k] || {}), [sub]: v } }));
    const save = async () => {
        // Chỉ gửi khoá ĐÃ ĐỔI — khoá không đụng tới tiếp tục theo giá trị gốc ở talpha_rules.json.
        const patch = Object.fromEntries(Object.entries(d).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(data.settings[k])));
        try {
            await api("/api/talpha/ai-chatbot/settings", { method: "PUT", json: { settings: patch } });
            flash.ok("Đã lưu cài đặt"); reload();
        } catch (e) { flash.err(e); }
    };
    const post = async (body: Record<string, unknown>, okMsg?: (r: any) => string) => {
        try { const r = await api("/api/talpha/ai-chatbot/settings", { json: body }); flash.ok(okMsg ? okMsg(r) : "Xong"); reload(); return r; }
        catch (e) { flash.err(e); return null; }
    };
    const live = d.mode === "live";
    const enabledPages = data.pages.filter((p) => p.enabled);

    return (
        <div className="space-y-4">
            <Card title="Việc cần làm">
                <ul className="grid gap-1.5 text-sm md:grid-cols-2">
                    {data.checklist.map((c) => (
                        <li key={c.key} className="flex items-start gap-2">
                            {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />}
                            <span className={c.ok ? "text-muted-foreground" : "text-foreground"}>{c.label}</span>
                        </li>
                    ))}
                </ul>
                <p className="mt-2 text-[11px] text-muted-foreground">Page mới nối Pancake tự được nhận, tự lấy token, tự chạy; page die / hết gói tự nghỉ — không cần cấu hình từng page. Tag “Bot AI” là tuỳ chọn.</p>
            </Card>

            <Card title={<span className="flex items-center gap-2"><Power className="h-4 w-4 text-orange-500" /> Trạng thái</span>}
                actions={<>
                    <span className="text-xs text-muted-foreground">Worker {data.worker?.started ? "chạy" : "chưa chạy"}{data.worker?.last_tick_at ? ` · ${fmtTime(data.worker.last_tick_at)}` : ""} · chờ {data.queue.pending || 0} · đang chạy {data.queue.running || 0}</span>
                    <ActionButton onClick={() => post({ action: "run_now" }, (r) => (r.enabled ? `Đã chạy một vòng${r.processed ? " (có việc)" : " (không có việc)"}` : "AI đang tắt — không chạy"))}><Play className="h-3.5 w-3.5" /> Chạy ngay</ActionButton>
                </>}>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <Field label="Công tắc tổng" hint="Tắt = không gọi Pancake / AI, không gửi gì">
                        <button type="button" onClick={() => set("enabled", !d.enabled)} className={cn("mt-1 inline-flex w-full items-center justify-center rounded-lg px-3 py-2 text-sm font-semibold",
                            d.enabled ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200")}>{d.enabled ? "AI ĐANG BẬT" : "AI ĐANG TẮT"}</button>
                    </Field>
                    <Field label="Chế độ" hint={live ? "LIVE: gửi tin THẬT cho khách" : "Shadow: soạn + ghi nhật ký, KHÔNG gửi"}>
                        <select className={inputCls} value={d.mode} onChange={(e) => set("mode", e.target.value)}>
                            <option value="shadow">Shadow — chỉ thử, không gửi</option><option value="live">Live — gửi thật</option></select>
                    </Field>
                    <Field label="Page mới" hint={d.pages_auto ? "Mọi page đủ điều kiện tự chạy (đã gán nước, đọc được tin, không có bot khác)" : "Chỉ page bật tay (Luôn bật) mới chạy"}>
                        <button type="button" onClick={() => set("pages_auto", !d.pages_auto)} className={cn("mt-1 inline-flex w-full items-center justify-center rounded-lg px-3 py-2 text-sm font-semibold",
                            d.pages_auto ? "bg-sky-500 text-white" : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200")}>{d.pages_auto ? "TỰ BẬT AI CHO MỌI PAGE" : "CHỈ PAGE BẬT TAY"}</button>
                    </Field>
                    <Field label="Chỉ gửi thật cho các hội thoại (staging)" hint="Mỗi dòng một conversation_id. Rỗng = mọi hội thoại của page đang chạy">
                        <textarea className={cn(inputCls, "h-[60px] font-mono text-xs")} value={(d.live_test_conversations || []).join("\n")}
                            onChange={(e) => set("live_test_conversations", e.target.value.split(/\s+/).filter(Boolean))} />
                    </Field>
                </div>
                {live && d.enabled && (d.live_test_conversations || []).length === 0 && (
                    <div className="mt-3"><Notice tone="warn"><ShieldAlert className="mr-1 inline h-4 w-4" />AI đang GỬI THẬT cho mọi khách của {enabledPages.length} page đang chạy. Page có bot khác trả lời (vd bot AI Sale cũ) được tự né.</Notice></div>
                )}
            </Card>

            <Card title="Model AI">
                <div className="grid gap-3 md:grid-cols-2">
                    {(["classifier", "generator"] as const).map((k) => (
                        <ModelPicker key={k} label={k === "classifier" ? "Phân loại (model nhẹ, rẻ)" : "Trả lời (model chính)"} value={d[k]} providers={data.providers}
                            onChange={(v) => set(k, v)} onTest={() => post({ action: "test_provider", target: k }, (r) => `${r.provider} · ${r.model}: ${r.latency_ms} ms · ${r.tokens} token · $${Number(r.cost_usd).toFixed(5)}`)} />
                    ))}
                </div>
                <details className="mt-3"><summary className="cursor-pointer text-sm text-muted-foreground">Nâng cao: ngưỡng tin cậy, token, trần chi phí, timeout</summary>
                <div className="mt-3 grid gap-3 md:grid-cols-3 xl:grid-cols-4">
                    {NUM_FIELDS.map(([k, label, hint]) => (
                        <Field key={k} label={label} hint={hint}><input type="number" step="any" className={inputCls} value={d[k] ?? ""} onChange={(e) => set(k, e.target.value === "" ? "" : Number(e.target.value))} /></Field>
                    ))}
                </div>
                </details>
            </Card>

            <Card title={<span className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-orange-500" /> Khoá (mã hoá trong kho, gọi thử trước khi lưu)</span>}>
                <div className="grid gap-3 md:grid-cols-2">
                    {[["deepseek", "DeepSeek API key"], ["openai", "OpenAI API key"], ["gemini", "Gemini API key (trống = dùng khoá 'Hỏi AI')"], ["telegram", "Telegram Bot Token"]].map(([k, label]) => (
                        <KeyRow key={k} kind={k} label={label} status={data.keys[k]} onSave={(v) => post({ action: "save_key", kind: k, value: v }, (r) => r.detail || "Đã lưu khoá")}
                            onDelete={() => post({ action: "delete_key", kind: k }, () => "Đã xoá khoá")} />
                    ))}
                </div>
            </Card>

            <details className="rounded-xl border border-border bg-card p-3 md:p-4">
            <summary className="cursor-pointer text-sm font-semibold">Nâng cao: luồng xử lý, tag, giọng điệu</summary>
            <div className="mt-3">
                <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
                    {FLOW_FIELDS.map(([k, label, hint]) => (
                        <Field key={k} label={label} hint={hint}><input type="number" step="1" className={inputCls} value={d[k] ?? ""} onChange={(e) => set(k, e.target.value === "" ? "" : Number(e.target.value))} /></Field>
                    ))}
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <Field label="Tag khi AI trả lời (tạo sẵn trên Pancake)"><input className={inputCls} value={d.tag_answered} onChange={(e) => set("tag_answered", e.target.value)} /></Field>
                    <Field label="Tag khi cần Sale hỗ trợ (tạo sẵn trên Pancake)"><input className={inputCls} value={d.tag_needs_help} onChange={(e) => set("tag_needs_help", e.target.value)} /></Field>
                    <Field label="Tag tắt AI (sale gắn → AI im), phẩy ngăn cách"><input className={inputCls} value={(d.pause_tags || []).join(", ")} onChange={(e) => set("pause_tags", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} /></Field>
                    <Field label="Tên người gửi của AI trên Pancake" hint="Để nhận ra tin của chính AI (gửi bằng token page: 'Public API')"><input className={inputCls} value={(d.own_sender_names || []).join(", ")} onChange={(e) => set("own_sender_names", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} /></Field>
                    <Field label="Giọng điệu / cách xưng hô (persona)"><textarea className={cn(inputCls, "h-20")} value={d.persona} onChange={(e) => set("persona", e.target.value)} /></Field>
                    <Field label="Link hội thoại Pancake trong Telegram" hint="{page_id}, {conversation_id}; rỗng = không gắn"><input className={inputCls} value={d.pancake_url_template} onChange={(e) => set("pancake_url_template", e.target.value)} /></Field>
                </div>
                <div className="mt-3 flex flex-wrap gap-4 text-sm">
                    {[["allow_partial_answers", "Cho trả lời một phần (phần thiếu chuyển Sale)"], ["respect_dashboard_assignment", "Hội thoại đã gán Sale trên dashboard → AI im"],
                        ["respect_pancake_assignee", "Hội thoại có người phụ trách trên Pancake → AI im"], ["poll_enabled", "Quét tin mới theo lịch"]].map(([k, label]) => (
                        <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={!!d[k]} onChange={(e) => set(k, e.target.checked)} /> {label}</label>
                    ))}
                </div>
            </div>
            </details>

            <Card title="Telegram (báo Sale khi AI không trả lời được)">
                <div className="grid gap-3 md:grid-cols-3">
                    <Field label="Chat ID (nhóm: -100…)"><input className={inputCls} value={d.telegram?.chat_id || ""} onChange={(e) => setNested("telegram", "chat_id", e.target.value.trim())} /></Field>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!d.telegram?.enabled} onChange={(e) => setNested("telegram", "enabled", e.target.checked)} /> Bật báo Telegram</label>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!d.telegram?.notify_in_shadow} onChange={(e) => setNested("telegram", "notify_in_shadow", e.target.checked)} /> Báo cả ở chế độ shadow</label>
                </div>
                <div className="mt-2"><ActionButton onClick={() => post({ action: "test_telegram", chat_id: d.telegram?.chat_id }, (r) => r.detail)}>Gửi tin thử</ActionButton></div>
            </Card>

            <details className="rounded-xl border border-border bg-card p-3 md:p-4">
            <summary className="cursor-pointer text-sm font-semibold">Nâng cao: webhook Pancake (tuỳ chọn — quét theo lịch vẫn chạy)</summary>
            <div className="mt-3">
                <div className="grid gap-3 md:grid-cols-2">
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!d.webhook_enabled} onChange={(e) => set("webhook_enabled", e.target.checked)} /> Nhận webhook</label>
                    <Field label="IP nguồn được nhận (Pancake: 203.171.22.6)"><input className={inputCls} value={(d.webhook_allowed_ips || []).join(", ")} onChange={(e) => set("webhook_allowed_ips", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} /></Field>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    {data.webhook_url ? <code className="break-all rounded bg-muted px-2 py-1">{revealedUrl || data.webhook_url}</code> : <span className="text-muted-foreground">Chưa có chìa webhook.</span>}
                    {data.webhook_url && !revealedUrl && <ActionButton onClick={async () => { const r = await post({ action: "reveal_webhook_url" }, () => "URL đầy đủ hiện ở trên — chỉ dán vào Pancake, đừng gửi ai"); if (r?.webhook_url) setRevealedUrl(r.webhook_url); }}>Hiện URL</ActionButton>}
                    <ActionButton onClick={async () => { const r = await post({ action: "rotate_webhook_secret" }, () => "Đã tạo chìa mới — dán URL mới vào Pancake → Cài đặt page → Công cụ → Webhook"); if (r?.webhook_url) setRevealedUrl(r.webhook_url); }}><RefreshCw className="h-3.5 w-3.5" /> {data.webhook_url ? "Đổi chìa" : "Tạo chìa"}</ActionButton>
                </div>
            </div>
            </details>

            <div className="sticky bottom-2 z-10 flex items-center gap-2 rounded-xl border border-border bg-background/95 p-2 shadow-sm backdrop-blur">
                <span className="text-xs text-muted-foreground">{data.override.updated_at ? `Lưu lần cuối ${fmtTime(data.override.updated_at)} bởi ${data.override.updated_by || "—"}` : "Đang dùng cài đặt gốc (talpha_rules.json)"}</span>
                <div className="ml-auto flex gap-2">
                    {dirty && <button type="button" className={btnCls} onClick={() => setD(structuredClone(data.settings))}>Bỏ thay đổi</button>}
                    <ActionButton primary disabled={!dirty} onClick={() => save()}><Save className="h-4 w-4" /> Lưu cài đặt</ActionButton>
                </div>
            </div>
            {flash.node}

            <PagesCard data={data} post={post} />
            <RulesCard data={data} post={post} />
        </div>
    );
}

function ModelPicker({ label, value, providers, onChange, onTest }: {
    label: string; value: { provider: string; model: string }; providers: { id: string; label: string }[];
    onChange: (v: { provider: string; model: string }) => void; onTest: () => Promise<unknown>;
}) {
    const [models, setModels] = useState<string[]>([]);
    const [err, setErr] = useState("");
    const load = async () => {
        setErr("");
        try { setModels((await api<{ models: string[] }>("/api/talpha/ai-chatbot/settings", { json: { action: "list_models", provider: value.provider } })).models); }
        catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    };
    const listId = `models-${label.replace(/\W/g, "")}`;
    return (
        <div className="rounded-lg border border-border p-3">
            <div className="mb-2 text-sm font-medium">{label}</div>
            <div className="grid grid-cols-2 gap-2">
                <select className={inputCls} value={value.provider} onChange={(e) => { onChange({ ...value, provider: e.target.value }); setModels([]); }}>
                    {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                <input className={inputCls} list={listId} value={value.model} onChange={(e) => onChange({ ...value, model: e.target.value.trim() })} placeholder="tên model" />
                <datalist id={listId}>{models.map((m) => <option key={m} value={m} />)}</datalist>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
                <ActionButton onClick={load}>Tải danh sách model</ActionButton>
                <ActionButton onClick={onTest} title="Gọi thử model đã LƯU (lưu cài đặt trước)">Test kết nối</ActionButton>
            </div>
            {err && <p className="mt-1 text-xs text-rose-600">{err}</p>}
            {models.length > 0 && <p className="mt-1 text-[11px] text-muted-foreground">{models.length} model — gõ vào ô tên model để chọn</p>}
        </div>
    );
}

function KeyRow({ kind, label, status, onSave, onDelete }: {
    kind: string; label: string; status: { has: boolean; masked: string; via: string | null }; onSave: (v: string) => Promise<unknown>; onDelete: () => Promise<unknown>;
}) {
    const [v, setV] = useState("");
    return (
        <div className="rounded-lg border border-border p-3 text-sm">
            <div className="mb-1 flex items-center gap-2"><span className="font-medium">{label}</span>
                {status?.has ? <Pill tone="green">{status.masked}{status.via && status.via !== label ? ` · ${status.via}` : ""}</Pill> : <Pill tone="amber">chưa có</Pill>}</div>
            <div className="flex gap-2">
                <input type="password" autoComplete="off" className={inputCls} value={v} onChange={(e) => setV(e.target.value)} placeholder="Dán khoá mới" />
                <ActionButton primary disabled={v.trim().length < 10} onClick={async () => { await onSave(v.trim()); setV(""); }}>Thử + lưu</ActionButton>
                {status?.has && status.via !== "GEMINI_API_KEY" && <ActionButton onClick={onDelete} title="Xoá khoá"><Trash2 className="h-4 w-4" /></ActionButton>}
            </div>
            {kind === "telegram" && <p className="mt-1 text-[11px] text-muted-foreground">Tạo bot bằng @BotFather, thêm bot vào nhóm Sale, lấy chat id nhóm.</p>}
        </div>
    );
}

const STATUS_TONE: Record<string, "green" | "blue" | "amber" | "red" | "slate"> = {
    running: "green", running_read_only: "blue", off: "slate", auto_off: "slate", no_market: "amber", no_plan: "red",
    no_permission: "red", no_token: "amber", other_bot: "amber", error: "red",
};

function PagesCard({ data, post }: { data: Data; post: (b: Record<string, unknown>, m?: (r: any) => string) => Promise<any> }) {
    const [filter, setFilter] = useState("");
    const [onlyIssues, setOnlyIssues] = useState(false);
    const [tokenFor, setTokenFor] = useState<string | null>(null);
    const [token, setToken] = useState("");
    const rows = data.pages
        .filter((p) => !filter || `${p.name} ${p.market || ""} ${p.page_id}`.toLowerCase().includes(filter.toLowerCase()))
        .filter((p) => !onlyIssues || (!p.enabled && p.mode !== "off"))
        .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
    const running = data.pages.filter((p) => p.enabled).length;
    return (
        <Card title={`Page (${running} đang chạy / ${data.pages.length})`} actions={<>
            <input className={cn(inputCls, "w-44")} placeholder="Lọc page" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> Chỉ page chưa chạy</label>
            <ActionButton onClick={() => post({ action: "read_page_tokens" }, (r) => `Đọc được ${r.found} token page, lưu mới ${r.saved}${r.errors?.length ? ` · lỗi: ${r.errors.join("; ")}` : ""}${r.note ? ` · ${r.note}` : ""}`)}
                title="Máy tự làm việc này mỗi 30 phút — bấm khi vừa nối page mới và không muốn chờ">
                <KeyRound className="h-3.5 w-3.5" /> Đọc token ngay</ActionButton>
        </>}>
            <p className="mb-2 text-xs text-muted-foreground">Không cần làm gì với từng page: page mới tự chạy, token tự đọc (token đang dùng — không sinh mới), page die / hết gói / đang có bot khác thì tự nghỉ.
                Chỉ đổi <b>Chế độ</b> khi muốn ép <b>Luôn bật</b> (page chưa gán nước) hoặc <b>Tắt</b> một page.</p>
            <div className="max-h-[460px] overflow-auto">
                <table className="w-full min-w-[640px] text-sm">
                    <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground"><tr><th className="py-1.5 pr-2">Page</th><th className="pr-2">Nước</th><th className="pr-2">Trạng thái</th><th className="pr-2">Token page</th><th>Chế độ</th></tr></thead>
                    <tbody>
                        {rows.map((p) => (
                            <tr key={p.page_id} className="border-t border-border/50 align-top">
                                <td className="py-1.5 pr-2">{p.name}<div className="text-[11px] text-muted-foreground">{p.page_id}{p.last_poll_at ? ` · quét ${fmtTime(p.last_poll_at)}` : ""}</div></td>
                                <td className="pr-2">{p.market || "—"}</td>
                                <td className="pr-2"><Pill tone={STATUS_TONE[p.status] || "slate"}>{p.status_label}</Pill>
                                    {p.health_detail && <div className="mt-0.5 max-w-[260px] truncate text-[11px] text-rose-500" title={p.health_detail}>{p.health_detail}</div>}</td>
                                <td className="pr-2">
                                    {tokenFor === p.page_id ? (
                                        <div className="flex gap-1"><input type="password" className={cn(inputCls, "w-36")} value={token} onChange={(e) => setToken(e.target.value)} placeholder="page_access_token" />
                                            <ActionButton primary onClick={async () => { await post({ action: "save_page_token", page_id: p.page_id, token: token.trim() }, () => "Đã lưu token page"); setTokenFor(null); setToken(""); }}>Lưu</ActionButton></div>
                                    ) : (
                                        <div className="flex items-center gap-1">{p.has_page_token ? <Pill tone="green">tự đọc / có</Pill> : <Pill tone="slate">chưa</Pill>}
                                            <button type="button" className="text-[11px] text-muted-foreground underline" onClick={() => { setTokenFor(p.page_id); setToken(""); }}>dán tay</button></div>
                                    )}
                                </td>
                                <td>
                                    <select className={cn(inputCls, "w-32 py-1 text-xs")} value={p.mode}
                                        onChange={(e) => post({ action: "set_page", page_id: p.page_id, mode: e.target.value }, () => "Đã đổi chế độ page")}>
                                        <option value="auto">Tự động</option><option value="on">Luôn bật</option><option value="off">Tắt</option>
                                    </select>
                                </td>
                            </tr>
                        ))}
                        {!rows.length && <tr><td colSpan={5} className="py-6 text-center text-xs text-muted-foreground">Không có page nào khớp.</td></tr>}
                    </tbody>
                </table>
            </div>
        </Card>
    );
}

const RULE_KINDS: Record<string, string> = { first_message: "Tin nhắn đầu tiên", keyword: "Từ khoá", regex: "Mẫu regex", intent: "Ý định" };

function RulesCard({ data, post }: { data: Data; post: (b: Record<string, unknown>, m?: (r: any) => string) => Promise<any> }) {
    const [f, setF] = useState({ kind: "keyword", pattern: "", page_id: "", note: "" });
    return (
        <details className="rounded-xl border border-border bg-card p-3 md:p-4">
        <summary className="cursor-pointer text-sm font-semibold">Sổ luật trả lời tự động của POS ({data.pos_rules.filter((r) => r.enabled).length} luật đang bật) — dùng chung mọi page</summary>
        <div className="mt-3">
            <p className="mb-2 text-xs text-muted-foreground">Pancake không có API đọc luật trả lời tự động — khai lại ở đây những luật POS / Botcake đang chạy. Ngoài sổ này, AI luôn chờ
                “ân hạn POS” rồi đọc lại hội thoại: POS / Botcake / Sale đã trả lời thì AI im. Ý định: price, shipping, promotion, product_info… (phẩy ngăn cách).</p>
            <table className="mb-3 w-full text-sm">
                <tbody>
                    {data.pos_rules.map((r) => (
                        <tr key={r.id} className={cn("border-t border-border/50", !r.enabled && "opacity-50")}>
                            <td className="py-1.5 pr-2">{RULE_KINDS[r.kind] || r.kind}</td>
                            <td className="pr-2 font-mono text-xs">{r.pattern || "—"}</td>
                            <td className="pr-2 text-xs text-muted-foreground">{r.page_name || "mọi page"}{r.note ? ` · ${r.note}` : ""}</td>
                            <td className="text-right"><button type="button" className="text-xs underline" onClick={() => post({ action: "save_rule", id: r.id, kind: r.kind, pattern: r.pattern, page_id: r.page_id, note: r.note, enabled: !r.enabled }, () => (r.enabled ? "Đã tắt luật" : "Đã bật luật"))}>{r.enabled ? "Tắt" : "Bật"}</button></td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <div className="grid gap-2 md:grid-cols-5">
                <select className={inputCls} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(RULE_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <input className={cn(inputCls, "md:col-span-2")} value={f.pattern} disabled={f.kind === "first_message"} onChange={(e) => setF({ ...f, pattern: e.target.value })}
                    placeholder={f.kind === "intent" ? "price, shipping" : f.kind === "regex" ? "^\\s*\\d{9,12}\\s*$" : "bảng giá, freeship"} />
                <select className={inputCls} value={f.page_id} onChange={(e) => setF({ ...f, page_id: e.target.value })}>
                    <option value="">Mọi page</option>{data.pages.filter((p) => p.enabled).map((p) => <option key={p.page_id} value={p.page_id}>{p.name}</option>)}</select>
                <ActionButton primary onClick={async () => { const r = await post({ action: "save_rule", ...f, page_id: f.page_id || null, note: f.note || null }, () => "Đã thêm luật"); if (r) setF({ ...f, pattern: "" }); }}><Plus className="h-4 w-4" /> Thêm luật</ActionButton>
            </div>
        </div>
        </details>
    );
}
