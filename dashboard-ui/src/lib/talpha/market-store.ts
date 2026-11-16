// ═══════════════════════════════════════════════════════════════════
// Thị trường nhập ở /admin → Thị trường (04/11/2026) — phần ĐỤNG KHO: đọc mới nhất, ghi phần phủ.
// Phần thuần (phủ, soát, tính khối ghi) ở lib/talpha/market-config.ts.
//
// Phần phủ nằm ở bảng market_overrides (15/11/2026 — trước đó file data/thi_truong.json), mỗi nước
// một dòng. RULES trong rules.ts đọc MỘT lần lúc khởi động, và hàng chục hằng số khắp dashboard sinh
// từ nó. Nên lưu xong thì dashboard tự khởi động lại (pm2 / docker dựng lại tiến trình) thay vì vá
// từng hằng số; trang này luôn đọc thẳng từ kho để thấy ngay cái vừa lưu.
// ═══════════════════════════════════════════════════════════════════
import fs from "fs";
import { query } from "@/lib/db";
import { RULES_JSON } from "./config-path";
import { STARTUP_OVERRIDES } from "./rules";
import { applyMarketOverrides, type OverridesFile, type MarketOverride } from "./market-config";

export function readBaseRules(): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(RULES_JSON(), "utf-8"));
}

type OverrideRow = { market_key: string; settings: MarketOverride; updated_at: string; updated_by: string | null };

/** Phần phủ trong kho, cùng dạng file phủ cũ. updated_at / updated_by = lần sửa gần nhất. */
export async function readOverrides(): Promise<OverridesFile> {
    const rows = await query<OverrideRow>(
        "SELECT market_key, settings, updated_at, updated_by FROM market_overrides ORDER BY market_key");
    const latest = rows.reduce<OverrideRow | null>((m, r) => (!m || r.updated_at > m.updated_at ? r : m), null);
    return {
        markets: Object.fromEntries(rows.map((r) => [r.market_key, r.settings])),
        updated_at: latest?.updated_at,
        updated_by: latest?.updated_by ?? undefined,
    };
}

/** Luật mới nhất (gốc + phần phủ trong kho) — có thể mới hơn RULES đang chạy. */
export async function latestRules(): Promise<Record<string, unknown>> {
    return applyMarketOverrides(readBaseRules(), await readOverrides());
}

/** JSON với khoá xếp theo thứ tự — so hai bản phủ không phụ thuộc thứ tự khoá. */
function stableStringify(v: unknown): string {
    if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
    if (v && typeof v === "object") {
        return `{${Object.keys(v as object).sort()
            .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(",")}}`;
    }
    return JSON.stringify(v ?? null);
}

/** Dấu vân tay của phần phủ — bot so dấu này để biết phải khởi động lại. */
export function overridesFingerprint(overrides: OverridesFile | null): string {
    return stableStringify((overrides && overrides.markets) || {});
}

/** Phần phủ trong kho khác phần đã nạp lúc khởi động: dashboard đang chạy bằng luật cũ. */
export async function needsRestart(): Promise<boolean> {
    try {
        return overridesFingerprint(await readOverrides()) !== overridesFingerprint(STARTUP_OVERRIDES);
    } catch {
        return false;
    }
}

/** Đặt (`khoi`) hoặc bỏ (`null`) phần sửa của một nước. */
export async function saveMarketOverride(key: string, block: MarketOverride | null, ai: string): Promise<void> {
    if (block === null || !Object.keys(block).length) {
        await query("DELETE FROM market_overrides WHERE market_key = @key", { key });
        return;
    }
    await query(
        `INSERT INTO market_overrides (market_key, settings, updated_at, updated_by)
         VALUES (@key, @settings::jsonb, now(), @ai)
         ON CONFLICT (market_key) DO UPDATE
           SET settings = EXCLUDED.settings, updated_at = now(), updated_by = EXCLUDED.updated_by`,
        { key, settings: JSON.stringify(block), ai });
}

/**
 * Khởi động lại để nạp luật mới. Dưới pm2 (máy chủ): thoát sau khi trả lời, pm2 dựng lại tiến
 * trình trong vài giây. Chạy `npm run dev` ở máy: không tự thoát được — người chạy khởi động lại.
 */
export function scheduleRestart(): "tu_dong" | "tay" {
    // pm2 (máy chủ) hoặc docker compose (TALPHA_AUTO_RESTART=1, restart: unless-stopped; tên cũ TALPHA_TU_KHOI_DONG vẫn nhận) tự bật lại.
    const autoRestart = (process.env.TALPHA_AUTO_RESTART || process.env.TALPHA_TU_KHOI_DONG) === "1";
    if (process.env.pm_id === undefined && !autoRestart) return "tay";
    setTimeout(() => {
        console.log("Thị trường nhập trên trang đã đổi — thoát để pm2 / docker dựng lại với luật mới.");
        process.exit(0);
    }, 1500);
    return "tu_dong";
}
