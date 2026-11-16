// node shipment_alerts.test.js   (không gọi mạng, không cần cài zca-js)
// Số liệu dưới đây là số DỰNG cho test, không phải đơn thật.
const assert = require("assert");
const { buildShipmentMorning, buildShipmentEvening, fetchShipments, recordNudges, priorNudges, pickupCode, dayEvents, twCustomerMessage } = require("./shipment_alerts");
const { toZalo, splitMessage } = require("./zalo_text");

let ok = 0;
const t = async (name, fn) => {
    try { await fn(); ok++; }
    catch (e) { console.error(`✗ ${name}`); throw e; }
};
const plainText = (s) => toZalo(s).msg;

const NOW = Date.parse("2026-09-26T01:30:00Z");          // 08:30 giờ VN
const TODAY = "2026-09-26";
const ASSIGNEE = { ten: "Thương", uid: "3346668495041864321" };
// Mốc trong ngày VN: "2026-09-25 10:00 VN" = 03:00Z.
const vnIso = (date, time = "10:00") => new Date(Date.parse(`${date}T${time}:00+07:00`)).toISOString();

const shipment = (o = {}) => ({
    tracking: "18024614", track17_code: "73N18024614", order_id: "T1466", customer: "Ghen", phone: "0975475359",
    store_name: "全家新城康樂店", store_code: "026205", cod_local: 1499, status: "AvailableForPickup",
    status_since: vnIso("2026-09-20"), source: "17track", ...o,
});
const alert = (code, o = {}, s = {}) => ({ level: "gap", code, title: "", detail: "", days: 3, ...o, shipment: shipment(s) });
const DATA = (o = {}) => ({
    market: { code: "TW", label: "Đài Loan", currency: "NT$" },
    has_api_key: true,
    last_sync: { at: "2026-09-25T23:05:00Z", ok: true, quota: { total: 600, used: 385, remain: 215 } },
    last_import: "2026-09-25T23:01:00Z",
    counts: { AvailableForPickup: 49 },
    totals: { at_store_value: 49711 },
    shipments: [],
    alerts: [],
    ...o,
});
const morning = (d, o = {}) => buildShipmentMorning(d, { today: TODAY, nowTs: NOW, phuTrach: ASSIGNEE, ...o });

(async () => {
    // ── SÁNG · Đài Loan ──
    await t("đầu tin: tên nước, giờ 17TRACK, quota; hôm qua đếm theo ngày VN", () => {
        const shipments = [
            shipment({ tracking: "A", status: "Delivered", status_since: vnIso("2026-09-25"), cod_local: 999 }),
            shipment({ tracking: "B", status: "Delivered", status_since: vnIso("2026-09-25", "23:30"), cod_local: 1000 }),
            shipment({ tracking: "C", status: "Delivered", status_since: vnIso("2026-09-24"), cod_local: 5000 }),   // hôm kia
            shipment({ tracking: "D", status: "AvailableForPickup", status_since: vnIso("2026-09-25") }),
            shipment({ tracking: "E", status: "Exception", sub_status: "Exception_Returning", status_since: vnIso("2026-09-25"), cod_local: 799 }),
        ];
        const m = plainText(morning(DATA({ shipments })).text);
        const lines = m.split("\n");
        assert.strictEqual(lines[0], "☀️ VẬN ĐƠN ĐÀI LOAN · SÁNG 26/09");
        assert.strictEqual(lines[1], "17TRACK 06:05 ✓ · quota còn 215/600");
        assert.ok(m.includes("📊 HÔM QUA 25/09\n✅ Khách đã lấy 2 đơn · 1.999 NT$"), m);
        assert.ok(m.includes("🏪 Mới tới cửa hàng 1 · ↩️ Bắt đầu hoàn 1 · 799 NT$"), m);
        assert.ok(m.includes("📦 Đang nằm cửa hàng 49 đơn · 49.711 NT$"));
    });

    await t("khách phải gọi: đủ mã · tiền · hạn, tên SĐT, cửa hàng + mã lấy hàng, tin tiếng Trung soạn sẵn", () => {
        const r = morning(DATA({ alerts: [
            alert("sap_bi_tra_ve", { days_left: 2 }, { order_id: "CON2", tracking: "K2" }),
            alert("sap_bi_tra_ve", { days_left: 0 }, { order_id: "T1577", tracking: "K0", customer: "Ana", phone: "0912345359", store_name: "觀月", store_code: "211114", cod_local: 1399 }),
        ] }));
        const m = plainText(r.text);
        assert.ok(m.includes("☎️ @Thương · GỌI 2 KHÁCH SẮP BỊ TRẢ VỀ"), m);
        // Mã lấy hàng = mã TRACKING (73N bỏ đi), không phải mã cửa hàng 211114. Hàng tới từ
        // 20/09 (trước hôm qua) → đã được nhắn lúc mới tới → câu NHẮC LẠI, gấp hơn.
        assert.ok(m.includes("1. T1577 · 1.399 NT$ · HẾT HẠN HÔM NAY · đã nhắn lúc mới tới\n👤 Ana · 0912345359\n🏪 觀月 · mã lấy hàng 18024614\n"
            + "💬 Hi Ana, this is another reminder: your parcel has been waiting at 觀月 (pickup code 18024614) for 3 days and hasn't been picked up yet! "
            + "Today is the LAST DAY to pick it up — if it's not collected today, it will be returned. Please make sure to pick it up today! "
            + "If you have any questions, just reply to this message. Thank you!\n"
            + "🇻🇳 Dịch: Chào Ana, nhắc bạn lần nữa: hàng của bạn đã nằm ở cửa hàng 觀月 (mã lấy hàng 18024614) 3 ngày rồi mà vẫn chưa được lấy! "
            + "Hôm nay là NGÀY CUỐI để lấy hàng — hôm nay không lấy là hàng bị trả về. Bạn nhớ ghé lấy ngay trong hôm nay nhé! "
            + "Có gì thắc mắc bạn cứ nhắn lại cho shop nhé. Cảm ơn bạn!"), m);
        assert.ok(!/NT\$\d|prepare|chuẩn bị tiền|請準備/.test(m.split("\n").filter((l) => /^(💬|🇻🇳)/.test(l)).join("\n")),
            "câu gửi khách KHÔNG nhắc chuẩn bị tiền (Sỹ Anh 01/10/2026)");
        assert.ok(!m.includes("211114"), "mã cửa hàng không được ghi là mã lấy hàng");
        assert.ok(m.includes("2. CON2 · 1.499 NT$ · còn 2 ngày · đã nhắn lúc mới tới"), "hạn THẬT vẫn báo cho Thương ở dòng đầu");
        assert.ok(!m.includes("天內領取"), "tin gửi khách KHÔNG ghi còn mấy ngày");
        assert.ok(m.includes("The store will only keep it for a few more days"), "còn 2 ngày: nhắc lại nói sắp bị trả, không nói số ngày còn");
        assert.deepStrictEqual(r.goi, ["K0", "K2"], "bot lưu đúng khoá, đúng thứ tự gọi");
    });

    await t("@Thương là NHẮC TÊN thật: điện thoại Thương báo", () => {
        const z = toZalo(morning(DATA({ alerts: [alert("sap_bi_tra_ve", { days_left: 1 })] })).text);
        const m = z.mentions.find((x) => z.msg.slice(x.pos, x.pos + x.len) === "@Thương");
        assert.ok(m, "phải có mention @Thương");
        assert.strictEqual(m.uid, "3346668495041864321");
    });

    await t("khách MỚI TỚI: hàng tới hôm qua/hôm nay, câu nhẹ nhàng nói tới mấy ngày; tới trước đó → NHẮC LẠI", () => {
        const r = morning(DATA({ alerts: [
            alert("toi_cua_hang", { level: "nhac", days: 1, days_left: 6 }, { order_id: "T1701", tracking: "M1", status_since: vnIso("2026-09-25"), customer: "Maria", phone: "0905123118", store_name: "全家台南金華店", store_code: "024301", cod_local: 999 }),
            alert("toi_cua_hang", { level: "nhac", days: 4, days_left: 3 }, { order_id: "CU", tracking: "M2", status_since: vnIso("2026-09-22") }),
        ] }));
        const m = plainText(r.text);
        assert.ok(m.includes("📬 @Thương · NHẮN 1 KHÁCH HÀNG MỚI TỚI"), m);
        assert.ok(m.includes("T1701 · 999 NT$ · còn 6 ngày\n👤 Maria · 0905123118 · 🏪 全家台南金華店 · mã lấy hàng 18024614\n"
            + "💬 Hi Maria, your parcel arrived at 全家台南金華店 (pickup code 18024614) 1 day ago. "
            + "Please drop by the store to pick it up when you can — if it's not picked up in time, it will be returned. Thank you!\n"
            + "🇻🇳 Dịch: Chào Maria, hàng của bạn đã tới cửa hàng 全家台南金華店 (mã lấy hàng 18024614) được 1 ngày rồi. "
            + "Phiền bạn tranh thủ ghé cửa hàng lấy nhé, quá hạn hàng sẽ bị trả về. Cảm ơn bạn!"), m);
        assert.ok(m.includes("🔁 @Thương · NHẮC LẠI 1 KHÁCH ĐÃ NHẮN MÀ CHƯA LẤY"), "tới từ 22/09 mà chưa lấy → nhắc lại");
        assert.ok(m.includes("CU · 1.499 NT$ · tới 4 ngày · đã nhắn lúc mới tới"), m);
        assert.ok(m.includes("Hi Ghen, this is another reminder: your parcel has been waiting at 全家新城康樂店 (pickup code 18024614) for 4 days"), m);
        assert.deepStrictEqual(r.moiToi, ["M1"]);
        assert.deepStrictEqual(r.nhacLai, ["M2"]);
        assert.deepStrictEqual(r.daNhan.sort(), ["M1", "M2"], "cả hai khách có câu soạn sẵn → ghi sổ");
    });

    await t("không có khách phải gọi thì nói rõ", () => {
        const m = plainText(morning(DATA()).text);
        assert.ok(m.includes("☎️ Không có khách nào phải gọi gấp hôm nay ✅"), m);
    });

    await t("hỏi đối tác + kiểm đơn lệch: mỗi loại một dòng mã", () => {
        const m = plainText(morning(DATA({ alerts: [
            alert("sap_bi_tra_ve", { days_left: -1 }, { order_id: "Q1" }),
            alert("sap_bi_tra_ve", { days_left: -20 }, { order_id: "Q20" }),
            alert("giao_hong", { level: "canh_bao" }, { order_id: "H1", status: "Exception", sub_status: "Exception_Other" }),
            alert("giao_hong", { level: "canh_bao" }, { order_id: "HOAN", status: "Exception", sub_status: "Exception_Returning" }),
            alert("dung_im", { level: "canh_bao", days: 21 }, { order_id: "T1579" }),
            alert("dung_im", { level: "canh_bao", days: 9 }, { order_id: "T1750", track17_code: null }),
            alert("lech_trang_thai", { level: "canh_bao", detail: "Đối tác ghi ĐÃ GIAO, 17TRACK ghi hàng đang/đã HOÀN — tiền COD có thể không về." }, { order_id: "T1652" }),
        ] })).text);
        assert.ok(m.includes("🔎 HỎI ĐỐI TÁC\n• 2 đơn quá hạn còn giữ không: Q1 (1n) · Q20 (20n)"), m);
        assert.ok(m.includes("• 1 đơn giao hỏng/sự cố: H1 (sự cố)"), m);
        assert.ok(!m.includes("HOAN"), "hàng đang hoàn không cần hỏi");
        assert.ok(m.includes("• 1 đơn không nhúc nhích: T1579 (21n)"));
        assert.ok(m.includes("• 1 đơn chưa gửi hàng: T1750 (9n)"));
        assert.ok(m.includes("💰 KIỂM 1 ĐƠN LỆCH trước đối soát COD\n• T1652: Đối tác ghi ĐÃ GIAO, 17TRACK ghi hàng đang/đã HOÀN"), m);
    });

    await t("17TRACK lỗi / hết quota → cảnh báo ngay dưới đầu tin", () => {
        const failedSync = plainText(morning(DATA({ last_sync: { at: "2026-09-25T23:05:00Z", ok: false, error: "sai khoá" } })).text);
        assert.ok(failedSync.includes("⚠️ 17TRACK lỗi 06:05 26/09: sai khoá"), failedSync);
        const quotaOut = plainText(morning(DATA({ last_sync: { at: "2026-09-25T23:05:00Z", ok: true, quota_out: true, over_cap: 7, quota: { total: 600, remain: 0 } } })).text);
        assert.ok(quotaOut.includes("⚠️ HẾT QUOTA 17TRACK — 7 đơn chưa được theo dõi: thêm khoá mới hoặc chờ ngày 1"), quotaOut);
    });

    await t("/vandon gõ tay: cùng khuôn, đổi dòng đầu", () => {
        const m = plainText(morning(DATA(), { tieuDe: "📦 VẬN ĐƠN ĐÀI LOAN · 14:05 26/09" }).text);
        assert.strictEqual(m.split("\n")[0], "📦 VẬN ĐƠN ĐÀI LOAN · 14:05 26/09");
    });

    await t("ngày đông khách: tin tự chia, mỗi phần ≤ 1800 ký tự Zalo", () => {
        const alerts = Array.from({ length: 15 }, (_, i) => alert("sap_bi_tra_ve", { days_left: 1 }, { order_id: `X${i}`, tracking: `K${i}` }));
        const parts = splitMessage(toZalo(morning(DATA({ alerts })).text), 1800);
        assert.ok(parts.length >= 2 && parts.every((p) => p.msg.length <= 1800));
    });

    // ── SÁNG · Singapore ──
    const SG = (o = {}) => DATA({ market: { code: "SG", label: "Singapore", currency: "SGD" },
        counts: { InTransit: 30, InfoReceived: 7, OutForDelivery: 1 }, totals: { at_store_value: 0 }, ...o });
    await t("SG: tiêu đề nước, hôm qua giao thành công, đang đi giao / trên đường", () => {
        const m = plainText(morning(SG({ shipments: [shipment({ status: "Delivered", status_since: vnIso("2026-09-25"), cod_local: 99 })] })).text);
        assert.ok(m.startsWith("☀️ VẬN ĐƠN SINGAPORE · SÁNG 26/09"), m);
        assert.ok(m.includes("✅ Giao thành công 1 đơn · 99 SGD"), m);
        assert.ok(m.includes("🚚 Đang đi giao 1 đơn · 📦 Đang trên đường 37 đơn"), m);
        assert.ok(!m.includes("cửa hàng"));
    });
    await t("SG: gọi = giao hỏng / hẹn lại, kèm khu vực, ghi chú đối tác, tin tiếng Anh", () => {
        const r = morning(SG({ alerts: [
            alert("giao_hong", { level: "canh_bao" }, { order_id: "S1011", tracking: "JT2026092201", track17_code: "JT2026092201",
                customer: "Joy", phone: "81234567", city: "Tampines", store_name: "", store_code: "", cod_local: 69,
                source: "doi_tac", status: "DeliveryFailure", raw_status: "Khách hẹn lúc khác giao", note: "Giao lại vào 28" }),
            alert("giao_hong", { level: "canh_bao" }, { order_id: "S1013", status: "Exception", sub_status: "Exception_Returning" }),
        ] }));
        const m = plainText(r.text);
        assert.ok(m.includes("☎️ @Thương · GỌI 1 KHÁCH GIAO HỎNG / HẸN LẠI"), m);
        // TH2 (Sỹ Anh 01/10/2026): bảo khách xem cuộc gọi nhỡ / SMS của shipper, chủ động liên hệ lại.
        assert.ok(m.includes("1. S1011 · 69 SGD · khách hẹn giao lại\n👤 Joy · 81234567 · Tampines\n📝 Đối tác ghi: \"Giao lại vào 28\"\n"
            + "💬 Hi Joy, J&T tried to deliver your parcel (JT2026092201) but couldn't reach you. Please check your phone for any missed calls or SMS "
            + "from the J&T driver and contact them directly to arrange a new delivery time. If you need help, just reply to us. Thank you!\n"
            + "🇻🇳 Dịch: Chào Joy, J&T đã tới giao hàng (JT2026092201) nhưng không gặp được bạn. Bạn kiểm tra lại điện thoại xem có cuộc gọi nhỡ"), m);
        assert.ok(!m.includes("S1013"), "hàng đang hoàn không lên danh sách gọi");
        assert.ok(!m.includes("📬"), "Singapore không có mục khách mới tới cửa hàng");
        assert.deepStrictEqual(r.goi, ["JT2026092201"]);
        assert.deepStrictEqual(r.daNhan, ["JT2026092201"], "khách giao hỏng đã có câu → ghi sổ để lần sau nhắc gấp hơn");
    });

    await t("SG: giao hỏng mà đã nhắn hôm trước (sổ) hoặc hỏng ≥ 2 lần → câu nhắc lại gấp hơn", () => {
        const failedAlert = (o) => alert("giao_hong", { level: "canh_bao" }, { store_name: "", source: "17track", status: "DeliveryFailure", sub_status: "DeliveryFailure_Other", ...o });
        const r = morning(SG({ alerts: [
            failedAlert({ order_id: "S1039", tracking: "JT1", track17_code: "JT1", customer: "Ann" }),
            failedAlert({ order_id: "S1044", tracking: "JT2", track17_code: "JT2", customer: "Ben", fail_count: 3 }),
            failedAlert({ order_id: "S1050", tracking: "JT3", track17_code: "JT3", customer: "Cat" }),
        ] }), { soNhac: { JT1: { lan: 1, dau: "2026-09-25", cuoi: "2026-09-25" } } });
        const m = plainText(r.text);
        assert.ok(m.includes("S1039 · 1.499 SGD · giao hỏng · đã nhắn 1 lần"), m);
        assert.ok(m.includes("Hi Ann, this is another reminder: J&T still hasn't been able to deliver your parcel (JT1)!"), m);
        assert.ok(m.includes("Hi Ben, this is another reminder: J&T has tried to deliver your parcel (JT2) 3 times and still couldn't reach you!"), m);
        assert.ok(m.includes("🇻🇳 Dịch: Chào Ben, shop nhắc bạn lần nữa: J&T đã giao hàng (JT2) 3 lần mà vẫn không gặp được bạn!"), m);
        assert.ok(m.includes("Hi Cat, J&T tried to deliver your parcel (JT3) but couldn't reach you."), "lần đầu vẫn giọng thường");
    });

    await t("SG: BÁO TRƯỚC khách sắp nhận hàng — đi giao hôm nay / đã vào J&T, mỗi mốc một lần, bỏ đơn cũ", () => {
        const sg = (o) => shipment({ store_name: "", source: "17track", status: "InTransit", last_event_time: vnIso("2026-09-25"), ...o });
        const sh = [
            sg({ order_id: "S1066", tracking: "JT10", track17_code: "JT10", customer: "Dan", phone: "81112222", city: "Jurong" }),
            sg({ order_id: "S1067", tracking: "JT11", track17_code: "JT11", customer: "Eve", status: "OutForDelivery", last_event_time: vnIso(TODAY, "07:00") }),
            sg({ order_id: "S1068", tracking: "JT12", source: "doi_tac" }),
            sg({ order_id: "S1069", tracking: "JT13" }),
            sg({ order_id: "S1070", tracking: "JT14", last_event_time: vnIso("2026-09-20") }),
            sg({ order_id: "S1071", tracking: "JT15", track17_code: "JT15", customer: "Fay", status: "OutForDelivery" }),
        ];
        const r = morning(SG({ shipments: sh }), { soNhac: { "SapGiao:JT13": { lan: 1, dau: "2026-09-25", cuoi: "2026-09-25" } } });
        const m = plainText(r.text);
        assert.ok(m.includes("🚚 @Thương · BÁO TRƯỚC 3 KHÁCH SẮP NHẬN HÀNG — nhắn khách mở máy, để ý điện thoại"), m);
        assert.ok(m.includes("S1067 · 1.499 SGD · GIAO HÔM NAY\n👤 Eve · 0975475359\n💬 Hi Eve, your parcel (JT11) is out for delivery with J&T today!"), "đi giao HÔM NAY lên đầu");
        assert.ok(m.includes("S1066 · 1.499 SGD · đã vào J&T, sắp giao\n👤 Dan · 81112222 · Jurong\n"
            + "💬 Hi Dan, your parcel (JT10) is now with J&T and will be delivered soon (usually within 1–2 days). Please keep your phone on"), m);
        assert.ok(m.includes("🇻🇳 Dịch (giao hôm nay): Chào {tên}, hàng của bạn ({mã}) sẽ được J&T giao trong hôm nay!"), m);
        assert.ok(m.includes("🇻🇳 Dịch (sắp giao): Chào {tên}, hàng của bạn ({mã}) đã tới J&T và sắp được giao (thường trong 1–2 ngày)."), m);
        assert.strictEqual((m.match(/🇻🇳/g) || []).length, 2, "dịch MỘT lần mỗi loại, không dịch từng khách");
        assert.ok(m.includes("S1071 · 1.499 SGD · đã vào J&T, sắp giao"), "đi giao từ HÔM QUA thì không nói 'hôm nay' — báo chung sắp giao");
        assert.ok(!m.includes("S1068"), "'đang vận chuyển' của bảng đối tác có thể còn ở chặng Trung Quốc — không báo");
        assert.ok(!m.includes("S1069"), "mốc đã báo hôm trước — không báo lại");
        assert.ok(!m.includes("S1070"), "sự kiện cũ quá 2 ngày — đơn đứng im, không báo trước");
        assert.deepStrictEqual(r.sapGiao, ["JT11", "JT10", "JT15"]);
        assert.deepStrictEqual(r.daNhan, ["HomNay:JT11", "SapGiao:JT10", "SapGiao:JT15"], "ghi sổ theo khoá mốc");
        assert.ok(!plainText(morning(DATA({ shipments: sh })).text).includes("BÁO TRƯỚC"), "Đài không có mục này");
    });

    await t("SG tối: chấm khách báo trước sáng nay đã nhận chưa", () => {
        const d = SG({ shipments: [shipment({ tracking: "JT10", status: "Delivered", cod_local: 69 }), shipment({ tracking: "JT11", status: "OutForDelivery" })] });
        const m = plainText(buildShipmentEvening(d, { today: TODAY, nowTs: Date.parse("2026-09-26T15:00:00Z"), sangNay: { goi: [], moiToi: [], sapGiao: ["JT10", "JT11"] } }));
        assert.ok(m.includes("🚚 2 KHÁCH BÁO TRƯỚC SÁNG NAY → 1 đã nhận (69 SGD) · 1 chưa"), m);
    });

    // ── SÁNG · Nhật Bản (Japan Post qua 17TRACK, 21/10/2026) ──
    const JP = (o = {}) => DATA({ market: { code: "JP", label: "Nhật Bản", currency: "JPY" },
        counts: { InTransit: 20, InfoReceived: 13 }, totals: { at_store_value: 0 }, ...o });
    await t("JP: tiêu đề nước, giao hỏng → câu Japan Post + phiếu báo vắng nhà, không có mục cửa hàng", () => {
        const failedAlert = (o) => alert("giao_hong", { level: "canh_bao" }, { store_name: "", store_code: "", source: "17track",
            status: "DeliveryFailure", sub_status: "DeliveryFailure_Other", cod_local: 8999, ...o });
        const r = morning(JP({ alerts: [
            failedAlert({ order_id: "J1000", tracking: "256500702942", track17_code: "256500702942", customer: "Sato", phone: "08033162030", city: "" }),
            failedAlert({ order_id: "J1001", tracking: "256500726322", track17_code: "256500726322", customer: "Kaye", fail_count: 2 }),
        ] }), { soNhac: { 256500726322: { lan: 1, dau: "2026-09-25", cuoi: "2026-09-25" } } });
        const m = plainText(r.text);
        assert.ok(m.startsWith("☀️ VẬN ĐƠN NHẬT BẢN · SÁNG 26/09"), m);
        assert.ok(m.includes("1. J1000 · 8.999 JPY · giao hỏng\n👤 Sato · 08033162030\n"
            + "💬 Hi Sato, Japan Post tried to deliver your parcel (256500702942) but you weren't home. Please check your mailbox for the missed-delivery notice (不在連絡票)"), m);
        assert.ok(m.includes("🇻🇳 Dịch: Chào Sato, Japan Post đã tới giao hàng (256500702942) nhưng bạn không có nhà."), m);
        assert.ok(m.includes("Hi Kaye, this is another reminder: Japan Post has tried to deliver your parcel (256500726322) 2 times and still couldn't reach you!"), m);
        assert.ok(m.includes("Japan Post only keeps the parcel for about a week"), m);
        assert.ok(!m.includes("J&T"), "Nhật không được nói J&T");
        assert.ok(!m.includes("📬"), "Nhật giao tận nhà — không có mục khách mới tới cửa hàng");
        assert.deepStrictEqual(r.goi, ["256500702942", "256500726322"]);
    });
    await t("JP: BÁO TRƯỚC khách sắp nhận — nói Japan Post; 'đang vận chuyển' của bảng đối tác thì không báo", () => {
        const jp = (o) => shipment({ store_name: "", source: "17track", status: "InTransit", last_event_time: vnIso("2026-09-25"), ...o });
        const r = morning(JP({ shipments: [
            jp({ order_id: "J1002", tracking: "256500700001", track17_code: "256500700001", customer: "Mae", status: "OutForDelivery", last_event_time: vnIso(TODAY, "07:00") }),
            jp({ order_id: "J1003", tracking: "256500700002", track17_code: "256500700002", customer: "Lyn" }),
            jp({ order_id: "J1004", tracking: "256500700003", source: "doi_tac" }),
        ] }));
        const m = plainText(r.text);
        assert.ok(m.includes("J1002 · 1.499 JPY · GIAO HÔM NAY"), m);
        assert.ok(m.includes("💬 Hi Mae, your parcel (256500700001) is out for delivery with Japan Post today!"), m);
        assert.ok(m.includes("J1003 · 1.499 JPY · đã vào Japan Post, sắp giao"), m);
        assert.ok(m.includes("🇻🇳 Dịch (sắp giao): Chào {tên}, hàng của bạn ({mã}) đã tới Japan Post và sắp được giao"), m);
        assert.ok(!m.includes("J1004"), "bảng đối tác ghi đang vận chuyển — có thể còn ở chặng gửi từ Đài sang");
    });

    await t("JP: 17TRACK từ chối đăng ký mọi mã Sagawa → không ghi '17TRACK ✓', nói rõ đang theo bảng đối tác", () => {
        const ls = { at: "2026-09-25T23:05:00Z", ok: true, registered: 0, register_rejected: 33, quota: { total: 600, used: 479, remain: 121 } };
        const m = plainText(morning(JP({ last_sync: ls, shipments: [shipment({ store_name: "", status: "InfoReceived", source: "doi_tac", registered: false })] })).text);
        assert.ok(m.includes("theo bảng đối tác, trễ ~2 ngày"), m);
        assert.ok(!m.includes("17TRACK 06:05 ✓"), m);
        assert.ok(m.includes("⚠️ 17TRACK từ chối đăng ký 33 mã (hãng tạm chưa hỗ trợ qua API) — trạng thái theo bảng đối tác"), m);
        const sg = plainText(morning(SG({ last_sync: ls, shipments: [shipment({ registered: true })] })).text);
        assert.ok(!sg.includes("từ chối đăng ký"), "nước có mã đã đăng ký thì không kêu");
    });

    // ── SÁNG · UAE (WeShip, 28/09/2026) ──
    const AE = (o = {}) => DATA({ market: { code: "AE", label: "UAE", currency: "AED" }, provider: "weship",
        last_sync: { at: "2026-09-25T23:03:00Z", ok: true, provider: "weship", targets: 27, checked: 27, failed: 0 },
        last_import: null, counts: { InTransit: 4, InfoReceived: 13, OutForDelivery: 1 }, totals: { at_store_value: 0 }, ...o });
    const uae = (o) => shipment({ tracking: "VS1068045", track17_code: "VS1068045", order_id: "12", customer: "Maria", phone: "0501234567",
        city: "Dubai", store_name: "", store_code: "", cod_local: 159, source: "weship", status: "DeliveryFailure", ...o });
    await t("UAE: nguồn ghi WeShip (không quota), tiêu đề nước", () => {
        const m = plainText(morning(AE()).text);
        const lines = m.split("\n");
        assert.strictEqual(lines[0], "☀️ VẬN ĐƠN UAE · SÁNG 26/09");
        assert.strictEqual(lines[1], "WeShip 06:03 ✓");
        assert.ok(!m.includes("17TRACK"), m);
    });
    await t("UAE: gọi khách từ chối / không nghe máy / hẹn lại — lý do, số lần, ghi chú đơn, tin tiếng Anh theo lý do", () => {
        const r = morning(AE({ alerts: [
            alert("giao_hong", { level: "canh_bao" }, uae({ sub_status: "DeliveryFailure_Rejected", raw_status: "REFUSED", fail_count: 2, note: "Flat 426 K1 Building Al Rigga" })),
            alert("giao_hong", { level: "canh_bao" }, uae({ order_id: "5", tracking: "VS1068349", track17_code: "VS1068349", customer: "Ann",
                sub_status: "DeliveryFailure_NoResponse", raw_status: "NO RESPONSE", fail_count: 1, city: "Dibba, Fujairah" })),
            alert("giao_hong", { level: "canh_bao" }, uae({ order_id: "4", tracking: "VS1068056", track17_code: "VS1068056", customer: "Liza",
                sub_status: "DeliveryFailure_Rescheduled", raw_status: "Rescheduled", fail_count: 2 })),
        ] }));
        const m = plainText(r.text);
        assert.ok(m.includes("☎️ @Thương · GỌI 3 KHÁCH GIAO HỎNG / HẸN LẠI"), m);
        // Từ chối lần 2 → nhắc lại: hỏi còn lấy không, không trả lời thì huỷ (Sỹ Anh duyệt 01/10/2026).
        assert.ok(m.includes("1. #12 · 159 AED · khách từ chối lần 2\n👤 Maria · 0501234567 · Dubai\n📝 Ghi chú đơn: \"Flat 426 K1 Building Al Rigga\"\n"
            + "💬 Hi Maria, we haven't heard back from you about your order (parcel VS1068045), which was refused at delivery. Do you still want it?"), m);
        assert.ok(m.includes("🇻🇳 Dịch: Chào Maria, shop chưa nhận được phản hồi của bạn về đơn (mã VS1068045) bị từ chối nhận hôm trước."), m);
        // Không nghe máy lần đầu → bảo xem cuộc gọi nhỡ, chủ động gọi lại tài xế.
        assert.ok(m.includes("2. #5 · 159 AED · không nghe máy\n👤 Ann · 0501234567 · Dibba, Fujairah\n"
            + "💬 Hi Ann, the courier tried to deliver your order (parcel VS1068349) but couldn't reach you by phone. Please check your phone for missed calls"), m);
        assert.ok(m.includes("3. #4 · 159 AED · hẹn giao lại lần 2\n"), m);
        assert.ok(m.includes("Hi Liza, this is another reminder: the courier has tried to deliver your order (parcel VS1068056) 2 times and still couldn't complete it!"), m);
        assert.ok(!m.includes("J&T"), "tin UAE không được nói J&T");
        assert.deepStrictEqual(r.goi, ["VS1068045", "VS1068349", "VS1068056"]);
        assert.deepStrictEqual(r.daNhan, ["VS1068045", "VS1068349", "VS1068056"], "UAE cũng ghi sổ nhắc");
    });
    await t("UAE: khách TỪ CHỐI từ 3 lần → rút khỏi danh sách gọi, gom một dòng NÊN HUỶ (Sỹ Anh 02/10/2026)", () => {
        const refused = (o) => alert("giao_hong", { level: "canh_bao" }, uae({ sub_status: "DeliveryFailure_Rejected", raw_status: "REFUSED", ...o }));
        const r = morning(AE({ alerts: [
            refused({ order_id: "14", tracking: "VS1", track17_code: "VS1", fail_count: 5, cod_local: 119 }),
            refused({ order_id: "3", tracking: "VS2", track17_code: "VS2", fail_count: 3, cod_local: 119 }),
            refused({ order_id: "18", tracking: "VS3", track17_code: "VS3", fail_count: 2, cod_local: 109 }),
            alert("giao_hong", { level: "canh_bao" }, uae({ order_id: "5", tracking: "VS4", track17_code: "VS4",
                sub_status: "DeliveryFailure_NoResponse", raw_status: "NO RESPONSE", fail_count: 4 })),
        ] }));
        const m = plainText(r.text);
        assert.ok(m.includes("☎️ @Thương · GỌI 2 KHÁCH GIAO HỎNG / HẸN LẠI"), m);
        assert.ok(m.includes("🗑️ NÊN HUỶ 2 ĐƠN · 238 AED — khách từ chối nhận từ 3 lần trở lên, không nhắn nữa\n#14 (5 lần) · #3 (3 lần)"), m);
        assert.ok(!/Hi Maria, we haven't heard back[^\n]*\(parcel VS1\)/.test(m) && !m.includes("(parcel VS2)"), "không soạn câu gửi khách nên huỷ");
        assert.deepStrictEqual(r.goi, ["VS3", "VS4"], "từ chối 2 lần và không nghe máy 4 lần vẫn gọi");
        assert.ok(!r.daNhan.includes("VS1") && !r.daNhan.includes("VS2"), "không ghi sổ nhắc đơn nên huỷ");
    });
    await t("UAE: lần đầu từ chối hỏi có vấn đề gì; sai địa chỉ xin địa chỉ / định vị", () => {
        const r = morning(AE({ alerts: [
            alert("giao_hong", { level: "canh_bao" }, uae({ sub_status: "DeliveryFailure_Rejected", fail_count: 1 })),
            alert("giao_hong", { level: "canh_bao" }, uae({ order_id: "7", tracking: "VS7", track17_code: "VS7", customer: "Omar", sub_status: "DeliveryFailure_InvalidAddress", fail_count: 1 })),
        ] }));
        const m = plainText(r.text);
        assert.ok(m.includes("Hi Maria, the courier told us your order (parcel VS1068045) was refused at delivery. Was there a problem with the order?"), m);
        assert.ok(m.includes("Hi Omar, the courier couldn't find your address for your order (parcel VS7). Please reply with your full address (building, flat number, area) or send your location pin"), m);
        assert.ok(m.includes("🇻🇳 Dịch: Chào Omar, bên giao hàng không tìm được địa chỉ của bạn"), m);
    });

    await t("UAE: BÁO TRƯỚC — hẹn giao ngày mai / hôm nay, đi giao hôm nay, đã vào kho hãng", () => {
        const ae = (o) => uae({ status: "InTransit", sub_status: null, last_event_time: vnIso(TODAY, "06:00"), ...o });
        const r = morning(AE({ shipments: [
            ae({ order_id: "31", tracking: "VS31", track17_code: "VS31", customer: "Ali", sub_status: "InTransit_Scheduled", raw_status: "DELIVERY SCHEDULED ON NEXT DAY" }),
            ae({ order_id: "32", tracking: "VS32", track17_code: "VS32", customer: "Bea", sub_status: "InTransit_Scheduled", raw_status: "DELIVERY SCHEDULED ON NEXT DAY", last_event_time: vnIso("2026-09-25") }),
            ae({ order_id: "33", tracking: "VS33", track17_code: "VS33", customer: "Cid", status: "OutForDelivery", raw_status: "Dispatched" }),
            ae({ order_id: "34", tracking: "VS34", track17_code: "VS34", customer: "Dee", raw_status: "Arrived at facility", last_event_time: vnIso("2026-09-25") }),
        ] }));
        const m = plainText(r.text);
        assert.ok(m.includes("🚚 @Thương · BÁO TRƯỚC 4 KHÁCH SẮP NHẬN HÀNG"), m);
        assert.ok(m.includes("#32 · 159 AED · GIAO HÔM NAY\n👤 Bea · 0501234567 · Dubai\n💬 Hi Bea, your order (parcel VS32) is scheduled for delivery today!"), "hẹn từ hôm qua → hôm nay giao");
        assert.ok(m.includes("#33 · 159 AED · GIAO HÔM NAY\n👤 Cid · 0501234567 · Dubai\n💬 Hi Cid, your order (parcel VS33) is out for delivery with the courier today!"), m);
        assert.ok(m.includes("#31 · 159 AED · hẹn giao NGÀY MAI\n👤 Ali · 0501234567 · Dubai\n💬 Hi Ali, your order (parcel VS31) is scheduled for delivery tomorrow!"), m);
        assert.ok(m.includes("🇻🇳 Dịch (hẹn giao ngày mai): Chào {tên}, đơn của bạn (mã {mã}) đã được hẹn giao vào ngày mai! Bạn nhớ mở máy và để ý cuộc gọi, tin nhắn của tài xế giao hàng"), m);
        assert.ok(m.includes("#34 · 159 AED · đã vào kho hãng, sắp giao\n👤 Dee · 0501234567 · Dubai\n💬 Hi Dee, your order (parcel VS34) is now with the courier"), m);
        assert.ok(!m.includes("J&T"), m);
    });

    await t("UAE: WeShip lỗi vài mã / lượt hỏng → tin tự nói", () => {
        const m1 = plainText(morning(AE({ last_sync: { at: "2026-09-25T23:03:00Z", ok: true, provider: "weship", targets: 27, checked: 25, failed: 2,
            error: "2/27 mã lỗi — VS1: WeShip HTTP 503" } })).text);
        assert.ok(m1.includes("⚠️ WeShip lỗi 2 mã: 2/27 mã lỗi — VS1: WeShip HTTP 503"), m1);
        const m2 = plainText(morning(AE({ last_sync: { at: "2026-09-25T23:03:00Z", ok: false, provider: "weship", error: "fetch failed" } })).text);
        assert.ok(m2.includes("⚠️ WeShip lỗi 06:03 26/09: fetch failed"), m2);
        const m3 = plainText(morning(AE({ last_sync: null })).text);
        assert.ok(m3.includes("⚠️ WeShip chưa tra lần nào"), m3);
    });

    // ── TỐI ──
    const EVENING_NOW = Date.parse("2026-09-26T15:00:00Z");       // 22:00 giờ VN
    const evening = (d, o = {}) => plainText(buildShipmentEvening(d, { today: TODAY, nowTs: EVENING_NOW, ...o }));
    await t("tối: chấm danh sách sáng — đã lấy (cứu tiền), chưa lấy MAI HẾT HẠN, bị trả về", () => {
        const shipments = [
            shipment({ tracking: "K1", order_id: "T1", status: "Delivered", status_since: vnIso(TODAY, "15:00"), cod_local: 1399 }),
            shipment({ tracking: "K2", order_id: "T2", status: "AvailableForPickup" }),
            shipment({ tracking: "K3", order_id: "T3", status: "Exception", sub_status: "Exception_Returned", status_since: vnIso(TODAY, "12:00"), cod_local: 799 }),
            shipment({ tracking: "M1", order_id: "T9", status: "Delivered", status_since: vnIso(TODAY, "18:00"), cod_local: 999 }),
            shipment({ tracking: "M2", order_id: "T8", status: "AvailableForPickup", status_since: vnIso("2026-09-25") }),
        ];
        const alerts = [alert("sap_bi_tra_ve", { days_left: 1 }, { tracking: "K2", order_id: "T2" })];
        const m = evening(DATA({ shipments, alerts, last_sync: { at: "2026-09-26T14:30:00Z", ok: true } }),
            { sangNay: { ngay: TODAY, goi: ["K1", "K2", "K3"], moiToi: ["M1", "M2"] } });
        const lines = m.split("\n");
        assert.strictEqual(lines[0], "🌙 VẬN ĐƠN ĐÀI LOAN · TỐI 26/09 · HÔM NAY LÀM ĐƯỢC GÌ");
        assert.strictEqual(lines[1], "17TRACK cập nhật 21:30 ✓");
        assert.ok(m.includes("☎️ 3 KHÁCH PHẢI GỌI SÁNG NAY\n✅ 1 đã lấy · cứu 1.399 NT$\n⏳ 1 chưa lấy, MAI HẾT HẠN: T2\n❌ 1 bị trả về: T3 · 799 NT$"), m);
        assert.ok(m.includes("📬 2 KHÁCH HÀNG MỚI TỚI → 1 đã lấy · 1 còn chờ"), m);
        assert.ok(m.includes("📊 CẢ NGÀY 26/09\n✅ Khách đã lấy 2 đơn · 2.398 NT$"), m);
        assert.ok(m.includes("🏪 Mới tới cửa hàng 0 · ↩️ Bắt đầu hoàn 1 · 799 NT$"), m);
        assert.ok(m.includes("Sáng mai 08:30: 1 khách còn treo ở trên đứng đầu danh sách gọi."));
    });
    await t("tối: không có danh sách sáng (bot vừa bật lại) → chỉ báo số cả ngày", () => {
        const m = evening(DATA());
        assert.ok(!m.includes("☎️"), m);
        assert.ok(m.includes("📊 CẢ NGÀY 26/09"));
    });
    await t("tối SG: 'đã giao' thay cho 'đã lấy'", () => {
        const m = evening(SG({ shipments: [shipment({ tracking: "J1", order_id: "S1", status: "Delivered", status_since: vnIso(TODAY, "16:00"), cod_local: 69 })] }),
            { sangNay: { ngay: TODAY, goi: ["J1"], moiToi: [] } });
        assert.ok(m.startsWith("🌙 VẬN ĐƠN SINGAPORE · TỐI 26/09"), m);
        assert.ok(m.includes("☎️ 1 KHÁCH GIAO HỎNG / HẸN LẠI SÁNG NAY\n✅ 1 đã giao · cứu 69 SGD"), m);
        assert.ok(m.includes("✅ Giao thành công 1 đơn · 69 SGD"));
    });

    await t("suKienNgay tính theo NGÀY VIỆT NAM (23:30 VN vẫn là hôm đó)", () => {
        const result = dayEvents([shipment({ status: "Delivered", status_since: "2026-09-25T16:30:00Z" })], "2026-09-25");
        assert.strictEqual(result.daLay.length, 1);
    });

    await t("fetchVanDon hỏi đúng khoảng ngày, gắn market, báo lỗi route", async () => {
        let url = "";
        const f = async (u) => { url = u; return { ok: true, json: async () => ({ alerts: [] }) }; };
        await fetchShipments({ url: "http://dash/api/talpha/tracking", rangeDays: 60 }, TODAY, f, "SG");
        assert.strictEqual(url, "http://dash/api/talpha/tracking?from=2026-07-28&to=2026-09-26&market=SG");
        const errorFetch = async () => ({ ok: true, json: async () => ({ error: "Query lỗi" }) });
        await assert.rejects(fetchShipments({ url: "x" }, TODAY, errorFetch), /Query lỗi/);
    });

    await t("mã lấy hàng = mã TRACKING: 7-11 bỏ 73N, FamilyMart giữ số 0, API tính sẵn thì dùng luôn", () => {
        assert.strictEqual(pickupCode({ tracking: "18050703", track17_code: "73N18050703", store_code: "265155" }), "18050703");
        assert.strictEqual(pickupCode({ tracking: "6722465195", track17_code: "06722465195", store_code: "022980" }), "06722465195");
        assert.strictEqual(pickupCode({ pickup_code: "18050703", track17_code: "73N99999999" }), "18050703");
        assert.strictEqual(pickupCode({ tracking: "18050703" }), "18050703", "kho cũ chưa có track17_code");
    });

    await t("tin khách lần đầu (Anh + dịch Việt): đếm XUÔI số ngày đã tới, có tên chuỗi cửa hàng, không nhắc tiền", () => {
        const s = shipment({ customer: "Emelita", store_name: "靜安", store_code: "265155", tracking: "18050703", track17_code: "73N18050703", ship_method: "7 ELEVEN", cod_local: 1499 });
        assert.strictEqual(twCustomerMessage(s, { ngay: 2, conLai: 5 }),
            "Hi Emelita, your parcel arrived at 7-ELEVEN 靜安 (pickup code 18050703) 2 days ago. "
            + "Please drop by the store to pick it up when you can — if it's not picked up in time, it will be returned. Thank you!");
        assert.strictEqual(twCustomerMessage(s, { ngay: 2, conLai: 5 }, "vi"),
            "Chào Emelita, hàng của bạn đã tới cửa hàng 7-ELEVEN 靜安 (mã lấy hàng 18050703) được 2 ngày rồi. "
            + "Phiền bạn tranh thủ ghé cửa hàng lấy nhé, quá hạn hàng sẽ bị trả về. Cảm ơn bạn!");
        assert.ok(twCustomerMessage(s, { ngay: 0 }).includes("arrived at 7-ELEVEN 靜安 (pickup code 18050703) today"));
        assert.ok(twCustomerMessage(s, { ngay: 1 }).includes("1 day ago"), "1 ngày không thêm 's'");
        assert.ok(!/5 days|1,499|NT\$/.test(twCustomerMessage(s, { ngay: 2, conLai: 5 })), "không nói còn mấy ngày, không nhắc tiền");
        assert.ok(twCustomerMessage({ ...s, ship_method: "Family mart", store_name: "全家福興福利店" }, {}).includes("at 全家福興福利店 ("), "tên đã có 全家 thì không thêm chuỗi");
        assert.strictEqual(twCustomerMessage(shipment({ store_name: "" }), { ngay: 3 }), null, "thiếu cửa hàng thì không soạn");
    });

    await t("tin khách nhắc lại: gấp hơn — mai / hôm nay là ngày cuối thì nói thẳng", () => {
        const s = shipment({ customer: "Emelita", store_name: "靜安", tracking: "18050703", track17_code: "73N18050703", cod_local: 1499 });
        const tomorrowMsg = twCustomerMessage(s, { ngay: 6, conLai: 1, nhacLai: true });
        assert.ok(tomorrowMsg.startsWith("Hi Emelita, this is another reminder: your parcel has been waiting at 靜安 (pickup code 18050703) for 6 days "
            + "and hasn't been picked up yet! Tomorrow is the last day to pick it up"), tomorrowMsg);
        assert.ok(!/1,499|NT\$/.test(tomorrowMsg), "không nhắc tiền");
        assert.ok(twCustomerMessage(s, { ngay: 6, conLai: 1, nhacLai: true }, "vi").includes("Mai là ngày cuối để lấy hàng"));
        assert.ok(twCustomerMessage(s, { ngay: 7, conLai: 0, nhacLai: true }).includes("Today is the LAST DAY to pick it up"));
    });

    await t("sổ nhắc: mỗi ngày +1 lần, gửi lại trong ngày không cộng, 14 ngày không nhắc thì bỏ", () => {
        let nudges = recordNudges({}, ["A", "B"], "2026-09-26");
        assert.deepStrictEqual(nudges.A, { lan: 1, dau: "2026-09-26", cuoi: "2026-09-26" });
        nudges = recordNudges(nudges, ["A"], "2026-09-26");
        assert.strictEqual(nudges.A.lan, 1, "cùng ngày không cộng");
        nudges = recordNudges(nudges, ["A"], "2026-09-27");
        assert.deepStrictEqual(nudges.A, { lan: 2, dau: "2026-09-26", cuoi: "2026-09-27" });
        assert.strictEqual(priorNudges(nudges, "A", "2026-09-27"), 1, "tin hôm nay chưa tính là lần TRƯỚC");
        assert.strictEqual(priorNudges(nudges, "A", "2026-09-28"), 2);
        nudges = recordNudges(nudges, [], "2026-10-12");
        assert.ok(!nudges.B && !nudges.A, "lâu không nhắc → bỏ khỏi sổ");
    });

    await t("sổ nhắc: khách mới tới HÔM QUA mà sáng qua đã nhắn → sáng nay sang NHẮC LẠI, ghi 'đã nhắn 1 lần'", () => {
        const r = morning(DATA({ alerts: [
            alert("toi_cua_hang", { level: "nhac", days: 1, days_left: 6 }, { order_id: "T1701", tracking: "M1", status_since: vnIso("2026-09-25", "07:00") }),
        ] }), { soNhac: { M1: { lan: 1, dau: "2026-09-25", cuoi: "2026-09-25" } } });
        const m = plainText(r.text);
        assert.ok(!m.includes("MỚI TỚI"), m);
        assert.ok(m.includes("T1701 · 1.499 NT$ · tới 1 ngày · đã nhắn 1 lần"), m);
        assert.deepStrictEqual(r.nhacLai, ["M1"]);
    });

    await t("tin tối chấm cả khách nhắc lại", () => {
        const d = DATA({ shipments: [shipment({ tracking: "M2", status: "Delivered" }), shipment({ tracking: "M3" })] });
        const m = plainText(buildShipmentEvening(d, { today: TODAY, nowTs: Date.parse("2026-09-26T15:00:00Z"), sangNay: { goi: [], moiToi: [], nhacLai: ["M2", "M3"] } }));
        assert.ok(m.includes("🔁 2 KHÁCH NHẮC LẠI → 1 đã lấy (1.499 NT$) · 1 còn chờ, sáng mai nhắc tiếp"), m);
    });

    console.log(`van_don: ${ok} phép thử — tất cả đạt.`);
})().catch((e) => { console.error(e.message); process.exit(1); });
