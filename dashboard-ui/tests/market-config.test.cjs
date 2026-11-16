// node tests/market-config.test.cjs (chạy qua npm test — tsc dựng .test-build trước)
// Thị trường nhập ở /admin → Thị trường (04/11/2026): phủ lên talpha_rules.json, và soát nước nhập
// trên trang. Bộ dữ liệu phủ dùng chung với bản Python và bản bot — ba bản phải ra cùng kết quả.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const T = require("../.test-build/market-config.js");
const R = require("../.test-build/rules.js");

let ok = 0;
const t = (name, fn) => { try { fn(); ok++; console.log("  ✓", name); } catch (e) { console.error("  ✗", name); throw e; } };
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "tests", "fixtures", "market_overrides.json"), "utf8"));
const withoutNotes = (d) => Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith("_")));

console.log("── Thị trường: phủ lên luật gốc ──");
t("ra đúng kết quả chung của ba bản (dashboard · Python · bot)", () => {
    const result = T.applyMarketOverrides(FIXTURE.luat, FIXTURE.phu);
    const expected = FIXTURE.mong_doi;
    assert.deepStrictEqual(withoutNotes(result.markets), expected.markets);
    assert.deepStrictEqual(withoutNotes(result.market_aliases), expected.market_aliases);
    assert.deepStrictEqual(result.camp_market_tokens, expected.camp_market_tokens);
    assert.deepStrictEqual(Object.fromEntries(Object.entries(result.access.teams).map(([k, v]) => [k, v.markets])), expected.teams);
});
t("không sửa luật gốc truyền vào; không có file phủ thì y nguyên", () => {
    const before = JSON.stringify(FIXTURE.luat);
    T.applyMarketOverrides(FIXTURE.luat, FIXTURE.phu);
    assert.strictEqual(JSON.stringify(FIXTURE.luat), before);
    assert.deepStrictEqual(T.applyMarketOverrides(FIXTURE.luat, null), FIXTURE.luat);
});
t("shop POS sinh từ markets trùng đúng talpha.yaml cũ (đổi nguồn mà không đổi shop nào)", () => {
    const yaml = require("js-yaml");
    const y = yaml.load(fs.readFileSync(path.join(__dirname, "..", "..", "config", "projects", "talpha.yaml"), "utf8"));
    const oldShops = y.poscake.shops.map((s) => ({ name: s.name, shop_id: String(s.shop_id), bien: s.api_key.replace(/^\$\{|\}$/g, "") }));
    const newShops = R.SHOP_POS.map((s) => ({ name: s.name, shop_id: s.shop_id, bien: s.bien_key }));
    assert.deepStrictEqual(newShops, oldShops);
});

console.log("── Thị trường: soát nước nhập trên trang ──");
const BASE_RULES = T.applyMarketOverrides(FIXTURE.luat, null);
const thailand = (patch = {}) => ({
    key: "Thailand", display: "Thái Lan", shop_label: "TH", currency: "THB", currency_symbol: "฿",
    rate_vnd: 700, pos_money_divisor: 1, shop_id: "123456", status: "active", orders_from: "2026-11-05",
    flag: "🇹🇭", tokens: ["TH", "THAI"], team: "dong_nam_a", ...patch,
});
t("nước mới khai đủ thì không lỗi", () => {
    assert.deepStrictEqual(T.marketInputErrors(thailand(), BASE_RULES, true), []);
});
t("sắp chạy được để trống tỷ giá, số chia, shop; đang bán / đã tắt thì không", () => {
    assert.deepStrictEqual(T.marketInputErrors(thailand({ status: "upcoming", rate_vnd: null, pos_money_divisor: null, shop_id: "" }), BASE_RULES, true), []);
    for (const status of ["active", "disabled"]) {
        const errors = T.marketInputErrors(thailand({ status, rate_vnd: null, pos_money_divisor: null, shop_id: "" }), BASE_RULES, true).join(" | ");
        assert.ok(/tỷ giá/.test(errors) && /số chia/.test(errors) && /shop POS/.test(errors), errors);
    }
});
t("mã shop vào thẳng SQL của view → chỉ 2–3 chữ in hoa; không trùng nước khác", () => {
    assert.ok(T.marketInputErrors(thailand({ shop_label: "T'H" }), BASE_RULES, true).some((x) => /Mã shop/.test(x)));
    assert.ok(T.marketInputErrors(thailand({ shop_label: "SG" }), BASE_RULES, true).some((x) => /đã thuộc nước khác/.test(x)));
});
t("không đổi được mã shop của nước đã có — đơn cũ đang mang mã đó", () => {
    const sg = { ...thailand(), key: "Singapore", display: "Singapore", shop_label: "SP", shop_id: "715135541", tokens: ["SG"], team: null };
    assert.ok(T.marketInputErrors(sg, BASE_RULES, false).some((x) => /Không đổi được mã shop SG/.test(x)));
});
t("mã campaign đang thuộc nước khác → từ chối (chi tiêu nước kia sẽ chạy sang)", () => {
    assert.ok(T.marketInputErrors(thailand({ tokens: ["TH", "SG"] }), BASE_RULES, true).some((x) => /SG đang thuộc Singapore/.test(x)));
    assert.ok(T.marketInputErrors(thailand({ tokens: [] }), BASE_RULES, true).some((x) => /ít nhất một mã/.test(x)));
});
t("shop POS trùng nước khác, số chia lẻ, team lạ, thêm trùng tên → từ chối", () => {
    assert.ok(T.marketInputErrors(thailand({ shop_id: "715135541" }), BASE_RULES, true).some((x) => /Shop POS 715135541/.test(x)));
    assert.ok(T.marketInputErrors(thailand({ pos_money_divisor: 1.5 }), BASE_RULES, true).some((x) => /số nguyên/.test(x)));
    assert.ok(T.marketInputErrors(thailand({ team: "khong_co" }), BASE_RULES, true).some((x) => /Không có team/.test(x)));
    assert.ok(T.marketInputErrors({ ...thailand(), key: "Singapore" }, BASE_RULES, true).some((x) => /Đã có nước Singapore/.test(x)));
});

console.log("── Thị trường: form ⇄ file phủ ──");
t("mở form từ luật: mã campaign + team đọc ngược từ market_aliases, access.teams", () => {
    const sg = T.inputFromRules("Singapore", BASE_RULES);
    assert.deepStrictEqual(sg.tokens, ["SG"]);
    assert.strictEqual(sg.team, "dong_nam_a");
    assert.strictEqual(sg.rate_vnd, 20000);
});
t("sửa nước có trong config: CHỈ ghi ô đã sửa — ô khác vẫn theo file gốc", () => {
    const sg = T.inputFromRules("Singapore", BASE_RULES);
    assert.deepStrictEqual(T.overrideFromInput(sg, BASE_RULES), {});
    assert.deepStrictEqual(T.overrideFromInput({ ...sg, rate_vnd: 19500 }, BASE_RULES), { rate_vnd: 19500 });
    assert.deepStrictEqual(T.overrideFromInput({ ...sg, tokens: ["SG", "sgp"], team: "dong_a" }, BASE_RULES), { tokens: ["SGP"], team: "dong_a" });
});
t("thêm nước: ghi đủ; phủ lại rồi mở form ra đúng cái đã nhập", () => {
    const block = T.overrideFromInput(thailand(), BASE_RULES);
    assert.strictEqual(block.shop_label, "TH");
    assert.deepStrictEqual(block.tokens, ["TH", "THAI"]);
    const after = T.applyMarketOverrides(FIXTURE.luat, { markets: { Thailand: block } });
    assert.deepStrictEqual(T.inputFromRules("Thailand", after), thailand());
});

console.log("── Thị trường: camp thuộc nước nào (soát trước khi xoá nước) ──");
t("cùng kết quả campaignMarket của rules.ts trên luật đang chạy", () => {
    const rules = { market_aliases: R.RULES.market_aliases, camp_market_tokens: R.RULES.camp_market_tokens };
    for (const name of ["TW/SAnh/001/ABC", "SG/Thai/x", "Thuong/JP/abc", "ae/loc", "khong ma nuoc", "", "Thuong/SG/TW"]) {
        const m = R.campaignMarket(name);
        assert.strictEqual(T.marketOfCampaign(name, rules), m.source === "mac_dinh" ? null : m.market, name);
    }
});
t("nước vừa thêm trên trang (chưa khởi động lại) đã nhận camp mang mã của nó", () => {
    const after = T.applyMarketOverrides(FIXTURE.luat, { markets: { Thailand: { display: "Thái Lan", shop_label: "TH", tokens: ["TH", "THAI"] } } });
    assert.strictEqual(T.marketOfCampaign("TH/SAnh/001", after), "Thailand");
    assert.strictEqual(T.marketOfCampaign("Thuong/thai/abc", after), "Thailand");
    assert.strictEqual(T.marketOfCampaign("TH/SAnh/001", FIXTURE.luat), null);
});

console.log(`${ok} phép thử thị trường qua.`);
