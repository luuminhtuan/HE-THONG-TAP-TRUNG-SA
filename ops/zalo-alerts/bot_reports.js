// Dựng + gửi từng loại tin của bot.js (tách 16/11/2026): tin ads một nước, tin mỗi giờ, tin vận
// đơn, tin đính chính.
const { buildMarketReport, buildCorrectionMessage } = require("./daily_report");
const { dayBefore } = require("./commands");
const { buildShipmentMorning, buildShipmentEvening, fetchShipments, recordNudges } = require("./shipment_alerts");
const { correctionAction, correctionDeadline } = require("./schedule");
const { MARKETS } = require("./rules");
const { buildHourlyDigest, messFromPancake } = require("./hourly_digest");
const {
    DRY, DR, SHIPMENT_CFG, CORRECTION_DEADLINE_HOURS, log, ddmm, MESS_PANCAKE,
    loadState, markState, vnDateStr, vnHHMM, inQuietHours, formatHHMM, slotLabel, slotNumbersKey,
} = require("./bot_config");
const { fetchStale, readMonthlyReport, getRealtime, fetchPancakeMarket } = require("./bot_sources");
const { enqueue, sendBatch, groupOf } = require("./bot_session");

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
        // So với CÙNG MỐC hôm qua (số bot đã báo lúc đó, trạng thái bot → soMoc). Chưa có thì
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

// ─── Vận đơn ───
// Sỹ Anh duyệt mẫu 26/09/2026: 08:30 SÁNG (hôm qua + khách phải gọi/nhắn, đủ chi tiết từng
// khách) và 22:00 TỐI (hôm nay làm được gì). Từ 08/10/2026 gửi vào nhóm "ADS + VẬN ĐƠN" của
// nước đó. Mỗi nước một mốc riêng — nước này hỏng không kéo nước kia.
// Tin sáng lưu danh sách khách phải gọi/nhắn vào trạng thái bot để tin tối chấm "đã lấy chưa".

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
// Ghi vào trạng thái bot (bảng zalo_bot_state) nên pm2 restart / máy chủ reboot giữa lúc chờ vẫn không mất lịch.
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

module.exports = { buildReport, sendReport, buildHourly, sendHourly, buildShipmentDigest, sendShipmentDigest, queueCorrection, checkCorrections };
