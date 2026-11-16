"use client";

// ═══════════════════════════════════════════════════════════════════
// Hỏi AI (15/11/2026) — trang riêng /talpha/ask-ai, chỉ giám đốc. Trước là ô nhỏ ở cuối Tổng quan.
//
// Hỏi bằng tiếng Việt → /api/talpha/ceo-ask: Gemini tự viết câu SQL (chạy bằng vai CHỈ ĐỌC), đọc kết
// quả rồi trả lời. Một câu mất 5–40 giây (Gemini nghĩ + vài lượt truy vấn, model quá tải thì đổi model)
// nên màn chờ phải nói đang làm gì và đã chờ bao lâu. Lịch sử hỏi giữ trong phiên trình duyệt
// (sessionStorage) để chuyển tab rồi quay lại không mất.
//
// Khoá AI riêng (16/11/2026): khoá mặc định hết lượt thì người hỏi dán khoá Gemini khác ở nút "Khoá AI".
// Khoá chỉ nằm trong localStorage của TRÌNH DUYỆT NÀY (máy khác / trình duyệt khác không thấy, không
// dùng chung), gửi kèm từng câu hỏi; xoá đi là quay về khoá mặc định. Xem lib/talpha/gemini-key.ts.
// ═══════════════════════════════════════════════════════════════════
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { format } from "date-fns";
import ReactMarkdown from "react-markdown";
import { Bot, Check, ChevronDown, Database, Eye, EyeOff, KeyRound, Loader2, RotateCcw, Send, Trash2, X } from "lucide-react";
import { cn } from "../utils";
import { GEMINI_KEY_HEADER, GEMINI_KEY_STORAGE, maskKey, isValidGeminiKey, type GeminiKeySource } from "@/lib/talpha/gemini-key";

type Turn = {
    id: string;
    hoi: string;
    tu?: string;
    den?: string;
    trang_thai: "dang" | "xong" | "loi";
    bat_dau: number;
    giay?: number;
    tra_loi?: string;
    queries?: string[];
    model?: string;
    nguon_khoa?: GeminiKeySource;
    loi?: string;
};

/** localStorage có thể ném lỗi (chặn dữ liệu trang, chế độ riêng tư) — đọc / ghi đều bọc lại. */
function readBrowserKey(): string {
    try { return localStorage.getItem(GEMINI_KEY_STORAGE) || ""; } catch { return ""; }
}

// ─── Ô khoá AI riêng của trình duyệt này ──────────────────────────────────────
function AiKeyPanel({ khoa: apiKey, onDoi: onChange, onDong: onClose }: { khoa: string; onDoi: (k: string) => void; onDong: () => void }) {
    const [draft, setDraft] = useState("");
    const [revealed, setRevealed] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    const save = async () => {
        const k = draft.trim();
        setError(""); setNotice("");
        if (!isValidGeminiKey(k)) { setError("Khoá không đúng dạng — khoá Gemini thường bắt đầu bằng AIza…"); return; }
        setSaving(true);
        try {
            // Kiểm khoá trước khi lưu: khoá sai thì không lưu, người hỏi khỏi tưởng đã đổi được.
            const r = await fetch("/api/talpha/ceo-ask/check-key", { method: "POST", headers: { [GEMINI_KEY_HEADER]: k } });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
            try { localStorage.setItem(GEMINI_KEY_STORAGE, k); }
            catch { throw new Error("Trình duyệt đang chặn lưu dữ liệu trang (chế độ riêng tư?) — không lưu được khoá."); }
            onChange(k);
            setDraft("");
            setRevealed(false);
            setNotice(`Đã lưu trên trình duyệt này — khoá gọi được ${j.so_model} model${j.model ? `, câu hỏi sau dùng ${j.model}` : ""}.`);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setSaving(false);
        }
    };

    const remove = () => {
        try { localStorage.removeItem(GEMINI_KEY_STORAGE); } catch { /* đã không có */ }
        onChange("");
        setError("");
        setNotice("Đã xoá — từ câu hỏi sau dùng lại khoá mặc định của hệ thống.");
    };

    return (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        <KeyRound className="h-4 w-4 text-indigo-500" /> Khoá Gemini riêng của trình duyệt này
                    </p>
                    <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                        Khoá mặc định hết lượt thì dán khoá Gemini khác vào đây. Khoá <b className="font-medium text-foreground">chỉ lưu trên
                        trình duyệt này</b> — máy khác, trình duyệt khác không thấy và không dùng chung. Có khoá ở đây thì mọi câu hỏi
                        dùng khoá này; xoá đi thì dùng lại khoá mặc định. Hạn mức Google tính theo project: khoá mới tạo trong
                        cùng project vẫn hết lượt.
                    </p>
                </div>
                <button type="button" onClick={onClose} aria-label="Đóng"
                    className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                    <X className="h-4 w-4" />
                </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground">Đang dùng:</span>
                {apiKey ? (
                    <>
                        <span className="rounded-md bg-indigo-500/10 px-2 py-1 font-mono text-indigo-600 dark:text-indigo-300">Khoá riêng {maskKey(apiKey)}</span>
                        <button type="button" onClick={remove}
                            className="flex items-center gap-1 rounded-md px-2 py-1 font-medium text-rose-600 hover:bg-rose-500/10 dark:text-rose-400">
                            <Trash2 className="h-3 w-3" /> Xoá, dùng khoá mặc định
                        </button>
                    </>
                ) : (
                    <span className="rounded-md bg-muted px-2 py-1 font-medium text-foreground">Khoá mặc định của hệ thống</span>
                )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[16rem] flex-1">
                    <input
                        type={revealed ? "text" : "password"}
                        value={draft}
                        onChange={(e) => { setDraft(e.target.value); setError(""); setNotice(""); }}
                        onKeyDown={(e) => { if (e.key === "Enter" && !saving) save(); }}
                        placeholder={apiKey ? "Dán khoá mới để thay (AIza…)" : "Dán khoá Gemini (AIza…)"}
                        autoComplete="off"
                        spellCheck={false}
                        data-1p-ignore
                        data-lpignore="true"
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 pr-9 font-mono text-sm text-foreground placeholder:font-sans placeholder:text-muted-foreground focus:border-indigo-500 focus:outline-none"
                    />
                    <button type="button" onClick={() => setRevealed((v) => !v)} aria-label={revealed ? "Ẩn khoá" : "Xem khoá"}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                        {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                </div>
                <button type="button" onClick={save} disabled={saving || !draft.trim()}
                    className="flex h-9 items-center gap-1.5 rounded-lg bg-indigo-500 px-3 text-xs font-semibold text-white hover:bg-indigo-600 disabled:opacity-50">
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    {saving ? "Đang kiểm khoá…" : "Kiểm tra & lưu"}
                </button>
            </div>
            <p className="text-[11px] text-muted-foreground">
                Lấy khoá ở{" "}
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline dark:text-indigo-300">
                    aistudio.google.com/apikey
                </a>.
            </p>
            {notice && <p className="text-xs text-emerald-600 dark:text-emerald-400">{notice}</p>}
            {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
        </div>
    );
}

const SUGGESTIONS = [
    "Tháng này mỗi nước bao nhiêu đơn, doanh số bao nhiêu?",
    "Marketer nào ROAS cao nhất tháng này?",
    "Sản phẩm nào bán chạy nhất tháng này?",
    "Campaign nào tiêu nhiều tiền mà không ra đơn?",
    "Tỷ lệ giao thành công của từng nước tháng này?",
    "Ngày nào doanh số cao nhất tháng này?",
];

/** Câu nói ở màn chờ theo số giây đã chờ — API không báo từng bước, đây là các bước thường gặp. */
const STEPS: [number, string][] = [
    [0, "Đang hiểu câu hỏi…"],
    [4, "Đang truy vấn kho số…"],
    [14, "Đang đọc kết quả, soạn câu trả lời…"],
    [35, "Gemini đang chậm — máy đang thử model khác…"],
];
const stepAt = (seconds: number) => [...STEPS].reverse().find(([s]) => seconds >= s)?.[1] ?? STEPS[0][1];

const SESSION_KEY = "talpha-hoi-ai";

// ─── Hiển thị câu trả lời: markdown + bảng ─────────────────────────────────────
// react-markdown thuần không vẽ bảng (cần remark-gfm). Tách khối bảng "| … |" ra tự vẽ, phần còn lại để
// react-markdown lo.
type Block = { loai: "chu"; text: string } | { loai: "bang"; dau: string[]; dong: string[][] };
const isTableRow = (s: string) => /^\s*\|.*\|\s*$/.test(s);
const isSeparatorRow = (s: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(s);
const splitCells = (s: string) => s.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((x) => x.trim());

function splitBlocks(md: string): Block[] {
    const lines = md.split("\n");
    const out: Block[] = [];
    let textLines: string[] = [];
    const flushText = () => { if (textLines.join("").trim()) out.push({ loai: "chu", text: textLines.join("\n") }); textLines = []; };
    for (let i = 0; i < lines.length; i++) {
        if (isTableRow(lines[i]) && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
            flushText();
            const header = splitCells(lines[i]);
            const bodyRows: string[][] = [];
            i += 2;
            while (i < lines.length && isTableRow(lines[i])) { bodyRows.push(splitCells(lines[i])); i++; }
            i--;
            out.push({ loai: "bang", dau: header, dong: bodyRows });
        } else {
            textLines.push(lines[i]);
        }
    }
    flushText();
    return out;
}

const MD = {
    p: ({ children }: { children?: ReactNode }) => <p className="my-2 leading-relaxed">{children}</p>,
    ul: ({ children }: { children?: ReactNode }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
    ol: ({ children }: { children?: ReactNode }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
    strong: ({ children }: { children?: ReactNode }) => <strong className="font-semibold text-foreground">{children}</strong>,
    h1: ({ children }: { children?: ReactNode }) => <p className="mt-3 font-semibold text-foreground">{children}</p>,
    h2: ({ children }: { children?: ReactNode }) => <p className="mt-3 font-semibold text-foreground">{children}</p>,
    h3: ({ children }: { children?: ReactNode }) => <p className="mt-3 font-semibold text-foreground">{children}</p>,
    code: ({ children }: { children?: ReactNode }) => <code className="rounded bg-muted px-1 py-0.5 text-[0.85em]">{children}</code>,
};
// Trong ô bảng: bỏ thẻ <p> bọc ngoài để chữ đậm / số nằm gọn trên một dòng.
const MD_CELL = { ...MD, p: ({ children }: { children?: ReactNode }) => <Fragment>{children}</Fragment> };

function AnswerView({ text }: { text: string }) {
    return (
        <div className="text-sm text-foreground/90">
            {splitBlocks(text).map((k, i) => k.loai === "chu"
                ? <ReactMarkdown key={i} components={MD}>{k.text}</ReactMarkdown>
                : (
                    <div key={i} className="my-3 overflow-x-auto rounded-lg border border-border">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/50">
                                <tr>{k.dau.map((c, j) => (
                                    <th key={j} className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
                                        <ReactMarkdown components={MD_CELL}>{c}</ReactMarkdown>
                                    </th>
                                ))}</tr>
                            </thead>
                            <tbody>
                                {k.dong.map((d, r) => (
                                    <tr key={r} className="border-t border-border/60">
                                        {d.map((c, j) => (
                                            <td key={j} className={cn("px-3 py-2 tabular-nums", j > 0 && /^[\s*\d.,%\-+−₫đ$NT]*(tr|tỷ|k|VND|VNĐ|đơn)?[\s*]*$/i.test(c) && "text-right")}>
                                                <ReactMarkdown components={MD_CELL}>{c}</ReactMarkdown>
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ))}
        </div>
    );
}

// ─── Trang ─────────────────────────────────────────────────────────────────────
export default function AskAiTab({ dateRange }: { dateRange?: { from: Date; to: Date } }) {
    const [turns, setTurns] = useState<Turn[]>(() => {
        try {
            const raw = typeof window !== "undefined" ? sessionStorage.getItem(SESSION_KEY) : null;
            // Lượt đang chờ lúc rời trang thì coi như mất (yêu cầu đã đứt).
            return raw ? (JSON.parse(raw) as Turn[]).map((x) => x.trang_thai === "dang"
                ? { ...x, trang_thai: "loi" as const, loi: "Đã rời trang khi đang chờ — hỏi lại nhé." } : x) : [];
        } catch { return []; }
    });
    const [question, setQuestion] = useState("");
    const [now, setNow] = useState(() => Date.now());
    const [sqlOpen, setSqlOpen] = useState<Record<string, boolean>>({});
    const [browserKey, setBrowserKey] = useState("");
    const [keyPanelOpen, setKeyPanelOpen] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const topRef = useRef<HTMLDivElement>(null);

    // Khoá riêng đọc sau khi gắn trang (localStorage không có lúc dựng ở máy chủ). Tab khác của cùng trình
    // duyệt đổi / xoá khoá thì tab này theo luôn.
    useEffect(() => {
        setBrowserKey(readBrowserKey());
        const onStorage = (e: StorageEvent) => { if (e.key === GEMINI_KEY_STORAGE || e.key === null) setBrowserKey(readBrowserKey()); };
        window.addEventListener("storage", onStorage);
        return () => window.removeEventListener("storage", onStorage);
    }, []);

    const openKeyPanel = () => {
        setKeyPanelOpen(true);
        topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    const isWaiting = turns.some((x) => x.trang_thai === "dang");
    const fromDate = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : undefined;
    const toDate = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : undefined;

    useEffect(() => {
        try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(turns.slice(-30))); } catch { /* chế độ riêng tư */ }
    }, [turns]);

    // Đồng hồ màn chờ.
    useEffect(() => {
        if (!isWaiting) return;
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, [isWaiting]);

    // Có lượt mới / vừa có câu trả lời → cuộn xuống cuối.
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, [turns.length, turns[turns.length - 1]?.trang_thai]);

    const ask = useCallback(async (q: string) => {
        const questionText = q.trim();
        if (!questionText || isWaiting) return;
        const id = `${Date.now()}`;
        const startedAt = Date.now();
        setTurns((ds) => [...ds, { id, hoi: questionText, tu: fromDate, den: toDate, trang_thai: "dang", bat_dau: startedAt }]);
        setQuestion("");
        setNow(Date.now());
        const updateTurn = (p: Partial<Turn>) => setTurns((ds) => ds.map((x) => (x.id === id ? { ...x, ...p } : x)));
        try {
            // Đọc lại localStorage ngay lúc hỏi: vừa đổi khoá ở tab khác vẫn dùng đúng khoá mới nhất.
            const apiKey = readBrowserKey();
            const r = await fetch("/api/talpha/ceo-ask", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(apiKey ? { [GEMINI_KEY_HEADER]: apiKey } : {}) },
                body: JSON.stringify({ question: questionText, from: fromDate, to: toDate }),
            });
            const j = await r.json().catch(() => ({ error: `Máy chủ trả lỗi (HTTP ${r.status})` }));
            const seconds = Math.round((Date.now() - startedAt) / 1000);
            const keySource: GeminiKeySource = j.key_source || (apiKey ? "trinh_duyet" : "mac_dinh");
            if (!r.ok) updateTurn({ trang_thai: "loi", loi: j.error || `HTTP ${r.status}`, giay: seconds, nguon_khoa: keySource });
            else updateTurn({ trang_thai: "xong", tra_loi: j.answer || "", queries: j.queries || [], model: j.model, giay: seconds, nguon_khoa: keySource });
        } catch {
            updateTurn({ trang_thai: "loi", loi: "Không gửi được — kiểm mạng rồi hỏi lại.", giay: Math.round((Date.now() - startedAt) / 1000) });
        } finally {
            inputRef.current?.focus();
        }
    }, [isWaiting, fromDate, toDate]);

    const rangeLabel = dateRange ? `${format(dateRange.from, "dd/MM/yyyy")} – ${format(dateRange.to, "dd/MM/yyyy")}` : "";

    return (
        <div className="mx-auto flex max-w-4xl flex-col gap-4">
            <div ref={topRef} className="flex scroll-mt-4 flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
                        <Bot className="h-5 w-5 text-indigo-500" /> Hỏi AI về số liệu
                    </h2>
                    <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
                        Hỏi bằng tiếng Việt — AI tự truy vấn kho số (chỉ đọc) rồi trả lời. Câu hỏi không nói ngày thì tính theo
                        khoảng đang chọn ở góc trên{rangeLabel ? <> (<b className="font-medium text-foreground">{rangeLabel}</b>)</> : null}.
                        Đổi model ở Quản trị → Khoá kết nối → tab Gemini.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                    <button type="button" onClick={() => (keyPanelOpen ? setKeyPanelOpen(false) : openKeyPanel())} aria-expanded={keyPanelOpen}
                        title={browserKey ? "Đang hỏi bằng khoá Gemini riêng lưu trên trình duyệt này" : "Đang hỏi bằng khoá Gemini mặc định của hệ thống"}
                        className={cn("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                            browserKey
                                ? "bg-indigo-500/10 text-indigo-600 hover:bg-indigo-500/15 dark:text-indigo-300"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                        <KeyRound className="h-3.5 w-3.5" />
                        Khoá AI: {browserKey ? <span className="font-mono">riêng {maskKey(browserKey)}</span> : "mặc định"}
                    </button>
                    {turns.length > 0 && !isWaiting && (
                        <button type="button" onClick={() => setTurns([])}
                            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
                            <Trash2 className="h-3.5 w-3.5" /> Xoá cuộc hỏi
                        </button>
                    )}
                </div>
            </div>

            {keyPanelOpen && <AiKeyPanel khoa={browserKey} onDoi={setBrowserKey} onDong={() => setKeyPanelOpen(false)} />}

            {turns.length === 0 && (
                <div className="rounded-xl border border-dashed border-border bg-card/50 p-5">
                    <p className="mb-3 text-sm font-medium text-foreground">Thử hỏi:</p>
                    <div className="flex flex-wrap gap-2">
                        {SUGGESTIONS.map((g) => (
                            <button key={g} type="button" onClick={() => ask(g)}
                                className="rounded-full border border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                                {g}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className="space-y-5">
                {turns.map((x) => {
                    const waitSeconds = Math.max(0, Math.floor((now - x.bat_dau) / 1000));
                    return (
                        <div key={x.id} className="space-y-2">
                            {/* Câu hỏi */}
                            <div className="flex justify-end">
                                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-indigo-500 px-4 py-2.5 text-sm text-white shadow-sm">
                                    {x.hoi}
                                </div>
                            </div>
                            {/* Trả lời / đang chờ / lỗi */}
                            <div className="flex gap-2.5">
                                <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-500/10">
                                    <Bot className="h-4 w-4 text-indigo-500" />
                                </div>
                                <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md border border-border bg-card px-4 py-3 shadow-sm">
                                    {x.trang_thai === "dang" && (
                                        <div role="status" aria-live="polite" className="space-y-3">
                                            <div className="flex items-center gap-2 text-sm text-indigo-600 dark:text-indigo-300">
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                <span>{stepAt(waitSeconds)}</span>
                                                <span className="tabular-nums text-xs text-muted-foreground">{waitSeconds} giây</span>
                                            </div>
                                            <div className="space-y-2" aria-hidden>
                                                <div className="h-3 w-11/12 animate-pulse rounded bg-muted" />
                                                <div className="h-3 w-9/12 animate-pulse rounded bg-muted" />
                                                <div className="h-3 w-10/12 animate-pulse rounded bg-muted" />
                                            </div>
                                            <p className="text-[11px] text-muted-foreground">Thường mất 5–40 giây. Cứ để trang mở, có câu trả lời sẽ hiện ở đây.</p>
                                        </div>
                                    )}
                                    {x.trang_thai === "loi" && (
                                        <div className="space-y-2">
                                            <p className="text-sm text-rose-600 dark:text-rose-400">{x.loi}</p>
                                            <div className="flex flex-wrap items-center gap-4">
                                                <button type="button" onClick={() => ask(x.hoi)} disabled={isWaiting}
                                                    className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:underline disabled:opacity-50 dark:text-indigo-300">
                                                    <RotateCcw className="h-3 w-3" /> Hỏi lại
                                                </button>
                                                <button type="button" onClick={openKeyPanel}
                                                    className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-300">
                                                    <KeyRound className="h-3 w-3" /> {x.nguon_khoa === "trinh_duyet" ? "Đổi khoá AI riêng" : "Dùng khoá AI riêng"}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                    {x.trang_thai === "xong" && (
                                        <>
                                            <AnswerView text={x.tra_loi || "Chưa lấy được câu trả lời — thử hỏi cụ thể hơn."} />
                                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
                                                {x.model && <span className="font-mono">{x.model}</span>}
                                                {x.nguon_khoa && <span>{x.nguon_khoa === "trinh_duyet" ? "khoá riêng" : "khoá mặc định"}</span>}
                                                {x.giay != null && <span>{x.giay} giây</span>}
                                                {x.tu && x.den && <span>khoảng {x.tu} → {x.den}</span>}
                                                {(x.queries?.length ?? 0) > 0 && (
                                                    <button type="button" onClick={() => setSqlOpen((m) => ({ ...m, [x.id]: !m[x.id] }))}
                                                        className="inline-flex items-center gap-1 hover:text-foreground">
                                                        <Database className="h-3 w-3" /> {x.queries!.length} truy vấn đã chạy
                                                        <ChevronDown className={cn("h-3 w-3 transition-transform", sqlOpen[x.id] && "rotate-180")} />
                                                    </button>
                                                )}
                                            </div>
                                            {sqlOpen[x.id] && (
                                                <pre className="mt-2 max-h-56 overflow-auto rounded-lg border border-border bg-muted/30 p-2 text-[11px] leading-relaxed text-muted-foreground">
                                                    {x.queries!.join("\n\n— — —\n\n")}
                                                </pre>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
                <div ref={bottomRef} />
            </div>

            {/* Ô hỏi — dính đáy vùng nội dung */}
            <div className="sticky bottom-0 -mx-3 border-t border-border bg-background/95 px-3 pb-3 pt-3 backdrop-blur md:-mx-6 md:px-6">
                <div className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm focus-within:ring-2 focus-within:ring-indigo-500/30">
                    <textarea
                        ref={inputRef}
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(question); }
                        }}
                        rows={2}
                        placeholder="Hỏi về đơn, doanh số, quảng cáo, marketer… (Enter để gửi, Shift+Enter xuống dòng)"
                        className="max-h-40 min-h-[44px] flex-1 resize-y bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                    />
                    <button
                        type="button"
                        onClick={() => ask(question)}
                        disabled={isWaiting || !question.trim()}
                        aria-label="Gửi câu hỏi"
                        className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-indigo-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-indigo-600 disabled:opacity-50"
                    >
                        {isWaiting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        {isWaiting ? "Đang trả lời…" : "Hỏi"}
                    </button>
                </div>
            </div>
        </div>
    );
}
