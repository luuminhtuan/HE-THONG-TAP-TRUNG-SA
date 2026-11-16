# Bot Zalo — logic gửi tin

Ghi chú 15/11/2026, đọc từ code `ops/zalo-alerts/` (nhánh `kho-postgres`). Cách cài, ghép nick,
lệnh chạy tay chi tiết: `ops/zalo-alerts/README.md`. File này trả lời: bot gửi **gì**, **khi nào**,
số lấy **từ đâu**, và xử lý thế nào khi số chưa đủ hay Zalo rớt phiên.

## 1. Tổng quan

Bot là một tiến trình Node (`ops/zalo-alerts/bot.js`) gửi tin ads + vận đơn vào nhóm Zalo của từng
nước và trả lời lệnh gõ trong nhóm. **Bot không tự tính số** — mọi con số đều hỏi API của dashboard.

Từ 16/11/2026 `bot.js` chỉ là điểm chạy: nạp luật phủ thị trường (`market_config.js → primeMarketOverrides()`,
hỏi dashboard bằng `fetch`) rồi gọi `bot_main.js`. Thân bot chia theo việc: `bot_config.js` (hằng, cờ dòng lệnh,
trạng thái), `bot_store.js` (phiên, nhóm, trạng thái trong database), `bot_sources.js` (hỏi dashboard),
`bot_session.js` (phiên Zalo, hàng gửi, nhóm), `bot_reports.js`
(dựng + gửi từng loại tin), `bot_commands.js` (lệnh gõ), `bot_slots.js` (vòng rà mốc). Tin ads ở
`daily_report.js` + `daily_report_*.js`, tin vận đơn ở `shipment_alerts.js` + `shipment_*.js`.

```
            mỗi 5'                       HTTP + header x-talpha-token
 bot.js ── vòng rà ──► dựng tin ───────────────────────────────► dashboard (Next.js)
   │                     │                                          │
   │                     │  market-report · sheet-report            ├─ Postgres: market_monthly_reports,
   │                     │  realtime · pancake-messages             │            monthly_report_tabs, sync_health…
   │                     │  tracking · sync-health                  └─ gọi thẳng Meta / POS / Pancake /
   │                     ▼                                             17TRACK / WeShip
   └──── zca-js ────► nhóm Zalo "ADS + VẬN ĐƠN <nước>"
   database (qua dashboard): phiên đăng nhập, nhóm từng nước, mốc đã gửi, số đã báo, lịch đính chính, sổ nhắc khách
```

| Thành phần | Chi tiết |
|---|---|
| Gửi bằng | Nick Zalo **phụ** "Hoàng Rin", thư viện zca-js (giả làm Zalo Web). Trái điều khoản Zalo — nick có thể bị khoá. Zalo chỉ cho **một phiên web** mỗi nick |
| Khoá đăng nhập | Bảng `zalo_session` (cookie + imei + userAgent, MÃ HOÁ pgcrypto bằng `TALPHA_ENCRYPTION_KEY` như khoá kết nối), tạo khi ghép nick trên trang hoặc `node pair.js` |
| Gọi dashboard | `TALPHA_DASHBOARD_URL` (mặc định `http://localhost:3000`; Docker `http://dashboard:3000`). `config.js` bọc `fetch` toàn cục: mọi lượt gọi tới dashboard tự gắn `x-talpha-token`, chìa đọc từ `data/.internal_token` mỗi lượt |
| Chạy ở đâu | VPS: pm2 `talpha-zalo-alerts` (`ops/pm2/ecosystem.vps.config.js`). Docker: `docker compose --profile zalo up -d` |
| Nhịp | Vòng rà **5 phút** (mốc đến hạn + đính chính) · giữ phiên Zalo **mỗi giờ** · so "vân tay" thị trường **mỗi 60 giây** |
| Bộ nhớ | Bảng `zalo_bot_state` + `zalo_market_groups` (migration 0003) — bot đọc / ghi qua dashboard (`bot_store.js`) |

Dùng vòng rà thay cho hẹn giờ vì pm2 restart lúc 08:29 là mất sạch hẹn giờ. Mọi lần gửi xếp chung
**một hàng** (`bot_session.js → enqueue`): lệnh gõ trúng lúc tin 08:30 đang đi thì đợi, không xen vào giữa.

## 2. Nhóm Zalo

Mỗi nước một nhóm `ADS + VẬN ĐƠN <nước>` (TAIWAN · SGP · UAE · JAPAN, chốt 08/10/2026). Tin ads và tin
vận đơn của nước đó chung một nhóm; nhóm nào chỉ thấy số nước mình.

* **Tự nhận nhóm theo tên** lúc khởi động, và mỗi vòng 5' nếu còn nước thiếu nhóm. Tên nhóm được bỏ
  dấu, viết hoa rồi so với tên nước, mã nước và `market_aliases` (`rules.js → marketFromGroupName`).
* **Một nước khớp ≥ 2 nhóm thì không đoán**, chỉ ghi log → chọn tay `node pair.js --chon-nuoc <id> --nuoc TW`.
* Nhóm đã nhận lưu ở bảng `zalo_market_groups`. Nick phụ phải nằm sẵn trong nhóm.
* Lần đầu vào một nhóm, bot gửi **một** tin hướng dẫn lệnh (`zalo_bot_state → gioiThieu`, restart không gửi lại).
* **Chỉ nghe 4 nhóm nước.** Nick phụ còn ở nhóm COD có người đối tác và nhóm cũ — gõ lệnh ở đó bot im.
* Nước `disabled` (đã tắt) bị lọc khỏi mọi lịch gửi dù `config.json` còn ghi tên.

## 3. Lịch gửi trong ngày (giờ VN)

| Giờ | Tin | Nước | Số của | Trễ tối đa |
|---|---|---|---|---|
| 08:30 | Ads sáng | mọi nước có nhóm | cả ngày hôm qua | 210' (tới 12:00) |
| 08:30, sau ads | Vận đơn sáng | TW, SG, AE, JP, VN | hôm qua + khách phải gọi / nhắn | 180' (tới 11:30) |
| 13:00 | Ads trưa | mọi nước | hôm nay, ▲▼ so **13:00 hôm qua** | 60' |
| 18:00 | Ads chiều | mọi nước | hôm nay, ▲▼ so **18:00 hôm qua** | 60' |
| 22:00 | Ads tối | mọi nước | hôm nay, ▲▼ so **cả ngày hôm qua** | 60' |
| 22:00, sau ads | Vận đơn tối | TW, SG, AE, JP, VN | chấm danh sách khách của tin sáng | 60' |
| HH:05, 07:05 → 23:05, trừ 13h · 18h · 22h | Tin mỗi giờ | JP | hôm nay, "(+N)" thêm trong giờ qua | 40' |

Luật của mỗi mốc (`schedule.js → slotAction`, `bot_slots.js → runSlot`):

1. **Chưa tới giờ, hoặc hôm nay đã gửi** → bỏ qua. Mốc đã gửi ghi theo từng mốc × từng nước ở
   `zalo_bot_state → moc` (`ads:TW:sang`, `vandon:SG`, `ads:AE:13:00`, `vandon_toi:TW`, `gio:JP:09:05`).
2. **Quá cửa sổ trễ** → đánh dấu xong, **không gửi** (tin nhãn "13:00" bắn lúc 21h vừa sai nhãn vừa dẫm mốc 22:00).
3. **Dựng tin lỗi** (dashboard lỗi, bảng số chưa có dòng ngày) → chưa đánh dấu, 5' sau thử lại trong cửa sổ.
   Đã gửi được ít nhất một tin rồi mới hỏng → vẫn đánh dấu, không gửi lặp.
4. **Giờ yên 23:00–07:00** không tự gửi. Ngoại lệ: tin mỗi giờ 23:05 của Nhật (chính lịch đặt nó trong giờ yên).
   Lệnh gõ tay trả lời bất cứ lúc nào.
5. **Thứ tự một vòng**: ads sáng mọi nước → vận đơn sáng → các mốc ads giữa ngày → vận đơn tối → tin mỗi giờ.
   Trong một nhóm, tin ads luôn đứng trước tin vận đơn cùng mốc. Nước này hỏng không kéo nước kia.

Số ▲▼ của mốc trưa/chiều là số **bot đã báo** cùng mốc hôm qua (`zalo_bot_state → soMoc["TW|13:00"]`). Chỉ
mốc tự gửi đúng giờ và số đã đủ mới được nhớ — gửi tay `--moc` không ghi đè.

## 4. Nội dung từng loại tin và nguồn số

| Tin | Nội dung | Nguồn số |
|---|---|---|
| Ads (sáng/trưa/chiều/tối, `/baocao`) | Tiền ads · doanh số · %ads · đơn · mess · tỷ lệ chốt; xếp hạng người **trong nước**; dòng "chưa gán cho ai"; ▲▼ | `/api/talpha/market-report?month=` → bảng `market_monthly_reports` (`format_all.py` ghi mỗi giờ, cùng bộ ô với TỔNG TEAM) |
| Ads — khi bảng trên thiếu, hoặc cũ hơn vòng OK gần nhất quá 45' | Cùng số đầu tin, **không có xếp hạng người** (tin ghi rõ) | `/api/talpha/sheet-report?date=` → bảng `monthly_report_tabs`, tab nước của TỔNG TEAM |
| Ads — chi tiết camp | Mọi camp của nước đó, tên đầy đủ, theo marketer, tiêu nhiều trước. Lỗi thì tin vẫn đi, thiếu phần camp | `/api/talpha/realtime` (Meta + POS gọi thẳng). Một lượt dùng chung cho mọi nước trong 3', lọc nước theo tên camp |
| Ads Nhật — số mess | Thay số mess của Meta (Meta không báo tin nhắn ở Nhật) | `/api/talpha/pancake-messages` |
| Tin mỗi giờ (JP) | Ads · tin nhắn · bình luận mới · SĐT · đơn · doanh số **theo page**, "(+N)" so giờ trước | `realtime` + `pancake-messages`; tổng giờ trước ở `zalo_bot_state → gioTruoc` |
| Vận đơn sáng | Hôm qua (đã lấy, mới tới, bắt đầu hoàn); @Thương; khách phải gọi / nhắn (tên, SĐT, cửa hàng, mã lấy hàng, hạn, **câu nhắn soạn sẵn**); nhắc lại khách chưa lấy; sắp giao; nên huỷ; hỏi đối tác; đơn lệch | `/api/talpha/tracking?market=&from=<60 ngày trước>&to=<hôm nay>` — **cùng route màn Theo dõi vận đơn**, cùng luật cảnh báo `buildAlerts` |
| Vận đơn tối | Khách phải gọi sáng nay: đã lấy (cứu bao nhiêu tiền) / chưa lấy / bị trả về; khách mới tới đã lấy chưa; số cả ngày | `tracking` + danh sách sáng ở `zalo_bot_state → vanDonSang` |
| `/canhbao` | Camp của nước tiêu ≥ 300.000đ mà 0 tin nhắn (tối đa 12 camp) | `/api/talpha/realtime` |
| Dòng "⚠️ SỐ CHƯA ĐỦ" | Sync đứng bao lâu, TKQC / shop nào đọc lỗi | `/api/talpha/sync-health` → bảng `sync_health` (`daily_guarded.sh` ghi mỗi vòng :20) |
| Dòng ⚠️ cảnh báo hệ thống (12/11/2026, tin ads của nhóm nước) | Bộ soát từng TKQC/shop không chạy quá `health_check_stale_minutes` (chỉ khi sync vẫn chạy); TKQC / shop mất sạch hoặc tụt dòng (shop chỉ báo vào nhóm nước đó); **shop đứng im** — ads nước đó tiêu ≥ `stalled_shop_min_ads_vnd` trong `stalled_shop_days` ngày mà shop POS không có đơn mới | `/api/talpha/sync-health` → `accounts` (bảng `sync_health_accounts`), `stalled_shops` (`lib/talpha/stalled-shops.ts`); ngưỡng ở `talpha_rules.json → thresholds`; chữ ở `daily_report_stale.js → systemHealthNotes` |

Vận đơn theo nước:

* **Đài Loan** (lấy ở cửa hàng): gọi khách sắp bị trả về, nhắn khách mới tới, **nhắc lại mỗi sáng** khách đã
  nhắn mà chưa lấy (sổ nhắc `zalo_bot_state → vanDonNhac`, chỉ ghi sau khi gửi thật). Câu nhắn tiếng Trung.
* **Singapore, Nhật** (giao tận nhà): gọi đơn giao hỏng / hẹn giao lại, báo trước đơn sắp giao. Câu nhắn
  tiếng Anh + bản dịch. Nhật: 17TRACK hãng Japan Post.
* **Việt Nam** (giao tận nhà, J&T, mở 11/11/2026): trạng thái J&T đọc thẳng từ đơn POS (`provider: "pos"`,
  `lib/talpha/pos-jt.ts`) — không qua 17TRACK, không quota, nên đầu tin không có dòng cảnh báo nguồn. Câu nhắn khách
  **tiếng Việt** (xưng em – anh/chị), một dòng, không bản dịch; báo trước chỉ khi J&T đang đi giao.
* **UAE**: trạng thái tra ở **trang WeShip**, không qua 17TRACK; câu nhắn theo lý do (từ chối, không nghe
  máy, hẹn lại). Từ chối ≥ 3 lần → rút khỏi danh sách gọi, gom một dòng "nên huỷ".
* In đủ chi tiết tối đa 15 khách phải gọi, 20 khách mới tới; còn lại trỏ về dashboard.
* 17TRACK lỗi / sắp hết quota (< 200 mã) / từ chối đăng ký mã → đầu tin tự có dòng cảnh báo, để sale
  không gọi nhầm khách đã lấy hàng.

Tin dài quá 1.800 ký tự tự chia thành nhiều tin, cách nhau 4 giây (`zalo_text.js → splitMessage`).

## 5. Số chưa đủ → gửi tạm rồi tự đính chính

Luật chốt 22/09/2026: **sync đứng thì vẫn gửi đúng khung giờ** (có nhãn "SỐ CHƯA ĐỦ"), **sync đủ số thì
tự gửi thêm một tin đính chính**.

**Khi nào tin bị coi là "chưa đủ"** (`daily_report_stale.js → buildStaleWarning`). "Vòng OK" = dòng `sync_health`
có `ok` (sync_rc 0 **và** format_rc 0 — đã ghi được báo cáo):

| Loại tin | Chưa đủ khi |
|---|---|
| Tin về ngày đã qua (08:30, `--report`) | Chưa có vòng OK nào chạy **sau 00:00 của ngày kế tiếp** (không dùng ngưỡng tuổi: sync 23:22 thì 8h sáng "cũ 490'" nhưng số gần đủ) |
| Tin giữa ngày (13:00 / 18:00 / 22:00) | Vòng OK gần nhất cũ hơn `staleWarnMinutes` (120') |

**Vòng đời một lịch đính chính:**

1. Gửi tin tạm. Thấy cờ `chuaDu` → ghi `zalo_bot_state → dinhChinh[khoá]` = `{ngay, nuoc, intraday, label, luc, so, hanTs}`.
   Ghi ra file nên pm2 restart / máy chủ reboot giữa lúc chờ không mất lịch.
2. Mỗi vòng 5', `checkCorrections` (`bot_reports.js`) hỏi `sync-health` rồi `correctionAction` (`schedule.js`):
   * tin ngày đã qua: **gửi** khi có vòng OK sau khi hết ngày đó;
   * tin giữa ngày: **gửi** khi có vòng OK chạy sau lúc gửi tin tạm.
3. Tin `🔄 ĐÍNH CHÍNH — <nhãn>` liệt kê chỗ lệch (Tiền ads · Đơn · Doanh số · Mess: cũ → mới) rồi đính kèm
   bản báo cáo đủ số. **Không lệch gì** → chỉ mấy dòng đầu "✅ Số không đổi".
4. **Hạn chờ**: tin ngày đã qua 24 giờ (`dinhChinhHanGio`); tin giữa ngày chỉ tới **hết ngày đó** (qua đêm
   thì tin 08:30 đã là số cả ngày). Quá hạn mà vẫn chưa đủ → bỏ chờ, có log.
5. Giờ yên 23h–7h thì đợi. Riêng `node bot.js --dinh-chinh` gửi luôn, bỏ qua giờ yên.

Thêm:

* Mốc giữa ngày mới đã gửi → lịch đính chính của mốc giữa ngày **trước đó cùng ngày, cùng nước** bị xoá
  (tin mới nhất đã mang số mới hơn).
* Lệnh `/baocao` gõ trong nhóm **không** xếp lịch đính chính (gõ 10 lần ≠ 10 tin đính chính).
* **Sheet chưa có số hôm nay** (tin giữa ngày, mọi số = 0, vòng OK gần nhất trước 00:00): tin không in
  "Ads 0đ · 0 đơn" mà ghi "Sheet chưa có số hôm nay" kèm tiền ads Meta trực tiếp.
* **TKQC chết bị bỏ qua** (`fetch_errors.bo_qua`): vòng vẫn OK nên **không** phải "SỐ CHƯA ĐỦ" — chỉ thêm
  dòng ℹ️ nêu tên TK để cấp lại quyền hoặc gỡ.
* `sync-health` lỗi → bot coi như "không biết tuổi số": tin vẫn đi, không kèm cảnh báo (thà thiếu cảnh
  báo còn hơn chặn mất báo cáo).

## 6. Chống gửi trùng, gửi lẫn

| Cơ chế | Chặn cái gì |
|---|---|
| `zalo_bot_state → moc` theo mốc × nước × ngày | Bắn lại cùng mốc sau restart |
| `markState`: đọc lại file ngay trước khi ghi một thay đổi nhỏ | Vòng này ghi đè mất khoá vòng kia vừa ghi |
| Cờ `scanning` (`bot_main.js`) | Hai vòng rà chồng nhau khi một vòng gửi lâu |
| Hàng gửi chung `enqueue` | Tin của hai loạt (lệnh + mốc tự gửi) xen vào nhau |
| Gửi được một phần rồi hỏng → coi như đã gửi | Gửi lại cả loạt; không chen tin báo lỗi vào giữa |
| Cùng lệnh, cùng nhóm, trong 60 giây → bỏ | Bấm gửi hai lần |
| `gioiThieu` theo id nhóm | Tin hướng dẫn lặp mỗi lần restart |

## 7. Lệnh gõ trong nhóm (`commands.js`)

Mọi lệnh chỉ trả số của **nước của nhóm** (gõ `/vandon sg` trong nhóm UAE vẫn ra UAE). Có dấu / không
dấu, hoa / thường đều được. Chữ không bắt đầu bằng `/` bot bỏ qua.

| Gõ | Bot trả |
|---|---|
| `/baocao` · `/bc` | Số đang chạy hôm nay, một tin |
| `/baocao homqua` · `/baocao 14/09` | Số hôm qua · số một ngày |
| `/baocao Lộc` · `/baocao homqua Lộc` | Số + camp của một người ở nước của nhóm |
| `/baocao team` | Chỉ phần số đầu tin, không kèm camp |
| `/canhbao` · `/cb` | Camp tiêu ≥ 300k mà 0 tin nhắn (Meta trực tiếp) |
| `/vandon` · `/vd` | Vận đơn mới nhất (khuôn tin sáng, đề giờ lúc gõ) |
| `/gio` | Tin mỗi giờ ngay lúc gõ — chỉ nước bật `moiGio` (JP); không ghi mốc "(+N)" |
| `/bot` · `/lenh` · `/help` | Cách dùng |

Lệnh lỗi → bot trả một dòng `⚠️ Chưa lấy được số lúc này (…)` / `⚠️ Sheet chưa có số ngày …`.

## 8. Vận hành

**Cấu hình trên trang** (16/11/2026): `/admin` → Khoá kết nối → tab **Zalo (bot)** — giám đốc làm hết, không gõ lệnh:

1. Bật bot trên máy chủ (Docker: `docker compose --profile zalo up -d zalo`; pm2: `talpha-zalo-alerts`). Trang báo
   "Bot Zalo đang chạy" khi thấy nhịp tim (30 giây/lần).
2. **Ghép nick Zalo** → mã QR hiện trên trang → quét bằng app Zalo của NICK PHỤ → bấm xác nhận trên điện thoại.
   Mã do chính bot xin; phiên lưu vào bảng `zalo_session` (mã hoá) — ảnh QR về trang, phiên thì không.
3. **Nhóm nhận tin từng nước**: chọn trong danh sách nhóm nick phụ đang ở; chọn "chưa có nhóm" là nước đó thôi nhận.
   Nhóm đã chọn nhận báo cáo THEO LỊCH từ mốc kế tiếp.
4. **Gửi thử** từng nước — một tin "TIN THỬ" vào nhóm đã chọn; kết quả hiện ở "Việc gần đây".

**Nhóm do trang quản lý** (cờ `nhomTuTrang` trong `zalo_bot_state`, ghi khi ghép nick / chọn nhóm trên trang): bot THÔI tự nhận
nhóm theo tên và THÔI tự gửi tin giới thiệu — chỉ gửi vào nhóm người chọn. Lý do (16/11/2026): ghép một nick đang ở sẵn
4 nhóm thật của team, bot tự nhận cả 4 và nhắn giới thiệu vào cả 4 ngay lúc ghép. Đổi nick thì nhóm chọn cho nick cũ mà
nick mới không ở trong bị bỏ (gửi vào đó Zalo báo "Tham số không hợp lệ"); lúc khởi động bot cũng soát lại như vậy.

Bên dưới: trang ghi yêu cầu vào bảng `zalo_requests`, bot (`bot_control.js`) nhặt qua `/api/talpha/zalo/bot` (chìa
nội bộ), làm rồi ghi kết quả + trạng thái vào `zalo_bot_status` (migration 0002). Bot không chạy thì trang không nhận
yêu cầu (để dồn lại là lúc bot bật lên nó gửi / đổi nhóm bất ngờ). Lệnh `node pair.js …` vẫn dùng được như cũ.

**Phiên Zalo**

* Đăng nhập **lười**: chỉ khi có tin cần gửi. Gửi lỗi → bỏ phiên, đăng nhập lại **một lần** rồi gửi lại.
* Chưa ghép / đăng nhập hỏng lúc khởi động → **không thoát** (để pm2 không restart liên tục che lỗi thật),
  đứng chờ, 10' thử lại.
* Bộ nhận lệnh bị Zalo đóng (thường do ai mở Zalo Web/PC bằng nick phụ) → đăng nhập lại sau 10', 20', 40'…
  tối đa 2 giờ. Kết nối lại được thì nhịp chờ về 10'.
* `keepAlive` mỗi giờ và lưu lại cookie mới vào `zalo_session` (cookie không đổi thì không ghi). `keepAlive` hỏng → đăng nhập lại NGAY (không
  đợi lần gửi tới) để trang biết sớm.
* **Mất đăng nhập hiện trên dashboard** (12/11/2026 — 03/11 Zalo đá phiên web của nick phụ, cookie chết, bot câm 9
  ngày không ai biết): đăng nhập hỏng / Zalo đóng kết nối thì bot ghi `zalo_bot_status.logged_in = false` +
  `last_error` ("Mất đăng nhập Zalo từ …", kèm "cần ghép lại nick" khi cookie chết, "bot đang tự thử lại" khi chỉ
  rớt mạng — `bot_session.js → getLoginProblem`, `bot_control.js`). Giám đốc thấy băng đỏ đầu dashboard
  (`components/talpha/zalo-bot-banner.tsx`) với nút sang tab Zalo để ghép lại nick; quá 90 giây không có nhịp tim
  thì băng vàng "Bot Zalo không chạy". Đăng nhập lại được thì bot tự xoá dòng lỗi đó.

**Thị trường đổi** (`/admin` → Thị trường): mỗi 60 giây bot so vân tay `market_overrides`
(`market_config.js`, qua `/api/talpha/market-config?overrides=1`). Khác lúc khởi động và **không** đang gửi →
`process.exit(0)` để pm2 / Docker dựng lại bot với luật mới.

**Chạy tay** (thêm `--dry-run` để chỉ in, không đăng nhập, không gửi):

```bash
node bot.js --report [YYYY-MM-DD] [--nuoc TW]   # báo cáo một ngày (mặc định hôm qua) — có xếp lịch đính chính
node bot.js --moc 18:00 [--nuoc AE]             # tin một mốc giữa ngày (không ghi đè số đã nhớ)
node bot.js --vandon [sang|toi] [--nuoc SG]     # tin vận đơn
node bot.js --gio [--nuoc JP]                   # tin mỗi giờ
node bot.js --dinh-chinh [--nuoc SG]            # gửi ngay đính chính đang chờ, kể cả 23h–7h
node bot.js --lenh "/baocao homqua" --nuoc TW   # như có người gõ lệnh đó trong nhóm
node pair.js | --tu-nhan | --groups | --chon-nuoc <id> --nuoc JP
```

**Kho của bot trong database** (16/11/2026, migration 0003 — trước là ba loại file cạnh `bot.js`):

| Bảng | Giữ gì |
|---|---|
| `zalo_session` | Khoá đăng nhập nick phụ, MÃ HOÁ như khoá kết nối. Mất / đổi `TALPHA_ENCRYPTION_KEY` → ghép lại nick trên trang |
| `zalo_market_groups` | Nhóm nhận tin của từng nước (`market`, `group_id`, `group_name`, cách chọn) |
| `zalo_bot_state` | Mỗi dòng một mục `(section, item)`: `moc`, `soMoc`, `dinhChinh`, `vanDonSang`, `vanDonNhac`, `gioTruoc`, `gioiThieu`, `nhomTuTrang` |

Bot KHÔNG nối thẳng Postgres: `bot_store.js` đọc cả kho qua `GET /api/talpha/zalo/bot?store=1` (chìa nội bộ) lúc
khởi động và đầu mỗi vòng rà, giữ trong bộ nhớ (code cũ đọc đồng bộ). Ghi = sửa bộ nhớ + xếp hàng
`POST {store_ops}` — chỉ mục đổi, nên bot dịch vụ và lệnh chạy tay sửa hai mục khác nhau không đè nhau; dashboard
không trả lời thì giữ hàng và thử lại. Việc bấm trên trang (ghép nick, chọn nhóm, bỏ ghép) đợi ghi xong mới báo
"xong"; bot thoát cũng đợi. Dashboard chưa lên lúc bot khởi động → bot ĐỢI chứ không đoán (đoán sai mốc nào đã gửi
là bắn lặp tin). **Lần đầu chạy bản này**: file cũ còn trên máy (`.zalo_session.json`, `zalo_group_nuoc_<mã>.json`,
`state.json`) thì bot chép vào kho (chỉ chỗ kho còn trống), soát khớp rồi xoá file — kho đã có bản khác thì giữ file
và ghi log để xem tay.

**Bot im lặng thì soát** `pm2 logs talpha-zalo-alerts` (Docker: `docker compose logs zalo`):
`Bộ nhận lệnh bị đóng` / `Đăng nhập Zalo lỗi` → phiên bị đá; `Mốc … lỗi — vòng sau thử lại` → dashboard
hoặc báo cáo chưa có số; gõ `/baocao` mà không thấy dòng `Lệnh "/baocao" từ …` → bot không nghe được nhóm.

**Tinh chỉnh**: `ops/zalo-alerts/config.json` (giờ mốc, cửa sổ trễ, giờ yên, ngưỡng camp đốt tiền, người
được @nhắc, số khách in đủ, khung 1800 ký tự) — bảng nghĩa từng khoá ở README của bot.

## 9. Lưu ý khi sửa

* **Danh sách nước của bot đang gõ cứng trong `config.json`**: `nhomNuoc.markets`, `vanDon.markets` (TW, SG, AE, JP,
  VN — Việt Nam thêm 11/11/2026), `moiGio.markets`, `nhomNuoc.messPancake` (JP). Thêm nước mới ở `/admin` → Thị trường thì bot
  **chưa** gửi gì cho nước đó — phải thêm mã vào các danh sách này (nước `disabled` thì tự lọc).
* `ops/zalo-alerts/.gitignore` vẫn chặn `.zalo_session.json`, `state.json`, `zalo_group_nuoc_*.json` (file cũ — máy
  chưa chạy bản kho database còn giữ), `qr.png`, `groups.txt` — không vào git.
* Hàm dựng tin là hàm thuần, có test: `cd ops/zalo-alerts && npm test` (không gọi mạng, không đăng nhập).
  `require("./bot")` là đăng nhập Zalo luôn — logic cần test thì tách ra file riêng như `schedule.js`.
* Giờ VN phải dùng `hourCycle: "h23"` — `hour12: false` trả "24" lúc nửa đêm (bot cũ từng bắn tin 8h lúc 0h05).
* Chú thích trong code còn lệch ở mấy chỗ (README đã sửa 16/11/2026):
  * Chú thích đầu `bot.js` và log trong `daily_report_market.js → fetchMarketNumbers` còn nhắc `data/bao_cao_nuoc/<tháng>.json`
    — nay là bảng `market_monthly_reports`.
  * Chú thích `commands.js` ghi `/canhbao` có "chi tiêu bất thường" — `buildMarketAlert` chỉ bắt camp đốt tiền.
