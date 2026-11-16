// ═══════════════════════════════════════════════════════════════════
// Pancake (pages.fm) — đếm TIN NHẮN theo page, cho nước mà Meta KHÔNG báo số tin nhắn.
//
// Vì sao (Sỹ Anh yêu cầu 09/10/2026): quảng cáo chạy ở Nhật không có chỉ số tin nhắn trên
// Meta (luật bảo vệ thông tin liên lạc của Nhật, như châu Âu) — hai camp Nhật đầu tiên đều
// là camp tin nhắn (Tương tác → Messenger → Cuộc trò chuyện) mà insights trả 0 mess. Số
// thật nằm trong hộp thư Pancake của page, nên đếm ở đó.
//
// API: https://pages.fm/api/v1 với access_token của TÀI KHOẢN Pancake (JWT, ~90 ngày, ghi
// trong TALPHA_PANCAKE_API_TOKEN). public_api/v1 trả "Invalid access_token" với token tài
// khoản nên dùng v1. Đo 09/10/2026:
//   • /pages → { categorized: { activated: [page…] } }
//   • /pages/{id}/conversations?current_count=N — lật trang bằng current_count (page_number
//     bị BỎ QUA: trang nào cũng trả cùng lô); lô đầu 60, lô sau 40; xếp theo updated_at mới
//     nhất trước. Hội thoại KHÔNG ghi đến từ quảng cáo nào → gom theo PAGE rồi nối camp bằng
//     tên page trong tên camp (mỗi camp Nhật một page).
//   • inserted_at / updated_at là giờ UTC không ghi múi (như POS) — đổi +7 ra ngày VN.
//   • Gọi dồn là 429 Too Many Requests → giãn lượt, gặp 429 thì chờ rồi thử lại.
// Hàm ở đây là hàm THUẦN (không mạng) để test được; route /api/talpha/pancake-messages gọi mạng.
// ═══════════════════════════════════════════════════════════════════
import { CAMP_MARKETS, normCampMarketer } from "./rules";

export const PANCAKE_API = "https://pages.fm/api/v1";

export type Conversation = {
    id: string; type?: string | null; inserted_at?: string | null; updated_at?: string | null;
    has_phone?: boolean | null;
};
export type ConversationCounts = { inbox_moi: number; comment_moi: number; co_sdt: number };

/** Tên page để SO KHỚP — cùng luật normalize_page_name (ops/talpha_reports/talpha_rules.py): bỏ kiểu
 *  chữ trang trí (𝑱𝒂𝒑𝒂𝒏 → japan), hoa thường, dấu câu, khoảng trắng thừa. */
export function normalizePageName(s?: string | null): string {
    return String(s || "").normalize("NFKC").toLowerCase()
        .replace(/[^\p{L}\p{N}_]+/gu, " ").trim().replace(/\s+/g, " ");
}

/** Ô TÊN PAGE trong tên campaign chuẩn NƯỚC/MARKETER/TỆP/SẢNPHẨM/TRANG/NGÀY — ô thứ 4 sau ô nước.
 *  Không có ô nước (tên cũ) thì đếm từ ô marketer như camp_san_pham. Không thấy → null. */
export function pageOfCampaign(cn?: string | null): string | null {
    const p = String(cn || "").split("/").map((x) => x.trim());
    const mi = p.findIndex((s) => s.toUpperCase() in CAMP_MARKETS);
    const k = mi >= 0 ? mi + 1 : p.slice(0, 2).findIndex((s) => normCampMarketer(s));
    if (k < 0) return null;
    const t = p[k + 3];
    return t ? t : null;
}

/** "2026-10-08T22:39:09.188" (UTC không múi) → ngày VN "2026-10-09". Hỏng → null. */
export function toVnDate(iso?: string | null): string | null {
    const s = String(iso || "").trim();
    if (!s) return null;
    const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z");
    return Number.isNaN(t) ? null : new Date(t + 7 * 3600_000).toISOString().slice(0, 10);
}

/** 00:00 ngày VN `ngay` tính bằng epoch ms. */
export const vnDayStartMs = (date: string) => Date.parse(`${date}T00:00:00+07:00`);

/** Hội thoại MỚI trong ngày VN: INBOX = tin nhắn mới (cùng nghĩa "cuộc trò chuyện mới" của Meta),
 *  COMMENT = bình luận mới; co_sdt = số tin nhắn mới đã có số điện thoại. Trùng id chỉ đếm một lần. */
export function countForDay(hts: Conversation[], date: string): ConversationCounts {
    const out: ConversationCounts = { inbox_moi: 0, comment_moi: 0, co_sdt: 0 };
    const da = new Set<string>();
    for (const h of hts) {
        if (!h || da.has(h.id) || toVnDate(h.inserted_at) !== date) continue;
        da.add(h.id);
        if (String(h.type || "").toUpperCase() === "COMMENT") out.comment_moi++;
        else { out.inbox_moi++; if (h.has_phone) out.co_sdt++; }
    }
    return out;
}

/** Như demTrongNgay nhưng cho KHOẢNG ngày VN [tu, den] (Ads Command Center chọn nhiều ngày). */
export function countForRange(hts: Conversation[], from: string, to: string): ConversationCounts {
    const out: ConversationCounts = { inbox_moi: 0, comment_moi: 0, co_sdt: 0 };
    const da = new Set<string>();
    for (const h of hts) {
        const d = h ? toVnDate(h.inserted_at) : null;
        if (!h || da.has(h.id) || !d || d < from || d > to) continue;
        da.add(h.id);
        if (String(h.type || "").toUpperCase() === "COMMENT") out.comment_moi++;
        else { out.inbox_moi++; if (h.has_phone) out.co_sdt++; }
    }
    return out;
}

/** Mess của MỘT page chia cho các camp chạy page đó — CÙNG luật bot Zalo (tin_gio.chiaMessTheoCamp):
 *  theo click Messenger, không camp nào có click thì theo tiền. Phần dư làm tròn trao cho camp có
 *  phần lẻ lớn nhất — tổng luôn đúng bằng mess của page. */
export function splitMessByCampaign(totalMess: number, cs: { link_clicks?: number | null; spend_vnd?: number | null }[]): number[] {
    if (cs.length <= 1) return cs.map(() => totalMess);
    let w = cs.map((c) => Number(c.link_clicks || 0));
    if (!w.some((v) => v > 0)) w = cs.map((c) => Number(c.spend_vnd || 0));
    const S = w.reduce((a, b) => a + b, 0) || 1;
    const raw = w.map((v) => (totalMess * v) / S);
    const out = raw.map(Math.floor);
    const remainders = raw.map((v, i) => [v - Math.floor(v), i] as [number, number]).sort((a, b) => b[0] - a[0]);
    for (let j = 0, leftover = totalMess - out.reduce((a, b) => a + b, 0); j < leftover; j++) out[remainders[j % remainders.length][1]]++;
    return out;
}

/** Lật tiếp hay thôi: lô xếp theo updated_at giảm dần, nên khi CẢ lô đã cập nhật trước 00:00 ngày
 *  `ngay` thì không còn hội thoại nào TẠO trong ngày đó ở các lô sau (tạo ≤ cập nhật). */
export function batchDoneForDay(batch: Conversation[], date: string): boolean {
    if (!batch.length) return true;
    const dayStart = vnDayStartMs(date);
    return batch.every((h) => {
        const s = String(h.updated_at || h.inserted_at || "");
        const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z");
        return !Number.isNaN(t) && t < dayStart;
    });
}

/** Hạn của token Pancake (JWT, trường exp) → epoch ms; không đọc được → null. */
export function hanToken(jwt?: string | null): number | null {
    const p = String(jwt || "").split(".");
    if (p.length !== 3) return null;
    try {
        const j = JSON.parse(Buffer.from(p[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
        return typeof j.exp === "number" ? j.exp * 1000 : null;
    } catch { return null; }
}

/** Page của một nước theo tên: TỪ CUỐI là mã nước ("Lucky Charm JP", "… Cream JP"). Bổ sung cho
 *  cách khớp chính (tên page trong tên camp), để page mới chưa chạy camp vẫn được đếm. CHỈ từ cuối:
 *  "Japan Prime Leather" là page ĐÀI (camp TW/…) — khớp cả tên là đếm nhầm tin nhắn Đài sang Nhật.
 *  Route chỉ truyền MÃ SHOP (JP): đuôi "Japan" còn là tên hàng ("Prime Leather Japan" bán ở Đài). */
export function isMarketPage(name: string | null | undefined, tokens: string[]): boolean {
    const words = normalizePageName(name).toUpperCase().split(" ");
    const lastWord = words[words.length - 1];
    return !!lastWord && tokens.some((t) => normalizePageName(t).toUpperCase() === lastWord);
}
