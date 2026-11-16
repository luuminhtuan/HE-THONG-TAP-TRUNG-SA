/**
 * Loại TKQC — luật thuần (04/11/2026), cùng luật với sync/core/ad_accounts.py → initial_account_type. Khai ở
 * talpha_rules.json → tkqc_loai. Chỉ loại vao_bao_cao mới vào báo cáo (view fb_ads_data).
 */
import { RULES } from "./rules";

export type AccountKindDef = { ten: string; vao_bao_cao: boolean };
export type AdAccountConfig = {
    mac_dinh?: string;
    loai_tien_khac?: string;
    loai?: Record<string, AccountKindDef | string>;
    gan_san?: Record<string, string>;
};

/** Nhiều token Meta (TKQC ở nhiều BM / app). Thứ tự = ưu tiên: TK đọc bằng token ĐẦU TIÊN thấy nó.
 *  Cùng danh sách với sync/core/ad_accounts.py → BIEN_TOKEN. */
export const META_TOKEN_VARS = ["TALPHA_META_ACCESS_TOKEN", "TALPHA_META_ACCESS_TOKEN_2", "TALPHA_META_ACCESS_TOKEN_3"];

export const AD_ACCOUNT_CFG: AdAccountConfig = (RULES as unknown as { tkqc_loai?: AdAccountConfig }).tkqc_loai || {};

/** [{ma, ten, vao_bao_cao}] theo thứ tự khai. */
export function listAccountKinds(cfg: AdAccountConfig = AD_ACCOUNT_CFG): { ma: string; ten: string; vao_bao_cao: boolean }[] {
    return Object.entries(cfg.loai || {})
        .filter(([k, v]) => !k.startsWith("_") && v && typeof v === "object")
        .map(([code, v]) => ({ ma: code, ten: (v as AccountKindDef).ten || code, vao_bao_cao: !!(v as AccountKindDef).vao_bao_cao }));
}

/** Loại của TKQC thấy LẦN ĐẦU: gán sẵn → theo tiền tệ (VND → mặc định, tiền khác → loai_tien_khac:
 *  engine coi chi tiêu là VND, TK USD vào báo cáo là sai cả chục nghìn lần). */
export function initialAccountKind(accountId: string, currency: string | null | undefined, cfg: AdAccountConfig = AD_ACCOUNT_CFG): string {
    const id = String(accountId).replace(/^act_/, "");
    const preassigned = Object.fromEntries(Object.entries(cfg.gan_san || {}).filter(([k]) => !k.startsWith("_")));
    if (preassigned[id]) return preassigned[id];
    if ((currency || "VND").toUpperCase() !== "VND") return cfg.loai_tien_khac || "khac";
    return cfg.mac_dinh || "antalo";
}
