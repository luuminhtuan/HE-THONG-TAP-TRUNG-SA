// Tab của RIÊNG người dùng, không có số của nước nào — ai đăng nhập cũng thấy, kể cả người chưa được giao team / vai lạ.
// Chấm công (20/11/2026): tự chấm vào / ra và xem lịch của chính mình. Không khai ở access.roles.
// File không import gì: access-rules.ts (máy chủ) và dashboard-shell.tsx (trình duyệt) cùng đọc — access-rules kéo theo
// rules.ts (đọc file bằng fs) nên trình duyệt không import nó được.
export const PERSONAL_TABS: readonly string[] = ["attendance"];
