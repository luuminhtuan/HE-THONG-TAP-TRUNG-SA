/**
 * CẦU NỐI TỚI ENGINE DÙNG CHUNG.
 *
 * Engine thật nằm trong repo dashboard:
 *     dashboard-ui/src/lib/talpha/ads-recon/   (TypeScript)
 *
 * Vì sao đặt ở đó chứ không phải ở đây: màn "Thanh toán quảng cáo" trong
 * dashboard là chỗ Sỹ Anh dùng hằng tuần, mà lệnh deploy chỉ đẩy repo
 * lên VPS — engine nằm ngoài repo đó thì lên server là mất.
 *
 * Node ≥ 22.18 nạp thẳng file .ts (tự bỏ kiểu lúc chạy) nên ở đây không cần bước dựng.
 *
 * Thư mục này giữ phần còn lại: bản dòng lệnh, kho kỳ trên đĩa, file mẫu, test.
 * Một engine, hai lối vào — không bao giờ có chuyện hai nơi ra hai kết quả.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ENGINE_DIR = resolve(HERE, "..", "..", "dashboard-ui", "src", "lib", "talpha", "ads-recon");
export const REPO_ROOT = resolve(HERE, "..", "..");

if (!existsSync(ENGINE_DIR)) {
    throw new Error(
        `Không tìm thấy engine ở ${ENGINE_DIR}.\n` +
        `Thư mục này phải nằm NGAY TRONG repo (<repo>/ads-reconciliation-cli). Đã đổi chỗ thì sửa lại đường dẫn trong src/engine.mjs.`);
}

export * from "../../dashboard-ui/src/lib/talpha/ads-recon/recon.ts";
export * from "../../dashboard-ui/src/lib/talpha/ads-recon/normalize.ts";
export * from "../../dashboard-ui/src/lib/talpha/ads-recon/match.ts";
export * from "../../dashboard-ui/src/lib/talpha/ads-recon/rules.ts";
export * from "../../dashboard-ui/src/lib/talpha/ads-recon/ingest.ts";
export { parseDelimited, readAnySheets } from "../../dashboard-ui/src/lib/talpha/ads-recon/xlsx.ts";
