// ═══════════════════════════════════════════════════════════════════
// AI Chatbot — page có được AI xét không (THUẦN, có test). 26/11/2026: user không muốn cấu hình từng page (page die / tạo
// mới liên tục) → mặc định TỰ ĐỘNG: page nào đủ điều kiện thì chạy, page die / hết gói / mất quyền / đang có bot khác thì
// tự nghỉ, hết lỗi thì tự chạy lại. Người dùng chỉ can thiệp khi muốn ép "Luôn bật" hoặc "Tắt".
// MỘT hàm trả lời cả "chạy không" lẫn "vì sao" — router, poller, trang Cài đặt cùng dùng.
// ═══════════════════════════════════════════════════════════════════

export type PageMode = "auto" | "on" | "off";

export type PageFacts = {
    mode: PageMode;
    market: string | null;
    /** Mã lỗi lượt kéo hộp thư gần nhất (pancake_pages.last_error_code): 121 / 122 = ngoài gói, 105 = mất quyền. */
    inboxErrorCode: string | null;
    hasPageToken: boolean;
    hasAccountToken: boolean;
    /** Sức khoẻ do worker ghi sau lượt quét gần nhất. */
    health: string | null;
    healthCode: string | null;
    healthAt: number | null;
    otherBotAt: number | null;
};

export type PagePolicy = {
    /** Tự bật AI cho page ở chế độ auto. */
    pagesAuto: boolean;
    /** Đang ở chế độ live (gửi thật) — page không có token page thì không gửi được. */
    live: boolean;
    now: number;
    /** Thấy bot khác gửi trong khoảng này → page ở chế độ auto tự nghỉ. */
    otherBotQuietMs: number;
    /** Page lỗi: nghỉ khoảng này rồi thử lại. */
    errorBackoffMs: number;
};

export type PageStatus =
    | "running" | "running_read_only" | "off" | "auto_off" | "no_market" | "no_plan" | "no_permission" | "no_token"
    | "other_bot" | "error";

export const PAGE_STATUS_LABELS: Record<PageStatus, string> = {
    running: "Đang chạy",
    running_read_only: "Chạy thử (chưa có token page — chỉ đọc)",
    off: "Tắt tay",
    auto_off: "Chờ bật (tự bật page mới đang tắt)",
    no_market: "Chưa gán nước — chưa có kiến thức sản phẩm",
    no_plan: "Ngoài gói cước Pancake",
    no_permission: "Tài khoản Pancake mất quyền trên page",
    no_token: "Chưa đọc được token",
    other_bot: "Page đang có bot khác trả lời — AI tự né",
    error: "Lỗi đọc Pancake — tạm nghỉ, tự thử lại",
};

const NO_PLAN = new Set(["121", "122"]);
const NO_PERMISSION = new Set(["105"]);

/** Page có chạy không + vì sao. `enabled` = router / poller xét page này. */
export function resolvePage(p: PageFacts, s: PagePolicy): { enabled: boolean; status: PageStatus } {
    const off = (status: PageStatus) => ({ enabled: false, status });
    if (p.mode === "off") return off("off");
    // Lỗi do worker đo chỉ giữ trong khoảng nghỉ — hết khoảng là thử lại (page được gia hạn gói / cấp lại quyền thì tự chạy).
    // Mã lỗi của lượt kéo hộp thư (inboxErrorCode) do việc nền hộp thư tự đo lại mỗi giờ.
    const recentError = p.health === "error" && p.healthAt !== null && s.now - p.healthAt < s.errorBackoffMs;
    const code = String((recentError ? p.healthCode : null) || p.inboxErrorCode || "");
    if (NO_PLAN.has(code)) return off("no_plan");
    if (NO_PERMISSION.has(code)) return off("no_permission");
    if (!p.hasPageToken && !p.hasAccountToken) return off("no_token");
    if (recentError) return off("error");
    const runningStatus: PageStatus = p.hasPageToken ? "running" : "running_read_only";
    if (p.mode === "on") return { enabled: true, status: runningStatus };
    // auto
    if (!s.pagesAuto) return off("auto_off");
    if (!p.market) return off("no_market");
    if (p.otherBotAt !== null && s.now - p.otherBotAt < s.otherBotQuietMs) return off("other_bot");
    // Live mà chưa có token page: không gửi được → đừng xét (khỏi chuyển Sale hàng loạt "chưa có token"). Shadow đọc bằng
    // token tài khoản được.
    if (s.live && !p.hasPageToken) return off("no_token");
    return { enabled: true, status: runningStatus };
}

/** Lỗi Pancake → mã sức khoẻ page (lỗi của PAGE — khác lỗi mạng tạm thời). null = không phải lỗi page. */
export function pageErrorCode(message: string, code: string | null): string | null {
    const c = String(code || "");
    if (NO_PLAN.has(c) || NO_PERMISSION.has(c)) return c;
    if (/invalid.*(access_token|token)|token.*(expired|invalid|hết hạn)/i.test(message)) return "token";
    if (/page.*(not found|không tồn tại)|unpublished|bị khoá|disabled/i.test(message)) return "page";
    return null;
}
