// ═══════════════════════════════════════════════════════════════════
// Model Gemini cho ô "Hỏi dashboard" (15/11/2026).
//
// Trước đây gõ cứng "gemini-2.5-flash,gemini-2.0-flash" — Google khai tử model cũ với tài khoản mới
// (404 "no longer available to new users") là ô hỏi chết. Nay: danh sách lấy THẲNG từ Google theo
// khoá đang dùng, giám đốc chọn model ở Quản trị → Khoá kết nối → tab Gemini (lưu ở app_documents,
// kho "ai_settings"). Chưa chọn → tự chọn model "flash" mới nhất khoá đó dùng được. Model đang chọn
// bị gỡ → ceo-ask tự sang model kế tiếp trong danh sách thử.
// ═══════════════════════════════════════════════════════════════════
import { readStoreFresh, updateStore } from "@/lib/talpha/store";

export type ModelGemini = { id: string; ten: string; mo_ta: string; gioi_han_vao: number | null };
type CaiDatAi = { gemini_model?: string | null; updated_by?: string | null; updated_at?: string | null };

const SETTINGS_STORE = "ai_settings";
const API = "https://generativelanguage.googleapis.com/v1beta/models";

/** Model khoá này gọi được để trả lời (generateContent). Khoá đi ở header, không nằm trên địa chỉ. */
export async function listGeminiModels(key: string): Promise<ModelGemini[]> {
    const out: ModelGemini[] = [];
    let pageToken = "";
    for (let i = 0; i < 5; i++) {
        const r = await fetch(`${API}?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
            { headers: { "x-goog-api-key": key }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error(`Google từ chối: ${j?.error?.message || `HTTP ${r.status}`}`);
        for (const m of (j?.models || []) as {
            name: string; displayName?: string; description?: string; inputTokenLimit?: number; supportedGenerationMethods?: string[];
        }[]) {
            if (!(m.supportedGenerationMethods || []).includes("generateContent")) continue;
            const id = m.name.replace(/^models\//, "");
            // Bỏ model không trả lời chữ được: nhúng, ảnh (imagen, nano-banana), giọng nói / chép lời, hỏi đáp tài liệu (aqa).
            if (/embed|image|imagen|banana|tts|audio|transcribe|aqa|veo|live/i.test(id)) continue;
            out.push({ id, ten: m.displayName || id, mo_ta: m.description || "", gioi_han_vao: m.inputTokenLimit ?? null });
        }
        pageToken = j?.nextPageToken || "";
        if (!pageToken) break;
    }
    return out;
}

const versionOf = (id: string) => Number(/gemini-(\d+(?:\.\d+)?)/.exec(id)?.[1] || 0);

/** Thứ tự nên dùng khi chưa ai chọn: bản số lớn trước; cùng bản thì flash → flash-lite → pro; bản
 *  chính thức trước bản thử (preview / exp). THUẦN. */
export function rankRecommendedModels(ds: ModelGemini[]): string[] {
    const rank = (id: string) => (/-flash$/.test(id) ? 0 : /-flash-lite$/.test(id) ? 1 : /-pro$/.test(id) ? 2
        : /flash/.test(id) ? 3 : 4) + (/preview|exp|latest/.test(id) ? 10 : 0);
    return ds.map((m) => m.id).filter((id) => /^gemini-/.test(id))
        .sort((a, b) => rank(a) - rank(b) || versionOf(b) - versionOf(a) || a.localeCompare(b));
}

export async function getSelectedModel(): Promise<CaiDatAi> {
    return readStoreFresh<CaiDatAi>(SETTINGS_STORE, {});
}

export async function saveSelectedModel(model: string | null, ai: string): Promise<void> {
    await updateStore<CaiDatAi>(SETTINGS_STORE, {}, (cur) => ({
        ...cur, gemini_model: model, updated_by: ai, updated_at: new Date().toISOString(),
    }));
}

/** Model ceo-ask thử lần lượt: model đã chọn → TALPHA_AI_MODEL (nếu có) → các model nên dùng của
 *  khoá này. Không lấy được danh sách từ Google thì vẫn còn model đã chọn / biến môi trường.
 *  Lấy được danh sách thì bỏ model đã chọn mà khoá này không gọi được — khoá riêng của trình duyệt
 *  (lib/talpha/gemini-key.ts) có thể ở project khác, không có model giám đốc chọn cho khoá mặc định. */
export async function modelFallbackOrder(key: string): Promise<string[]> {
    const selected = (await getSelectedModel()).gemini_model || null;
    const env = (process.env.TALPHA_AI_MODEL || "").split(",").map((s) => s.trim()).filter(Boolean);
    let autoModels: string[] = [];
    let coModel: Set<string> | null = null;
    try {
        const ds = await listGeminiModels(key);
        coModel = new Set(ds.map((m) => m.id));
        autoModels = rankRecommendedModels(ds).slice(0, 4);
    } catch (e) { console.error("gemini-models: không lấy được danh sách model:", e instanceof Error ? e.message : e); }
    const muon = [selected, ...env].filter((x): x is string => !!x && (!coModel || coModel.has(x)));
    return [...new Set([...muon, ...autoModels])];
}
