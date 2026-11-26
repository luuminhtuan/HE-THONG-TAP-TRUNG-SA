// ═══════════════════════════════════════════════════════════════════
// AI Chatbot — xử lý chữ (THUẦN, có test): bỏ dấu tiếng Việt, viết tắt chat, tách từ, trigram (sai chính tả),
// đoán ngôn ngữ, che số điện thoại / email trước khi gửi ra AI, tách số / link / SĐT để soát căn cứ câu trả lời.
// ═══════════════════════════════════════════════════════════════════

/** "Kem dưỡng Đà Lạt" → "Kem duong Da Lat". */
export function stripDiacritics(s: string): string {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
}

/** Chữ thường, bỏ dấu, chỉ còn chữ / số / khoảng trắng. Giữ chữ Hán / Nhật / Ả Rập (không có \p{M} để bỏ). */
export function normalizeText(s: string): string {
    return stripDiacritics(String(s || "").normalize("NFKC")).toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

/** Viết tắt hay gặp khi chat tiếng Việt (đã bỏ dấu) → dạng đủ. Luật nghiệp vụ không nằm ở đây — chỉ là ngôn ngữ. */
const ABBREVIATIONS: Record<string, string> = {
    sp: "san pham", ko: "khong", k: "khong", kh: "khong", hok: "khong", hong: "khong", hem: "khong",
    dc: "duoc", dk: "duoc", bn: "bao nhieu", bnh: "bao nhieu", j: "gi", ntn: "nhu the nao", sdt: "so dien thoai",
    ship: "ship giao hang", sd: "su dung", hdsd: "huong dan su dung", tk: "tai khoan", ck: "chuyen khoan",
    cod: "cod thanh toan khi nhan hang", bh: "bao hanh", ad: "admin", shp: "shop", vs: "voi", mk: "minh", mn: "moi nguoi",
    trc: "truoc", r: "roi", ok: "ok", oke: "ok", okie: "ok", tl: "tra loi", lm: "lam", nc: "nuoc", ib: "nhan tin",
};

const STOPWORDS = new Set([
    // tiếng Việt (bỏ dấu)
    "a", "ah", "ak", "ạ", "oi", "nhe", "nha", "nhen", "voi", "cho", "minh", "em", "anh", "chi", "ban", "shop", "la", "thi", "ma",
    "co", "cua", "nay", "kia", "do", "vay", "the", "nao", "gi", "khong", "duoc", "roi", "va", "hay", "hoac", "cung", "de", "o",
    "tai", "tu", "den", "lai", "nua", "di", "len", "xuong", "ra", "vao", "nhieu", "it", "rat", "qua", "lam", "hoi", "biet",
    "muon", "can", "xin", "giup", "dum", "ho", "voi", "nhi", "sao", "ne", "day", "ay", "ok", "vang", "uh", "um", "dc",
    // tiếng Anh
    "the", "a", "an", "is", "are", "am", "be", "to", "of", "and", "or", "in", "on", "at", "for", "with", "it", "this", "that",
    "do", "does", "can", "could", "would", "should", "i", "you", "me", "my", "your", "we", "please", "pls", "hi", "hello",
    "what", "how", "which", "about", "there", "have", "has", "any", "some", "po", "ba", "dear", "sis", "maam", "sir",
]);

/** Thêm từ đồng nghĩa từ cấu hình (`ai_chatbot.synonyms`): { "kem chong nang": ["sunscreen", "spf"] }. */
export type SynonymMap = Record<string, string[]>;

function expandAbbreviations(normalized: string): string {
    return normalized.split(" ").map((w) => ABBREVIATIONS[w] ?? w).join(" ");
}

/** Chuẩn hoá + mở viết tắt chat ("sp nay dung ntn" → "san pham nay dung nhu the nao") — cho bộ dò từ khoá. */
export function normalizeChat(s: string): string {
    return expandAbbreviations(normalizeText(s));
}

/** Tách từ để tìm kiếm: chuẩn hoá, mở viết tắt, bỏ từ dừng; giữ số (mã SP "012", dung tích "50"). */
export function tokenize(s: string): string[] {
    const n = expandAbbreviations(normalizeText(s));
    const out: string[] = [];
    for (const w of n.split(" ")) {
        if (!w) continue;
        if (/^\d+$/.test(w)) { out.push(w); continue; }
        if (w.length < 2 || STOPWORDS.has(w)) continue;
        out.push(w);
    }
    return out;
}

/** Cặp từ liền nhau ("kem duong", "duong am") — khớp cụm chính xác hơn từng từ lẻ. */
export function bigrams(tokens: string[]): string[] {
    const out: string[] = [];
    for (let i = 0; i + 1 < tokens.length; i++) out.push(`${tokens[i]} ${tokens[i + 1]}`);
    return out;
}

/** Mở rộng câu hỏi bằng từ đồng nghĩa (so trên dạng đã chuẩn hoá). */
export function expandSynonyms(text: string, synonyms: SynonymMap): string {
    const n = normalizeText(text);
    const extra: string[] = [];
    for (const [k, vs] of Object.entries(synonyms || {})) {
        const nk = normalizeText(k);
        const all = [nk, ...(vs || []).map(normalizeText)].filter(Boolean);
        if (all.some((v) => v && (` ${n} `).includes(` ${v} `))) extra.push(...all);
    }
    return extra.length ? `${text} ${extra.join(" ")}` : text;
}

/** Tập trigram ký tự của một từ — "dưỡng" gõ sai "duogn" vẫn gần "duong". */
export function trigrams(word: string): Set<string> {
    const w = `  ${word} `;
    const out = new Set<string>();
    for (let i = 0; i + 3 <= w.length; i++) out.add(w.slice(i, i + 3));
    return out;
}

/** Độ giống trigram (Jaccard) của hai từ, 0..1. */
export function trigramSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    const ta = trigrams(a), tb = trigrams(b);
    let inter = 0;
    for (const t of ta) if (tb.has(t)) inter++;
    const union = ta.size + tb.size - inter;
    return union ? inter / union : 0;
}

/** Jaccard của hai tập từ. */
export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
    const A = new Set(a), B = new Set(b);
    if (!A.size && !B.size) return 0;
    let inter = 0;
    for (const x of A) if (B.has(x)) inter++;
    return inter / (A.size + B.size - inter);
}

// ─── Ngôn ngữ ───────────────────────────────────────────────────────

const VI_DIACRITIC = /[ăâđêôơưàáạảãầấậẩẫằắặẳẵèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]/i;
const VI_WORDS = new Set(["khong", "ko", "duoc", "dc", "bao", "nhieu", "minh", "ban", "shop", "nhe", "nha", "oi", "gi", "sao",
    "the", "nao", "san", "pham", "dung", "mua", "gia", "co", "cho", "em", "anh", "chi", "a", "vay", "nay", "lam", "roi", "voi",
    "hang", "giao", "bn", "j", "sp", "hok", "k", "muon", "can", "toi", "cach", "tac", "thi", "la", "cua", "nhu"]);
const TL_WORDS = new Set(["po", "ba", "ang", "ng", "mga", "salamat", "magkano", "pwede", "paano", "ito", "yung", "naman", "lang",
    "ako", "ko", "mo", "sa", "na", "kayo", "opo", "wala", "meron", "gamitin", "padala"]);
const ID_WORDS = new Set(["apa", "berapa", "bisa", "ini", "itu", "saya", "kak", "harga", "tidak", "ada", "dong", "gimana",
    "bagaimana", "kirim", "ongkir", "barang", "mau", "beli", "pakai", "cara", "yang", "dan", "untuk"]);
const EN_WORDS = new Set(["the", "is", "are", "what", "how", "price", "much", "do", "does", "can", "you", "have", "this", "it",
    "use", "product", "shipping", "deliver", "where", "when", "please", "thanks", "thank", "want", "buy", "order", "my", "i"]);

/** Đoán ngôn ngữ tin nhắn: vi · en · tl (Tagalog) · id · zh · ja · ko · th · ar · unknown. Tiếng Việt không dấu vẫn nhận. */
export function detectLanguage(text: string): string {
    const s = String(text || "");
    if (!s.trim()) return "unknown";
    if (/[぀-ヿ]/.test(s)) return "ja";
    if (/[가-힯]/.test(s)) return "ko";
    if (/[一-鿿]/.test(s)) return "zh";
    if (/[฀-๿]/.test(s)) return "th";
    if (/[؀-ۿ]/.test(s)) return "ar";
    if (VI_DIACRITIC.test(s)) return "vi";
    const words = normalizeText(s).split(" ").filter(Boolean);
    if (!words.length) return "unknown";
    const score = (set: Set<string>) => words.filter((w) => set.has(w)).length;
    const scores: [string, number][] = [["vi", score(VI_WORDS)], ["tl", score(TL_WORDS)], ["id", score(ID_WORDS)], ["en", score(EN_WORDS)]];
    scores.sort((a, b) => b[1] - a[1]);
    if (scores[0][1] === 0) return /^[\x00-\x7f]*$/.test(s) ? "en" : "unknown";
    return scores[0][0];
}

/** Hai mã ngôn ngữ có coi là cùng ngôn ngữ trả lời không (unknown → không xét). */
export function sameLanguage(a: string | null | undefined, b: string | null | undefined): boolean {
    const x = String(a || "unknown").toLowerCase().slice(0, 2), y = String(b || "unknown").toLowerCase().slice(0, 2);
    if (x === "un" || y === "un") return true;
    return x === y;
}

// ─── Dữ liệu cá nhân ────────────────────────────────────────────────

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Số điện thoại: 8–15 chữ số, cho phép +, khoảng trắng, chấm, gạch giữa các nhóm. Không che số ngắn (giá, mã SP).
const PHONE_RE = /(?<![\d])(?:\+?\d[\d .-]{6,18}\d)(?![\d])/g;

/** Che SĐT / email trước khi gửi nội dung khách ra nhà cung cấp AI. */
export function redactPii(text: string): string {
    return String(text || "")
        .replace(EMAIL_RE, "[email]")
        .replace(PHONE_RE, (m) => (m.replace(/\D/g, "").length >= 8 ? "[sđt]" : m));
}

// ─── Soát căn cứ câu trả lời ─────────────────────────────────────────

/** Mọi con số trong chữ, bỏ dấu ngăn cách (350.000đ → "350000", 1,5 → "15"). Chỉ số ≥ 2 chữ số. */
export function extractNumbers(text: string): string[] {
    const out = new Set<string>();
    for (const m of String(text || "").matchAll(/\d[\d.,\s]*\d|\d/g)) {
        // Nhóm cách bằng khoảng trắng chỉ gộp khi là kiểu ngăn nghìn ("350 000"), không gộp "2 3" (hai số).
        const raw = m[0];
        const parts = /\s/.test(raw) && !/^\d{1,3}(\s\d{3})+$/.test(raw.trim()) ? raw.split(/\s+/) : [raw];
        for (const p of parts) {
            const d = p.replace(/\D/g, "");
            if (d.length >= 2) out.add(d.replace(/^0+(?=\d)/, ""));
        }
    }
    return [...out];
}

export function extractUrls(text: string): string[] {
    return [...String(text || "").matchAll(/\b(?:https?:\/\/|www\.)[^\s<>"')]+/gi)].map((m) => m[0].replace(/[.,;:!?]+$/, "").toLowerCase());
}

export function extractPhones(text: string): string[] {
    return [...String(text || "").matchAll(PHONE_RE)].map((m) => m[0].replace(/\D/g, "")).filter((d) => d.length >= 8);
}

export function extractEmails(text: string): string[] {
    return [...String(text || "").matchAll(EMAIL_RE)].map((m) => m[0].toLowerCase());
}

/** Chữ an toàn cho parse_mode HTML của Telegram. */
export function escapeHtml(s: string): string {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Cắt chuỗi theo ký tự, thêm "…". */
export function truncate(s: string, max: number): string {
    const t = String(s || "");
    return t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1))}…`;
}
