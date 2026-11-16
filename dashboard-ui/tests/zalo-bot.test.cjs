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
    assert.ok("error" in Z.parseZaloRequest({ action: "set_group", payload: { market: "TW" } }, MARKETS));
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
console.log(`${ok} phép thử bot Zalo qua.`);
