---
paths:
  - "dashboard-ui/**/*.tsx"
  - "dashboard-ui/**/*.ts"
  - "dashboard-ui/**/*.css"
---
# Quy ước dashboard — Next.js TALPHA

## Nền

- Next.js 16 App Router + React 19 + TailwindCSS + TypeScript, tất cả trong `dashboard-ui/`.
  Không có backend riêng — API là route trong `src/app/api/`.
- Biểu đồ: `recharts`. Biểu tượng: `lucide-react`. Bảng: `@tanstack/react-table`.

## Cấu trúc

- Tab dashboard: `src/components/talpha/tabs/<ten>-tab.tsx` — client component (`"use client"`),
  gọi route `/api/talpha/...`. Khai tab ở `components/talpha/nav-config.ts` (slug URL). Tab lớn tách component
  con vào thư mục cùng tên `tabs/<ten>/` (như `tabs/cod-recon/`); file `<ten>-tab.tsx` vẫn là cửa vào.
- Route lớn: `route.ts` chỉ nhận / trả, phần dựng để ở `<route>/_lib/*.ts` (như `order-ledger/_lib/`).
- Logic nghiệp vụ (tiền, đối soát, vận đơn, sổ đơn) để ở `src/lib/talpha/` dạng **hàm thuần có test**,
  không nhét vào component hay route.
- Tối đa **500 dòng/file** `.ts` / `.tsx` (CI cảnh báo). Vượt thì tách component / module con.

## Luật cứng

- Luật nghiệp vụ đọc qua `lib/talpha/rules.ts` từ `config/talpha_rules.json` — không gõ tỷ giá,
  phí, tên marketer, ngưỡng vào code.
- Đường dẫn file cấu hình hỏi `lib/talpha/config-path.ts`, đừng ghép `process.cwd()`.
- Tiền POS chia `posMoneyDivisor()` — đừng gõ `/100` (Đài, Nhật lưu nguyên tiền nên chia 1).
- Chi phí quảng cáo đã là VND — không quy đổi.
- Khoá kết nối đọc qua `getCredential()` (`lib/talpha/credentials.ts`) — đừng đọc `process.env` thẳng cho khoá.
- Kho số đọc qua `lib/db.ts`: `query(sql, { ten })`, tham số `@ten`. SQL do trình duyệt / AI viết chạy
  bằng `queryReadOnly` (vai chỉ đọc `talpha_readonly` / `talpha_readonly_market`).
- `rules.ts` và `credentials.ts` đọc luật phủ thị trường + bảng khoá từ bộ nạp lúc khởi động
  (`instrumentation.ts` → `primeStartupData()`, `lib/talpha/startup-data.ts`). Đừng thêm `execFileSync` /
  truy vấn đồng bộ lúc nạp module — trước 16/11/2026 kiểu đó chặn cả event loop.
- Dữ liệu người dùng nhập (sao kê, việc đối soát, vận đơn, chi phí vận hành) đọc/ghi qua
  `lib/talpha/store.ts` (bảng `app_documents`).

## Phân quyền

- Cửa chặn chung: `src/proxy.ts`. **Thêm route API mới thì khai vào `API_RULES`**
  (`lib/talpha/access-rules.ts`) — không khai là chỉ giám đốc gọi được.
- Route gộp nhiều nước phải tự lọc theo `getAccess()`.
- Bot / việc nền gọi API bằng header `x-talpha-token`.

## Đặt tên

- Code mới: tên file, route, hàm, biến, type **tiếng Anh**. File và thư mục route `kebab-case`;
  component, type `PascalCase`; hàm, biến `camelCase`.
- Slug URL người dùng thấy (`/talpha/income-statement`…) không đổi — link đã gửi nhau sẽ gãy.
- Nhãn giao diện, thông báo lỗi cho người dùng, chú thích nghiệp vụ: **tiếng Việt**.

## Kiểm tra

```bash
cd dashboard-ui && npm test && npx tsc --noEmit
```

`npm test` dịch các module trong `src/lib/talpha/` bằng `tsc` rồi chạy `tests/*.test.cjs`. Module mới có
test thì thêm nó vào danh sách dịch trong script `test` của `package.json`.
