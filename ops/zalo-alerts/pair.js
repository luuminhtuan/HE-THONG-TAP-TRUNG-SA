// Ghép nick Zalo PHỤ cho bot — chạy TRÊN MÁY CHỦ, trong thư mục này:
//   node pair.js                   đăng nhập bằng QR → lưu phiên → in danh sách nhóm
//   node pair.js --groups          dùng phiên đã lưu, in lại danh sách nhóm
//   node pair.js --tu-nhan         chọn nhóm của MỖI NƯỚC theo tên "ADS + VẬN ĐƠN <nước>"
//                                  (TAIWAN · SGP · UAE · JAPAN) → zalo_group_nuoc_<mã>.json
//   node pair.js --chon-nuoc <id nhóm> --nuoc TW   chọn tay nhóm của một nước
//
// Từ 08/10/2026 (Sỹ Anh chốt) MỖI NƯỚC MỘT NHÓM, ads + vận đơn chung nhóm. Nhóm cũ (BÁO CÁO
// ADS gộp các nước, VẬN ĐƠN TW/SGP/UAE) bỏ — --chon / --chon-vandon cũ đã xoá. Bot dịch vụ cũng
// tự nhận nhóm theo tên lúc khởi động nếu nước nào chưa có file — lệnh dưới để chạy tay/soát.
//
// Ghép TRÊN MÁY CHỦ chứ không ghép ở máy Mac rồi chép phiên lên: phiên sinh ra ở IP nào
// thì dùng ở IP đó, Zalo ít hỏi lại. QR ghi ra qr.png — hết hạn sau ~100 giây, tự làm mã
// mới tối đa 5 lần. Nick phụ phải NẰM SẴN trong nhóm đích.
// Ghép lại khi bot đang chạy: xong thì `pm2 restart talpha-zalo-alerts` để bot nạp phiên mới.
const fs = require("fs");
const path = require("path");
const { LoginQRCallbackEventType: E } = require("zca-js");
const { SESSION_FILE, createZalo, writePrivateFile, saveSession, login, listGroups, saveMarketGroup } = require("./zalo");
const CFG = require("./config");
const { primeMarketOverrides } = require("./market_config");
// rules.js đọc luật đồng bộ lúc được require — nạp SAU primeMarketOverrides() (cuối file), để nước thêm
// trên /admin → Thị trường cũng có nhóm của nó.
let MARKETS, pickGroupsByName;

const QR_FILE = path.join(__dirname, "qr.png");
const GROUPS_FILE = path.join(__dirname, "groups.txt");
const MAX_QR_ATTEMPTS = 5;
const log = (...a) => console.log(new Date().toISOString(), ...a);
let MARKET_CODES = [];

function argAfter(flag) {
    const i = process.argv.indexOf(flag);
    const v = i >= 0 ? process.argv[i + 1] : "";
    return v && !v.startsWith("--") ? v : "";
}

async function pairByQr() {
    let attempts = 0, displayName = "";
    const api = await createZalo().loginQR({ qrPath: QR_FILE }, async (ev) => {
        switch (ev.type) {
            case E.QRCodeGenerated:
                attempts++;
                await ev.actions.saveToFile(QR_FILE);
                log(`QR_READY lần ${attempts}/${MAX_QR_ATTEMPTS}: ${QR_FILE} — mở app Zalo của NICK PHỤ → quét mã (còn ~100 giây)`);
                break;
            case E.QRCodeExpired:
                if (attempts >= MAX_QR_ATTEMPTS) { log(`QR hết hạn ${attempts} lần — dừng. Sẵn sàng quét thì chạy lại.`); ev.actions.abort(); }
                else { log("QR hết hạn — làm mã mới"); ev.actions.retry(); }
                break;
            case E.QRCodeScanned:
                displayName = ev.data.display_name || "";
                log(`ĐÃ QUÉT bởi "${displayName}" — bấm XÁC NHẬN đăng nhập trên điện thoại`);
                break;
            case E.QRCodeDeclined:
                log("Điện thoại đã TỪ CHỐI đăng nhập — dừng.");
                ev.actions.abort();
                break;
            case E.GotLoginInfo:
                // Ghi phiên NGAY lúc có, chưa đợi đăng nhập xong: bước sau hỏng thì vẫn không phải quét lại.
                writePrivateFile(SESSION_FILE, { ...ev.data, language: "vi", name: displayName, savedAt: new Date().toISOString() });
                log("Đã lưu phiên vào .zalo_session.json (quyền 600).");
                break;
        }
    });
    saveSession(api, { name: displayName });
    try { fs.unlinkSync(QR_FILE); } catch {}
    return api;
}

async function printGroups(api) {
    const groups = await listGroups(api);
    const lines = groups.map((g) => `${g.id}\t${g.members ?? "?"} người\t${g.name}`);
    fs.writeFileSync(GROUPS_FILE, lines.join("\n") + "\n");
    log(`Nick này đang ở ${groups.length} nhóm (id · số người · tên):`);
    for (const d of lines) console.log("   " + d);
    return groups;
}

async function autoAssignGroups(api) {
    const { chon: picked, trung: ambiguous, thieu: missing } = pickGroupsByName(await listGroups(api), MARKET_CODES);
    for (const [m, g] of Object.entries(picked)) {
        const file = saveMarketGroup(m, g, "tu-nhan");
        log(`${m} ${MARKETS[m] ? MARKETS[m].flag : ""} → "${g.name}" (${g.members ?? "?"} người) → ${path.basename(file)}`);
    }
    for (const [m, xs] of Object.entries(ambiguous)) {
        log(`${m}: ${xs.length} nhóm cùng tên kiểu "ADS + VẬN ĐƠN" — KHÔNG tự chọn: ${xs.map((g) => `"${g.name}" (${g.id})`).join(", ")}. Chọn tay: node pair.js --chon-nuoc <id> --nuoc ${m}`);
    }
    for (const m of missing) log(`${m}: nick phụ không ở nhóm nào tên "ADS + VẬN ĐƠN ${MARKETS[m] ? MARKETS[m].ten.toUpperCase() : m}" — thêm nick vào nhóm rồi chạy lại.`);
    log("Bot đang chạy thì: pm2 restart talpha-zalo-alerts");
}

async function main() {
    const manualGroupId = argAfter("--chon-nuoc");
    if (manualGroupId) {
        const marketCode = argAfter("--nuoc").toUpperCase();
        if (!MARKET_CODES.includes(marketCode)) throw new Error(`thiếu/sai --nuoc (${MARKET_CODES.join(", ")})`);
        const api = await login();
        const g = (await listGroups(api)).find((x) => x.id === manualGroupId);
        if (!g) throw new Error(`nick phụ không ở nhóm id ${manualGroupId} — chạy \`node pair.js --groups\` xem lại`);
        const file = saveMarketGroup(marketCode, g, "chon-tay");
        log(`Đã chọn nhóm ADS + VẬN ĐƠN ${marketCode}: "${g.name}" (${g.members ?? "?"} người) → ${path.basename(file)}`);
        log("Bot đang chạy thì: pm2 restart talpha-zalo-alerts");
        return;
    }
    if (process.argv.includes("--tu-nhan")) {
        await autoAssignGroups(await login());
        return;
    }
    if (process.argv.includes("--groups")) {
        await printGroups(await login());
        return;
    }
    const api = await pairByQr();
    log("GHÉP XONG.");
    await printGroups(api);
    log("Chọn nhóm từng nước: node pair.js --tu-nhan");
}

primeMarketOverrides()
    .then(() => {
        ({ MARKETS, pickGroupsByName } = require("./rules"));
        MARKET_CODES = ((CFG.nhomNuoc || {}).markets || Object.keys(MARKETS)).map((x) => String(x).toUpperCase());
        return main();
    })
    .then(() => process.exit(0)).catch((e) => { log("LỖI:", e.message); process.exit(1); });
