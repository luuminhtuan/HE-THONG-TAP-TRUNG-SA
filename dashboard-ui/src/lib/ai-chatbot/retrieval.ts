// ═══════════════════════════════════════════════════════════════════
// AI Chatbot — truy xuất kiến thức / RAG (THUẦN, có test). Không đưa cả kho vào prompt: lọc theo phạm vi page → nước →
// chung, bỏ mục hết hạn, xếp hạng rồi lấy top-k trong ngân sách ký tự.
//
// Điểm 0..1 = phần trọng số (idf) của từ trong câu hỏi tìm thấy trong mục kiến thức — tiêu đề / từ khoá tính đủ, chỉ có
// trong nội dung tính 0,7; khớp gần (trigram ≥ 0,6, sai chính tả / thiếu dấu) tính theo độ giống. Mỗi câu hỏi chấm với
// từng truy vấn (câu gốc, truy vấn model viết lại, tên SP nhắc tới) rồi lấy cao nhất — truy vấn viết lại bằng tiếng Việt
// giúp khách hỏi tiếng Anh vẫn khớp kho tiếng Việt (lớp "ngữ nghĩa" không cần vector DB).
// ═══════════════════════════════════════════════════════════════════
import type { KbEntry, RetrievedItem } from "./types";
import { bigrams, expandSynonyms, normalizeText, tokenize, trigramSimilarity, type SynonymMap } from "./text";

export type RetrievalOptions = {
    topK: number;
    minScore: number;
    now: number;
    priceMaxAgeMs: number;
    /** Mục đang bàn trong hội thoại (câu hỏi tiếp nối "còn màu khác không?") — được cộng điểm. */
    boostIds?: number[];
    synonyms?: SynonymMap;
};

/** Mục dùng được cho page này: đang bật, chưa hết hạn, đúng phạm vi (page của nó → nước của page → chung). */
export function inScope(e: KbEntry, pageId: string, market: string | null, now: number): boolean {
    if (e.validUntil !== null && e.validUntil < now) return false;
    if (e.scope === "global") return true;
    if (e.scope === "market") return !!market && e.market === market;
    return e.pageId === pageId;
}

/** Giá / tồn kho đã cũ: mục sản phẩm đồng bộ từ POS mà lần đồng bộ cuối quá hạn (hoặc chưa từng). */
export function isPriceStale(e: KbEntry, now: number, maxAgeMs: number): boolean {
    if (e.kind !== "product") return false;
    if (e.syncedAt === null) return e.source === "pos_sync";
    return now - e.syncedAt > maxAgeMs;
}

type DocIndex = { strong: Set<string>; weak: Set<string>; phrases: Set<string> };

function indexEntry(e: KbEntry): DocIndex {
    const titleTok = tokenize(`${e.title} ${e.keywords.join(" ")}`);
    const bodyTok = tokenize(e.content.slice(0, 4000));
    return {
        strong: new Set(titleTok),
        weak: new Set(bodyTok),
        phrases: new Set([...bigrams(titleTok), ...bigrams(bodyTok)]),
    };
}

function idfTable(docs: DocIndex[]): Map<string, number> {
    const df = new Map<string, number>();
    for (const d of docs) for (const t of new Set([...d.strong, ...d.weak])) df.set(t, (df.get(t) || 0) + 1);
    const N = docs.length || 1;
    const out = new Map<string, number>();
    for (const [t, n] of df) out.set(t, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
    return out;
}

/** Độ khớp của một từ với tài liệu: 1 (tiêu đề/từ khoá) · 0,7 (nội dung) · khớp gần × độ giống. */
function termMatch(t: string, d: DocIndex): number {
    if (d.strong.has(t)) return 1;
    if (d.weak.has(t)) return 0.7;
    if (t.length < 4 || /^\d+$/.test(t)) return 0;
    let best = 0;
    for (const w of d.strong) if (w.length >= 3) best = Math.max(best, trigramSimilarity(t, w));
    let bestWeak = 0;
    if (best < 0.6) for (const w of d.weak) if (w.length >= 3) bestWeak = Math.max(bestWeak, trigramSimilarity(t, w));
    if (best >= 0.6) return 0.9 * best;
    return bestWeak >= 0.6 ? 0.6 * bestWeak : 0;
}

function scoreQuery(query: string, d: DocIndex, idf: Map<string, number>, maxIdf: number): { score: number; matched: string[] } {
    const qt = [...new Set(tokenize(query))];
    if (!qt.length) return { score: 0, matched: [] };
    let num = 0, den = 0;
    const matched: string[] = [];
    for (const t of qt) {
        const w = idf.get(t) ?? maxIdf;           // từ không có trong kho: trọng số cao (câu hỏi có ý mà kho không có)
        den += w;
        const m = termMatch(t, d);
        if (m > 0) { num += w * m; matched.push(t); }
    }
    let score = den ? num / den : 0;
    if (bigrams(tokenize(query)).some((b) => d.phrases.has(b))) score = Math.min(1, score + 0.08);   // khớp cả cụm ("kem chong nang")
    return { score, matched };
}

/**
 * Xếp hạng mục kiến thức cho MỘT câu hỏi. `queries` = [câu hỏi, …truy vấn viết lại, …tên SP]; mỗi mục lấy điểm cao nhất
 * qua các truy vấn. Trả top-k (không lọc minScore — nơi gọi quyết định trả lời được hay không).
 */
export function rankKnowledge(entries: KbEntry[], queries: string[], opts: RetrievalOptions): RetrievedItem[] {
    if (!entries.length) return [];
    const docs = entries.map(indexEntry);
    const idf = idfTable(docs);
    const maxIdf = Math.max(1, ...idf.values());
    const qs = queries.map((q) => expandSynonyms(q, opts.synonyms || {})).filter((q) => normalizeText(q));
    const boost = new Set(opts.boostIds || []);
    const items: RetrievedItem[] = entries.map((entry, i) => {
        let best = { score: 0, matched: [] as string[] };
        for (const q of qs) {
            const r = scoreQuery(q, docs[i], idf, maxIdf);
            if (r.score > best.score) best = r;
        }
        let score = best.score;
        if (score > 0 && boost.has(entry.id)) score = Math.min(1, score + 0.15);
        if (score > 0 && entry.scope === "page") score = Math.min(1, score + 0.03);
        return { entry, score, stalePrice: isPriceStale(entry, opts.now, opts.priceMaxAgeMs), matchedTerms: best.matched };
    });
    return items.filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.entry.id - b.entry.id).slice(0, opts.topK);
}

// ─── Dựng khối <knowledge> cho prompt ────────────────────────────────

type Variant = { name?: string; price?: number | null; stock?: number | null };

const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** Giá / tồn kho của mục sản phẩm từ metadata — CHỈ khi còn tươi. Cũ → ghi rõ để model không báo giá. */
function productFacts(e: KbEntry, stale: boolean, now: number): string {
    const md = e.metadata || {};
    const variants = Array.isArray(md.variants) ? (md.variants as Variant[]) : [];
    const currency = String(md.currency || "");
    if (!variants.length) return "";
    if (stale) {
        const names = variants.slice(0, 12).map((v) => v.name).filter(Boolean);
        return `${names.length ? `Biến thể: ${names.join(", ")}\n` : ""}Giá / tồn kho: CHƯA CẬP NHẬT — không được báo giá hay tồn kho.`;
    }
    const ageMin = e.syncedAt ? Math.round((now - e.syncedAt) / 60000) : null;
    const lines = variants.slice(0, 12).map((v) => {
        const parts = [v.name || "Mặc định"];
        if (typeof v.price === "number" && v.price > 0) parts.push(`giá ${fmtNum(v.price)} ${currency}`.trim());
        if (typeof v.stock === "number") parts.push(v.stock > 0 ? "còn hàng" : "hết hàng");
        return `- ${parts.join(", ")}`;
    });
    return `Biến thể (giá + tồn kho cập nhật ${ageMin !== null ? `${ageMin} phút trước` : "gần đây"}):\n${lines.join("\n")}`;
}

/** Khối kiến thức đưa cho model: "[#id] tiêu đề (loại · nguồn)" + nội dung, trong ngân sách ký tự. */
export function renderKnowledge(items: RetrievedItem[], maxChars: number, now: number): string {
    const blocks: string[] = [];
    let used = 0;
    for (const it of items) {
        const e = it.entry;
        const origin = e.isOfficial ? "dữ liệu chính thức" : e.source === "learning" ? "FAQ đã duyệt" : "admin bổ sung";
        const facts = productFacts(e, it.stalePrice, now);
        const body = [e.content.trim().slice(0, 1800), facts].filter(Boolean).join("\n");
        const block = `[#${e.id}] ${e.title} (${e.kind} · ${origin})\n${body}`;
        if (used + block.length > maxChars && blocks.length) break;
        blocks.push(block.slice(0, maxChars));
        used += block.length;
    }
    return blocks.join("\n\n");
}
