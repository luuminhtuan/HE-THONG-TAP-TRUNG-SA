// node tests/zalo-bot.test.cjs (chạy qua npm test — tsc dựng .test-build trước)
// Bot Zalo điều khiển từ trang (16/11/2026): soát yêu cầu bấm trên /admin → Khoá kết nối → Zalo, bot còn chạy không.
const assert = require("assert");
const Z = require("../.test-build/zalo-bot-rules.js");

let ok = 0;
const t = (name, fn) => { try { fn(); ok++; console.log("  ✓", name); } catch (e) { console.error("  ✗", name); throw e; } };
const MARKETS = ["TW", "SG", "AE", "JP"];

console.log("── Bot Zalo: yêu cầu từ trang ──");
t("việc không có tham số: ghép nick, tải nhóm, bỏ ghép", () => {
    for (const action of ["pair", "refresh_groups", "unpair"]) {
        assert.deepStrictEqual(Z.parseZaloRequest({ action, payload: { market: "TW", x: "y" } }, MARKETS), { action, payload: {} });
    }
});
t("chọn nhóm: nước viết thường vẫn nhận, mã nhóm phải là số", () => {
    assert.deepStrictEqual(Z.parseZaloRequest({ action: "set_group", payload: { market: "tw", group_id: " 7316 " } }, MARKETS),
        { action: "set_group", payload: { market: "TW", group_id: "7316" } });
    assert.ok("error" in Z.parseZaloRequest({ action: "set_group", payload: { market: "TW", group_id: "1; DROP" } }, MARKETS));
    assert.deepStrictEqual(Z.parseZaloRequest({ action: "set_group", payload: { market: "TW" } }, MARKETS),
        { action: "set_group", payload: { market: "TW", group_id: "" } }, "bỏ trống = bỏ nhóm của nước đó");
});
t("gửi thử / chọn nhóm cho nước bot không phục vụ: từ chối", () => {
    assert.ok("error" in Z.parseZaloRequest({ action: "send_test", payload: { market: "KR" } }, MARKETS));
    assert.ok("error" in Z.parseZaloRequest({ action: "set_group", payload: { market: "", group_id: "1" } }, MARKETS));
    assert.deepStrictEqual(Z.parseZaloRequest({ action: "send_test", payload: { market: "jp" } }, MARKETS),
        { action: "send_test", payload: { market: "JP" } });
});
t("việc lạ / body hỏng: lỗi đọc được", () => {
    assert.ok("error" in Z.parseZaloRequest({ action: "xoa_het" }, MARKETS));
    assert.ok("error" in Z.parseZaloRequest(null, MARKETS));
    assert.ok("error" in Z.parseZaloRequest([], MARKETS));
});
t("bot còn chạy: nhịp tim trong 90 giây", () => {
    const now = Date.parse("2026-11-16T10:00:00Z");
    assert.strictEqual(Z.isBotOnline("2026-11-16T09:59:00Z", now), true);
    assert.strictEqual(Z.isBotOnline("2026-11-16T09:58:00Z", now), false);
    assert.strictEqual(Z.isBotOnline(null, now), false);
    assert.strictEqual(Z.isBotOnline("không phải ngày", now), false);
});
console.log("── Bot Zalo: kho trong database (phiên, nhóm, trạng thái) ──");
const SESSION = { cookie: [{ key: "zpw_sek" }], imei: "i-1", userAgent: "ua", language: "vi", name: "Hoàng Rin" };
t("thao tác ghi kho hợp lệ: giữ nguyên thứ tự, mã nước viết hoa", () => {
    const ops = Z.parseStoreOps([
        { type: "state_set", section: "moc", item: "ads:TW:18:00", value: "2026-11-16" },
        { type: "state_set", section: "nhomTuTrang", item: "", value: "2026-11-16T09:57Z" },
        { type: "state_del", section: "dinhChinh", item: "report:TW:2026-11-15" },
        { type: "state_del", section: "vanDonSang" },
        { type: "group_set", market: "tw", id: "5092035087637680474", name: "ADS + VẬN ĐƠN TAIWAN", method: "trang", chosen_at: "2026-11-16T09:57:59.179Z" },
        { type: "group_del", market: "sg" },
        { type: "session_set", value: SESSION },
        { type: "session_del" },
    ]);
    assert.ok(Array.isArray(ops), JSON.stringify(ops));
    assert.deepStrictEqual(ops.map((o) => o.type), ["state_set", "state_set", "state_del", "state_del", "group_set", "group_del", "session_set", "session_del"]);
    assert.strictEqual(ops[3].item, null, "không ghi item = xoá cả section");
    assert.strictEqual(ops[4].market, "TW");
    assert.strictEqual(ops[5].market, "SG");
});
t("thao tác hỏng: bỏ cả lượt, lỗi chỉ đúng chỗ", () => {
    const bad = [
        [{ type: "state_set", section: "moc; DROP", item: "x", value: 1 }, /mục trạng thái lạ/],
        [{ type: "state_set", section: "moc", item: "x" }, /thiếu value/],
        [{ type: "group_set", market: "TW", id: "1 OR 1=1", name: "x" }, /mã nhóm/],
        [{ type: "group_set", market: "Đài", id: "1", name: "x" }, /mã nước lạ/],
        [{ type: "session_set", value: { cookie: [], imei: "", userAgent: "ua" } }, /thiếu cookie/],
        [{ type: "xoa_het" }, /loại lạ/],
    ];
    for (const [op, re] of bad) {
        const r = Z.parseStoreOps([{ type: "session_del" }, op]);
        assert.ok("error" in r && re.test(r.error) && /thao tác 1/.test(r.error), JSON.stringify(r));
    }
    assert.ok("error" in Z.parseStoreOps("không phải mảng"));
    assert.ok("error" in Z.parseStoreOps(new Array(Z.MAX_STORE_OPS + 1).fill({ type: "session_del" })));
    assert.ok("error" in Z.parseStoreOps([{ type: "state_set", section: "big", item: "x", value: "x".repeat(1_000_001) }]));
});
t("chép file cũ: phiên, nhóm từng nước, dòng trạng thái", () => {
    const r = Z.parseStoreImport({
        session: SESSION,
        market_groups: { tw: { id: "5092035087637680474", name: "ADS + VẬN ĐƠN TAIWAN", method: "trang", chosen_at: "không phải ngày" } },
        state_rows: [{ section: "moc", item: "ads:TW:18:00", value: "2026-11-16" }],
    });
    assert.ok(!("error" in r), JSON.stringify(r));
    assert.strictEqual(r.session.name, "Hoàng Rin");
    assert.deepStrictEqual(r.market_groups.TW, { id: "5092035087637680474", name: "ADS + VẬN ĐƠN TAIWAN", method: "trang", chosen_at: null });
    assert.strictEqual(r.state_rows.length, 1);
    assert.deepStrictEqual(Z.parseStoreImport({}), { session: null, market_groups: {}, state_rows: [] });
    assert.ok("error" in Z.parseStoreImport({ session: { imei: "x" } }));
    assert.ok("error" in Z.parseStoreImport(null));
});
console.log(`${ok} phép thử bot Zalo qua.`);
