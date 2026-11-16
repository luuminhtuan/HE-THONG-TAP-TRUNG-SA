// ═══════════════════════════════════════════════════════════════════
// Thân bot Zalo (runService, main) — bot.js nạp luật phủ thị trường xong mới require file này.
// Cách chạy, cờ dòng lệnh: xem đầu bot.js.
// ═══════════════════════════════════════════════════════════════════
const CFG = require("./config");
const { dayBefore } = require("./commands");
const { MARKETS } = require("./rules");
const { fetchOverridesFingerprint, getLoadedFingerprint } = require("./market_config");
const {
    ARGS, DRY, MARKET_CODES, SHIPMENT_MARKETS, HOURLY_MARKETS, log, argAfter, vnDateStr,
    DAILY_AT, SHIPMENT_AT, SHIPMENT_EVENING_AT, INTRADAY_SLOTS, slotLabel, slotKind,
} = require("./bot_config");
const {
    enableServiceMode, loadZalo, isLoggedIn, getMarketGroups,
    connect, groupOf, keepSessionAlive, introduceNewGroups, loadGroups, autoAssignGroups, waitOrWake, pruneStaleGroups,
} = require("./bot_session");
const { startControl } = require("./bot_control");
const { sendReport, sendHourly, sendShipmentDigest, checkCorrections } = require("./bot_reports");
const { runCommand } = require("./bot_commands");
const { checkSlots } = require("./bot_slots");

async function runService() {
    enableServiceMode(runCommand);   // từ đây mỗi lần đăng nhập đều bật lại bộ nhận lệnh
    log(`Dashboard base: ${CFG.dashboardBaseUrl}${process.env.TALPHA_DASHBOARD_URL ? " (env TALPHA_DASHBOARD_URL)" : ""}`);
    loadZalo();
    // Trang /admin → Khoá kết nối → Zalo điều khiển bot (ghép nick bằng QR, chọn nhóm, gửi thử) — bật NGAY, kể cả
    // khi chưa ghép: đó chính là lúc cần ghép từ trang (bot_control.js, 16/11/2026).
    startControl();
    // Đăng nhập hỏng / chưa ghép: KHÔNG thoát — pm2 sẽ khởi động lại liên tục và che mất lỗi
    // thật. Đứng chờ, 10' thử lại một lần — ghép nick / chọn nhóm trên trang thì thử lại ngay.
    for (;;) {
        loadGroups();
        try { await connect(); await pruneStaleGroups(); await autoAssignGroups(); }
        catch (e) { log("Đăng nhập Zalo lỗi:", e.message); }
        if (isLoggedIn() && Object.keys(getMarketGroups()).length) break;
        if (isLoggedIn()) log("Chưa có nhóm nước nào — thêm nick phụ vào nhóm \"ADS + VẬN ĐƠN <nước>\", hoặc chọn nhóm ở /admin → Khoá kết nối → Zalo.");
        await waitOrWake(10 * 60 * 1000);
    }
    for (const m of MARKET_CODES) {
        const g = getMarketGroups()[m];
        if (g) log(`Nhóm ${m} "${g.name}" (${g.id}) · ads ${[DAILY_AT, ...INTRADAY_SLOTS].join(" + ")}`
            + (SHIPMENT_MARKETS.includes(m) ? ` · vận đơn ${[SHIPMENT_AT, SHIPMENT_EVENING_AT].filter(Boolean).join(" + ") || "(tắt)"}` : " · chưa có vận đơn")
            + " · nghe lệnh.");
        else log(`Chưa có nhóm ${m} — không gửi gì cho ${m}.`);
    }

    try { await introduceNewGroups(); } catch (e) { log("Tin giới thiệu lỗi:", e.message); }

    let scanning = false;                 // không để hai vòng rà chồng nhau khi một vòng gửi lâu
    const tick = async () => {
        if (scanning) return;
        scanning = true;
        try {
            // Nhóm nào còn thiếu thì mỗi vòng thử tự nhận lại — Sỹ Anh thêm nick vào nhóm là vòng sau tự gửi.
            if (MARKET_CODES.some((m) => !getMarketGroups()[m])) { await autoAssignGroups(); await introduceNewGroups(); }
            await checkSlots(); await checkCorrections();
        }
        catch (e) { log("Vòng rà lỗi:", e.message); }
        finally { scanning = false; }
    };
    await tick();
    setInterval(tick, 5 * 60 * 1000);
    setInterval(keepSessionAlive, 60 * 60 * 1000);

    // Thị trường nhập ở /admin → Thị trường đổi (thêm, sửa, tắt nước): luật nạp lúc khởi động đã cũ.
    // Thoát lúc KHÔNG đang gửi để pm2 dựng lại bot với luật mới (04/11/2026, xem market_config.js).
    const marketFingerprint = getLoadedFingerprint();
    setInterval(async () => {
        if (scanning) return;
        const latest = await fetchOverridesFingerprint();
        if (latest === null || latest === marketFingerprint) return;
        log("Thị trường nhập trên trang đã đổi — khởi động lại để nạp luật mới.");
        process.exit(0);
    }, 60 * 1000);
}

async function main() {
    const command = argAfter("--lenh");
    if (command || ["--report", "--vandon", "--moc", "--gio", "--dinh-chinh"].some((a) => ARGS.includes(a))) {
        if (!DRY) { loadZalo(); loadGroups(); }
        const markets = argAfter("--nuoc") ? [argAfter("--nuoc").toUpperCase()] : null;
        if (markets && !MARKETS[markets[0]]) throw new Error(`--nuoc lạ: ${markets[0]} (có: ${MARKET_CODES.join(", ")})`);
        if (ARGS.includes("--dinh-chinh")) {
            // --dinh-chinh [--nuoc SG]: gửi ngay các tin đính chính đang chờ (state.json), bỏ qua giờ yên.
            await checkCorrections({ goiTay: true, chiNuoc: markets ? markets[0] : null });
        } else if (ARGS.includes("--gio")) {
            // --gio [--nuoc JP]: gửi ngay tin mỗi giờ (không ghi mốc "lần trước").
            for (const m of (markets || HOURLY_MARKETS)) {
                if (!groupOf(m)) { log(`Bỏ ${m}: chưa có nhóm.`); continue; }
                const r = await sendHourly(m, false);
                log(`${DRY ? "In thử" : "Đã gửi"} ${r.ghiChu}.`);
            }
        } else if (ARGS.includes("--vandon")) {
            // --vandon [sang|toi] [--nuoc SG]: gửi ngay (mặc định: khuôn sáng, mọi nước có vận đơn).
            const kind = ["sang", "toi"].includes(argAfter("--vandon")) ? argAfter("--vandon") : "sang";
            for (const m of (markets || SHIPMENT_MARKETS)) {
                if (!SHIPMENT_MARKETS.includes(m)) { log(`Bỏ ${m}: chưa theo dõi vận đơn.`); continue; }
                if (!groupOf(m)) { log(`Bỏ ${m}: chưa có nhóm.`); continue; }
                await sendShipmentDigest(m, kind);
                log(`${DRY ? "In thử" : "Đã gửi"} tin vận đơn ${m} (${kind}).`);
            }
        } else if (ARGS.includes("--moc")) {
            // --moc 13:00: gửi ngay tin của một mốc giữa ngày (khuôn trưa/chiều/tối), số hôm nay.
            const slotTime = /^\d{1,2}:\d{2}$/.test(argAfter("--moc")) ? argAfter("--moc") : (INTRADAY_SLOTS[0] || "13:00");
            const todayStr = vnDateStr();
            for (const m of (markets || MARKET_CODES)) {
                if (!groupOf(m)) { log(`Bỏ ${m}: chưa có nhóm.`); continue; }
                const r = await sendReport(m, todayStr, { homNay: true, label: slotLabel(slotTime), theoDoi: `${slotTime}:${m}:${todayStr}`, kieu: slotKind(slotTime), moc: slotTime, nho: false });
                log(`${DRY ? "In thử" : "Đã gửi"} mốc ${slotTime}: ${r.ghiChu}.`);
            }
        } else if (command) {
            if (!(await runCommand(command, "dòng lệnh", null))) log(`"${command}" không phải lệnh của bot.`);
        } else {
            const date = /^\d{4}-\d{2}-\d{2}$/.test(argAfter("--report")) ? argAfter("--report") : dayBefore(vnDateStr());
            for (const m of (markets || MARKET_CODES)) {
                if (!groupOf(m)) { log(`Bỏ ${m}: chưa có nhóm.`); continue; }
                const r = await sendReport(m, date, { theoDoi: `report:${m}:${date}` });
                log(`${DRY ? "In thử" : "Đã gửi"} báo cáo ${m} ngày ${date}: ${r.ghiChu}.`
                    + (r.chuaDu ? " SỐ CHƯA ĐỦ — bot dịch vụ sẽ tự gửi tin đính chính khi sync đủ số." : ""));
            }
        }
        return true;
    }
    await runService();
    return false;
}

function start() {
    return main()
        .then((oneShot) => { if (oneShot) setTimeout(() => process.exit(0), 1000); })
        .catch((e) => { log("LỖI:", e.message); process.exit(1); });
}

module.exports = { start };
