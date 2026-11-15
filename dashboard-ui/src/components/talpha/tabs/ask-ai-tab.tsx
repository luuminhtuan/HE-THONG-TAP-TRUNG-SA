"use client";

// ═══════════════════════════════════════════════════════════════════
// Hỏi AI (15/11/2026) — trang riêng /talpha/ask-ai, chỉ giám đốc. Trước là ô nhỏ ở cuối Tổng quan.
//
// Hỏi bằng tiếng Việt → /api/talpha/ceo-ask: Gemini tự viết câu SQL (chạy bằng vai CHỈ ĐỌC), đọc kết
// quả rồi trả lời. Một câu mất 5–40 giây (Gemini nghĩ + vài lượt truy vấn, model quá tải thì đổi model)
// nên màn chờ phải nói đang làm gì và đã chờ bao lâu. Lịch sử hỏi giữ trong phiên trình duyệt
// (sessionStorage) để chuyển tab rồi quay lại không mất.
// ═══════════════════════════════════════════════════════════════════
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { format } from "date-fns";
import ReactMarkdown from "react-markdown";
import { Bot, ChevronDown, Database, Loader2, RotateCcw, Send, Trash2 } from "lucide-react";
import { cn } from "../utils";

type Luot = {
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
    loi?: string;
};

const GOI_Y = [
    "Tháng này mỗi nước bao nhiêu đơn, doanh số bao nhiêu?",
    "Marketer nào ROAS cao nhất tháng này?",
    "Sản phẩm nào bán chạy nhất tháng này?",
    "Campaign nào tiêu nhiều tiền mà không ra đơn?",
    "Tỷ lệ giao thành công của từng nước tháng này?",
    "Ngày nào doanh số cao nhất tháng này?",
];

/** Câu nói ở màn chờ theo số giây đã chờ — API không báo từng bước, đây là các bước thường gặp. */
const BUOC: [number, string][] = [
    [0, "Đang hiểu câu hỏi…"],
    [4, "Đang truy vấn kho số…"],
    [14, "Đang đọc kết quả, soạn câu trả lời…"],
    [35, "Gemini đang chậm — máy đang thử model khác…"],
];
const buocLuc = (giay: number) => [...BUOC].reverse().find(([s]) => giay >= s)?.[1] ?? BUOC[0][1];

const KHO_PHIEN = "talpha-hoi-ai";

// ─── Hiển thị câu trả lời: markdown + bảng ─────────────────────────────────────
// react-markdown thuần không vẽ bảng (cần remark-gfm). Tách khối bảng "| … |" ra tự vẽ, phần còn lại để
// react-markdown lo.
type Khoi = { loai: "chu"; text: string } | { loai: "bang"; dau: string[]; dong: string[][] };
const laDongBang = (s: string) => /^\s*\|.*\|\s*$/.test(s);
const laDongKe = (s: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(s);
const tachO = (s: string) => s.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((x) => x.trim());

function tachKhoi(md: string): Khoi[] {
    const dong = md.split("\n");
    const out: Khoi[] = [];
    let chu: string[] = [];
    const xongChu = () => { if (chu.join("").trim()) out.push({ loai: "chu", text: chu.join("\n") }); chu = []; };
    for (let i = 0; i < dong.length; i++) {
        if (laDongBang(dong[i]) && i + 1 < dong.length && laDongKe(dong[i + 1])) {
            xongChu();
            const dau = tachO(dong[i]);
            const than: string[][] = [];
            i += 2;
            while (i < dong.length && laDongBang(dong[i])) { than.push(tachO(dong[i])); i++; }
            i--;
            out.push({ loai: "bang", dau, dong: than });
        } else {
            chu.push(dong[i]);
        }
    }
    xongChu();
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
const MD_O = { ...MD, p: ({ children }: { children?: ReactNode }) => <Fragment>{children}</Fragment> };

function TraLoi({ text }: { text: string }) {
    return (
        <div className="text-sm text-foreground/90">
            {tachKhoi(text).map((k, i) => k.loai === "chu"
                ? <ReactMarkdown key={i} components={MD}>{k.text}</ReactMarkdown>
                : (
                    <div key={i} className="my-3 overflow-x-auto rounded-lg border border-border">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/50">
                                <tr>{k.dau.map((c, j) => (
                                    <th key={j} className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
                                        <ReactMarkdown components={MD_O}>{c}</ReactMarkdown>
                                    </th>
                                ))}</tr>
                            </thead>
                            <tbody>
                                {k.dong.map((d, r) => (
                                    <tr key={r} className="border-t border-border/60">
                                        {d.map((c, j) => (
                                            <td key={j} className={cn("px-3 py-2 tabular-nums", j > 0 && /^[\s*\d.,%\-+−₫đ$NT]*(tr|tỷ|k|VND|VNĐ|đơn)?[\s*]*$/i.test(c) && "text-right")}>
                                                <ReactMarkdown components={MD_O}>{c}</ReactMarkdown>
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
    const [luot, setLuot] = useState<Luot[]>(() => {
        try {
            const raw = typeof window !== "undefined" ? sessionStorage.getItem(KHO_PHIEN) : null;
            // Lượt đang chờ lúc rời trang thì coi như mất (yêu cầu đã đứt).
            return raw ? (JSON.parse(raw) as Luot[]).map((x) => x.trang_thai === "dang"
                ? { ...x, trang_thai: "loi" as const, loi: "Đã rời trang khi đang chờ — hỏi lại nhé." } : x) : [];
        } catch { return []; }
    });
    const [cauHoi, setCauHoi] = useState("");
    const [bayGio, setBayGio] = useState(() => Date.now());
    const [moSql, setMoSql] = useState<Record<string, boolean>>({});
    const cuoiRef = useRef<HTMLDivElement>(null);
    const oNhapRef = useRef<HTMLTextAreaElement>(null);

    const dangCho = luot.some((x) => x.trang_thai === "dang");
    const tu = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : undefined;
    const den = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : undefined;

    useEffect(() => {
        try { sessionStorage.setItem(KHO_PHIEN, JSON.stringify(luot.slice(-30))); } catch { /* chế độ riêng tư */ }
    }, [luot]);

    // Đồng hồ màn chờ.
    useEffect(() => {
        if (!dangCho) return;
        const t = setInterval(() => setBayGio(Date.now()), 1000);
        return () => clearInterval(t);
    }, [dangCho]);

    // Có lượt mới / vừa có câu trả lời → cuộn xuống cuối.
    useEffect(() => {
        cuoiRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, [luot.length, luot[luot.length - 1]?.trang_thai]);

    const hoi = useCallback(async (q: string) => {
        const hoiGi = q.trim();
        if (!hoiGi || dangCho) return;
        const id = `${Date.now()}`;
        const batDau = Date.now();
        setLuot((ds) => [...ds, { id, hoi: hoiGi, tu, den, trang_thai: "dang", bat_dau: batDau }]);
        setCauHoi("");
        setBayGio(Date.now());
        const capNhat = (p: Partial<Luot>) => setLuot((ds) => ds.map((x) => (x.id === id ? { ...x, ...p } : x)));
        try {
            const r = await fetch("/api/talpha/ceo-ask", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question: hoiGi, from: tu, to: den }),
            });
            const j = await r.json().catch(() => ({ error: `Máy chủ trả lỗi (HTTP ${r.status})` }));
            const giay = Math.round((Date.now() - batDau) / 1000);
            if (!r.ok) capNhat({ trang_thai: "loi", loi: j.error || `HTTP ${r.status}`, giay });
            else capNhat({ trang_thai: "xong", tra_loi: j.answer || "", queries: j.queries || [], model: j.model, giay });
        } catch {
            capNhat({ trang_thai: "loi", loi: "Không gửi được — kiểm mạng rồi hỏi lại.", giay: Math.round((Date.now() - batDau) / 1000) });
        } finally {
            oNhapRef.current?.focus();
        }
    }, [dangCho, tu, den]);

    const khoang = dateRange ? `${format(dateRange.from, "dd/MM/yyyy")} – ${format(dateRange.to, "dd/MM/yyyy")}` : "";

    return (
        <div className="mx-auto flex max-w-4xl flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
                        <Bot className="h-5 w-5 text-indigo-500" /> Hỏi AI về số liệu
                    </h2>
                    <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
                        Hỏi bằng tiếng Việt — AI tự truy vấn kho số (chỉ đọc) rồi trả lời. Câu hỏi không nói ngày thì tính theo
                        khoảng đang chọn ở góc trên{khoang ? <> (<b className="font-medium text-foreground">{khoang}</b>)</> : null}.
                        Đổi model ở Quản trị → Khoá kết nối → tab Gemini.
                    </p>
                </div>
                {luot.length > 0 && !dangCho && (
                    <button type="button" onClick={() => setLuot([])}
                        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
                        <Trash2 className="h-3.5 w-3.5" /> Xoá cuộc hỏi
                    </button>
                )}
            </div>

            {luot.length === 0 && (
                <div className="rounded-xl border border-dashed border-border bg-card/50 p-5">
                    <p className="mb-3 text-sm font-medium text-foreground">Thử hỏi:</p>
                    <div className="flex flex-wrap gap-2">
                        {GOI_Y.map((g) => (
                            <button key={g} type="button" onClick={() => hoi(g)}
                                className="rounded-full border border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                                {g}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className="space-y-5">
                {luot.map((x) => {
                    const giayCho = Math.max(0, Math.floor((bayGio - x.bat_dau) / 1000));
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
                                                <span>{buocLuc(giayCho)}</span>
                                                <span className="tabular-nums text-xs text-muted-foreground">{giayCho} giây</span>
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
                                            <button type="button" onClick={() => hoi(x.hoi)} disabled={dangCho}
                                                className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:underline disabled:opacity-50 dark:text-indigo-300">
                                                <RotateCcw className="h-3 w-3" /> Hỏi lại
                                            </button>
                                        </div>
                                    )}
                                    {x.trang_thai === "xong" && (
                                        <>
                                            <TraLoi text={x.tra_loi || "Chưa lấy được câu trả lời — thử hỏi cụ thể hơn."} />
                                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
                                                {x.model && <span className="font-mono">{x.model}</span>}
                                                {x.giay != null && <span>{x.giay} giây</span>}
                                                {x.tu && x.den && <span>khoảng {x.tu} → {x.den}</span>}
                                                {(x.queries?.length ?? 0) > 0 && (
                                                    <button type="button" onClick={() => setMoSql((m) => ({ ...m, [x.id]: !m[x.id] }))}
                                                        className="inline-flex items-center gap-1 hover:text-foreground">
                                                        <Database className="h-3 w-3" /> {x.queries!.length} truy vấn đã chạy
                                                        <ChevronDown className={cn("h-3 w-3 transition-transform", moSql[x.id] && "rotate-180")} />
                                                    </button>
                                                )}
                                            </div>
                                            {moSql[x.id] && (
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
                <div ref={cuoiRef} />
            </div>

            {/* Ô hỏi — dính đáy vùng nội dung */}
            <div className="sticky bottom-0 -mx-3 border-t border-border bg-background/95 px-3 pb-3 pt-3 backdrop-blur md:-mx-6 md:px-6">
                <div className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm focus-within:ring-2 focus-within:ring-indigo-500/30">
                    <textarea
                        ref={oNhapRef}
                        value={cauHoi}
                        onChange={(e) => setCauHoi(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); hoi(cauHoi); }
                        }}
                        rows={2}
                        placeholder="Hỏi về đơn, doanh số, quảng cáo, marketer… (Enter để gửi, Shift+Enter xuống dòng)"
                        className="max-h-40 min-h-[44px] flex-1 resize-y bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                    />
                    <button
                        type="button"
                        onClick={() => hoi(cauHoi)}
                        disabled={dangCho || !cauHoi.trim()}
                        aria-label="Gửi câu hỏi"
                        className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-indigo-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-indigo-600 disabled:opacity-50"
                    >
                        {dangCho ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        {dangCho ? "Đang trả lời…" : "Hỏi"}
                    </button>
                </div>
            </div>
        </div>
    );
}
