// ═══════════════════════════════════════════════════════════════════
// AI Chatbot — phụ trợ cho route /api/talpha/ai-chatbot/*: quyền → phạm vi nước, trả JSON, đọc body có giới hạn.
// Quyền tab / route đã chặn ở proxy.ts (API_RULES); đây chỉ cắt dữ liệu theo nước của người xem.
// ═══════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import type { Access } from "@/lib/talpha/access-rules";
import type { Scope } from "./admin-store";

export const NO_STORE = { "Cache-Control": "no-store" };

export function scopeOf(a: Access): Scope {
    return { full: a.full, codes: a.codes, actor: String(a.name || a.email || a.id || a.kind) };
}

export const ok = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: NO_STORE });
export const bad = (error: string | string[], status = 400) =>
    NextResponse.json(Array.isArray(error) ? { error: error.join(" · "), errors: error } : { error }, { status, headers: NO_STORE });

/** Lỗi máy chủ: ghi log đủ, trả người dùng câu gọn (không lộ SQL / khoá). */
export function serverError(e: unknown, where: string) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[ai-chatbot] ${where}:`, msg);
    if (/relation .*ai_.* does not exist/i.test(msg)) return bad("Chưa chạy migration 0009_ai_chatbot.sql — xem docs/ai-chatbot/DEPLOYMENT.md", 503);
    return bad("Lỗi máy chủ khi xử lý AI Chatbot — xem log", 500);
}

/** Body JSON tối đa `max` byte (chặn gửi khối lớn). */
export async function readJson(req: Request, max = 64_000): Promise<any> {
    const text = await req.text();
    if (text.length > max) throw Object.assign(new Error("body quá lớn"), { status: 413 });
    try { return text ? JSON.parse(text) : {}; } catch { throw Object.assign(new Error("JSON không hợp lệ"), { status: 400 }); }
}

/** Page thuộc nước người xem? (page chưa gán nước: chỉ người xem hết). */
export async function canSeePage(scope: Scope, pageId: string): Promise<boolean> {
    if (scope.full) return true;
    const [r] = await query<{ market: string | null }>("SELECT market FROM pancake_pages WHERE page_id = @pageId", { pageId });
    return !!r?.market && scope.codes.includes(r.market);
}

export const intParam = (v: string | null) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
export const dateParam = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
