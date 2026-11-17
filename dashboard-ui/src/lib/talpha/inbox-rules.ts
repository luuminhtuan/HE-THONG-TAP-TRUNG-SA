// ═══════════════════════════════════════════════════════════════════
// Tab Tin nhắn — gán hội thoại cho người dùng + tag nội bộ (17/11/2026): phần THUẦN (soát thao tác, ai gán được cho
// ai). Phần đụng kho: inbox-meta.ts. Test: tests/inbox-rules.test.cjs.
// ═══════════════════════════════════════════════════════════════════

export const TAG_COLORS = ["slate", "red", "amber", "emerald", "sky", "violet", "pink"] as const;
export type TagColor = (typeof TAG_COLORS)[number];
export const TAG_NAME_MAX = 40;

export type InboxAction =
    | { action: "assign"; page_id: string; conversation_id: string; user_id: string | null }
    | { action: "tag"; page_id: string; conversation_id: string; tag_id: number; on: boolean }
    | { action: "create_tag"; name: string; color: TagColor }
    | { action: "sync_now" };

/** Người dùng của phần mềm, kèm nước họ xem được — để chọn người phụ trách hội thoại. */
export type InboxUser = { id: string; name: string; role: string; full: boolean; codes: string[] };

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const idOf = (v: unknown) => (typeof v === "string" || typeof v === "number") && String(v).trim() ? String(v).trim().slice(0, 200) : "";

/** Tên tag: bỏ khoảng trắng thừa, tối đa TAG_NAME_MAX ký tự. Rỗng → "". */
export function normalizeTagName(s: unknown): string {
    return String(s ?? "").replace(/\s+/g, " ").trim().slice(0, TAG_NAME_MAX);
}

/** Body POST /api/talpha/messages → thao tác hợp lệ, hoặc lỗi đọc được. */
export function parseInboxAction(body: unknown): InboxAction | { error: string } {
    if (!isRecord(body)) return { error: "Thiếu nội dung" };
    const action = String(body.action || "");
    if (action === "sync_now") return { action };
    if (action === "create_tag") {
        const name = normalizeTagName(body.name);
        if (!name) return { error: "Tên tag trống" };
        const color = (TAG_COLORS as readonly string[]).includes(String(body.color)) ? body.color as TagColor : "slate";
        return { action, name, color };
    }
    const page_id = idOf(body.page_id), conversation_id = idOf(body.conversation_id);
    if (!page_id || !conversation_id) return { error: "Thiếu page_id / conversation_id" };
    if (action === "assign") {
        const user_id = body.user_id == null || body.user_id === "" ? null : idOf(body.user_id);
        if (body.user_id != null && body.user_id !== "" && !user_id) return { error: "Người được gán không hợp lệ" };
        return { action, page_id, conversation_id, user_id };
    }
    if (action === "tag") {
        const tag_id = Number(body.tag_id);
        if (!Number.isInteger(tag_id) || tag_id <= 0) return { error: "Tag không hợp lệ" };
        return { action, page_id, conversation_id, tag_id, on: body.on !== false };
    }
    return { error: `Việc lạ: ${action || "(trống)"}` };
}

/** Ai nhận được hội thoại của nước `market`: người xem hết (giám đốc) + người xem được nước đó. Page chưa gán nước
 *  (market null) → chỉ người xem hết. */
export function assignableFor(users: InboxUser[], market: string | null): InboxUser[] {
    return users.filter((u) => u.full || (!!market && u.codes.includes(market)));
}

/** Người hiện trong bộ lọc "người phụ trách" của người xem: xem hết → mọi người; xem một phần → người xem hết + người
 *  chung ít nhất một nước. */
export function visibleUsersFor(viewer: { full: boolean; codes: string[] }, users: InboxUser[]): InboxUser[] {
    if (viewer.full) return users;
    return users.filter((u) => u.full || u.codes.some((c) => viewer.codes.includes(c)));
}

// ── Nút "Tải tin mới" (17/11/2026) — dòng trạng thái cạnh nút. Bảng pancake_sync_runs (migration 0007), đọc / ghi ở
// inbox-sync.ts. Kiểu đặt ở đây (file thuần) để test dựng được không kéo theo kho.

export type InboxSyncRun = {
    id: number;
    trigger: "manual" | "schedule";
    requested_by: string | null;
    status: "pending" | "running" | "ok" | "failed";
    requested_at: string;
    started_at: string | null;
    finished_at: string | null;
    summary: string | null;
};

export type InboxSyncStatus = {
    /** Yêu cầu / lượt đang chờ hoặc đang chạy (mới nhất) — có thì nút đang quay. */
    open: InboxSyncRun | null;
    /** Lượt xong gần nhất (ok / failed). */
    last: InboxSyncRun | null;
    /** Lần cuối một lượt kéo BẮT ĐẦU — không có / quá cũ: máy này chưa bật việc nền kéo tin. */
    runner_seen_at: string | null;
    /** Tự kéo mấy phút một lần — talpha_rules.json → pancake_inbox.sync_every_minutes. */
    every_minutes: number;
};

/** Yêu cầu chờ quá chừng này mà việc nền không chạy lượt nào trong RUNNER_ALIVE_MS → báo máy chưa bật việc nền. */
export const RUNNER_WAIT_MS = 90_000;
export const RUNNER_ALIVE_MS = 15 * 60_000;

export type InboxSyncNote = { busy: boolean; tone: "muted" | "warn" | "error"; text: string };

/** Trạng thái lượt kéo → chữ cạnh nút. `fmt` định dạng giờ (vnTime). */
export function inboxSyncNote(s: InboxSyncStatus | null | undefined, now: number, fmt: (iso: string) => string): InboxSyncNote {
    if (!s) return { busy: false, tone: "muted", text: "" };
    const o = s.open;
    if (o?.status === "running") {
        return { busy: true, tone: "muted", text: `Đang kéo tin từ Pancake (bắt đầu ${fmt(o.started_at || o.requested_at)})…` };
    }
    if (o) {
        const seen = s.runner_seen_at ? Date.parse(s.runner_seen_at) : 0;
        if (now - Date.parse(o.requested_at) > RUNNER_WAIT_MS && now - seen > RUNNER_ALIVE_MS) {
            return {
                busy: true, tone: "warn",
                text: `Đã gửi yêu cầu lúc ${fmt(o.requested_at)} nhưng chưa có việc nền nào nhận — máy này chưa bật lịch kéo tin `
                    + "(Docker: docker compose up -d scheduler; máy chủ: talpha-pancake.timer).",
            };
        }
        return { busy: true, tone: "muted", text: `Đã gửi yêu cầu lúc ${fmt(o.requested_at)} — chờ việc nền nhận lệnh…` };
    }
    const l = s.last;
    if (!l) return { busy: false, tone: "muted", text: "Chưa có lượt kéo tin nào." };
    const who = l.trigger === "manual" ? `bấm tay${l.requested_by ? ` — ${l.requested_by}` : ""}` : "theo lịch";
    return {
        busy: false, tone: l.status === "failed" ? "error" : "muted",
        text: `Lượt gần nhất ${fmt(l.finished_at || l.requested_at)} (${who}): ${l.summary || (l.status === "ok" ? "xong" : "lỗi")}`,
    };
}
