/**
 * Loại TKQC — luật thuần (04/11/2026), cùng luật với sync/core/tkqc.py → loai_lan_dau. Khai ở
 * talpha_rules.json → tkqc_loai. Chỉ loại vao_bao_cao mới vào báo cáo (view fb_ads_data).
 */
import { RULES } from "./rules";

export type LoaiDef = { ten: string; vao_bao_cao: boolean };
export type TkqcCfg = {
    mac_dinh?: string;
    loai_tien_khac?: string;
    loai?: Record<string, LoaiDef | string>;
    gan_san?: Record<string, string>;
};

/** Nhiều token Meta (TKQC ở nhiều BM / app). Thứ tự = ưu tiên: TK đọc bằng token ĐẦU TIÊN thấy nó.
 *  Cùng danh sách với sync/core/tkqc.py → BIEN_TOKEN. */
export const BIEN_TOKEN_META = ["TALPHA_META_ACCESS_TOKEN", "TALPHA_META_ACCESS_TOKEN_2", "TALPHA_META_ACCESS_TOKEN_3"];

export const TKQC_CFG: TkqcCfg = (RULES as unknown as { tkqc_loai?: TkqcCfg }).tkqc_loai || {};

/** [{ma, ten, vao_bao_cao}] theo thứ tự khai. */
export function cacLoai(cfg: TkqcCfg = TKQC_CFG): { ma: string; ten: string; vao_bao_cao: boolean }[] {
    return Object.entries(cfg.loai || {})
        .filter(([k, v]) => !k.startsWith("_") && v && typeof v === "object")
        .map(([ma, v]) => ({ ma, ten: (v as LoaiDef).ten || ma, vao_bao_cao: !!(v as LoaiDef).vao_bao_cao }));
}

/** Loại của TKQC thấy LẦN ĐẦU: gán sẵn → theo tiền tệ (VND → mặc định, tiền khác → loai_tien_khac:
 *  engine coi chi tiêu là VND, TK USD vào báo cáo là sai cả chục nghìn lần). */
export function loaiLanDau(accountId: string, tienTe: string | null | undefined, cfg: TkqcCfg = TKQC_CFG): string {
    const id = String(accountId).replace(/^act_/, "");
    const gan = Object.fromEntries(Object.entries(cfg.gan_san || {}).filter(([k]) => !k.startsWith("_")));
    if (gan[id]) return gan[id];
    if ((tienTe || "VND").toUpperCase() !== "VND") return cfg.loai_tien_khac || "khac";
    return cfg.mac_dinh || "antalo";
}
