import { NextRequest, NextResponse } from "next/server";
import { layModelGemini, thuTuModel } from "@/lib/talpha/gemini-models";
import { GEMINI_KEY_HEADER, laKhoaGeminiHopLe } from "@/lib/talpha/gemini-key";

export const dynamic = "force-dynamic";

// Kiểm khoá Gemini RIÊNG trước khi trang Hỏi AI lưu nó vào trình duyệt (16/11/2026, lib/talpha/gemini-key.ts).
// Khoá đi ở header, hỏi Google danh sách model của khoá — không lưu, không ghi log khoá.
// Quyền: theo /api/talpha/ceo-ask (API_RULES khớp tiền tố) — chỉ giám đốc.
//
//   POST (header x-gemini-key) → { ok, so_model, model }   model = model câu hỏi kế tiếp sẽ dùng trước

export async function POST(req: NextRequest) {
    const key = (req.headers.get(GEMINI_KEY_HEADER) || "").trim();
    if (!laKhoaGeminiHopLe(key)) {
        return NextResponse.json({ error: "Khoá không đúng dạng — khoá Gemini thường bắt đầu bằng AIza…, lấy ở aistudio.google.com/apikey." }, { status: 400 });
    }
    try {
        const ds = await layModelGemini(key);
        if (!ds.length) return NextResponse.json({ error: "Khoá này không gọi được model trả lời chữ nào của Gemini." }, { status: 400 });
        const thuTu = await thuTuModel(key);
        return NextResponse.json({ ok: true, so_model: ds.length, model: thuTu[0] ?? null });
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
    }
}
