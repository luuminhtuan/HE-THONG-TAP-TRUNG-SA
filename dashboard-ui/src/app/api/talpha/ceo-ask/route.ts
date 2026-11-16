import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { GoogleGenAI, Type } from "@google/genai";
import { queryChiDoc } from "@/lib/db";
import { buildSystemPrompt } from "@/lib/talpha/ceo-ask-prompt";
import { checkSql, cleanSql } from "@/lib/talpha/ceo-ask-sql";
import { docKhoa } from "@/lib/talpha/khoa";
import { thuTuModel } from "@/lib/talpha/gemini-models";
import { GEMINI_KEY_HEADER, laKhoaGeminiHopLe, type NguonKhoaGemini } from "@/lib/talpha/gemini-key";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Google Gemini. Model chọn ở Quản trị → Khoá kết nối → tab Gemini; chưa chọn thì tự lấy model "flash"
// mới nhất khoá đó dùng được (lib/talpha/gemini-models.ts — 15/11/2026, trước gõ cứng gemini-2.5-flash
// và chết khi Google khai tử model). Hết quota / quá tải / model bị gỡ thì thử model kế tiếp.
//
// Khoá (16/11/2026): trình duyệt có khoá RIÊNG (dán ở trang Hỏi AI, lưu localStorage, gửi kèm header
// x-gemini-key) thì dùng khoá đó cho câu hỏi này; không có thì khoá mặc định của hệ thống. Khoá riêng
// không lưu, không ghi log — xem lib/talpha/gemini-key.ts.

/** Chỗ người hỏi đổi khoá, theo khoá đang dùng — để câu báo lỗi chỉ đúng nút. */
const CHO_DOI_KHOA: Record<NguonKhoaGemini, string> = {
    trinh_duyet: "bấm “Khoá AI” ở đầu trang Hỏi AI để dán khoá khác (hoặc xoá để quay về khoá mặc định)",
    mac_dinh: "dán khoá Gemini riêng ở nút “Khoá AI” đầu trang Hỏi AI (chỉ lưu trên trình duyệt của bạn), " +
        "hoặc giám đốc đổi khoá mặc định ở Quản trị → Khoá kết nối → tab Gemini",
};
const TEN_KHOA: Record<NguonKhoaGemini, string> = { trinh_duyet: "Khoá Gemini riêng trên trình duyệt này", mac_dinh: "Khoá Gemini mặc định của hệ thống" };

/** Google từ chối chính cái khoá (sai, hết hạn, bị thu hồi, project chưa bật Gemini API). */
const laKhoaSai = (e: any) =>
    /API key not valid|API_KEY_INVALID|API key expired|PERMISSION_DENIED|has not been used in project|SERVICE_DISABLED/i
        .test(String(e?.message || e));

/** Model này không dùng được lúc này — bị gỡ (404 "no longer available to new users"), không hỗ trợ, hoặc
 *  TREO không trả lời (15/11/2026: gemini-3.8-flash treo quá 60 giây trong khi 3.5-flash trả lời 1,6 giây).
 *  Sang model kế, không phải lỗi thật. */
function laModelKhongCo(e: any): boolean {
    return /\b404\b|NOT_FOUND|no longer available|not found for API version|is not supported|HET_GIO_MODEL|DEADLINE_EXCEEDED/i
        .test(String(e?.message || e));
}

/**
 * Câu báo lỗi hạn mức đọc ĐÚNG lý do Google trả (15/11/2026) — bản cũ hễ 429 là ghi "free tier", người
 * trả phí đọc tưởng code sai. Google ghi rõ: "Quota exceeded for metric: …generate_content_free_tier_requests,
 * limit: 20, model: gemini-3.6-flash … Please retry in 17h30m9s".
 */
function loiHanMuc(m: string, nguon: NguonKhoaGemini): string {
    if (!laHetQuota(m)) return "Gemini đang quá tải, thử hỏi lại sau vài giây.";
    const metric = /Quota exceeded for metric:\s*([\w./-]+)/i.exec(m)?.[1] || "";
    const gioiHan = /limit:\s*(\d+)/i.exec(m)?.[1];
    const model = /model:\s*([\w.-]+)/i.exec(m)?.[1];
    const cho = /retry in\s*(?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/i.exec(m);
    const choChu = cho && (cho[1] || cho[2])
        ? ` Mở lại sau khoảng ${cho[1] ? `${cho[1]} giờ ` : ""}${cho[2] ? `${cho[2]} phút` : ""}.`.replace(" .", ".") : "";
    const theoNgay = /per.?day|PerDay|requests per day/i.test(m);
    const moTa = `${theoNgay ? "hết hạn mức trong ngày" : "vượt hạn mức số lượt"}${gioiHan ? ` (${gioiHan} lượt${theoNgay ? "/ngày" : ""}${model ? ` cho ${model}` : ""})` : ""}`;
    // Hạn mức Google tính theo PROJECT: khoá mới tạo trong cùng project vẫn hết lượt.
    if (/free_tier/i.test(metric) || /Free Tier/i.test(m)) {
        return `${TEN_KHOA[nguon]} đang ở mức MIỄN PHÍ (free tier) và đã ${moTa}.${choChu} ` +
            "Gói trả phí của ứng dụng Gemini (Google AI Pro / Ultra) không áp dụng cho API — phải bật thanh toán (billing) " +
            "cho đúng project chứa khoá ở aistudio.google.com → API keys, hoặc dùng khoá của project khác. " +
            `Muốn hỏi tiếp ngay: ${CHO_DOI_KHOA[nguon]}.`;
    }
    return `${TEN_KHOA[nguon]} đã ${moTa}${metric ? ` — hạn mức ${metric}` : ""}.${choChu} ` +
        `Xem mức đang dùng ở ai.dev/rate-limit. Muốn hỏi tiếp ngay: ${CHO_DOI_KHOA[nguon]}.`;
}

/** Một lượt gọi model tối đa chừng này — quá là coi model đang treo, sang model kế. */
const HET_GIO_MOT_LUOT = 30_000;
/** Cả câu hỏi tối đa chừng này (mọi lượt gọi, mọi model). */
const HET_GIO_CA_CAU = 100_000;
/** Model vừa treo / vừa bị gỡ / hết quota: bỏ qua 30 phút để câu hỏi sau khỏi chờ lại (nhớ trong tiến
 *  trình). Khoá "<vân tay khoá>|<model>": hạn mức là của từng khoá — khoá riêng của một người hết lượt
 *  không được làm người khác (khoá mặc định) bỏ model đó, và ngược lại. */
const modelTamBo = new Map<string, number>();
const vanTayKhoa = (k: string) => createHash("sha256").update(k).digest("hex").slice(0, 12);
const TAM_BO_MS = 30 * 60_000;
/** Hết quota của khoá (429 / RESOURCE_EXHAUSTED) — thử lại trong vài giây cũng vậy. */
const laHetQuota = (e: any) => /\b429\b|RESOURCE_EXHAUSTED|exceeded your current quota/i.test(String(e?.message || e));
/** Tạm bỏ model bao lâu theo kiểu lỗi: quá tải là chuyện vài phút, hết quota / bị gỡ / treo thì lâu hơn. */
const tamBoBaoLau = (e: any) => (laHetQuota(e) || laModelKhongCo(e) ? TAM_BO_MS : 5 * 60_000);
const MAX_SQL_CALLS = 4;
const ROW_CAP = 200;

// Câu SQL do LLM viết = KHÔNG tin được. Hai lớp chặn:
//   1. Soát chữ ở đây: chỉ 1 câu SELECT/WITH, không từ khoá ghi/DDL (danh sách chung ở
//      lib/talpha/ceo-ask-sql.ts — dùng chung với prompt builder). Gỡ nháy thừa: cleanSql.
//   2. Database: chạy bằng vai CHỈ ĐỌC talpha_doc, transaction READ ONLY, tối đa 30 giây
//      (queryChiDoc, migration 0003) — lọt qua lớp 1 cũng không ghi / không treo máy được.
// Bản BigQuery còn khoá "đúng dataset" + hạn mức byte quét; Postgres chỉ có một database và vai
// chỉ đọc thay cho cả hai.
async function runSql(rawSql: string): Promise<{ rows?: any[]; error?: string }> {
    const sql = cleanSql(rawSql);
    const safe = checkSql(sql);
    if (!safe.ok) return { error: `Query blocked: ${safe.reason}` };
    // Bound result size if the model forgot a LIMIT.
    const limited = /\blimit\b/i.test(sql) ? sql : `${sql.trim()}\nLIMIT ${ROW_CAP}`;
    try {
        const rows = await queryChiDoc(limited, "talpha_doc");
        return { rows: rows.slice(0, ROW_CAP) };
    } catch (e: any) {
        return { error: e?.message || String(e) };
    }
}

// System prompt SINH TỰ ĐỘNG từ config/talpha_rules.json (A5) — đừng chép rule
// bằng tay vào đây nữa, sửa rule là sửa JSON. Xem lib/talpha/ceo-ask-prompt.ts.
function systemPrompt(from: string, to: string): string {
    return buildSystemPrompt(from, to);
}

// Free tier Gemini thỉnh thoảng trả 503 UNAVAILABLE / 429 (quá tải) — retry với
// backoff để người dùng không thấy lỗi tạm thời.
function isTransient(e: any): boolean {
    const m = String(e?.message || e);
    return /\b503\b|UNAVAILABLE|overloaded|high demand|\b429\b|RESOURCE_EXHAUSTED|rate.?limit/i.test(m);
}
// Thử lại tối đa 2 lượt và chỉ khi quá tải tạm (503): hết quota / treo / bị gỡ thì đổi model ngay —
// 15/11/2026 một câu hỏi mất 46 giây vì cố thử lại 4 lượt một model đang quá tải.
async function genWithRetry(ai: GoogleGenAI, params: any, tries = 2): Promise<any> {
    let lastErr: any;
    for (let attempt = 0; attempt < tries; attempt++) {
        const ac = new AbortController();
        let hen: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([
                ai.models.generateContent({ ...params, config: { ...(params.config || {}), abortSignal: ac.signal } }),
                new Promise((_, tuChoi) => {
                    hen = setTimeout(() => {
                        ac.abort();
                        tuChoi(new Error(`HET_GIO_MODEL: ${params.model} không trả lời sau ${HET_GIO_MOT_LUOT / 1000} giây`));
                    }, HET_GIO_MOT_LUOT);
                }),
            ]);
        } catch (e: any) {
            lastErr = e;
            // Model treo / bị gỡ thì thử lại cũng vậy — ném ra để đổi model.
            if (laModelKhongCo(e) || laHetQuota(e) || !isTransient(e) || attempt === tries - 1) throw e;
            await new Promise((r) => setTimeout(r, 600 * Math.pow(2, attempt))); // 0.6s, 1.2s, 2.4s
        } finally {
            if (hen) clearTimeout(hen);
        }
    }
    throw lastErr;
}

const TOOLS = [
    {
        functionDeclarations: [
            {
                name: "run_sql",
                description: "Chạy 1 câu truy vấn Postgres (chỉ SELECT/WITH) trên kho số TALPHA và trả về tối đa 200 dòng kết quả dạng JSON. Dùng để lấy số liệu trả lời câu hỏi.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        sql: { type: Type.STRING, description: "Một câu SELECT Postgres hợp lệ, tên bảng / view viết trần (vd vw_orders_std), không dấu ;." },
                    },
                    required: ["sql"],
                },
            },
        ],
    },
];

// Chạy agent text-to-SQL với 1 model cụ thể. Trả về câu trả lời + các SQL đã chạy.
// Throw nếu model lỗi (transient/quota) để POST fallback sang model kế tiếp.
async function runAgent(ai: GoogleGenAI, model: string, question: string, from: string, to: string): Promise<{ answer: string; queries: string[] }> {
    const sys = systemPrompt(from, to);
    const contents: any[] = [{ role: "user", parts: [{ text: question }] }];
    const queriesRun: string[] = [];
    let answer = "";

    for (let i = 0; i < MAX_SQL_CALLS + 1; i++) {
        const resp = await genWithRetry(ai, {
            model,
            contents,
            config: {
                systemInstruction: sys,
                tools: TOOLS,
                // Lượt đầu: ÉP gọi run_sql (mode ANY) để model yếu (flash-lite) không
                // hỏi lại mà query ngay. Các lượt sau: AUTO để model tự chốt câu trả lời.
                toolConfig: { functionCallingConfig: { mode: i === 0 ? "ANY" : "AUTO" } },
                temperature: 0,
                maxOutputTokens: 8192,
            },
        });

        const calls = resp.functionCalls;
        if (!calls || calls.length === 0) {
            answer = (resp.text || "").trim();
            break;
        }

        // Append the model's function-call turn, then the tool results, and loop.
        const modelParts = resp.candidates?.[0]?.content?.parts || calls.map((c: any) => ({ functionCall: c }));
        contents.push({ role: "model", parts: modelParts });

        const responseParts: any[] = [];
        for (const call of calls) {
            const sql = cleanSql(String((call.args as any)?.sql || ""));
            queriesRun.push(sql);
            let resultStr: string;
            if (queriesRun.length > MAX_SQL_CALLS) {
                resultStr = "Đã đạt giới hạn số truy vấn. Hãy trả lời với dữ liệu đã có.";
            } else {
                const r = await runSql(sql);
                resultStr = r.error ? `Lỗi: ${r.error}` : JSON.stringify(r.rows);
            }
            responseParts.push({
                functionResponse: {
                    name: call.name || "run_sql",
                    response: { result: resultStr },
                },
            });
        }
        contents.push({ role: "user", parts: responseParts });
    }

    // Nếu model vẫn đòi gọi tool khi đã hết hạn mức query → ép 1 lượt KHÔNG tool
    // để nó tổng hợp đáp án từ dữ liệu đã thu thập (tránh rơi vào câu fallback).
    if (!answer) {
        const finalResp = await genWithRetry(ai, {
            model,
            contents,
            config: { systemInstruction: sys, temperature: 0, maxOutputTokens: 8192 },
        });
        answer = (finalResp.text || "").trim();
    }

    return { answer, queries: queriesRun };
}

export async function POST(request: Request) {
    // Khoá riêng của trình duyệt (header) thắng khoá mặc định. Khoá mặc định nhập ở Quản trị → Khoá kết
    // nối → tab Gemini (bảng api_credentials, 15/11/2026); docKhoa còn đọc GEMINI_API_KEY trong .env.local.
    const khoaRieng = (request.headers.get(GEMINI_KEY_HEADER) || "").trim();
    if (khoaRieng && !laKhoaGeminiHopLe(khoaRieng)) {
        return NextResponse.json({ error: `Khoá Gemini riêng trên trình duyệt này không đúng dạng — ${CHO_DOI_KHOA.trinh_duyet}.` }, { status: 400 });
    }
    const nguon: NguonKhoaGemini = khoaRieng ? "trinh_duyet" : "mac_dinh";
    try {
        const apiKey = khoaRieng || docKhoa("GEMINI_API_KEY") || docKhoa("GOOGLE_API_KEY");
        if (!apiKey) {
            return NextResponse.json(
                { error: "Chưa có khoá Gemini mặc định — giám đốc nhập ở Quản trị → Khoá kết nối → tab Gemini, hoặc dán khoá riêng ở nút “Khoá AI” đầu trang Hỏi AI. Lấy khoá ở aistudio.google.com/apikey." },
                { status: 400 }
            );
        }
        const tamBoKhoa = (m: string) => `${vanTayKhoa(apiKey)}|${m}`;
        const { question, from, to } = await request.json();
        if (!question || !String(question).trim()) {
            return NextResponse.json({ error: "Thiếu câu hỏi" }, { status: 400 });
        }
        const fromDate = from || "2026-01-01";
        const toDate = to || new Date().toISOString().slice(0, 10);
        const q = String(question).trim();

        const ai = new GoogleGenAI({ apiKey });
        const MODELS = await thuTuModel(apiKey);
        if (!MODELS.length) {
            return NextResponse.json({ error: `Không lấy được danh sách model của ${TEN_KHOA[nguon].charAt(0).toLowerCase() + TEN_KHOA[nguon].slice(1)} — khoá có thể sai hoặc đã bị thu hồi; ${CHO_DOI_KHOA[nguon]}.` }, { status: 400 });
        }

        // Fallback chain: thử lần lượt từng model; hết quota/quá tải (transient) thì
        // sang model kế. Lỗi thật (vd network) thì ném ngay ra ngoài.
        let result: { answer: string; queries: string[] } | null = null;
        let usedModel = MODELS[0];
        let lastErr: any;
        const batDau = Date.now();
        // Model đang bị tạm bỏ xếp xuống cuối (vẫn thử nếu mọi model khác hỏng).
        const conHan = (m: string) => (modelTamBo.get(tamBoKhoa(m)) ?? 0) > Date.now();
        const thuTu = [...MODELS.filter((m) => !conHan(m)), ...MODELS.filter(conHan)];
        for (const model of thuTu) {
            if (Date.now() - batDau > HET_GIO_CA_CAU) break;
            try {
                result = await runAgent(ai, model, q, fromDate, toDate);
                usedModel = model;
                break;
            } catch (e: any) {
                lastErr = e;
                if (!isTransient(e) && !laModelKhongCo(e)) throw e;
                modelTamBo.set(tamBoKhoa(model), Date.now() + tamBoBaoLau(e));
                console.warn(`ceo-ask (${nguon === "trinh_duyet" ? "khoá trình duyệt" : "khoá mặc định"}): ${model} — ${String(e?.message || e).slice(0, 200)}`);
                console.warn(`ceo-ask: model ${model} ${laModelKhongCo(e) ? "không còn dùng được" : "hết quota/quá tải"}, thử model kế tiếp`);
            }
        }
        if (!result) throw lastErr || new Error("Không model nào khả dụng");

        const answer = result.answer || "Xin lỗi, tôi chưa lấy được câu trả lời. Thử hỏi lại cụ thể hơn nhé.";
        return NextResponse.json({ answer, queries: result.queries, model: usedModel, key_source: nguon });
    } catch (e: any) {
        console.error(`ceo-ask error (${nguon === "trinh_duyet" ? "khoá trình duyệt" : "khoá mặc định"}):`, String(e?.message || e).slice(0, 500));
        if (laKhoaSai(e)) {
            return NextResponse.json({
                error: `${TEN_KHOA[nguon]} bị Google từ chối (sai, hết hạn hoặc project chưa bật Gemini API) — ${CHO_DOI_KHOA[nguon]}.`,
            }, { status: 400 });
        }
        if (laModelKhongCo(e)) {
            return NextResponse.json({
                error: /HET_GIO_MODEL|DEADLINE/i.test(String(e?.message || e))
                    ? "Gemini không trả lời kịp — thử lại, hoặc chọn model khác (vd gemini-3.5-flash) ở Quản trị → Khoá kết nối → tab Gemini."
                    : "Model Gemini đang chọn không còn dùng được — chọn model khác ở Quản trị → Khoá kết nối → tab Gemini.",
            }, { status: 503 });
        }
        if (isTransient(e)) {
            return NextResponse.json({ error: loiHanMuc(String(e?.message || e), nguon) }, { status: 503 });
        }
        return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
    }
}
