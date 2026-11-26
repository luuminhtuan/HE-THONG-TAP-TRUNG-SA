// ═══════════════════════════════════════════════════════════════════
// AI Chatbot — WORKER chạy trong tiến trình Next (instrumentation.ts gọi startAiChatbotWorker). Không thêm dịch vụ / Redis
// (VPS 1 GB RAM). Nhiều tiến trình cùng chạy vẫn an toàn: claim FOR UPDATE SKIP LOCKED + khoá thuê theo hội thoại.
//
//   • AI tắt (cài đặt) → chỉ đọc cài đặt mỗi 15 giây, KHÔNG gọi Pancake / AI / POS.
//   • Poller: page bật AI, mỗi poll_interval_seconds → hội thoại có tin khách mới → job.
//   • Job: khoá hội thoại → router.processTurn → xong / chờ / thử lại (giãn dần) / hỏng.
//   • Mỗi phút: job treo quá hạn → về chờ. Mỗi 6 giờ: dọn sổ vận hành. Mỗi kb_sync_hours: đồng bộ sản phẩm POS.
// Tắt hẳn worker trong một tiến trình: TALPHA_AI_WORKER=0.
// ═══════════════════════════════════════════════════════════════════
import os from "os";
import { processTurn } from "./router";
import { loadSettings, routerDeps, runtime, sendOpsAlert, syncPageTokens } from "./runtime";
import { conversationsNeedingCheck, PancakeError } from "./pancake-client";
import { pageErrorCode } from "./page-policy";
import { escapeHtml } from "./text";
import type { Job } from "./store-pg";
import type { AiSettings } from "./settings";

const CONCURRENCY = 2;
/** Hạn thuê job + khoá hội thoại; gia hạn mỗi 60 giây khi đang chạy. */
const LEASE_SECONDS = 180;
/** Số trang (60 hội thoại / trang) tối đa mỗi lượt quét một page. */
const POLL_MAX_PAGES = 10;
/** Số page quét song song (giới hạn Pancake 5 lượt / giây / page — tính riêng từng page). */
const POLL_PARALLEL = 4;
/** Tự đọc token page (page mới nối Pancake / token đổi) mỗi chừng này. */
const TOKEN_SYNC_MS = 30 * 60_000;
const SLOT = Symbol.for("talpha.aiChatbotWorker");
// Mã worker giữ trên globalThis: Next nạp module này ở nhiều bundle (instrumentation, route) — mỗi bản tự sinh mã là
// khoá thuê do bản này lấy, bản kia không nhả được.
const ID_SLOT = Symbol.for("talpha.aiChatbotWorkerId");
const gid = globalThis as unknown as { [ID_SLOT]?: string };
const WORKER_ID = gid[ID_SLOT] ??= `${os.hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 8)}`;

type State = {
    started: boolean; stopping: boolean; lastRecover: number; lastCleanup: number; lastKbSync: number; lastTokenSync?: number; lastKbFirstCheck?: number;
    lastPoll: Map<string, number>; active: number; lastTickAt: number; lastError: string | null; processed: number;
};
const g = globalThis as unknown as { [SLOT]?: State };

export function workerStatus() {
    const s = g[SLOT];
    return s ? { id: WORKER_ID, started: s.started, active: s.active, last_tick_at: s.lastTickAt ? new Date(s.lastTickAt).toISOString() : null,
        last_error: s.lastError, processed: s.processed } : { id: WORKER_ID, started: false };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function startAiChatbotWorker() {
    if (process.env.TALPHA_AI_WORKER === "0") { console.log("[ai-chatbot] worker tắt (TALPHA_AI_WORKER=0)"); return; }
    if (g[SLOT]?.started) return;
    g[SLOT] = { started: true, stopping: false, lastRecover: 0, lastCleanup: 0, lastKbSync: Date.now(), lastPoll: new Map(),
        active: 0, lastTickAt: 0, lastError: null, processed: 0 };
    console.log(`[ai-chatbot] worker ${WORKER_ID} chạy`);
    void loop();
}

async function loop() {
    const st = g[SLOT]!;
    // Chờ server dựng xong (khoá kết nối nạp ở instrumentation).
    await sleep(5000);
    while (!st.stopping) {
        let busy = false;
        try {
            st.lastTickAt = Date.now();
            const S = await loadSettings();
            if (!S.enabled) { await sleep(15_000); continue; }
            await housekeeping(S, st);
            if (S.poll_enabled) await pollDue(S, st);
            busy = await drain(S, st);
            st.lastError = null;
        } catch (e) {
            st.lastError = errText(e);
            // Bảng chưa có (chưa migrate) → nghỉ lâu, đừng ghi log dồn dập.
            const missing = /relation .* does not exist/i.test(st.lastError);
            console.error("[ai-chatbot] worker lỗi:", st.lastError);
            await sleep(missing ? 300_000 : 10_000);
            continue;
        }
        await sleep(busy ? 500 : 2000);
    }
}

async function housekeeping(S: AiSettings, st: State) {
    const rt = runtime();
    const now = Date.now();
    if (now - st.lastRecover > 60_000) {
        st.lastRecover = now;
        const n = await rt.pg.queue.recoverStuck();
        if (n) console.log(`[ai-chatbot] ${n} job treo quá hạn → về hàng chờ`);
    }
    if (now - st.lastCleanup > 6 * 3600_000) {
        st.lastCleanup = now;
        await rt.pg.queue.cleanup().catch((e) => console.error("[ai-chatbot] dọn sổ lỗi:", errText(e)));
    }
    if (S.kb_sync_hours > 0 && now - st.lastKbSync > S.kb_sync_hours * 3600_000) {
        st.lastKbSync = now;
        void import("./kb-sync").then((m) => m.syncPosKnowledge("lịch đồng bộ")).catch((e) => console.error("[ai-chatbot] đồng bộ KB lỗi:", errText(e)));
    } else if (S.kb_sync_hours > 0 && now - (st.lastKbFirstCheck || 0) > 3600_000) {
        // Shop POS MỚI (thêm ở /admin → Thị trường) chưa có sản phẩm nào trong kiến thức → đồng bộ ngay, không chờ lịch.
        st.lastKbFirstCheck = now;
        void import("./kb-sync").then(async (m) => {
            if (await m.hasUnsyncedShop()) { st.lastKbSync = Date.now(); await m.syncPosKnowledge("shop POS mới"); }
        }).catch((e) => console.error("[ai-chatbot] kiểm shop POS mới lỗi:", errText(e)));
    }
    // Token page: page mới nối Pancake / token đổi → tự đọc (không cần bấm, không cấu hình từng page).
    if (now - (st.lastTokenSync || 0) > TOKEN_SYNC_MS) {
        st.lastTokenSync = now;
        void syncPageTokens().catch((e) => console.error("[ai-chatbot] đọc token page lỗi:", errText(e)));
    }
}

/**
 * Quét page ĐANG CHẠY (luật page tự động) tới lượt, song song POLL_PARALLEL page: hội thoại cập nhật từ mốc lần trước (lùi
 * 60 s cho chắc) có lượt cuối KHÔNG phải page → job. Lỗi CỦA PAGE (die / hết gói / mất quyền / token hỏng) → ghi sức khoẻ
 * (page tự nghỉ page_error_backoff_minutes rồi thử lại), báo Telegram 1 lần / ngày, token hỏng thì đọc lại token.
 */
async function pollDue(S: AiSettings, st: State) {
    const rt = runtime();
    const now = Date.now();
    const due = (await rt.pg.queue.enabledPages()).filter((p) => now - (st.lastPoll.get(p.pageId) || 0) >= S.poll_interval_seconds * 1000);
    for (const p of due) st.lastPoll.set(p.pageId, now);
    let i = 0;
    const lane = async () => { while (i < due.length) await pollPage(S, due[i++], now); };
    await Promise.all(Array.from({ length: Math.min(POLL_PARALLEL, due.length) }, lane));
}

async function pollPage(S: AiSettings, p: { pageId: string; name: string; pollCursor: number | null }, now: number) {
    const rt = runtime();
    try {
        const floor = now - S.max_turn_age_minutes * 60_000;
        const since = Math.floor(Math.max(floor, (p.pollCursor || floor) - 60_000) / 1000);
        // Lật trang (60 / lượt) tới hết hội thoại cập nhật từ mốc — không bỏ sót hội thoại đứng sau vị trí 60.
        const rows = await rt.pancake.listRecentConversations(p.pageId, since, Math.floor(now / 1000) + 60, POLL_MAX_PAGES);
        let cursor: number | null = null;
        for (const c of conversationsNeedingCheck(rows, p.pageId)) {
            await rt.pg.queue.enqueue(p.pageId, c.id, "poll", now);
        }
        for (const r of rows) {
            const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(String(r.updated_at)) ? String(r.updated_at) : `${r.updated_at}Z`);
            if (!Number.isNaN(t)) cursor = Math.max(cursor ?? 0, t);
        }
        await rt.pg.queue.savePoll(p.pageId, cursor, null);
        await rt.pg.queue.setPageHealth(p.pageId, true, null, null);
    } catch (e) {
        const msg = errText(e);
        await rt.pg.queue.savePoll(p.pageId, null, msg).catch(() => {});
        const code = pageErrorCode(msg, e instanceof PancakeError ? e.code : null);
        if (!code) return;                                    // lỗi mạng tạm thời — lượt sau quét lại
        if (code === "token") void syncPageTokens("token hỏng", 5 * 60_000).catch(() => {});
        const alert = await rt.pg.queue.setPageHealth(p.pageId, false, code, msg).catch(() => false);
        if (alert && await sendOpsAlert(`⚠️ <b>AI Chatbot: page tạm nghỉ</b>\n📄 ${escapeHtml(p.name)} (<code>${escapeHtml(p.pageId)}</code>)\n` +
            `Lỗi: ${escapeHtml(msg.slice(0, 300))}\nAI tự thử lại sau ${S.page_error_backoff_minutes} phút — page die / hết gói thì không cần làm gì.`)) {
            await rt.pg.queue.markAlerted(p.pageId).catch(() => {});
        }
    }
}

/** Nhận job tới hạn, chạy song song tối đa CONCURRENCY. Trả true nếu đã làm được việc (vòng sau nhanh hơn). */
async function drain(S: AiSettings, st: State): Promise<boolean> {
    const rt = runtime();
    const running: Promise<unknown>[] = [];
    let did = false;
    while (st.active < CONCURRENCY) {
        // Mã khoá RIÊNG cho lượt nhận này: hai job cùng tiến trình không "lấy lại" được khoá của nhau.
        const job = await rt.pg.queue.claim(`${WORKER_ID}:${Math.random().toString(36).slice(2, 10)}`, LEASE_SECONDS);
        if (!job) break;
        did = true;
        st.active++;
        running.push(runJob(job, S).finally(() => { st.active--; st.processed++; }));
    }
    await Promise.all(running);
    return did;
}

/** Chạy một job đã nhận: khoá hội thoại (mã của job), gia hạn thuê mỗi phút khi AI / Pancake chậm, router, ghi kết quả. */
export async function runJob(job: Job, S: AiSettings): Promise<string> {
    const rt = runtime();
    const q = rt.pg.queue;
    const token = job.lockedBy || `${WORKER_ID}:${job.id}`;
    if (!(await q.acquireLock(job.pageId, job.conversationId, token, LEASE_SECONDS))) {
        await q.requeue(job, Date.now() + 5000, "conversation_locked", false);
        return "conversation_locked";
    }
    const renew = setInterval(() => { void q.renewLease(job, LEASE_SECONDS).catch(() => {}); }, 60_000);
    try {
        const out = await processTurn({ jobId: job.id, pageId: job.pageId, conversationId: job.conversationId, attempt: job.attempts, source: job.source || "" }, routerDeps(job.pageId));
        switch (out.kind) {
            case "done":
                await q.finish(job, "done", `${out.decision}:${out.reason}`, out.runId, null);
                return `${out.decision}:${out.reason}`;
            case "noop":
                await q.finish(job, "done", out.reason, null, null);
                return out.reason;
            case "requeue":
                await q.requeue(job, out.runAfter, out.reason, false);
                return `requeue:${out.reason}`;
            case "retry":
                return await retryOrFail(job, S, out.reason, out.error);
        }
    } catch (e) {
        return await retryOrFail(job, S, "internal_error", errText(e));
    } finally {
        clearInterval(renew);
        await q.releaseLock(job.pageId, job.conversationId, token).catch(() => {});
    }
}

async function retryOrFail(job: Job, S: AiSettings, reason: string, error: string): Promise<string> {
    const rt = runtime();
    const q = rt.pg.queue;
    if (job.attempts >= S.max_attempts) {
        // Hết lượt thử mà vẫn không đọc được hội thoại → KHÔNG gửi gì (an toàn). Ghi một lượt 'error' vào nhật ký (khoá lượt
        // = "job:<id>" — không biết tin nào của khách) để Tổng quan / Nhật ký thấy, rồi job 'failed'.
        const page = await rt.pg.store.getPage(job.pageId).catch(() => null);
        const runId = await rt.pg.store.insertRun({
            jobId: job.id, pageId: job.pageId, conversationId: job.conversationId, turnMessageId: `job:${job.id}`, market: page?.market ?? null,
            customerText: "", language: null, intent: null, classification: null, retrieved: [], answer: null, decision: "error",
            reason: `job_failed:${reason}`.slice(0, 200), provider: null, model: null, inputTokens: 0, outputTokens: 0, costUsd: 0,
            confidence: null, durationMs: 0, sentMessageId: null, tagStatus: null, mode: S.mode,
            trace: [{ step: "job", ok: false, detail: `${job.attempts} lần thử: ${error}`.slice(0, 500) }],
        }).catch(() => null);
        await q.finish(job, "failed", reason, runId, error);
        console.error(`[ai-chatbot] job ${job.id} hỏng sau ${job.attempts} lần: ${reason} — ${error}`);
        return `failed:${reason}`;
    }
    const backoff = Math.min(300_000, 15_000 * Math.pow(2, job.attempts - 1));
    await q.requeue(job, Date.now() + backoff, reason, true, error);
    return `retry:${reason}`;
}

/** Một vòng làm việc ngay (nút "Chạy ngay" ở AI Settings / route worker): quét page tới lượt + xử lý job tới hạn. */
export async function tickOnce(): Promise<{ enabled: boolean; processed: boolean }> {
    if (!g[SLOT]) g[SLOT] = { started: false, stopping: false, lastRecover: 0, lastCleanup: Date.now(), lastKbSync: Date.now(),
        lastPoll: new Map(), active: 0, lastTickAt: 0, lastError: null, processed: 0 };
    const st = g[SLOT]!;
    const S = await loadSettings(true);
    if (!S.enabled) return { enabled: false, processed: false };
    st.lastPoll.clear();
    await housekeeping(S, st);
    if (S.poll_enabled) await pollDue(S, st);
    return { enabled: true, processed: await drain(S, st) };
}

/** Nút "Xử lý ngay" / webhook: đưa hội thoại vào hàng chờ chạy ngay. */
export async function enqueueConversation(pageId: string, conversationId: string, source: string): Promise<number | null> {
    return runtime().pg.queue.enqueue(pageId, conversationId, source, Date.now());
}
