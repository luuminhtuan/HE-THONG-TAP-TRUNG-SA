import { NextRequest, NextResponse } from "next/server";
import { getAccess } from "@/lib/talpha/access";
import { getCredential } from "@/lib/talpha/khoa";
import { getSelectedModel, listGeminiModels, saveSelectedModel, rankRecommendedModels } from "@/lib/talpha/gemini-models";

export const dynamic = "force-dynamic";

// Chọn model Gemini cho ô "Hỏi dashboard" (15/11/2026) — Quản trị → Khoá kết nối → tab Gemini.
// Chỉ giám đốc (API_RULES: /api/talpha/khoa là full). Xem lib/talpha/gemini-models.ts.
//
//   GET            → model khoá đang dùng gọi được (lấy thẳng từ Google), model đang chọn, model tự chọn
//   POST {model}   → lưu model chọn; model: null = để máy tự chọn model "flash" mới nhất

async function getModelOptions() {
    const key = getCredential("GEMINI_API_KEY") || getCredential("GOOGLE_API_KEY");
    const selected = await getSelectedModel();
    if (!key) return { co_khoa: false, chon: selected, tu_dong: null, models: [] };
    const models = await listGeminiModels(key);
    return { co_khoa: true, chon: selected, tu_dong: rankRecommendedModels(models)[0] ?? null, models };
}

export async function GET() {
    try {
        return NextResponse.json(await getModelOptions());
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
    }
}

export async function POST(req: NextRequest) {
    if (!(req.headers.get("content-type") || "").includes("application/json")) {
        return NextResponse.json({ error: "Chỉ nhận JSON" }, { status: 415 });
    }
    const body = await req.json().catch(() => null);
    const model = body?.model ? String(body.model).trim() : null;
    try {
        const options = await getModelOptions();
        if (model && !options.models.some((m) => m.id === model)) {
            return NextResponse.json({ error: `Khoá Gemini này không gọi được model ${model}` }, { status: 400 });
        }
        const a = await getAccess(req);
        await saveSelectedModel(model, a?.email || a?.name || "?");
        return NextResponse.json({ ok: true, ...(await getModelOptions()) });
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
    }
}
