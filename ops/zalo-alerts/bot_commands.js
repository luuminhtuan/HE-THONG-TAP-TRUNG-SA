// Chạy lệnh gõ trong nhóm của bot.js (tách 16/11/2026). Đọc lệnh: commands.js → parseCommand.
const CFG = require("./config");
const { buildMarketAlert } = require("./daily_report");
const { parseCommand } = require("./commands");
const { MARKETS } = require("./rules");
const {
    MARKET_CODES, SHIPMENT_MARKETS, HOURLY_MARKETS, MARKETER_LIST, log, ddmm, argAfter, vnDateStr, helpMessage,
} = require("./bot_config");
const { getRealtime } = require("./bot_sources");
const { sendOne, sendBatch, enqueue, groupOf } = require("./bot_session");
const { buildReport, buildHourly, buildShipmentDigest } = require("./bot_reports");

// ─── Lệnh trong nhóm ───
const lastCommandAt = new Map();     // chữ lệnh → lúc nhận; cùng lệnh trong 60 giây thì bỏ (bấm gửi hai lần)

// m: nước của nhóm lệnh được gõ (null = dòng lệnh, dùng --nuoc hoặc mọi nước). Mọi lệnh chỉ
// trả số của ĐÚNG nước đó: nhóm Nhật không thấy số Đài, nhóm UAE không thấy SĐT khách Singapore.
async function runCommand(text, sender = "dòng lệnh", m = null) {
    const command = parseCommand(text, { today: vnDateStr(), nguoi: MARKETER_LIST });
    if (!command) return false;
    const markets = m ? [m] : (argAfter("--nuoc") ? [argAfter("--nuoc").toUpperCase()] : MARKET_CODES);
    const entryKey = `${m || "cli"}:${String(text).trim().toLowerCase()}`;
    if (Date.now() - (lastCommandAt.get(entryKey) || 0) < 60000) { log(`Bỏ lệnh lặp "${entryKey}" từ ${sender}.`); return true; }
    lastCommandAt.set(entryKey, Date.now());
    log(`Lệnh "${String(text).trim()}" từ ${sender}${m ? ` (nhóm ${m})` : ""}.`);

    for (const x of markets) {
        if (!MARKETS[x]) { log(`Bỏ nước lạ ${x}.`); continue; }
        const group = groupOf(x);
        if (!group) { log(`Bỏ ${x}: chưa có nhóm.`); continue; }
        await enqueue(async () => {
            try {
                if (command.loi) { await sendOne(`⚠️ ${command.loi}`, group); return; }
                if (command.lenh === "trogiup") { await sendOne(helpMessage(x), group); return; }
                if (command.lenh === "gio") {
                    if (!HOURLY_MARKETS.includes(x)) { await sendOne(`ℹ️ ${MARKETS[x].ten} chưa bật tin mỗi giờ — gõ /baocao để xem số hôm nay.`, group); return; }
                    // Gõ tay không ghi "lần trước": giữ mốc (+N) của tin tự gửi đúng giờ.
                    await sendBatch([(await buildHourly(x)).text], group);
                    return;
                }
                if (command.lenh === "vandon") {
                    if (!SHIPMENT_MARKETS.includes(x)) { await sendOne(`ℹ️ ${MARKETS[x].ten} chưa theo dõi vận đơn — làm khi có đơn và biết hãng giao.`, group); return; }
                    await sendBatch([(await buildShipmentDigest(x, "")).text], group);
                    return;
                }
                if (command.lenh === "canhbao") {
                    const todayStr = vnDateStr();
                    await sendOne(buildMarketAlert((await getRealtime(todayStr)).campaigns, CFG, x, todayStr), group);
                    return;
                }
                const r = await buildReport(x, command.ngay, command.homNay);
                const reply = command.loc === "team" ? r.teamMessage : command.loc ? r.tinNguoi(command.loc) : r.tinGop;
                log(`Đã trả lệnh ở ${x}: ${await sendBatch([reply], group)} tin.`);
            } catch (e) {
                log(`Lệnh lỗi (${x}):`, e.message);
                if (e.daGui > 0) return;                   // gửi được một phần rồi — không chen tin lỗi vào giữa
                const errorReply = command.lenh === "vandon" ? `⚠️ Chưa lấy được danh sách vận đơn lúc này (${e.message}). Lát nữa gõ lại.`
                    : /Sheet chưa có dòng/.test(e.message)
                        ? `⚠️ Sheet chưa có số ngày ${ddmm(command.ngay)} — vòng ghi Sheet chạy mỗi giờ phút 20, lát nữa gõ lại.`
                        : `⚠️ Chưa lấy được số lúc này (${e.message}). Lát nữa gõ lại.`;
                try { await sendOne(errorReply, group); } catch (e2) { log("Không gửi được tin báo lỗi:", e2.message); }
            }
        });
    }
    return true;
}

module.exports = { runCommand };
