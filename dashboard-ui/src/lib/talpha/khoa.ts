// ═══════════════════════════════════════════════════════════════════
// Khoá kết nối — MỘT chỗ đọc token Meta, key POS, token Pancake, key 17TRACK (04/11/2026).
//
// Khoá chết thường xuyên: token Meta đã đổi ba lần từ 08/2026, token Pancake sống khoảng
// 90 ngày, TKQC mất quyền. Trước đây thay khoá là sửa .env.local trên đúng một máy Mac rồi
// deploy; máy khác không có file đó thì không chạy được. Nay giám đốc dán khoá mới ở
// /admin → Khoá kết nối, máy gọi thử khoá trước rồi mới lưu.
//
// Lưu ở dashboard-ui/.env.khoa.local (ngoài git, chỉ root đọc), TÁCH khỏi .env.local vì
// from-mac.sh chép .env.local của Mac đè lên máy chủ mỗi lần deploy — khoá nhập trên trang
// mà nằm trong đó thì lần deploy sau mất. Khoá trên trang thắng biến môi trường:
//   • Dashboard đọc file mỗi lượt gọi (nhớ theo mtime) → khoá mới có hiệu lực ngay.
//   • Sync, vòng ghi Sheet, danh mục SP: systemd nạp file này SAU .env.local (drop-in do
//     vps-setup.sh dựng) → có hiệu lực từ lần chạy kế tiếp.
//
// Code cần khoá thì gọi docKhoa(), đừng đọc process.env thẳng.
// ═══════════════════════════════════════════════════════════════════
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { REPO_ROOT, TALPHA_YAML } from "./config-path";
import { MARKET_DA_TAT, MESS_PANCAKE, RULES, SHOP2MKT, SHOP_POS } from "./rules";
import { cheKhoa, docEnv, docGhiChu, suaEnv } from "./khoa-file";
import { PANCAKE_API, hanToken } from "./pancake";
import { getQuota, keyId } from "./track17";
import { TRACK_MARKETS } from "./tracking";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const lockfile = require("proper-lockfile");

export const FILE_KHOA = path.join(REPO_ROOT, "dashboard-ui", ".env.khoa.local");

const DAU_FILE = [
    "# Khoá kết nối nhập ở /admin → Khoá kết nối. Dashboard tự ghi file này — đừng sửa tay.",
    "# Ngoài git, deploy không đè. Khoá ở đây thắng khoá cùng tên trong .env.local.",
    "",
].join("\n");

let nho: { mtime: number; text: string; map: Map<string, string> } | null = null;

function docFile(): { text: string; map: Map<string, string> } {
    try {
        const mtime = fs.statSync(FILE_KHOA).mtimeMs;
        if (!nho || nho.mtime !== mtime) {
            const text = fs.readFileSync(FILE_KHOA, "utf8");
            nho = { mtime, text, map: docEnv(text) };
        }
        return nho;
    } catch {
        return { text: "", map: new Map() };   // chưa ai nhập khoá trên trang
    }
}

/** Khoá đang dùng: nhập trên trang trước, rồi biến môi trường (.env.local). */
export function docKhoa(ten: string): string {
    return (docFile().map.get(ten) ?? process.env[ten] ?? "").trim();
}

/** Toàn bộ môi trường đã phủ khoá nhập trên trang — cho hàm nhận cả bảng (17TRACK nhiều khoá). */
export function moiTruongKhoa(): Record<string, string | undefined> {
    return { ...process.env, ...Object.fromEntries(docFile().map) };
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
    const out: KhoaDef[] = [{
        ten: tenBien(cfg.meta_ads?.access_token) || "TALPHA_META_ACCESS_TOKEN",
        nhan: "Token Meta Ads",
        dung_cho: "Chi tiêu quảng cáo mỗi giờ, Ads Command Center",
        loai: "meta",
    }];
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
    const f = docFile();
    const ghiChu = docGhiChu(f.text);
    return danhSachKhoa().map(({ shop, ...d }) => {
        const trang = f.map.get(d.ten) || "";
        const env = (process.env[d.ten] || "").trim();
        const v = trang || env;
        return {
            ...d,
            shop_id: shop?.shop_id || null,
            nguon: trang ? "trang" : env ? "env" : "thieu",
            che: cheKhoa(v),
            do_dai: v.length,
            cap_nhat: trang ? ghiChu.get(d.ten) || null : null,
            env_khac: !!trang && !!env && env !== trang,
        };
    });
}

/** Đặt hoặc bỏ (`null`) một khoá trên trang. Ghi dưới khoá file, đổi tên một phát. */
export async function luuKhoa(ten: string, giaTri: string | null, ghiChu: string): Promise<void> {
    if (!fs.existsSync(FILE_KHOA)) fs.writeFileSync(FILE_KHOA, DAU_FILE, { mode: 0o600, flag: "a" });
    const release = await lockfile.lock(FILE_KHOA, {
        retries: { retries: 5, minTimeout: 100, maxTimeout: 1000 },
        stale: 10000,
    });
    try {
        const cu = fs.readFileSync(FILE_KHOA, "utf8");
        // Ghi ra file tạm rồi đổi tên: systemd và lượt đọc khác không bao giờ gặp file ghi dở.
        const tam = `${FILE_KHOA}.${process.pid}.tmp`;
        fs.writeFileSync(tam, suaEnv(cu || DAU_FILE, ten, giaTri, ghiChu), { mode: 0o600 });
        fs.renameSync(tam, FILE_KHOA);
        nho = null;
    } finally {
        await release();
    }
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

/** Token sống, đọc được bao nhiêu TKQC trong danh sách sync. Đọc được ít nhất một là lưu được:
 *  TKQC chết thì sync bỏ qua TK đó (Sỹ Anh chốt 28/10/2026), không phải lỗi của token. */
async function kiemMeta(tok: string): Promise<KetQuaKiem> {
    const me = await graph("me", tok, { fields: "id,name" });
    const tk = await graph("me/adaccounts", tok, { fields: "account_id", limit: "500" });
    const docDuoc = new Set((tk.data || []).map((a: { account_id: string }) => `act_${a.account_id}`));
    const can = (yamlTho().meta_ads?.ad_account_ids || []).map(String);
    const thieu = can.filter((id) => !docDuoc.has(id));
    let het: string | null = null;
    try {
        const exp = (await graph("debug_token", tok, { input_token: tok }))?.data?.expires_at;
        if (exp) het = new Date(exp * 1000).toISOString();
    } catch { /* không đọc được hạn thì thôi, token vẫn sống */ }
    const n = can.length - thieu.length;
    return {
        ok: can.length === 0 || n > 0,
        chi_tiet: `${me.name || "Token"} đọc được ${n}/${can.length} TKQC trong danh sách sync`,
        canh_bao: thieu.length ? `Không đọc được: ${thieu.join(", ")}` : undefined,
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
        if (d.loai === "meta") return await kiemMeta(giaTri);
        if (d.loai === "pos") return await kiemPos(d, giaTri);
        if (d.loai === "pancake") return await kiemPancake(giaTri);
        return await kiemTrack17(giaTri);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, chi_tiet: /timeout|aborted/i.test(msg) ? "Dịch vụ không trả lời sau 20 giây" : msg };
    }
}
