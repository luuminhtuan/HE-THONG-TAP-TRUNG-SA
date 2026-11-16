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
//   (Sỹ Anh chốt 22/09/2026). Lịch chờ nằm trong state.json → restart không mất.
// Nguồn số: data/bao_cao_nuoc/<tháng>.json (format_all.py ghi cùng lúc file TỔNG TEAM),
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
// ═══════════════════════════════════════════════════════════════════
const fs = require("fs");
const path = require("path");
const CFG = require("./config");
const { buildMarketReport, buildCorrectionMessage, buildMarketAlert } = require("./daily_report");
const { parseCommand, marketHelpMessage, dayBefore } = require("./commands");
const { buildShipmentMorning, buildShipmentEvening, fetchShipments, recordNudges } = require("./van_don");
const { slotAction, toMin, correctionAction, correctionDeadline } = require("./schedule");
const { toZalo, splitMessage } = require("./zalo_text");
const { MARKETERS, DISPLAY, MARKETS, pickGroupsByName, pageOfCampaign, campaignMarket } = require("./rules");
const { buildHourlyDigest, messFromPancake } = require("./tin_gio");
const { fetchOverridesFingerprint, vanTayDaNap: getLoadedFingerprint } = require("./thi_truong");

const DIR = __dirname;
const STATE_FILE = path.join(DIR, "state.json");
const ARGS = process.argv.slice(2);
const DRY = ARGS.includes("--dry-run");
const DR = CFG.dailyReport || {};
const SHIPMENT_CFG = CFG.vanDon || {};
const CORRECTION_DEADLINE_HOURS = Number(DR.dinhChinhHanGio) > 0 ? Number(DR.dinhChinhHanGio) : 24;   // hạn chờ đính chính
const MARKETER_LIST = Object.keys(MARKETERS).map((key) => ({ key, ten: DISPLAY[key] }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);
const ddmm = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : String(d || ""));

// Nước còn chạy: nước đã tắt (talpha_rules.json → status "da_tat", 04/11/2026) bị lọc khỏi MỌI lịch
// gửi dưới đây, kể cả khi config.json còn ghi tên nó — tắt nước chỉ cần sửa một chỗ.
const isActiveMarket = (m) => !!MARKETS[m] && !MARKETS[m].daTat;
// Nước có nhóm "ADS + VẬN ĐƠN" — thứ tự gửi trong một mốc.
const MARKET_CODES = ((CFG.nhomNuoc || {}).markets || Object.keys(MARKETS)).map((x) => String(x).toUpperCase()).filter(isActiveMarket);
// Nước có theo dõi vận đơn (Nhật chưa có).
const SHIPMENT_MARKETS = (Array.isArray(SHIPMENT_CFG.markets) && SHIPMENT_CFG.markets.length ? SHIPMENT_CFG.markets : ["TW"]).map((x) => String(x).toUpperCase()).filter(isActiveMarket);
// Nước Meta không báo số tin nhắn (Nhật): bản tin ads lấy mess từ Pancake (09/10/2026).
const MESS_PANCAKE = (((CFG.nhomNuoc || {}).messPancake) || []).map((x) => String(x).toUpperCase());
// Tin MỖI GIỜ (ads + tin nhắn Pancake + đơn theo page) — Sỹ Anh yêu cầu 09/10/2026 cho Nhật.
const HOURLY_CFG = CFG.moiGio || {};
const HOURLY_MARKETS = (HOURLY_CFG.markets || []).map((x) => String(x).toUpperCase()).filter(isActiveMarket);
// UAE không qua 17TRACK: đơn POS + tra thẳng trang WeShip (Sỹ Anh chốt 28/09/2026).
const SHIPMENT_SOURCES = { AE: "đơn POS + tra trang WeShip" };

function argAfter(flag) {
    const i = ARGS.indexOf(flag);
    const v = i >= 0 ? ARGS[i + 1] : "";
    return v && !v.startsWith("--") ? v : "";
}

// ─── State: ghi MỘT thay đổi nhỏ, đọc lại file ngay trước khi ghi ───
// Các vòng rà ôm state qua nhiều await mạng; ai ghi sau mà dùng bản cũ là xoá khoá của
// vòng kia — mốc đã gửi bị quên và vòng sau bắn lại tin thứ hai vào nhóm.
function loadState() {
    try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return {}; }
}
function markState(mut) {
    const st = loadState();
    mut(st);
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 2)); }
    catch (e) { log("Lỗi ghi state:", e.message); }
    return st;
}

// ─── Giờ Việt Nam. hourCycle h23 BẮT BUỘC: hour12:false trả "24" lúc nửa đêm, báo cáo 8h
// của bot WhatsApp từng bắn lúc 0h05 vì đúng chuyện này. ───
const vnDateStr = () => new Date().toLocaleDateString("sv-SE", { timeZone: CFG.timezone });   // YYYY-MM-DD
const vnHHMM = () => new Date().toLocaleString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: CFG.timezone });
function inQuietHours() {
    const h = toMin(vnHHMM()) / 60;
    const { quietStartHour: a, quietEndHour: b } = CFG;
    if (a == null || b == null || a === b) return false;
    return a < b ? (h >= a && h < b) : (h >= a || h < b);   // qua nửa đêm
}

const DAILY_AT = /^\d{1,2}:\d{2}$/.test(String(DR.at || "")) ? DR.at : "08:30";
const SHIPMENT_AT = /^\d{1,2}:\d{2}$/.test(String(SHIPMENT_CFG.at || "")) ? SHIPMENT_CFG.at : "";   // trống = không tự gửi tin vận đơn sáng
const SHIPMENT_EVENING_AT = /^\d{1,2}:\d{2}$/.test(String(SHIPMENT_CFG.toiAt || "")) ? SHIPMENT_CFG.toiAt : "";   // trống = không gửi tin tối
const formatHHMM = (ts) => new Date(ts).toLocaleString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: CFG.timezone });
const INTRADAY_SLOTS = (DR.intradaySlots || []).map((x) => String(x).trim()).filter((x) => /^\d{1,2}:\d{2}$/.test(x));
const slotLabel = (hhmm) => { const t = vnDateStr(); return `HÔM NAY ${t.slice(8, 10)}/${t.slice(5, 7)} · ${hhmm}`; };

// Tuổi của số trong Sheet (/api/talpha/sync-health). Hỏng thì null → tin gửi không kèm
// cảnh báo: thà thiếu cảnh báo còn hơn chặn mất báo cáo.
async function fetchStale() {
    if (!CFG.syncHealthUrl) return null;
    try {
        const res = await fetch(CFG.syncHealthUrl, { headers: { "cache-control": "no-store" } });
        if (!res.ok) return null;
        const j = await res.json();
        const okAge = j.last_ok_age_minutes == null ? null : Number(j.last_ok_age_minutes);
        if (!Number.isFinite(okAge)) return null;
        // loi = tên TKQC/shop đọc lỗi trong vòng sync gần nhất → tin "SỐ CHƯA ĐỦ" nói đích danh.
        return { okAge, limit: Number(DR.staleWarnMinutes || 120), lastOkTs: Date.now() - okAge * 60000, loi: j.fetch_errors || null };
    } catch (e) { log("Đọc tuổi sync lỗi:", e.message); return null; }
}

// Bảng số theo nước × người của một tháng — format_all.py ghi mỗi giờ vào bảng
// market_monthly_reports (15/11/2026, trước đó file data/bao_cao_nuoc); bot hỏi qua dashboard mỗi lần.
async function readMonthlyReport(month) {
    try {
        const r = await fetch(`${CFG.dashboardBaseUrl}/api/talpha/market-report?month=${encodeURIComponent(month)}`,
            { signal: AbortSignal.timeout(30_000) });
        return r.ok ? await r.json() : null;
    } catch (e) {
        log("Đọc bản số theo nước lỗi:", e.message);
        return null;
    }
}

// /api/talpha/realtime hỏi thẳng Meta + POS live (chậm, có rate-limit): bốn nước của CÙNG một
// mốc dùng chung một lượt gọi. Giữ 3 phút; lượt hỏng thì bỏ khỏi bộ nhớ để lần sau gọi lại.
const REALTIME_CACHE_MS = 3 * 60 * 1000;
const realtimeCache = new Map();
function getRealtime(dateStr) {
    const hit = realtimeCache.get(dateStr);
    if (hit && Date.now() - hit.at < REALTIME_CACHE_MS) return hit.p;
    const p = (async () => {
        const res = await fetch(`${DR.realtimeUrl}?from_date=${dateStr}&to_date=${dateStr}`, { headers: { "cache-control": "no-store" } });
        if (!res.ok) throw new Error(`realtime HTTP ${res.status}`);
        return res.json();
    })();
    realtimeCache.set(dateStr, { at: Date.now(), p });
    p.catch(() => { if (realtimeCache.get(dateStr) && realtimeCache.get(dateStr).p === p) realtimeCache.delete(dateStr); });
    return p;
}

// Tin nhắn Pancake + đơn POS theo page của một nước một ngày (/api/talpha/pancake-messages). camps:
// campaign Meta cùng ngày — gửi kèm tên page của camp nước đó (camp tạo hôm nay chưa kịp sync).
async function fetchPancakeMarket(m, date, camps) {
    if (!HOURLY_CFG.url) throw new Error("thiếu moiGio.url trong config");
    const pages = [...new Set((camps || [])
        .filter((c) => campaignMarket(c.campaign_name).market === MARKETS[m].key)
        .map((c) => pageOfCampaign(c.campaign_name)).filter(Boolean))];
    const q = new URLSearchParams({ market: m, date: date, ...(pages.length ? { trang: pages.join("|") } : {}) });
    const res = await fetch(`${HOURLY_CFG.url}?${q}`, { headers: { "cache-control": "no-store" } });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) throw new Error(j.error || `pancake-messages HTTP ${res.status}`);
    return j;
}

// ─── Kết nối + gửi ───
// Đăng nhập lười: chỉ khi có tin cần gửi. Gửi hỏng thì bỏ phiên trong bộ nhớ, đăng nhập lại
// một lần rồi gửi lại — phiên web của Zalo hay rớt khi Zalo đổi máy chủ.
let zalo = null;           // require("./zalo") muộn: --dry-run chạy được cả khi chưa cài zca-js
let api = null;
let marketGroups = {};         // mã nước → nhóm "ADS + VẬN ĐƠN <nước>"; thiếu = không gửi gì cho nước đó
let serviceMode = false;        // chạy dịch vụ thì mỗi lần đăng nhập đều bật lại bộ nhận lệnh

async function connect() {
    if (!zalo) zalo = require("./zalo");
    if (!api) {
        api = await zalo.login();
        log("Đã đăng nhập Zalo.");
        if (serviceMode) startListener(api);
    }
    return api;
}

async function sendOne(text, group) {
    if (DRY) {
        const parts = splitMessage(toZalo(text), CFG.maxChars || 1800);
        parts.forEach((p, i) => {
            const boldParts = p.styles.filter((s) => s.st === "b").map((s) => p.msg.slice(s.start, s.start + s.len));
            console.log(`\n──── tin${group ? ` → "${group.name}"` : ""}${parts.length > 1 ? ` (phần ${i + 1}/${parts.length})` : ""} · ${p.msg.length} ký tự ────\n${p.msg}`);
            if (boldParts.length) console.log(`   [chữ đậm: ${boldParts.join(" | ")}]`);
        });
        return parts.length;
    }
    if (!group) throw new Error("chưa có nhóm nhận tin — chạy `node pair.js --tu-nhan`");
    const opts = { maxChars: CFG.maxChars, sendGapMs: CFG.sendGapMs };
    // ketNoi() TRƯỚC rồi mới đọc zalo.guiNhom: viết gộp `zalo.guiNhom(await ketNoi(), …)`
    // thì JS đọc zalo.guiNhom trước khi ketNoi() kịp nạp module.
    let a = await connect();
    try {
        return await zalo.sendToGroup(a, group.id, text, opts);
    } catch (e) {
        log("Gửi lỗi, đăng nhập lại rồi thử một lần nữa:", e.message);
        api = null;
        a = await connect();
        return zalo.sendToGroup(a, group.id, text, opts);
    }
}

// Mọi lần gửi xếp MỘT hàng: hai người gõ lệnh cùng lúc, hay lệnh rơi đúng lúc tin 8h30
// đang gửi, thì loạt sau đợi loạt trước — không xen tin của hai loạt vào nhau.
let sendQueue = Promise.resolve();
function enqueue(fn) {
    const p = sendQueue.then(fn);
    sendQueue = p.catch(() => {});
    return p;
}

/** Gửi lần lượt. Trả số tin đã gửi được; hỏng giữa chừng thì dừng và ném lỗi kèm số đó. */
async function sendBatch(texts, group) {
    let sentCount = 0;
    for (const t of texts.filter(Boolean)) {
        if (sentCount > 0 && !DRY) await sleep(CFG.sendGapMs || 4000);
        try { await sendOne(t, group); }
        catch (e) { e.daGui = sentCount; throw e; }
        sentCount++;
    }
    return sentCount;
}

// Nhóm của nước m; dry-run không cần nhóm thật (chỉ in) — đặt tên giả để dòng in ghi rõ nước.
const groupOf = (m) => marketGroups[m] || (DRY ? { id: "", name: `ADS + VẬN ĐƠN ${m} (in thử)` } : null);

// Mốc giữa ngày → kiểu tin: trước 16h là TRƯA, trước 20h là CHIỀU, còn lại TỐI.
const slotKind = (hhmm) => (toMin(hhmm) < 16 * 60 ? "trua" : toMin(hhmm) < 20 * 60 ? "chieu" : "toi");
// Khoá số đã báo của một mốc một nước (state.soMoc) — để mai cùng giờ so ▲▼.
const slotNumbersKey = (m, slotTime) => `${m}|${slotTime}`;

// kieu: "sang" (08:30, kết quả hôm qua) · "trua" / "chieu" (13:00 / 18:00) · "toi" (22:00,
//       kết quả hôm nay) · "" (gõ tay / đính chính).
async function buildReport(m, date, isToday, label, knownStale, kind = "", slotTime = "") {
    const n = MARKETS[m];
    const stale = knownStale === undefined ? await fetchStale() : knownStale;
    const nowTime = vnHHMM(), today = vnDateStr();
    const marketTitle = `${n.flag} ${n.ten.toUpperCase()}`;
    let title, sourceLine, extra = {};
    if (kind === "sang") {
        title = `☀️ ADS ${marketTitle} · SÁNG ${ddmm(today)} · KẾT QUẢ ${ddmm(date)}`;
        sourceLine = "Số chốt từ vòng ghi file TỔNG TEAM" + (stale && stale.lastOkTs ? ` · sync ${formatHHMM(stale.lastOkTs)} ✓` : "");
    } else if (kind === "trua" || kind === "chieu") {
        title = `${kind === "trua" ? "🌤 ADS" : "🌇 ADS"} ${marketTitle} · ${kind === "trua" ? "TRƯA" : "CHIỀU"} ${ddmm(date)} · KẾT QUẢ TỚI ${slotTime || nowTime}`;
        sourceLine = "Số đang chạy" + (stale && stale.lastOkTs ? ` · sync ${formatHHMM(stale.lastOkTs)} ✓` : "")
            + " · ngày chưa chốt, còn lên tiếp";
        // So với CÙNG MỐC hôm qua (số bot đã báo lúc đó, state.json → soMoc). Chưa có thì
        // không ▲▼ — so 13:00 với cả ngày hôm qua thì chữ nào cũng ▼ nửa, báo động giả.
        const previous = (loadState().soMoc || {})[slotNumbersKey(m, slotTime)];
        extra = { khongSoCaNgay: true, soCungGio: previous && previous.ngay === dayBefore(date) ? { so: previous.so, nhan: `${slotTime} hôm qua` } : null };
    } else if (kind === "toi") {
        title = `🌙 ADS ${marketTitle} · TỐI ${ddmm(date)} · KẾT QUẢ HÔM NAY`;
        sourceLine = `Số tới ${nowTime} · ngày chưa chốt, còn lên nhẹ`;
    } else if (isToday) {
        title = `📊 ADS ${marketTitle} · HÔM NAY ${ddmm(date)} · ${nowTime}`;
        sourceLine = "Số đang chạy, chưa chốt ngày";
    } else {
        title = `📊 ADS ${marketTitle} · ${ddmm(date)}`;
        sourceLine = "Số từ vòng ghi file TỔNG TEAM";
    }
    // Nhật: Meta không báo tin nhắn → số mess lấy từ Pancake. Lỗi thì giữ số Meta và nói rõ.
    if (MESS_PANCAKE.includes(m)) {
        try {
            const rt = await getRealtime(date);
            const mt = messFromPancake(await fetchPancakeMarket(m, date, rt.campaigns), rt.campaigns);
            if (mt) { extra.messThay = mt; sourceLine += " · tin nhắn đếm từ Pancake"; }
            else sourceLine += " · ⚠️ chưa đếm được tin nhắn Pancake";
        } catch (e) { log(`Pancake ${m} lỗi — tin dùng số mess Meta:`, e.message); sourceLine += " · ⚠️ chưa đếm được tin nhắn Pancake"; }
    }
    return buildMarketReport(DR, date, {
        nuoc: m, docBan: readMonthlyReport, layRealtime: getRealtime, intraday: isToday, label: label || (isToday ? slotLabel(nowTime) : undefined),
        stale, log, tieuDe: title, nguon: sourceLine, ...extra,
    });
}

// MỘT tin ads cho một nước (Sỹ Anh chốt 16/09/2026: một tin, không phải sáu).
// theoDoi: khoá xếp lịch ĐÍNH CHÍNH. Chỉ mốc tự gửi và `--report` truyền vào — lệnh /baocao gõ
// trong nhóm là người ta HỎI số lúc này, không sinh tin đính chính.
// nho: mốc tự gửi đúng giờ mới nhớ số (gửi tay `--moc 13:00` lúc 15h thì số 15h không được
// thành "số 13:00 hôm qua" của ngày mai).
function sendReport(m, date, { homNay: isToday = false, label, theoDoi: trackKey, kieu: kind = "", moc: slotTime = "", nho: remember = true } = {}) {
    const group = groupOf(m);
    if (!group) return Promise.reject(new Error(`chưa có nhóm ADS + VẬN ĐƠN ${m} — chạy \`node pair.js --tu-nhan\``));
    return enqueue(async () => {
        const r = await buildReport(m, date, isToday, label, undefined, kind, slotTime);
        const n = await sendBatch([r.tinGop], group);
        if (slotTime && isToday && remember && !DRY) {
            // Mốc giữa ngày mới đã ra thì đính chính của mốc giữa ngày TRƯỚC cùng ngày, CÙNG NƯỚC,
            // thành thừa: tin mới nhất (vừa gửi) mới là tin người ta đang đọc.
            markState((s) => {
                for (const [k, p] of Object.entries(s.dinhChinh || {})) if (p && p.intraday && p.ngay === date && p.nuoc === m) delete s.dinhChinh[k];
            });
            // Nhớ số đã báo mốc này để mai cùng giờ so ▲▼. Số chưa đủ thì không nhớ — so với
            // số thiếu là ▲ giả.
            if (!r.chuaDu) markState((s) => { (s.soMoc = s.soMoc || {})[slotNumbersKey(m, slotTime)] = { ngay: date, so: r.so }; });
        }
        if (trackKey && r.chuaDu && !DRY) queueCorrection(trackKey, r, date, isToday, m);
        return { n, ghiChu: `tin ads ${m} (${n} tin, ${r.nguoi.length} người trong bảng)`, chuaDu: r.chuaDu };
    });
}

// ─── Tin MỖI GIỜ (Nhật, 09/10/2026) ───
// Ads Meta trực tiếp + tin nhắn Pancake + đơn POS, theo page. Nhớ tổng lần trước (state.gioTruoc)
// để in "(+N) thêm trong giờ qua". Meta hay Pancake hỏng thì tin vẫn đi, ghi rõ phần thiếu.
async function buildHourly(m) {
    const date = vnDateStr();
    let camps = [], campError = "";
    try { camps = (await getRealtime(date)).campaigns || []; } catch (e) { campError = e.message; }
    let pk = null;
    try { pk = await fetchPancakeMarket(m, date, camps); } catch (e) { log(`pancake-messages ${m} lỗi:`, e.message); }
    if (!pk && campError) throw new Error(`Meta: ${campError} · Pancake/đơn cũng lỗi`);
    return buildHourlyDigest({ n: MARKETS[m], ngay: date, gio: vnHHMM(), pk, camps, loiCamp: campError,
        truoc: ((loadState().gioTruoc || {})[m]) || null });
}

function sendHourly(m, remember = true) {
    const group = groupOf(m);
    if (!group) return Promise.reject(new Error(`chưa có nhóm ADS + VẬN ĐƠN ${m}`));
    return enqueue(async () => {
        const r = await buildHourly(m);
        const n = await sendBatch([r.text], group);
        if (remember && !DRY) markState((s) => { (s.gioTruoc = s.gioTruoc || {})[m] = { ngay: vnDateStr(), tong: r.tong }; });
        return { n, ghiChu: `tin mỗi giờ ${m} (${r.tong.mess} mess, ${r.tong.don} đơn)` };
    });
}

// Các mốc mỗi giờ của hôm nay: HH:<phut> từ `tu` tới `den`, bỏ giờ đã có bản tin thường.
function hourlySlots() {
    const minute = String(Number.isFinite(Number(HOURLY_CFG.phut)) ? Number(HOURLY_CFG.phut) : 5).padStart(2, "0");
    const reportHours = new Set(INTRADAY_SLOTS.map((x) => x.split(":")[0].padStart(2, "0")));
    const out = [];
    for (let h = Number(HOURLY_CFG.tu ?? 7); h <= Number(HOURLY_CFG.den ?? 23); h++) {
        const hh = String(h).padStart(2, "0");
        if (HOURLY_CFG.boGioCoBanTin !== false && reportHours.has(hh)) continue;
        out.push(`${hh}:${minute}`);
    }
    return out;
}

// ─── Vận đơn ───
// Sỹ Anh duyệt mẫu 26/09/2026: 08:30 SÁNG (hôm qua + khách phải gọi/nhắn, đủ chi tiết từng
// khách) và 22:00 TỐI (hôm nay làm được gì). Từ 08/10/2026 gửi vào nhóm "ADS + VẬN ĐƠN" của
// nước đó. Mỗi nước một mốc riêng — nước này hỏng không kéo nước kia.
// Tin sáng lưu danh sách khách phải gọi/nhắn vào state.json để tin tối chấm "đã lấy chưa".

// kieu: "sang" · "toi" · "" (gõ /vandon trong ngày — khuôn tin sáng, đề giờ lúc gõ).
async function buildShipmentDigest(m, kind) {
    const today = vnDateStr();
    const d = await fetchShipments(SHIPMENT_CFG, today, fetch, m);
    const base = { today, maxGoi: SHIPMENT_CFG.maxGap, maxMoiToi: SHIPMENT_CFG.maxMoiToi, quotaWarn: SHIPMENT_CFG.quotaWarn, phuTrach: SHIPMENT_CFG.phuTrach,
        // Sổ nhắc: khách Đài đã được nhắn những ngày nào — để nhắc lại khách chưa lấy (30/09/2026).
        soNhac: (loadState().vanDonNhac || {})[m] || {} };
    if (kind === "toi") {
        const morningState = (loadState().vanDonSang || {})[m];
        return { text: buildShipmentEvening(d, { ...base, sangNay: morningState && morningState.ngay === today ? morningState : null }) };
    }
    const title = kind === "sang" ? undefined : `📦 VẬN ĐƠN ${MARKETS[m].ten.toUpperCase()} · ${vnHHMM()} ${ddmm(today)}`;
    return buildShipmentMorning(d, { ...base, tieuDe: title });
}

function sendShipmentDigest(m, kind = "sang") {
    const group = groupOf(m);
    if (!group) return Promise.reject(new Error(`chưa có nhóm ADS + VẬN ĐƠN ${m} — chạy \`node pair.js --tu-nhan\``));
    return enqueue(async () => {
        const r = await buildShipmentDigest(m, kind);
        const n = await sendBatch([r.text], group);
        if (kind === "sang" && !DRY) {
            const todayStr = vnDateStr();
            markState((s) => {
                (s.vanDonSang = s.vanDonSang || {})[m] = { ngay: todayStr, goi: r.goi || [], moiToi: r.moiToi || [], nhacLai: r.nhacLai || [], sapGiao: r.sapGiao || [] };
                // Chỉ ghi sổ sau khi GỬI THẬT: khách có câu soạn sẵn trong tin sáng nay = đã nhắn thêm một lần.
                (s.vanDonNhac = s.vanDonNhac || {})[m] = recordNudges(s.vanDonNhac[m], r.daNhan, todayStr);
            });
        }
        return { n, ghiChu: `tin vận đơn ${m} ${kind || "gõ tay"} (${n} tin)` };
    });
}

// ─── Gửi TẠM đúng khung giờ, có số đủ thì tự ĐÍNH CHÍNH ───
// Sỹ Anh chốt 22/09/2026. Tin tạm vẫn gửi (giữ khung giờ), bot NHỚ số đã báo; vòng rà sau
// thấy sync đã chạy đủ số thì gửi thêm một tin nói rõ lệch bao nhiêu — vào đúng nhóm nước đó.
// Ghi vào state.json nên pm2 restart / máy chủ reboot giữa lúc chờ vẫn không mất lịch.
function queueCorrection(entryKey, r, date, isToday, m) {
    const pending = { ngay: date, nuoc: m, intraday: !!isToday, label: r.label, luc: Date.now(), so: r.so };
    pending.hanTs = correctionDeadline(pending, CORRECTION_DEADLINE_HOURS);
    markState((s) => { (s.dinhChinh = s.dinhChinh || {})[entryKey] = pending; });
    log(`Tin ${m} "${r.label}" gửi khi số CHƯA ĐỦ — chờ vòng sync đủ số để đính chính (hạn ${new Date(pending.hanTs).toISOString()}).`);
}

// goiTay: chạy `--dinh-chinh` — người gọi đã chọn gửi lúc này nên giờ yên không chặn (Sỹ Anh
// 11/10/2026: tin 22:00 SỐ CHƯA ĐỦ, sync đủ lúc 23:22 — chờ tới 7h thì tin giữa ngày đã hết hạn).
// chiNuoc: chỉ đính chính nước đó. Dry-run chỉ IN, không xoá lịch chờ.
async function checkCorrections({ goiTay: manual = false, chiNuoc: onlyMarket = null } = {}) {
    const allPending = loadState().dinhChinh || {};
    const pendingKeys = Object.keys(allPending).filter((k) => !onlyMarket || (allPending[k] && allPending[k].nuoc === onlyMarket));
    if (!pendingKeys.length) { if (manual) log("Không có tin nào đang chờ đính chính."); return; }   // không hỏi sync-health
    const stale = await fetchStale();
    for (const k of pendingKeys) {
        const p = allPending[k];
        const dropPending = () => { if (!DRY) markState((s) => { if (s.dinhChinh) delete s.dinhChinh[k]; }); };
        const group = p && groupOf(p.nuoc);
        // Lịch chờ của tin gộp cũ (trước 08/10/2026, không gắn nước) — nhóm đó đã bỏ.
        if (!p || !MARKETS[p.nuoc] || !group) { dropPending(); log(`Bỏ chờ đính chính "${k}" — không có nhóm nước để gửi.`); continue; }
        const act = correctionAction(p, stale);
        if (!act) { if (manual) log(`${p.nuoc} "${p.label}": sync chưa có vòng đủ số nào sau tin cũ — chưa đính chính được.`); continue; }
        if (act === "het-han") { dropPending(); log(`Bỏ chờ đính chính ${p.nuoc} "${p.label}" — quá hạn mà số vẫn chưa đủ.`); continue; }
        if (!manual && inQuietHours()) return;      // 23h–7h: không đánh thức nhóm, vòng sau gửi
        try {
            await enqueue(async () => {
                const r = await buildReport(p.nuoc, p.ngay, p.intraday, p.label, stale);
                await sendBatch([buildCorrectionMessage({
                    tin: r.tinGop, soCu: p.so, soMoi: r.so, label: `${MARKETS[p.nuoc].flag} ${p.label}`, luc: p.luc, intraday: p.intraday,
                })], group);
            });
            dropPending();
            log(`${DRY ? "In thử" : "Đã gửi"} đính chính ${p.nuoc} "${p.label}".`);
        } catch (e) {
            if (e.daGui > 0) { dropPending(); log(`Đính chính ${p.nuoc} "${p.label}" gửi được một phần — không gửi lại:`, e.message); }
            else log(`Đính chính ${p.nuoc} "${p.label}" lỗi — vòng sau thử lại:`, e.message);
        }
    }
}

// ─── Lệnh trong nhóm ───
const lastCommandAt = new Map();     // chữ lệnh → lúc nhận; cùng lệnh trong 60 giây thì bỏ (bấm gửi hai lần)

const helpMessage = (m) => marketHelpMessage({
    nuoc: MARKETS[m], at: DAILY_AT, mocAds: INTRADAY_SLOTS.join(" · "), nguoi: MARKETER_LIST,
    moiGio: HOURLY_MARKETS.includes(m) ? hourlySlots() : null,
    vanDon: SHIPMENT_MARKETS.includes(m) ? { at: SHIPMENT_AT, toi: SHIPMENT_EVENING_AT, nguon: SHIPMENT_SOURCES[m] } : null,
});

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

// Chỉ nghe ĐÚNG các nhóm nước. Nick phụ còn ở các nhóm COD có người của đối tác, và ở nhóm cũ
// (BÁO CÁO ADS, VẬN ĐƠN …) — gõ /baocao ở đó bot im, không lộ số ra ngoài.
function handleMessage(msg) {
    if (!zalo || msg.type !== zalo.ThreadType.Group) return;
    const m = Object.keys(marketGroups).find((x) => marketGroups[x] && marketGroups[x].id === msg.threadId) || null;
    if (!m) return;
    const text = typeof msg.data.content === "string" ? msg.data.content : "";
    if (!text.trim().startsWith("/")) return;
    runCommand(text, msg.data.dName || msg.data.uidFrom, m).catch((e) => log("Lỗi xử lý lệnh:", e.message));
}

// Bộ nhận lệnh gắn với MỘT phiên đăng nhập. Đăng nhập lại là thay bộ mới. Bộ nghe bị Zalo
// đóng hẳn (thường do mở Zalo Web/PC bằng nick phụ) thì đợi rồi đăng nhập lại, đợi dài dần
// để không giành phiên qua lại với người đang dùng Zalo Web.
const RETRY_INITIAL_MS = 10 * 60 * 1000, RETRY_MAX_MS = 2 * 60 * 60 * 1000;
let listener = null;
let retryDelay = RETRY_INITIAL_MS;

function startListener(a) {
    const previous = listener;
    listener = null;
    if (previous) { try { previous.stop(); } catch { /* bộ cũ đã chết */ } }
    const latest = zalo.startListening(a, {
        onMessage: handleMessage,
        log,
        onClosed: (l, code, reason) => {
            if (l !== listener) return;                     // bộ cũ vừa bị thay — không phải sự cố
            listener = null;
            api = null;
            const delay = retryDelay;
            retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
            log(`Bộ nhận lệnh bị đóng (mã ${code}${reason ? ", " + reason : ""}) — thường do mở Zalo Web/PC bằng nick phụ. Đăng nhập lại sau ${Math.round(delay / 60000)}'.`);
            setTimeout(() => { if (!api) connect().catch((e) => log("Đăng nhập lại lỗi:", e.message)); }, delay);
        },
    });
    latest.on("connected", () => { retryDelay = RETRY_INITIAL_MS; });
    listener = latest;
}

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
    const marketsWithGroup = MARKET_CODES.filter((m) => marketGroups[m]);
    for (const m of marketsWithGroup) {
        await runSlot(`ads:${m}:sang`, DAILY_AT, Number(DR.atCatchUpMinutes || 210),
            () => sendReport(m, yesterday, { theoDoi: `sang:${m}:${yesterday}`, kieu: "sang" }));
    }
    // Vận đơn: dashboard lỗi thì vòng 5' sau thử lại, quá catchUpMinutes thì bỏ hôm đó. Khoá
    // "vandon:<nước>" giữ như trước 08/10/2026 — hôm đổi nhóm không gửi lại tin đã gửi sáng nay.
    for (const m of SHIPMENT_MARKETS.filter((x) => marketGroups[x])) {
        if (SHIPMENT_AT) await runSlot(`vandon:${m}`, SHIPMENT_AT, Number(SHIPMENT_CFG.catchUpMinutes || 180), () => sendShipmentDigest(m, "sang"));
    }
    for (const slot of INTRADAY_SLOTS) {
        const todayStr = vnDateStr();
        for (const m of marketsWithGroup) {
            await runSlot(`ads:${m}:${slot}`, slot, Number(DR.intradayCatchUpMinutes || 60),
                () => sendReport(m, todayStr, { homNay: true, label: slotLabel(slot), theoDoi: `${slot}:${m}:${todayStr}`, kieu: slotKind(slot), moc: slot }));
        }
    }
    for (const m of SHIPMENT_MARKETS.filter((x) => marketGroups[x])) {
        if (SHIPMENT_EVENING_AT) await runSlot(`vandon_toi:${m}`, SHIPMENT_EVENING_AT, Number(SHIPMENT_CFG.toiCatchUpMinutes || 60), () => sendShipmentDigest(m, "toi"));
    }
    // Tin mỗi giờ: trễ quá catchUpMinutes thì bỏ giờ đó (bot vừa bật lại lúc 15:20 không bắn
    // lại 7 giờ đã qua — slotAction trả "skip" cho các giờ cũ). Mốc 23:05 rơi vào giờ yên
    // (23h–7h) nên đêm 09/10 và 10/10/2026 đều bị chặn tới quá cửa sổ rồi bỏ → quaGioYen.
    for (const m of HOURLY_MARKETS.filter((x) => marketGroups[x])) {
        for (const slotTime of hourlySlots()) await runSlot(`gio:${m}:${slotTime}`, slotTime, Number(HOURLY_CFG.catchUpMinutes || 40), () => sendHourly(m), { quaGioYen: true });
    }
}

async function keepSessionAlive() {
    if (!api) return;
    try { await api.keepAlive(); zalo.saveSession(api); }
    catch (e) { log("keepAlive lỗi — lần gửi tới sẽ đăng nhập lại:", e.message); api = null; }
}

async function introduceNewGroups() {
    for (const m of MARKET_CODES) {
        const group = marketGroups[m];
        if (!group || (loadState().gioiThieu || {})[group.id]) continue;
        await enqueue(() => sendOne(helpMessage(m), group));
        markState((s) => { (s.gioiThieu = s.gioiThieu || {})[group.id] = new Date().toISOString(); });
        log(`Đã gửi tin giới thiệu vào nhóm "${group.name}".`);
    }
}

function loadGroups() {
    marketGroups = Object.fromEntries(MARKET_CODES.map((m) => [m, zalo.readMarketGroup(m)]).filter(([, g]) => g));
}

// Nước chưa có file nhóm → tìm trong các nhóm nick phụ đang ở, theo đúng mẫu tên "ADS + VẬN ĐƠN
// <nước>" (rules.nuocTuTenNhom). Một nước khớp hai nhóm trở lên thì KHÔNG đoán.
async function autoAssignGroups() {
    const missing = MARKET_CODES.filter((m) => !marketGroups[m]);
    if (!missing.length) return;
    let allGroups;
    try { allGroups = await zalo.listGroups(await connect()); }
    catch (e) { log("Không đọc được danh sách nhóm để tự nhận:", e.message); return; }
    const { chon: picked, trung: ambiguous, thieu: stillMissing } = pickGroupsByName(allGroups, missing);
    for (const [m, g] of Object.entries(picked)) {
        zalo.saveMarketGroup(m, g, "tu-nhan");
        log(`Tự nhận nhóm ${m}: "${g.name}" (${g.id}).`);
    }
    for (const [m, xs] of Object.entries(ambiguous)) log(`${m}: ${xs.length} nhóm cùng mẫu tên — không tự chọn (${xs.map((g) => g.id).join(", ")}). Chọn tay: node pair.js --chon-nuoc <id> --nuoc ${m}`);
    for (const m of stillMissing) log(`${m}: nick phụ chưa ở nhóm "ADS + VẬN ĐƠN ${MARKETS[m].ten.toUpperCase()}" — chưa gửi gì cho ${m}.`);
    loadGroups();
}

async function runService() {
    serviceMode = true;
    log(`Dashboard base: ${CFG.dashboardBaseUrl}${process.env.TALPHA_DASHBOARD_URL ? " (env TALPHA_DASHBOARD_URL)" : ""}`);
    zalo = require("./zalo");
    // Đăng nhập hỏng / chưa ghép: KHÔNG thoát — pm2 sẽ khởi động lại liên tục và che mất lỗi
    // thật. Đứng chờ, 10' thử lại một lần.
    for (;;) {
        loadGroups();
        try { await connect(); await autoAssignGroups(); }
        catch (e) { log("Đăng nhập Zalo lỗi:", e.message); }
        if (api && Object.keys(marketGroups).length) break;
        if (api) log("Chưa có nhóm nước nào — thêm nick phụ vào nhóm \"ADS + VẬN ĐƠN <nước>\" rồi đợi, hoặc chạy `node pair.js --tu-nhan`.");
        await sleep(10 * 60 * 1000);
    }
    for (const m of MARKET_CODES) {
        const g = marketGroups[m];
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
            if (MARKET_CODES.some((m) => !marketGroups[m])) { await autoAssignGroups(); await introduceNewGroups(); }
            await checkSlots(); await checkCorrections();
        }
        catch (e) { log("Vòng rà lỗi:", e.message); }
        finally { scanning = false; }
    };
    await tick();
    setInterval(tick, 5 * 60 * 1000);
    setInterval(keepSessionAlive, 60 * 60 * 1000);

    // Thị trường nhập ở /admin → Thị trường đổi (thêm, sửa, tắt nước): luật nạp lúc khởi động đã cũ.
    // Thoát lúc KHÔNG đang gửi để pm2 dựng lại bot với luật mới (04/11/2026, xem thi_truong.js).
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
        if (!DRY) { zalo = require("./zalo"); loadGroups(); }
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

main()
    .then((oneShot) => { if (oneShot) setTimeout(() => process.exit(0), 1000); })
    .catch((e) => { log("LỖI:", e.message); process.exit(1); });
