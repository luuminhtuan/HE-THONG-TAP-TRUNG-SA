/**
 * Loại TKQC — luật thuần (04/11/2026), cùng luật với sync/core/ad_accounts.py → initial_account_type. Khai ở
 * talpha_rules.json → ad_account_categories. Chỉ loại include_in_report mới vào báo cáo (view fb_ads_data).
 */
import { RULES } from "./rules";

export type AccountKindDef = { name: string; include_in_report: boolean };
export type AdAccountConfig = {
    default?: string;
    non_vnd?: string;
    categories?: Record<string, AccountKindDef | string>;
    preassigned?: Record<string, string>;
};
export type AccountKind = { code: string; name: string; include_in_report: boolean };

/** Nhiều token Meta (TKQC ở nhiều BM / app). Thứ tự = ưu tiên: TK đọc bằng token ĐẦU TIÊN thấy nó.
 *  Cùng danh sách với sync/core/ad_accounts.py → TOKEN_VARS. */
export const META_TOKEN_VARS = ["TALPHA_META_ACCESS_TOKEN", "TALPHA_META_ACCESS_TOKEN_2", "TALPHA_META_ACCESS_TOKEN_3"];

export const AD_ACCOUNT_CFG: AdAccountConfig = (RULES as unknown as { ad_account_categories?: AdAccountConfig }).ad_account_categories || {};

/** [{code, name, include_in_report}] theo thứ tự khai. */
export function listAccountKinds(cfg: AdAccountConfig = AD_ACCOUNT_CFG): AccountKind[] {
    return Object.entries(cfg.categories || {})
        .filter(([k, v]) => !k.startsWith("_") && v && typeof v === "object")
        .map(([code, v]) => ({ code, name: (v as AccountKindDef).name || code, include_in_report: !!(v as AccountKindDef).include_in_report }));
}

/** Loại của TKQC thấy LẦN ĐẦU: gán sẵn → theo tiền tệ (VND → mặc định, tiền khác → non_vnd:
 *  engine coi chi tiêu là VND, TK USD vào báo cáo là sai cả chục nghìn lần). */
export function initialAccountKind(accountId: string, currency: string | null | undefined, cfg: AdAccountConfig = AD_ACCOUNT_CFG): string {
    const id = String(accountId).replace(/^act_/, "");
    const preassigned = Object.fromEntries(Object.entries(cfg.preassigned || {}).filter(([k]) => !k.startsWith("_")));
    if (preassigned[id]) return preassigned[id];
    if ((currency || "VND").toUpperCase() !== "VND") return cfg.non_vnd || "other";
    return cfg.default || "antalo";
}
