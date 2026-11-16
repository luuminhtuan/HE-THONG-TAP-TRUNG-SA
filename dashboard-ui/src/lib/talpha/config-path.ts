// ═══════════════════════════════════════════════════════════════════
// TALPHA — MỘT chỗ duy nhất biết cấu hình nằm ở đâu.
// ───────────────────────────────────────────────────────────────────
// Cấu hình sống ở `config/` tại GỐC REPO. Chỉ một bản, không bản sao.
//
// Trước 11/09/2026 có bản sao thứ hai ở `dashboard-ui/config/`, sinh ra bởi
// `scripts/sync-config.mjs` lúc prebuild để Vercel đóng gói được. Ba file khác
// nhau tự dò hai ứng viên, mỗi file một kiểu. Bản sao đã LỆCH thật: nó còn giữ
// shop_id Đài Loan cũ `1328343252` trong khi bản chuẩn lúc đó là `408074608` (nay
// là `1022091930`) — key POS trả "Cửa hàng không tồn tại" với mã sai. Ai build không
// qua prebuild là chạy bằng cấu hình sai mà không có dấu hiệu gì.
//
// Nay deploy là VPS (git clone nguyên cây repo) nên `../config` luôn có mặt.
// Bản sao đã xoá; hàm này là chỗ duy nhất ghép đường dẫn.
// ═══════════════════════════════════════════════════════════════════
import fs from "fs";
import path from "path";

/** Gốc repo — cwd của Next.js là `dashboard-ui/`, lùi một cấp. */
export const REPO_ROOT = path.join(process.cwd(), "..");

/** Đường dẫn tới một file trong `config/` ở gốc repo. */
export function configPath(...doan: string[]): string {
    return path.join(REPO_ROOT, "config", ...doan);
}

/**
 * Như `configPath` nhưng NÉM lỗi nói rõ file nào thiếu, thay vì để đoạn code
 * gọi nó chết bằng một `ENOENT` không ai đọc ra.
 */
export function requiredConfigPath(...doan: string[]): string {
    const p = configPath(...doan);
    if (!fs.existsSync(p)) {
        throw new Error(
            `Không tìm thấy cấu hình ${path.join("config", ...doan)} (đã tìm ở ${p}). ` +
            `Dashboard phải chạy từ trong cây repo — cwd hiện tại: ${process.cwd()}`,
        );
    }
    return p;
}

/** `config/talpha_rules.json` — nguồn rule nghiệp vụ DUY NHẤT. */
export const RULES_JSON = () => requiredConfigPath("talpha_rules.json");

/**
 * Nước thêm / sửa / tắt ở /admin → Thị trường nằm ở bảng market_overrides (15/11/2026 — trước đó file
 * data/thi_truong.json). Test đặt TALPHA_THI_TRUONG trỏ vào một FILE phủ để không đọc kho của máy
 * đang chạy test; không đặt = đọc kho.
 */
export const MARKET_OVERRIDES_TEST_FILE = (): string | null => process.env.TALPHA_THI_TRUONG || null;

/** `config/projects/talpha.yaml` — danh sách TKQC Meta và shop POS. */
export const TALPHA_YAML = () => requiredConfigPath("projects", "talpha.yaml");
