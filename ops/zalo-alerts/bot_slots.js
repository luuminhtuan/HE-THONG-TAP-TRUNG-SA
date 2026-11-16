// Mốc tự gửi của bot.js (tách 16/11/2026): vòng rà 5' xem mốc nào tới hạn, mốc nào đã gửi.
const { dayBefore } = require("./commands");
const { slotAction } = require("./schedule");
const {
    DR, SHIPMENT_CFG, HOURLY_CFG, MARKET_CODES, SHIPMENT_MARKETS, HOURLY_MARKETS, log,
    loadState, markState, vnDateStr, vnHHMM, inQuietHours,
    DAILY_AT, SHIPMENT_AT, SHIPMENT_EVENING_AT, INTRADAY_SLOTS, slotLabel, slotKind, hourlySlots,
} = require("./bot_config");
const { getMarketGroups } = require("./bot_session");
const { sendReport, sendHourly, sendShipmentDigest } = require("./bot_reports");

// ─── Mốc tự gửi ───
// Rà theo vòng 5' chứ không hẹn giờ: pm2 restart lúc 08:29 là mất sạch timer. Đổi lại vòng
// rà tự lo hai việc: chống bắn lại (state ghi TỪNG mốc, TỪNG nước) và chống bắn MUỘN (cửa sổ
// bù). Dựng tin hỏng (Sheet chưa có dòng, dashboard lỗi) → CHƯA đánh dấu, vòng sau thử lại
// trong cửa sổ. Gửi được ít nhất một tin rồi mới hỏng → vẫn đánh dấu, để không gửi lặp.
// quaGioYen: mốc mà chính lịch đã đặt trong giờ yên (tin mỗi giờ tới 23:05) — gửi luôn, không chờ.
async function runSlot(entryKey, slotTime, windowMin, job, { quaGioYen: ignoreQuietHours = false } = {}) {
    const today = vnDateStr();
    const act = slotAction(slotTime, vnHHMM(), (loadState().moc || {})[entryKey], today, windowMin);
    if (!act) return;
    const markDone = () => markState((s) => { (s.moc = s.moc || {})[entryKey] = today; });
    if (act === "skip") { markDone(); log(`Bỏ mốc ${entryKey} hôm nay (quá cửa sổ ${windowMin}', bây giờ ${vnHHMM()}).`); return; }
    if (!ignoreQuietHours && inQuietHours()) return;
    try {
        const r = await job();
        markDone();
        log(`Đã gửi mốc ${entryKey}: ${r.ghiChu}.`);
    } catch (e) {
        if (e.daGui > 0) markDone();
        log(`Mốc ${entryKey} lỗi${e.daGui > 0 ? ` sau ${e.daGui} tin — không gửi lại` : " — vòng sau thử lại"}:`, e.message);
    }
}

// Một mốc chạy lần lượt mọi nước (ads trước); 08:30 và 22:00 xong ads mới tới vận đơn — trong
// một nhóm, tin ads luôn đứng trước tin vận đơn cùng mốc.
async function checkSlots() {
    const yesterday = dayBefore(vnDateStr());
    const marketsWithGroup = MARKET_CODES.filter((m) => getMarketGroups()[m]);
    for (const m of marketsWithGroup) {
        await runSlot(`ads:${m}:sang`, DAILY_AT, Number(DR.atCatchUpMinutes || 210),
            () => sendReport(m, yesterday, { theoDoi: `sang:${m}:${yesterday}`, kieu: "sang" }));
    }
    // Vận đơn: dashboard lỗi thì vòng 5' sau thử lại, quá catchUpMinutes thì bỏ hôm đó. Khoá
    // "vandon:<nước>" giữ như trước 08/10/2026 — hôm đổi nhóm không gửi lại tin đã gửi sáng nay.
    for (const m of SHIPMENT_MARKETS.filter((x) => getMarketGroups()[x])) {
        if (SHIPMENT_AT) await runSlot(`vandon:${m}`, SHIPMENT_AT, Number(SHIPMENT_CFG.catchUpMinutes || 180), () => sendShipmentDigest(m, "sang"));
    }
    for (const slot of INTRADAY_SLOTS) {
        const todayStr = vnDateStr();
        for (const m of marketsWithGroup) {
            await runSlot(`ads:${m}:${slot}`, slot, Number(DR.intradayCatchUpMinutes || 60),
                () => sendReport(m, todayStr, { homNay: true, label: slotLabel(slot), theoDoi: `${slot}:${m}:${todayStr}`, kieu: slotKind(slot), moc: slot }));
        }
    }
    for (const m of SHIPMENT_MARKETS.filter((x) => getMarketGroups()[x])) {
        if (SHIPMENT_EVENING_AT) await runSlot(`vandon_toi:${m}`, SHIPMENT_EVENING_AT, Number(SHIPMENT_CFG.toiCatchUpMinutes || 60), () => sendShipmentDigest(m, "toi"));
    }
    // Tin mỗi giờ: trễ quá catchUpMinutes thì bỏ giờ đó (bot vừa bật lại lúc 15:20 không bắn
    // lại 7 giờ đã qua — slotAction trả "skip" cho các giờ cũ). Mốc 23:05 rơi vào giờ yên
    // (23h–7h) nên đêm 09/10 và 10/10/2026 đều bị chặn tới quá cửa sổ rồi bỏ → quaGioYen.
    for (const m of HOURLY_MARKETS.filter((x) => getMarketGroups()[x])) {
        for (const slotTime of hourlySlots()) await runSlot(`gio:${m}:${slotTime}`, slotTime, Number(HOURLY_CFG.catchUpMinutes || 40), () => sendHourly(m), { quaGioYen: true });
    }
}

module.exports = { runSlot, checkSlots };
