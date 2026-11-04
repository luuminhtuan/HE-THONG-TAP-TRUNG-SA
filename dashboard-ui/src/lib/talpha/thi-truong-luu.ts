// ═══════════════════════════════════════════════════════════════════
// Thị trường nhập ở /admin → Thị trường (04/11/2026) — phần ĐỤNG ĐĨA: đọc mới nhất, ghi file phủ.
// Phần thuần (phủ, soát, tính khối ghi) ở lib/talpha/thi-truong.ts.
//
// RULES trong rules.ts đọc MỘT lần lúc khởi động, và hàng chục hằng số khắp dashboard sinh từ nó.
// Nên lưu xong thì dashboard tự khởi động lại (pm2 dựng lại tiến trình) thay vì vá từng hằng số;
// trang này luôn đọc thẳng từ đĩa để thấy ngay cái vừa lưu.
// ═══════════════════════════════════════════════════════════════════
import fs from "fs";
import path from "path";
import { RULES_JSON, THI_TRUONG_JSON } from "./config-path";
import { phuLuat, type FilePhu, type KhoiPhu } from "./thi-truong";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const lockfile = require("proper-lockfile");

/** Lúc tiến trình này khởi động — file phủ mới hơn mốc này = luật đang chạy đã cũ. */
const LUC_KHOI_DONG = Date.now();

export function docGoc(): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(RULES_JSON(), "utf-8"));
}

export function docFilePhu(): FilePhu {
    const p = THI_TRUONG_JSON();
    if (!fs.existsSync(p)) return { markets: {} };
    return JSON.parse(fs.readFileSync(p, "utf-8"));   // hỏng thì ném — trang báo lỗi, không ghi đè mất
}

/** Luật mới nhất trên đĩa (gốc + file phủ) — có thể mới hơn RULES đang chạy. */
export function luatMoiNhat(): Record<string, unknown> {
    return phuLuat(docGoc(), docFilePhu());
}

/** File phủ đã đổi sau khi tiến trình này khởi động: dashboard đang chạy bằng luật cũ. */
export function choKhoiDongLai(): boolean {
    try { return fs.statSync(THI_TRUONG_JSON()).mtimeMs > LUC_KHOI_DONG; } catch { return false; }
}

/** Đặt (`khoi`) hoặc bỏ (`null`) khối của một nước trong file phủ. Ghi dưới khoá file, đổi tên một phát. */
export async function luuKhoiPhu(key: string, khoi: KhoiPhu | null, ai: string): Promise<void> {
    const p = THI_TRUONG_JSON();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (!fs.existsSync(p)) fs.writeFileSync(p, JSON.stringify({ markets: {} }, null, 2) + "\n", { flag: "a" });
    const release = await lockfile.lock(p, { retries: { retries: 5, minTimeout: 100, maxTimeout: 1000 }, stale: 10000 });
    try {
        const raw = fs.readFileSync(p, "utf-8").trim();
        const phu: FilePhu = raw ? JSON.parse(raw) : { markets: {} };
        const markets = { ...(phu.markets || {}) };
        if (khoi === null || !Object.keys(khoi).length) delete markets[key];
        else markets[key] = khoi;
        const moi: FilePhu = {
            ...phu,
            markets,
            updated_at: new Date().toISOString(),
            updated_by: ai,
        };
        // Ghi ra file tạm rồi đổi tên: sync, bot đọc lúc nào cũng gặp file trọn vẹn.
        const tam = `${p}.${process.pid}.tmp`;
        fs.writeFileSync(tam, JSON.stringify(moi, null, 2) + "\n");
        fs.renameSync(tam, p);
    } finally {
        await release();
    }
}

/**
 * Khởi động lại để nạp luật mới. Dưới pm2 (máy chủ): thoát sau khi trả lời, pm2 dựng lại tiến
 * trình trong vài giây. Chạy `npm run dev` ở máy: không tự thoát được — người chạy khởi động lại.
 */
export function khoiDongLai(): "tu_dong" | "tay" {
    if (process.env.pm_id === undefined) return "tay";
    setTimeout(() => {
        console.log("Thị trường nhập trên trang đã đổi — thoát để pm2 dựng lại với luật mới.");
        process.exit(0);
    }, 1500);
    return "tu_dong";
}
