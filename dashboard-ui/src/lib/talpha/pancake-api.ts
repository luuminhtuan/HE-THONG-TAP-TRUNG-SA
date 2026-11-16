// ═══════════════════════════════════════════════════════════════════
// Gọi API Pancake (pages.fm) — phần CÓ MẠNG, dùng chung cho:
//   • /api/talpha/pancake-messages — số một nước một ngày theo page (bot Zalo, tin mỗi giờ Nhật);
//   • /api/talpha/realtime     — Ads Command Center: mess từng camp của nước Meta không báo tin
//     nhắn (Nhật), Sỹ Anh yêu cầu 13/10/2026 "cập nhật dashboard cho thị trường Nhật".
// Hàm thuần (đếm, chia, khớp tên) ở lib/talpha/pancake.ts — có test.
//
// Pancake 429 khi gọi dồn: mỗi lượt cách nhau GIAN_MS, gặp 429 thì chờ 5s · 10s · 20s. Hai route
// hỏi cùng page cùng mốc trong 3 phút thì dùng chung một lần gọi (NHO_HT).
// ═══════════════════════════════════════════════════════════════════
import { campaignMarket, MESS_PANCAKE } from "./rules";
import { getCredential } from "./credentials";
import {
    PANCAKE_API, normalizePageName, splitMessByCampaign, countForRange, hanToken, batchDoneForDay, pageOfCampaign,
    type Conversation,
} from "./pancake";

export const GIAN_MS = 400;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function goiPancake(url: string): Promise<any> {
    for (let attempt = 0; attempt < 4; attempt++) {
        const r = await fetch(url, { cache: "no-store" });
        if (r.status === 429) { await sleep(5000 * 2 ** attempt); continue; }
        const j = await r.json().catch(() => null);
        if (!r.ok || !j) throw new Error(`Pancake HTTP ${r.status}`);
        if (j.success === false) throw new Error(`Pancake: ${j.message || "lỗi"}${j.error_code ? ` (mã ${j.error_code})` : ""}`);
        return j;
    }
    throw new Error("Pancake 429 — gọi dồn quá, thử lại sau");
}

/** Token tài khoản Pancake + lỗi nếu thiếu / hết hạn. */
export function tokenPancake(): { tok: string; het_han: string | null; loi: string } {
    const tok = getCredential("TALPHA_PANCAKE_API_TOKEN");
    const expiry = hanToken(tok);
    const loi = !tok ? "chưa có token Pancake (Quản trị → Khoá kết nối)"
        : expiry && expiry < Date.now() ? `token Pancake đã hết hạn ${new Date(expiry).toISOString().slice(0, 10)}` : "";
    return { tok, het_han: expiry ? new Date(expiry).toISOString() : null, loi };
}

// Danh sách page của tài khoản — 10 phút mới hỏi lại.
let dsPage: { at: number; tok: string; pages: { id: string; name: string }[] } | null = null;
export async function cacPage(tok: string): Promise<{ id: string; name: string }[]> {
    if (dsPage && dsPage.tok === tok && Date.now() - dsPage.at < 600_000) return dsPage.pages;
    const j = await goiPancake(`${PANCAKE_API}/pages?access_token=${encodeURIComponent(tok)}`);
    const c = j.categorized || {};
    const pages = [...(c.activated || []), ...(c.inactivated || [])]
        .filter((p: any) => p && p.id).map((p: any) => ({ id: String(p.id), name: String(p.name || "") }));
    dsPage = { at: Date.now(), tok, pages };
    return pages;
}

const MAX_BATCHES = 25;
const CONVERSATION_CACHE = new Map<string, { at: number; v: { hts: Conversation[]; du: boolean } }>();

/**
 * Mọi hội thoại có thể TẠO từ ngày VN `tu` tới nay của một page — lật bằng current_count (lô xếp
 * theo updated_at mới nhất trước) tới khi cả lô đã cập nhật trước 00:00 ngày `tu`, tối đa MAX_LO
 * lô. `du` = false khi chạm trần mà chưa lật hết (khoảng dài, page đông) hoặc quá `hetLuc`
 * (epoch ms — route có hạn chạy) — số đếm được là THIẾU. Chỉ nhớ kết quả lật HẾT.
 */
export async function conversationsSince(tok: string, pageId: string, from: string, deadline?: number): Promise<{ hts: Conversation[]; du: boolean }> {
    const cacheKey = `${pageId}|${from}`;
    const hit = CONVERSATION_CACHE.get(cacheKey);
    if (hit && Date.now() - hit.at < 180_000) return hit.v;
    const hts: Conversation[] = [];
    let cc = 0, complete = false;
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
        if (deadline && batch > 0 && Date.now() > deadline) break;
        const j = await goiPancake(`${PANCAKE_API}/pages/${pageId}/conversations?access_token=${encodeURIComponent(tok)}&current_count=${cc}`);
        const ds: Conversation[] = (j.conversations || []).map((h: any) => ({
            id: String(h.id), type: h.type, inserted_at: h.inserted_at, updated_at: h.updated_at, has_phone: !!h.has_phone,
        }));
        hts.push(...ds);
        if (batchDoneForDay(ds, from)) { complete = true; break; }
        cc += ds.length;
        await sleep(GIAN_MS);
    }
    const v = { hts, du: complete };
    if (complete) CONVERSATION_CACHE.set(cacheKey, { at: Date.now(), v });
    return v;
}

type CampMess = { campaign_name: string; spend_vnd: number; link_clicks?: number | null };

/**
 * Mess từng camp của nước Meta không báo tin nhắn (MESS_PANCAKE), khoảng ngày VN [tu, den]:
 * hội thoại INBOX mới trên page ghi trong tên camp (ô TRANG), chia cho các camp cùng page bằng
 * chiaMessTheoCamp — cùng luật tin mỗi giờ của bot. Chỉ camp CÓ TIÊU trong khoảng mới nhận mess.
 * Hỏng (token, mạng) thì ok=false kèm lý do — route giữ số Meta và báo cảnh báo, không im lặng.
 * `hetLuc`: quá giờ này thì page còn lại đếm dở (vào `thieu`) — route có hạn chạy.
 */
export async function pancakeMessByCampaign<C extends CampMess>(camps: C[], from: string, to: string, deadline?: number): Promise<{
    ok: boolean; loi: string; theoCamp: Map<C, number>; tong: number; thieu: string[]; khong_thay: string[];
}> {
    const byCampaign = new Map<C, number>();
    const kq = { ok: false, loi: "", theoCamp: byCampaign, tong: 0, thieu: [] as string[], khong_thay: [] as string[] };
    const byPage = new Map<string, { ten: string; cs: C[] }>();
    for (const c of camps) {
        if (!(c.spend_vnd > 0) || !MESS_PANCAKE.includes(campaignMarket(c.campaign_name).market || "")) continue;
        const t = pageOfCampaign(c.campaign_name);
        if (!t) continue;
        const k = normalizePageName(t);
        if (!byPage.has(k)) byPage.set(k, { ten: t, cs: [] });
        byPage.get(k)!.cs.push(c);
    }
    if (!byPage.size) { kq.ok = true; return kq; }
    const { tok, loi } = tokenPancake();
    if (loi) { kq.loi = loi; return kq; }
    try {
        const allPages = await cacPage(tok);
        for (const [k, g] of byPage) {
            const p = allPages.find((x) => normalizePageName(x.name) === k);
            if (!p) { kq.khong_thay.push(g.ten); continue; }
            const { hts, du: complete } = await conversationsSince(tok, p.id, from, deadline);
            if (!complete) kq.thieu.push(p.name);
            const n = countForRange(hts, from, to).inbox_moi;
            splitMessByCampaign(n, g.cs).forEach((v, i) => byCampaign.set(g.cs[i], v));
            kq.tong += n;
            await sleep(GIAN_MS);
        }
        kq.ok = true;
    } catch (e: any) { kq.loi = String(e?.message || e); }
    return kq;
}
