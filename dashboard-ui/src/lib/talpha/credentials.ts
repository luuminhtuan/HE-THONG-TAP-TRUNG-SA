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
//     (sync/core/credentials.py) → có hiệu lực từ lần chạy kế tiếp.
//
// Code cần khoá thì gọi docKhoa(), đừng đọc process.env thẳng.
// ═══════════════════════════════════════════════════════════════════
import fs from "fs";
import yaml from "js-yaml";
import { query } from "@/lib/db";
import { TALPHA_YAML } from "./config-path";
import { querySync } from "./db-sync";
import { DISABLED_MARKETS, MESS_PANCAKE, RULES, SHOP2MKT, SHOP_POS } from "./rules";
import { maskCredential } from "./credential-utils";
import { META_TOKEN_VARS } from "./ad-account-rules";
import { PANCAKE_API, tokenExpiry } from "./pancake";
import { getQuota, keyId } from "./track17";
import { TRACK_MARKETS } from "./tracking";

const ENCRYPTION_KEY_VAR = "TALPHA_ENCRYPTION_KEY";
const getEncryptionKey = () => (process.env[ENCRYPTION_KEY_VAR] || "").trim();
const READ_SQL = `SELECT name, public.pgp_sym_decrypt(encrypted_value, $1) AS value, note, updated_at, updated_by
                 FROM api_credentials`;
const REFRESH_INTERVAL_MS = 5 * 60_000;

type CredentialRecord = { value: string; note: string | null; updated_at: string; updated_by: string | null };
type CredentialRow = CredentialRecord & { name: string };

let cache: { map: Map<string, CredentialRecord>; luc: number } | null = null;
let errorAt = 0;
let refreshing = false;
let warnedMissingKey = false;

const toMap = (rows: CredentialRow[]) => new Map(rows.map(({ name, ...r }) => [name, r]));

/** Nạp lại bảng khoá (không chặn). */
async function refreshCache(): Promise<void> {
    const encryptionKey = getEncryptionKey();
    if (!encryptionKey || !process.env.DATABASE_URL) return;
    const rows = await query<CredentialRow>(READ_SQL.replace("$1", "@chia"), { chia: encryptionKey });
    cache = { map: toMap(rows), luc: Date.now() };
}

/** Khoá trong kho. Lượt đầu đọc đồng bộ (docKhoa không await được); sau đó làm mới nền mỗi 5 phút. */
function storedCredentials(): Map<string, CredentialRecord> {
    if (cache) {
        if (Date.now() - cache.luc > REFRESH_INTERVAL_MS && !refreshing) {
            refreshing = true;
            refreshCache().catch((e) => console.error("khoa: làm mới bảng api_credentials lỗi:", e))
                .finally(() => { refreshing = false; });
        }
        return cache.map;
    }
    const encryptionKey = getEncryptionKey();
    if (!process.env.DATABASE_URL || !encryptionKey) {
        if (!warnedMissingKey && process.env.DATABASE_URL) {
            console.error(`khoa: chưa đặt ${ENCRYPTION_KEY_VAR} — không giải mã được khoá trong kho, dùng khoá trong .env.local`);
            warnedMissingKey = true;
        }
        return new Map();
    }
    if (Date.now() - errorAt < 30_000) return new Map();   // kho vừa lỗi — đừng chặn mỗi lượt gọi
    try {
        cache = { map: toMap(querySync<CredentialRow>(READ_SQL, [encryptionKey])), luc: Date.now() };
        return cache.map;
    } catch (e) {
        errorAt = Date.now();
        console.error("khoa: KHÔNG đọc được bảng api_credentials — dùng khoá trong .env.local:", e);
        return new Map();
    }
}

/** Khoá đang dùng: nhập trên trang (kho) trước, rồi biến môi trường (.env.local). */
export function getCredential(credentialName: string): string {
    return (storedCredentials().get(credentialName)?.value ?? process.env[credentialName] ?? "").trim();
}

/** Toàn bộ môi trường đã phủ khoá nhập trên trang — cho hàm nhận cả bảng (17TRACK nhiều khoá). */
export function envWithCredentials(): Record<string, string | undefined> {
    const stored = Object.fromEntries([...storedCredentials()].map(([k, v]) => [k, v.value]));
    return { ...process.env, ...stored };
}

// ─── Danh sách khoá ─────────────────────────────────────────────────

export type CredentialKind = "meta" | "pos" | "pancake" | "track17" | "gemini";
export type CredentialDef = {
    ten: string;
    nhan: string;
    dung_cho: string;
    loai: CredentialKind;
    shop?: { name: string; shop_id: string; api_url: string };
};

type RawYaml = {
    meta_ads?: { access_token?: string; ad_account_ids?: string[] };
};

/** talpha.yaml CHƯA thay ${…} — để biết token Meta nằm ở biến nào, và danh sách TKQC. */
function readRawYaml(): RawYaml {
    return (yaml.load(fs.readFileSync(TALPHA_YAML(), "utf8")) as RawYaml) || {};
}

const envVarName = (v: unknown) => /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(String(v ?? "").trim())?.[1] || null;

/** Khoá nào cần nhập. Shop POS lấy từ markets (SHOP_POS) — thêm nước ở config hoặc /admin →
 *  Thị trường là có thêm ô ở đây. Nước đã tắt không gọi POS nữa nên không có ô (khoá cũ vẫn
 *  nằm trong file, bật lại là dùng). */
export function listCredentials(): CredentialDef[] {
    const cfg = readRawYaml();
    const markets = RULES.markets as Record<string, { display?: string }>;
    const isActive = (key?: string | null) => !!key && !DISABLED_MARKETS.has(key);
    const meta = envVarName(cfg.meta_ads?.access_token) || META_TOKEN_VARS[0];
    const out: CredentialDef[] = [{
        ten: meta,
        nhan: "Token Meta Ads",
        dung_cho: "Chi tiêu quảng cáo mỗi giờ, Ads Command Center — sync kéo MỌI TKQC token thấy",
        loai: "meta",
    }];
    // Token phụ (tuỳ chọn): TKQC nằm ở BM / app khác mà token chính không thấy. Mỗi TK đọc bằng token
    // ĐẦU TIÊN thấy nó (lib/talpha/ad-accounts.ts, sync/core/ad_accounts.py).
    META_TOKEN_VARS.slice(1).forEach((credentialName, i) => out.push({
        ten: credentialName,
        nhan: `Token Meta ${i + 2} — BM / app khác (tuỳ chọn)`,
        dung_cho: "Chỉ cần khi có TKQC mà token chính không thấy, vd TK của Business Manager cũ",
        loai: "meta",
    }));
    for (const s of SHOP_POS) {
        if (!isActive(s.name)) continue;
        out.push({
            ten: s.bien_key,
            nhan: `Key POS ${markets[s.name]?.display || s.name}`,
            dung_cho: "Đơn mỗi giờ, tab Kho, đơn hôm nay ở Ads Command Center",
            loai: "pos",
            shop: { name: s.name, shop_id: s.shop_id, api_url: s.api_url },
        });
    }
    // Nước nào dùng Pancake / 17TRACK đọc từ talpha_rules.json (markets.*.mess_source, tracking.markets).
    const pancakeMarkets = MESS_PANCAKE.filter(isActive).map((k) => markets[k]?.display || k).join(", ");
    const nuoc17 = TRACK_MARKETS.filter((m) => m.provider === "17track" && isActive(SHOP2MKT[m.code]))
        .map((m) => m.label).join(", ");
    out.push({
        ten: "TALPHA_PANCAKE_API_TOKEN",
        nhan: "Token Pancake",
        dung_cho: pancakeMarkets ? `Tin nhắn ${pancakeMarkets} (Meta không báo)` : "Chưa nước nào đếm tin nhắn qua Pancake",
        loai: "pancake",
    });
    out.push({
        ten: "TRACK17_API_KEY",
        nhan: "Key 17TRACK",
        dung_cho: nuoc17 ? `Theo dõi vận đơn ${nuoc17}` : "Chưa nước nào theo dõi vận đơn qua 17TRACK",
        loai: "track17",
    });
    // Khoá Gemini (15/11/2026) — trước đọc thẳng GEMINI_API_KEY trong .env.local, không nhập trên trang được.
    out.push({
        ten: "GEMINI_API_KEY",
        nhan: "Khoá Gemini (AI)",
        dung_cho: "Ô “Hỏi dashboard” ở Báo cáo → Tổng quan (chỉ giám đốc thấy). Lấy miễn phí ở aistudio.google.com/apikey",
        loai: "gemini",
    });
    return out;
}

// ─── Trạng thái + lưu ───────────────────────────────────────────────

export type CredentialStatus = Omit<CredentialDef, "shop"> & {
    shop_id: string | null;
    nguon: "trang" | "env" | "thieu";
    che: string;
    do_dai: number;
    cap_nhat: string | null;
    /** Khoá trên trang đang che một khoá KHÁC trong .env.local. */
    env_khac: boolean;
};

/** Khoá nào đang dùng, lấy từ đâu — giá trị đã che, không bao giờ trả khoá thật. */
export function getCredentialsStatus(): CredentialStatus[] {
    const stored = storedCredentials();
    return listCredentials().map(({ shop, ...d }) => {
        const pageValue = stored.get(d.ten)?.value || "";
        const env = (process.env[d.ten] || "").trim();
        const v = pageValue || env;
        return {
            ...d,
            shop_id: shop?.shop_id || null,
            nguon: pageValue ? "trang" : env ? "env" : "thieu",
            che: maskCredential(v),
            do_dai: v.length,
            cap_nhat: pageValue ? stored.get(d.ten)?.note || null : null,
            env_khac: !!pageValue && !!env && env !== pageValue,
        };
    });
}

/** Đặt hoặc bỏ (`null`) một khoá trên trang (bảng api_credentials, mã hoá), rồi nạp lại bản nhớ. */
export async function saveCredential(credentialName: string, value: string | null, note: string, ai = ""): Promise<void> {
    if (value === null) {
        await query("DELETE FROM api_credentials WHERE name = @ten", { ten: credentialName });
    } else {
        const encryptionKey = getEncryptionKey();
        if (!encryptionKey) throw new Error(`Chưa đặt ${ENCRYPTION_KEY_VAR} trên máy chủ — không mã hoá được khoá để lưu`);
        await query(
            `INSERT INTO api_credentials (name, encrypted_value, note, updated_at, updated_by)
             VALUES (@ten, public.pgp_sym_encrypt(@giaTri, @chia), @ghiChu, now(), @ai)
             ON CONFLICT (name) DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value, note = EXCLUDED.note,
               updated_at = now(), updated_by = EXCLUDED.updated_by`,
            { ten: credentialName, giaTri: value, chia: encryptionKey, ghiChu: note || null, ai: ai || null });
    }
    await refreshCache();
}

// ─── Gọi thử khoá ──────────────────────────────────────────────────

export type VerifyResult = { ok: boolean; chi_tiet: string; canh_bao?: string; het_han?: string | null };

const TIMEOUT_MS = 20_000;
const GRAPH = "https://graph.facebook.com/v21.0";

async function graph(duong: string, tok: string, q: Record<string, string> = {}) {
    const r = await fetch(`${GRAPH}/${duong}?${new URLSearchParams({ ...q, access_token: tok })}`,
        { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(`Meta từ chối: ${j.error?.message || `HTTP ${r.status}`}`);
    return j;
}

/** Token sống, đọc được bao nhiêu TKQC. Sync kéo MỌI TKQC token thấy (04/11/2026, lib/talpha/ad-accounts.ts), nên
 *  token đọc được ít nhất một TK là lưu được; TKQC vào báo cáo đang chạy mà token mới không thấy thì cảnh báo
 *  — lưu token đó là mất chi tiêu của các TK ấy. */
async function verifyMeta(tok: string, envVar: string): Promise<VerifyResult> {
    const me = await graph("me", tok, { fields: "id,name" });
    const adAccounts = await graph("me/adaccounts", tok, { fields: "account_id", limit: "500" });
    const readableIds = new Set((adAccounts.data || []).map((a: { account_id: string }) => String(a.account_id)));
    // Import muộn: ad-accounts.ts đọc khoá qua file này — import thẳng là vòng lặp module.
    let reportingAccounts: { id: string; name: string; token_env_var: string | null }[] = [];
    try {
        reportingAccounts = await (await import("@/lib/talpha/ad-accounts")).reportingAdAccounts(false);
    } catch { /* chưa có kho số / danh bạ — chỉ báo số TK đọc được */ }
    // Chỉ so các TK mà CHÍNH biến này đang đọc — token phụ không thấy TK của token chính là đương nhiên.
    const missing = reportingAccounts.filter((t) => (t.token_env_var || META_TOKEN_VARS[0]) === envVar && !readableIds.has(t.id));
    let expiry: string | null = null;
    try {
        const exp = (await graph("debug_token", tok, { input_token: tok }))?.data?.expires_at;
        if (exp) expiry = new Date(exp * 1000).toISOString();
    } catch { /* không đọc được hạn thì thôi, token vẫn sống */ }
    return {
        ok: readableIds.size > 0,
        chi_tiet: `${me.name || "Token"} đọc được ${readableIds.size} TKQC — sync kéo tất cả`,
        canh_bao: missing.length ? `TKQC đang vào báo cáo mà token này KHÔNG thấy: ${missing.map((t) => t.name || t.id).join(", ")}` : undefined,
        het_han: expiry,
    };
}

async function verifyPos(d: CredentialDef, key: string): Promise<VerifyResult> {
    const s = d.shop!;
    const r = await fetch(`${s.api_url}/shops/${s.shop_id}/orders?${new URLSearchParams({ api_key: key, page_size: "1" })}`,
        { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.success === false) throw new Error(`POS từ chối: ${j?.message || `HTTP ${r.status}`}`);
    return { ok: true, chi_tiet: `Shop ${s.shop_id} gọi được, ${Number(j.total_entries ?? 0).toLocaleString("vi-VN")} đơn` };
}

async function verifyPancake(tok: string): Promise<VerifyResult> {
    const expiry = tokenExpiry(tok);
    const expiryIso = expiry ? new Date(expiry).toISOString() : null;
    if (expiry && expiry < Date.now()) return { ok: false, chi_tiet: "Token đã hết hạn", het_han: expiryIso };
    const r = await fetch(`${PANCAKE_API}/pages?access_token=${encodeURIComponent(tok)}`,
        { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.success === false) throw new Error(`Pancake từ chối: ${j?.message || `HTTP ${r.status}`}`);
    const c = j.categorized || {};
    const n = (c.activated?.length || 0) + (c.inactivated?.length || 0);
    return { ok: true, chi_tiet: `Đọc được ${n} page`, het_han: expiryIso };
}

/** Liệt kê model — miễn phí, không tốn lượt hỏi. Khoá đi ở header, không nằm trên địa chỉ (log). */
async function verifyGemini(key: string): Promise<VerifyResult> {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=100",
        { headers: { "x-goog-api-key": key }, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`Google từ chối: ${j?.error?.message || `HTTP ${r.status}`}`);
    const n = ((j?.models || []) as { supportedGenerationMethods?: string[] }[])
        .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent")).length;
    return { ok: true, chi_tiet: `Gọi được Gemini — ${n} model trả lời được` };
}

/** Hỏi quota — miễn phí, không trừ lượt đăng ký nào. */
async function verifyTrack17(key: string): Promise<VerifyResult> {
    const q = await getQuota({ id: keyId(key), label: "khoá này", key });
    return { ok: true, chi_tiet: `Còn ${q.remain.toLocaleString("vi-VN")}/${q.total.toLocaleString("vi-VN")} lượt đăng ký mã` };
}

/** Gọi thử một khoá với dịch vụ thật. Không ghi gì, không tốn quota. */
export async function verifyCredential(d: CredentialDef, value: string): Promise<VerifyResult> {
    if (!value) return { ok: false, chi_tiet: "Chưa có khoá" };
    try {
        if (d.loai === "meta") return await verifyMeta(value, d.ten);
        if (d.loai === "pos") return await verifyPos(d, value);
        if (d.loai === "pancake") return await verifyPancake(value);
        if (d.loai === "gemini") return await verifyGemini(value);
        return await verifyTrack17(value);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, chi_tiet: /timeout|aborted/i.test(msg) ? "Dịch vụ không trả lời sau 20 giây" : msg };
    }
}
