// ═══════════════════════════════════════════════════════════════════
// TALPHA — Bot báo cáo ADS + VẬN ĐƠN vào nhóm Zalo, MỖI NƯỚC MỘT NHÓM
// ───────────────────────────────────────────────────────────────────
// 08/10/2026 (Sỹ Anh chốt): mỗi nước một nhóm "ADS + VẬN ĐƠN <nước>" — TAIWAN · SGP · UAE ·
// JAPAN. Tin ads của nước đó và tin vận đơn của nước đó chung một nhóm. BỎ HẲN nhóm cũ: BÁO CÁO
// ADS (gộp mọi nước) và VẬN ĐƠN TW / SGP / UAE — bot không đọc file nhóm cũ nữa.
// - Ads 08:30 (kết quả hôm qua) + 13:00 · 18:00 · 22:00 (số đang chạy hôm nay), giờ như cũ.
//   13:00/18:00 so ▲▼ với CÙNG MỐC hôm qua của chính nước đó, 22:00 so với cả ngày hôm qua.
// - Vận đơn 08:30 + 22:00 (Đài, Singapore, UAE, Nhật). Nhật từ 13/10/2026: bảng đối tác
//   "BS UP DATA JAPAN" + 17TRACK hãng Japan Post (21/10; 13/10 khai Sagawa bị từ chối), câu nhắn khách nói Japan Post / phiếu báo vắng nhà.
// - Lệnh gõ trong nhóm (commands.js): /baocao [homqua | dd/mm] [tên | team] · /canhbao · /vandon
//   · /bot — luôn trả số của NƯỚC CỦA NHÓM, không bao giờ số nước khác.
// - Sync đang đứng thì tin vẫn gửi ĐÚNG KHUNG GIỜ (mang dòng "SỐ CHƯA ĐỦ") và bot NHỚ số đã
//   báo; vòng sync nào lấy đủ số thì tự gửi thêm MỘT tin ĐÍNH CHÍNH vào đúng nhóm nước đó
//   (Sỹ Anh chốt 22/09/2026). Lịch chờ nằm trong trạng thái bot (bảng zalo_bot_state) → restart không mất.
// Nguồn số: bảng market_monthly_reports qua /api/talpha/market-report (format_all.py ghi cùng lúc file TỔNG TEAM),
// realtime = Meta + POS live (chi tiết camp), tracking = vận đơn, sync-health = tuổi số. Gửi
// bằng nick Zalo PHỤ (zca-js) — xem README.md.
//
// Chạy: node bot.js                                (dịch vụ — pm2 talpha-zalo-alerts)
//       node bot.js --lenh "/baocao homqua" --nuoc TW   (làm như có người gõ lệnh đó trong nhóm TW)
//       node bot.js --report [YYYY-MM-DD] [--nuoc TW]   (gửi ngay báo cáo ngày đó — mặc định hôm qua, mọi nước)
//       node bot.js --vandon [sang|toi] [--nuoc SG]     (gửi ngay tin vận đơn)
//       node bot.js --moc 13:00 [--nuoc AE]             (gửi ngay tin một mốc giữa ngày)
//       node bot.js --dinh-chinh [--nuoc SG]            (gửi ngay tin ĐÍNH CHÍNH đang chờ — kể cả 23h–7h)
//       thêm --dry-run: IN tin ra màn hình, không đăng nhập, không gửi.
//
// Tách 16/11/2026 — file này chỉ còn điểm chạy: nạp luật phủ thị trường rồi gọi bot_main.js (runService, main):
//   bot_config.js   — hằng từ config.json / talpha_rules.json, cờ dòng lệnh, trạng thái bot, giờ VN, mốc
//   bot_store.js    — phiên Zalo, nhóm từng nước, trạng thái bot trong database (qua dashboard)
//   bot_sources.js  — hỏi dashboard: sync-health, market-report, realtime, pancake-messages
//   bot_session.js  — phiên Zalo, hàng gửi tin, nhóm từng nước, bộ nhận lệnh
//   bot_reports.js  — dựng + gửi tin ads, tin mỗi giờ, tin vận đơn, tin đính chính
//   bot_commands.js — chạy lệnh gõ trong nhóm
//   bot_slots.js    — vòng rà mốc tự gửi
// ═══════════════════════════════════════════════════════════════════
// Nạp luật phủ thị trường (hỏi dashboard, BẤT ĐỒNG BỘ) TRƯỚC khi nạp bất kỳ module nào đọc luật:
// rules.js đọc luật đồng bộ lúc được require. config.js nạp trước để lượt hỏi mang chìa nội bộ.
require("./config");
require("./market_config").primeMarketOverrides()
    .then(() => require("./bot_main").start());
