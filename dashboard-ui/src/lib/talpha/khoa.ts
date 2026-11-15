// ═══════════════════════════════════════════════════════════════════
// Khoá kết nối — MỘT chỗ đọc token Meta, key POS, token Pancake, key 17TRACK (04/11/2026).
//
// Khoá chết thường xuyên: token Meta đã đổi ba lần từ 08/2026, token Pancake sống khoảng
// 90 ngày, TKQC mất quyền. Trước đây thay khoá là sửa .env.local trên đúng một máy Mac rồi
// deploy; máy khác không có file đó thì không chạy được. Nay giám đốc dán khoá mới ở
// /admin → Khoá kết nối, máy gọi thử khoá trước rồi mới lưu.
//
// Lưu ở bảng Postgres `api_credentials` (15/11/2026, migration 0006 — trước đó file
// dashboard-ui/.env.khoa.local), MÃ HOÁ bằng pgcrypto với chìa TALPHA_ENCRYPTION_KEY: bản sao lưu
// database hay câu SQL đọc nhầm bảng chỉ thấy chuỗi đã mã hoá; hai vai chỉ đọc của /api/query và
// "CEO hỏi" không được đọc bảng này. Khoá trên trang thắng biến môi trường (.env.local):
//   • Dashboard nạp bảng một lần (lượt đọc đầu), nạp lại ngay sau mỗi lần lưu và mỗi 5 phút.
//   • Sync, vòng ghi báo cáo, danh mục SP, lịch Docker đọc bảng lúc bắt đầu mỗi việc
//     (sync/core/khoa.py) → có hiệu lực từ lần chạy kế tiếp.
//
// Code cần khoá thì gọi docKhoa(), đừng đọc process.env thẳng.
// ═══════════════════════════════════════════════════════════════════
import fs from "fs";
import yaml from "js-yaml";
import { query } from "@/lib/db";
import { TALPHA_YAML } from "./config-path";
import { truyVanDongBo } from "./db-dong-bo";
import { MARKET_DA_TAT, MESS_PANCAKE, RULES, SHOP2MKT, SHOP_POS } from "./rules";
import { cheKhoa } from "./khoa-file";
import { BIEN_TOKEN_META } from "./tkqc-luat";
import { PANCAKE_API, hanToken } from "./pancake";
import { getQuota, keyId } from "./track17";
import { TRACK_MARKETS } from "./tracking";

const BIEN_CHIA = "TALPHA_ENCRYPTION_KEY";
const chiaMaHoa = () => (process.env[BIEN_CHIA] || "").trim();
const SQL_DOC = `SELECT name, public.pgp_sym_decrypt(encrypted_value, $1) AS value, note, updated_at, updated_by
                 FROM api_credentials`;
const LAM_MOI_SAU = 5 * 60_000;

type BanGhi = { value: string; note: string | null; updated_at: string; updated_by: string | null };
type Dong = BanGhi & { name: string };

let nho: { map: Map<string, BanGhi>; luc: number } | null = null;
let loiLuc = 0;
let dangLamMoi = false;
let daBaoThieu = false;

const thanhMap = (rows: Dong[]) => new Map(rows.map(({ name, ...r }) => [name, r]));

/** Nạp lại bảng khoá (không chặn). */
async function lamMoi(): Promise<void> {
    const chia = chiaMaHoa();
    if (!chia || !process.env.DATABASE_URL) return;
    const rows = await query<Dong>(SQL_DOC.replace("$1", "@chia"), { chia });
    nho = { map: thanhMap(rows), luc: Date.now() };
}

/** Khoá trong kho. Lượt đầu đọc đồng bộ (docKhoa không await được); sau đó làm mới nền mỗi 5 phút. */
function khoaTrongKho(): Map<string, BanGhi> {
    if (nho) {
        if (Date.now() - nho.luc > LAM_MOI_SAU && !dangLamMoi) {
            dangLamMoi = true;
            lamMoi().catch((e) => console.error("khoa: làm mới bảng api_credentials lỗi:", e))
                .finally(() => { dangLamMoi = false; });
        }
        return nho.map;
    }
    const chia = chiaMaHoa();
    if (!process.env.DATABASE_URL || !chia) {
        if (!daBaoThieu && process.env.DATABASE_URL) {
            console.error(`khoa: chưa đặt ${BIEN_CHIA} — không giải mã được khoá trong kho, dùng khoá trong .env.local`);
            daBaoThieu = true;
        }
        return new Map();
    }
    if (Date.now() - loiLuc < 30_000) return new Map();   // kho vừa lỗi — đừng chặn mỗi lượt gọi
    try {
        nho = { map: thanhMap(truyVanDongBo<Dong>(SQL_DOC, [chia])), luc: Date.now() };
        return nho.map;
    } catch (e) {
        loiLuc = Date.now();
        console.error("khoa: KHÔNG đọc được bảng api_credentials — dùng khoá trong .env.local:", e);
        return new Map();
    }
}

/** Khoá đang dùng: nhập trên trang (kho) trước, rồi biến môi trường (.env.local). */
export function docKhoa(ten: string): string {
    return (khoaTrongKho().get(ten)?.value ?? process.env[ten] ?? "").trim();
}

/** Toàn bộ môi trường đã phủ khoá nhập trên trang — cho hàm nhận cả bảng (17TRACK nhiều khoá). */
export function moiTruongKhoa(): Record<string, string | undefined> {
    const kho = Object.fromEntries([...khoaTrongKho()].map(([k, v]) => [k, v.value]));
    return { ...process.env, ...kho };
}

// ─── Danh sách khoá ─────────────────────────────────────────────────

export type LoaiKhoa = "meta" | "pos" | "pancake" | "track17";
export type KhoaDef = {
    ten: string;
    nhan: string;
    dung_cho: string;
    loai: LoaiKhoa;
    shop?: { name: string; shop_id: string; api_url: string };
};

type YamlTho = {
    meta_ads?: { access_token?: string; ad_account_ids?: string[] };
};

/** talpha.yaml CHƯA thay ${…} — để biết token Meta nằm ở biến nào, và danh sách TKQC. */
function yamlTho(): YamlTho {
    return (yaml.load(fs.readFileSync(TALPHA_YAML(), "utf8")) as YamlTho) || {};
}

const tenBien = (v: unknown) => /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(String(v ?? "").trim())?.[1] || null;

/** Khoá nào cần nhập. Shop POS lấy từ markets (SHOP_POS) — thêm nước ở config hoặc /admin →
 *  Thị trường là có thêm ô ở đây. Nước đã tắt không gọi POS nữa nên không có ô (khoá cũ vẫn
 *  nằm trong file, bật lại là dùng). */
export function danhSachKhoa(): KhoaDef[] {
    const cfg = yamlTho();
    const markets = RULES.markets as Record<string, { display?: string }>;
    const conChay = (key?: string | null) => !!key && !MARKET_DA_TAT.has(key);
    const meta = tenBien(cfg.meta_ads?.access_token) || BIEN_TOKEN_META[0];
    const out: KhoaDef[] = [{
        ten: meta,
        nhan: "Token Meta Ads",
        dung_cho: "Chi tiêu quảng cáo mỗi giờ, Ads Command Center — sync kéo MỌI TKQC token thấy",
        loai: "meta",
    }];
    // Token phụ (tuỳ chọn): TKQC nằm ở BM / app khác mà token chính không thấy. Mỗi TK đọc bằng token
    // ĐẦU TIÊN thấy nó (lib/talpha/tkqc.ts, sync/core/tkqc.py).
    BIEN_TOKEN_META.slice(1).forEach((ten, i) => out.push({
        ten,
        nhan: `Token Meta ${i + 2} — BM / app khác (tuỳ chọn)`,
        dung_cho: "Chỉ cần khi có TKQC mà token chính không thấy, vd TK của Business Manager cũ",
        loai: "meta",
    }));
    for (const s of SHOP_POS) {
        if (!conChay(s.name)) continue;
        out.push({
            ten: s.bien_key,
            nhan: `Key POS ${markets[s.name]?.display || s.name}`,
            dung_cho: "Đơn mỗi giờ, tab Kho, đơn hôm nay ở Ads Command Center",
            loai: "pos",
            shop: { name: s.name, shop_id: s.shop_id, api_url: s.api_url },
        });
    }
    // Nước nào dùng Pancake / 17TRACK đọc từ talpha_rules.json (markets.*.mess_source, tracking.markets).
    const nuocPancake = MESS_PANCAKE.filter(conChay).map((k) => markets[k]?.display || k).join(", ");
    const nuoc17 = TRACK_MARKETS.filter((m) => m.provider === "17track" && conChay(SHOP2MKT[m.code]))
        .map((m) => m.label).join(", ");
    out.push({
        ten: "TALPHA_PANCAKE_API_TOKEN",
        nhan: "Token Pancake",
        dung_cho: nuocPancake ? `Tin nhắn ${nuocPancake} (Meta không báo)` : "Chưa nước nào đếm tin nhắn qua Pancake",
        loai: "pancake",
    });
    out.push({
        ten: "TRACK17_API_KEY",
        nhan: "Key 17TRACK",
        dung_cho: nuoc17 ? `Theo dõi vận đơn ${nuoc17}` : "Chưa nước nào theo dõi vận đơn qua 17TRACK",
        loai: "track17",
    });
    return out;
}

// ─── Trạng thái + lưu ───────────────────────────────────────────────

export type TrangThaiKhoa = Omit<KhoaDef, "shop"> & {
    shop_id: string | null;
    nguon: "trang" | "env" | "thieu";
    che: string;
    do_dai: number;
    cap_nhat: string | null;
    /** Khoá trên trang đang che một khoá KHÁC trong .env.local. */
    env_khac: boolean;
};

/** Khoá nào đang dùng, lấy từ đâu — giá trị đã che, không bao giờ trả khoá thật. */
export function trangThaiKhoa(): TrangThaiKhoa[] {
    const kho = khoaTrongKho();
    return danhSachKhoa().map(({ shop, ...d }) => {
        const trang = kho.get(d.ten)?.value || "";
        const env = (process.env[d.ten] || "").trim();
        const v = trang || env;
        return {
            ...d,
            shop_id: shop?.shop_id || null,
            nguon: trang ? "trang" : env ? "env" : "thieu",
            che: cheKhoa(v),
            do_dai: v.length,
            cap_nhat: trang ? kho.get(d.ten)?.note || null : null,
            env_khac: !!trang && !!env && env !== trang,
        };
    });
}

/** Đặt hoặc bỏ (`null`) một khoá trên trang (bảng api_credentials, mã hoá), rồi nạp lại bản nhớ. */
export async function luuKhoa(ten: string, giaTri: string | null, ghiChu: string, ai = ""): Promise<void> {
    if (giaTri === null) {
        await query("DELETE FROM api_credentials WHERE name = @ten", { ten });
    } else {
        const chia = chiaMaHoa();
        if (!chia) throw new Error(`Chưa đặt ${BIEN_CHIA} trên máy chủ — không mã hoá được khoá để lưu`);
        await query(
            `INSERT INTO api_credentials (name, encrypted_value, note, updated_at, updated_by)
             VALUES (@ten, public.pgp_sym_encrypt(@giaTri, @chia), @ghiChu, now(), @ai)
             ON CONFLICT (name) DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value, note = EXCLUDED.note,
               updated_at = now(), updated_by = EXCLUDED.updated_by`,
            { ten, giaTri, chia, ghiChu: ghiChu || null, ai: ai || null });
    }
    await lamMoi();
}

// ─── Gọi thử khoá ──────────────────────────────────────────────────

export type KetQuaKiem = { ok: boolean; chi_tiet: string; canh_bao?: string; het_han?: string | null };

const HET_GIO = 20_000;
const GRAPH = "https://graph.facebook.com/v21.0";

async function graph(duong: string, tok: string, q: Record<string, string> = {}) {
    const r = await fetch(`${GRAPH}/${duong}?${new URLSearchParams({ ...q, access_token: tok })}`,
        { cache: "no-store", signal: AbortSignal.timeout(HET_GIO) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(`Meta từ chối: ${j.error?.message || `HTTP ${r.status}`}`);
    return j;
}

/** Token sống, đọc được bao nhiêu TKQC. Sync kéo MỌI TKQC token thấy (04/11/2026, lib/talpha/tkqc.ts), nên
 *  token đọc được ít nhất một TK là lưu được; TKQC vào báo cáo đang chạy mà token mới không thấy thì cảnh báo
 *  — lưu token đó là mất chi tiêu của các TK ấy. */
async function kiemMeta(tok: string, bien: string): Promise<KetQuaKiem> {
    const me = await graph("me", tok, { fields: "id,name" });
    const tk = await graph("me/adaccounts", tok, { fields: "account_id", limit: "500" });
    const docDuoc = new Set((tk.data || []).map((a: { account_id: string }) => String(a.account_id)));
    // Import muộn: tkqc.ts đọc khoá qua file này — import thẳng là vòng lặp module.
    let dangBaoCao: { id: string; ten: string; bien_token: string | null }[] = [];
    try {
        dangBaoCao = await (await import("@/lib/talpha/tkqc")).tkqcBaoCao(false);
    } catch { /* chưa có kho số / danh bạ — chỉ báo số TK đọc được */ }
    // Chỉ so các TK mà CHÍNH biến này đang đọc — token phụ không thấy TK của token chính là đương nhiên.
    const thieu = dangBaoCao.filter((t) => (t.bien_token || BIEN_TOKEN_META[0]) === bien && !docDuoc.has(t.id));
    let het: string | null = null;
    try {
        const exp = (await graph("debug_token", tok, { input_token: tok }))?.data?.expires_at;
        if (exp) het = new Date(exp * 1000).toISOString();
    } catch { /* không đọc được hạn thì thôi, token vẫn sống */ }
    return {
        ok: docDuoc.size > 0,
        chi_tiet: `${me.name || "Token"} đọc được ${docDuoc.size} TKQC — sync kéo tất cả`,
        canh_bao: thieu.length ? `TKQC đang vào báo cáo mà token này KHÔNG thấy: ${thieu.map((t) => t.ten || t.id).join(", ")}` : undefined,
        het_han: het,
    };
}

async function kiemPos(d: KhoaDef, key: string): Promise<KetQuaKiem> {
    const s = d.shop!;
    const r = await fetch(`${s.api_url}/shops/${s.shop_id}/orders?${new URLSearchParams({ api_key: key, page_size: "1" })}`,
        { cache: "no-store", signal: AbortSignal.timeout(HET_GIO) });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.success === false) throw new Error(`POS từ chối: ${j?.message || `HTTP ${r.status}`}`);
    return { ok: true, chi_tiet: `Shop ${s.shop_id} gọi được, ${Number(j.total_entries ?? 0).toLocaleString("vi-VN")} đơn` };
}

async function kiemPancake(tok: string): Promise<KetQuaKiem> {
    const het = hanToken(tok);
    const hetHan = het ? new Date(het).toISOString() : null;
    if (het && het < Date.now()) return { ok: false, chi_tiet: "Token đã hết hạn", het_han: hetHan };
    const r = await fetch(`${PANCAKE_API}/pages?access_token=${encodeURIComponent(tok)}`,
        { cache: "no-store", signal: AbortSignal.timeout(HET_GIO) });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.success === false) throw new Error(`Pancake từ chối: ${j?.message || `HTTP ${r.status}`}`);
    const c = j.categorized || {};
    const n = (c.activated?.length || 0) + (c.inactivated?.length || 0);
    return { ok: true, chi_tiet: `Đọc được ${n} page`, het_han: hetHan };
}

/** Hỏi quota — miễn phí, không trừ lượt đăng ký nào. */
async function kiemTrack17(key: string): Promise<KetQuaKiem> {
    const q = await getQuota({ id: keyId(key), label: "khoá này", key });
    return { ok: true, chi_tiet: `Còn ${q.remain.toLocaleString("vi-VN")}/${q.total.toLocaleString("vi-VN")} lượt đăng ký mã` };
}

/** Gọi thử một khoá với dịch vụ thật. Không ghi gì, không tốn quota. */
export async function kiemKhoa(d: KhoaDef, giaTri: string): Promise<KetQuaKiem> {
    if (!giaTri) return { ok: false, chi_tiet: "Chưa có khoá" };
    try {
        if (d.loai === "meta") return await kiemMeta(giaTri, d.ten);
        if (d.loai === "pos") return await kiemPos(d, giaTri);
        if (d.loai === "pancake") return await kiemPancake(giaTri);
        return await kiemTrack17(giaTri);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, chi_tiet: /timeout|aborted/i.test(msg) ? "Dịch vụ không trả lời sau 20 giây" : msg };
    }
}
