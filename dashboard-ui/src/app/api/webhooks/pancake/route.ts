import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCredential } from "@/lib/talpha/credentials";
import { parseWebhookHints } from "@/lib/ai-chatbot/pancake-parse";
import { logWebhook } from "@/lib/ai-chatbot/admin-store";
import { loadSettings, runtime, WEBHOOK_SECRET_VAR } from "@/lib/ai-chatbot/runtime";

export const dynamic = "force-dynamic";

// Webhook Pancake (chat) → AI Chatbot. CỬA NGOÀI duy nhất của module: proxy.ts thả /api/webhooks/* không cần đăng nhập,
// route TỰ xác thực:
//   • chìa bí mật trên URL (?key=…, sinh ở AI Settings, lưu mã hoá) — so sánh hằng thời gian;
//   • IP nguồn thuộc webhook_allowed_ips (Pancake chính thức: 203.171.22.6; đọc X-Real-IP do nginx ghi đè);
//   • thân ≤ 256 KB, ≤ 120 lượt / phút / IP.
// Pancake KHÔNG ký webhook (OpenAPI 25/11/2026) → payload chỉ là GỢI Ý (page, hội thoại): worker đọc lại tin bằng API với
// token của mình; giả mạo payload không khiến AI nói gì khác. Trả 200 nhanh (Pancake tự tắt webhook nếu lỗi nhiều).
const MAX_BODY = 256 * 1024;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
    const now = Date.now();
    const arr = (hits.get(ip) || []).filter((t) => now - t < 60_000);
    arr.push(now);
    hits.set(ip, arr);
    if (hits.size > 5000) hits.clear();
    return arr.length > 120;
}

function sameSecret(a: string, b: string): boolean {
    const x = Buffer.from(a), y = Buffer.from(b);
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export async function POST(req: NextRequest) {
    const ip = (req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || "").trim() || "unknown";
    const log = (ok: boolean, error: string | null, extra: { eventType?: string | null; pageId?: string | null; conversationId?: string | null; payload?: unknown } = {}) =>
        logWebhook(query, { ip, ok, error, eventType: extra.eventType ?? null, pageId: extra.pageId ?? null, conversationId: extra.conversationId ?? null, payload: extra.payload ?? null })
            .catch((e) => console.error("[ai-chatbot] ghi webhook log lỗi:", e?.message));
    if (rateLimited(ip)) return NextResponse.json({ ok: false, error: "rate limited" }, { status: 429 });
    const S = await loadSettings().catch(() => null);
    if (!S || !S.webhook_enabled) return NextResponse.json({ ok: true, ignored: "webhook đang tắt" });
    const secret = getCredential(WEBHOOK_SECRET_VAR);
    const key = req.nextUrl.searchParams.get("key") || req.headers.get("x-webhook-key") || "";
    if (!secret || !key || !sameSecret(key, secret)) {
        await log(false, "sai chìa");
        return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    if (S.webhook_allowed_ips.length && !S.webhook_allowed_ips.includes(ip)) {
        await log(false, `IP ngoài danh sách: ${ip}`);
        return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }
    const raw = await req.text();
    if (raw.length > MAX_BODY) { await log(false, "thân quá lớn"); return NextResponse.json({ ok: false, error: "too large" }, { status: 413 }); }
    let body: unknown;
    try { body = JSON.parse(raw); } catch { await log(false, "JSON hỏng"); return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 }); }

    const hints = parseWebhookHints(body);
    let queued = 0;
    try {
        const rt = runtime();
        for (const h of hints) {
            if (h.fromCustomer === false) continue;                    // tin phía page — không cần làm gì
            const page = await rt.pg.store.getPage(h.pageId);
            if (!S.enabled || !page?.enabled) continue;
            await rt.pg.queue.enqueue(h.pageId, h.conversationId, "webhook", Date.now());
            queued++;
        }
        const first = hints[0];
        // Lưu ĐỊA CHỈ (page, hội thoại, tin, loại sự kiện) — KHÔNG lưu nội dung tin của khách.
        await log(true, null, { eventType: first?.eventType || null, pageId: first?.pageId || null, conversationId: first?.conversationId || null, payload: { hints, queued } });
    } catch (e) {
        await log(false, e instanceof Error ? e.message : String(e), { payload: { hints } });
        // Vẫn 200: lỗi của mình không nên làm Pancake tắt webhook; poller sẽ bắt lại tin.
    }
    return NextResponse.json({ ok: true, queued });
}
