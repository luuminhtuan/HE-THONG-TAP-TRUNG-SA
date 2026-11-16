// ═══════════════════════════════════════════════════════════════════
// Kho chưa lên lúc dashboard khởi động (16/11/2026) — thử lại nền, đọc được thì tự khởi động lại nếu cần.
//
// RULES (rules.ts) tính MỘT lần lúc nạp module từ luật gốc + bảng market_overrides. Máy chủ khởi động lại mà
// pm2 bật dashboard trước Postgres thì lượt đọc đầu lỗi → dashboard chạy bằng luật gốc (thiếu nước nhập trên
// trang, tỷ giá sửa trên trang) tới tận lần khởi động sau. Ở đây: cứ 30 giây đọc lại; đọc được mà phần phủ
// khác cái đang chạy → khởi động lại (như sau khi lưu ở /admin → Thị trường; bot tự lành cùng kiểu); giống
// nhau (chưa ai nhập gì) → luật đang chạy vốn đúng, thôi.
//
// instrumentation.ts nạp file này SAU primeStartupData(): file kéo theo rules.ts.
// ═══════════════════════════════════════════════════════════════════
import { overridesFingerprint, readOverrides, scheduleRestart } from "./market-store";
import { STARTUP_OVERRIDES } from "./rules";

const RETRY_INTERVAL_MS = 30_000;

export function watchMarketOverridesRecovery(intervalMs: number = RETRY_INTERVAL_MS): void {
    let busy = false;
    const timer = setInterval(async () => {
        if (busy) return;            // kho treo: lượt trước chưa xong thì không chồng thêm lượt
        busy = true;
        try {
            const current = await readOverrides();
            clearInterval(timer);
            if (overridesFingerprint(current) === overridesFingerprint(STARTUP_OVERRIDES)) {
                console.log("startup: kho đã trả lời — không có thị trường nhập trên trang khác luật đang chạy");
                return;
            }
            const how = scheduleRestart();
            console.error(how === "tu_dong"
                ? "startup: kho đã trả lời, thị trường nhập trên trang khác luật đang chạy — khởi động lại để nạp"
                : "startup: kho đã trả lời, thị trường nhập trên trang khác luật đang chạy — CẦN KHỞI ĐỘNG LẠI dashboard");
        } catch {
            // Kho vẫn chưa lên — lượt sau thử tiếp.
        } finally {
            busy = false;
        }
    }, intervalMs);
    timer.unref?.();
}
