# Hướng dẫn cho AI làm việc trên thư mục này

Đọc `README.md` trước.

## Engine KHÔNG nằm ở đây

Nghiệp vụ đối soát nằm trong repo dashboard (TypeScript):
`../dashboard-ui/src/lib/talpha/ads-recon/`

Đặt ở đó vì màn **Thanh toán quảng cáo** trong dashboard là chỗ Sỹ Anh dùng
hằng tuần, mà lệnh deploy chỉ đẩy repo lên VPS — engine nằm ngoài repo đó thì
lên server là mất. Bản dòng lệnh nạp thẳng các file `.ts` đó (Node ≥ 22.18 tự bỏ
kiểu lúc chạy) — nên engine chỉ dùng cú pháp TypeScript "xoá được" (không enum,
không namespace), import kiểu viết `import type`, import giữa các file ghi đuôi `.ts`.

Thư mục này giữ: bản dòng lệnh, kho kỳ trên đĩa, file mẫu, test.
**Sửa nghiệp vụ thì sửa bên engine**, đừng chép một bản thứ hai về đây.

## Nguyên tắc cứng

1. **Lõi không dùng thư viện ngoài.** Đọc .xlsx/.csv, ghép cặp, sinh cảnh báo —
   tất cả bằng Node stdlib, kể cả bộ đọc .xlsx tự viết. Chạy được cả trong Next
   lẫn ở terminal mà không cần cài gì.

   **Ngoại lệ DUY NHẤT: `pdf.ts` cần `pdfjs-dist`** (Sỹ Anh yêu cầu đọc sao kê
   PDF ngày 10/09/2026). Tự viết bộ đọc PDF thì phải tự xử lý CID font và
   ToUnicode CMap — làm sai là tiếng Việt ra rác, mà rác thì không nhìn ra ngay.
   Gói này **nạp trễ** bằng `await import()`, chỉ khi gặp file PDF, và nằm ở
   `dashboard-ui/node_modules` nên bản dòng lệnh cũng dùng chung được.
   Thêm gói thứ hai thì phải hỏi trước.
2. **Ngưỡng và danh sách nằm ở `../config/talpha_rules.json`
   → `ads_settlement`.** Đổi định dạng file đầu vào thì thêm bí danh cột vào
   `columns`, đừng sửa hàm đọc.
3. **Không ghép bừa.** Không chắc thì để dòng đó chưa khớp và báo ra, còn hơn
   ghép cho đẹp bảng rồi giấu mất một lần trừ trùng. Cặp máy đoán phải gắn
   `ambiguous`.
4. **Mọi cảnh báo phải có `hint`** — nói rõ phải làm gì tiếp. Có test ép điều này.
5. **Không commit dữ liệu thật.** `data/inbox/`, `data/periods/` đã trong `.gitignore`;
   phía dashboard thì `data/` cả thư mục đã bị git bỏ qua.

## Kiểm tra sau khi sửa

```bash
npm test                                        # 52 phép thử ở đây
cd ../dashboard-ui && npm test  # thêm 29 phép thử phía dashboard (tests/ads-recon.test.cjs)
```

Hai bộ test chạy trên **cùng một engine**. Sửa engine mà chỉ chạy một bên là
bỏ sót. Đụng tới cách đọc file hoặc cách ghép thì chạy lại file mẫu và đối
chiếu đáp án trong README (35.400.000₫ · 3 nghiêm trọng · 4 cần xem).

Đổi giao diện màn dashboard thì phải build lại mới thấy:
```bash
cd ../dashboard-ui && npm run build && npx pm2 restart talpha-dashboard
```
