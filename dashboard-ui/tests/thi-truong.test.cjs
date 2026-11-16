// node tests/thi-truong.test.cjs (chạy qua npm test — tsc dựng .test-build trước)
// Thị trường nhập ở /admin → Thị trường (04/11/2026): phủ lên talpha_rules.json, và soát nước nhập
// trên trang. Bộ dữ liệu phủ dùng chung với bản Python và bản bot — ba bản phải ra cùng kết quả.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const T = require("../.test-build/market-config.js");
const R = require("../.test-build/rules.js");

let ok = 0;
const t = (ten, fn) => { try { fn(); ok++; console.log("  ✓", ten); } catch (e) { console.error("  ✗", ten); throw e; } };
const BO = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "tests", "fixtures", "thi_truong_phu.json"), "utf8"));
const khongGhiChu = (d) => Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith("_")));

console.log("── Thị trường: phủ lên luật gốc ──");
t("ra đúng kết quả chung của ba bản (dashboard · Python · bot)", () => {
    const ra = T.applyMarketOverrides(BO.luat, BO.phu);
    const md = BO.mong_doi;
    assert.deepStrictEqual(khongGhiChu(ra.markets), md.markets);
    assert.deepStrictEqual(khongGhiChu(ra.market_aliases), md.market_aliases);
    assert.deepStrictEqual(ra.camp_market_tokens, md.camp_market_tokens);
    assert.deepStrictEqual(Object.fromEntries(Object.entries(ra.access.teams).map(([k, v]) => [k, v.markets])), md.teams);
});
t("không sửa luật gốc truyền vào; không có file phủ thì y nguyên", () => {
    const truoc = JSON.stringify(BO.luat);
    T.applyMarketOverrides(BO.luat, BO.phu);
    assert.strictEqual(JSON.stringify(BO.luat), truoc);
    assert.deepStrictEqual(T.applyMarketOverrides(BO.luat, null), BO.luat);
});
t("shop POS sinh từ markets trùng đúng talpha.yaml cũ (đổi nguồn mà không đổi shop nào)", () => {
    const yaml = require("js-yaml");
    const y = yaml.load(fs.readFileSync(path.join(__dirname, "..", "..", "config", "projects", "talpha.yaml"), "utf8"));
    const cu = y.poscake.shops.map((s) => ({ name: s.name, shop_id: String(s.shop_id), bien: s.api_key.replace(/^\$\{|\}$/g, "") }));
    const moi = R.SHOP_POS.map((s) => ({ name: s.name, shop_id: s.shop_id, bien: s.bien_key }));
    assert.deepStrictEqual(moi, cu);
});

console.log("── Thị trường: soát nước nhập trên trang ──");
const LUAT = T.applyMarketOverrides(BO.luat, null);
const thai = (sua = {}) => ({
    key: "Thailand", display: "Thái Lan", shop_label: "TH", currency: "THB", currency_symbol: "฿",
    rate_vnd: 700, pos_money_divisor: 1, shop_id: "123456", status: "dang_ban", orders_from: "2026-11-05",
    flag: "🇹🇭", tokens: ["TH", "THAI"], team: "dong_nam_a", ...sua,
});
t("nước mới khai đủ thì không lỗi", () => {
    assert.deepStrictEqual(T.marketInputErrors(thai(), LUAT, true), []);
});
t("sắp chạy được để trống tỷ giá, số chia, shop; đang bán / đã tắt thì không", () => {
    assert.deepStrictEqual(T.marketInputErrors(thai({ status: "sap_chay", rate_vnd: null, pos_money_divisor: null, shop_id: "" }), LUAT, true), []);
    for (const status of ["dang_ban", "da_tat"]) {
        const loi = T.marketInputErrors(thai({ status, rate_vnd: null, pos_money_divisor: null, shop_id: "" }), LUAT, true).join(" | ");
        assert.ok(/tỷ giá/.test(loi) && /số chia/.test(loi) && /shop POS/.test(loi), loi);
    }
});
t("mã shop vào thẳng SQL của view → chỉ 2–3 chữ in hoa; không trùng nước khác", () => {
    assert.ok(T.marketInputErrors(thai({ shop_label: "T'H" }), LUAT, true).some((x) => /Mã shop/.test(x)));
    assert.ok(T.marketInputErrors(thai({ shop_label: "SG" }), LUAT, true).some((x) => /đã thuộc nước khác/.test(x)));
});
t("không đổi được mã shop của nước đã có — đơn cũ đang mang mã đó", () => {
    const sg = { ...thai(), key: "Singapore", display: "Singapore", shop_label: "SP", shop_id: "715135541", tokens: ["SG"], team: null };
    assert.ok(T.marketInputErrors(sg, LUAT, false).some((x) => /Không đổi được mã shop SG/.test(x)));
});
t("mã campaign đang thuộc nước khác → từ chối (chi tiêu nước kia sẽ chạy sang)", () => {
    assert.ok(T.marketInputErrors(thai({ tokens: ["TH", "SG"] }), LUAT, true).some((x) => /SG đang thuộc Singapore/.test(x)));
    assert.ok(T.marketInputErrors(thai({ tokens: [] }), LUAT, true).some((x) => /ít nhất một mã/.test(x)));
});
t("shop POS trùng nước khác, số chia lẻ, team lạ, thêm trùng tên → từ chối", () => {
    assert.ok(T.marketInputErrors(thai({ shop_id: "715135541" }), LUAT, true).some((x) => /Shop POS 715135541/.test(x)));
    assert.ok(T.marketInputErrors(thai({ pos_money_divisor: 1.5 }), LUAT, true).some((x) => /số nguyên/.test(x)));
    assert.ok(T.marketInputErrors(thai({ team: "khong_co" }), LUAT, true).some((x) => /Không có team/.test(x)));
    assert.ok(T.marketInputErrors({ ...thai(), key: "Singapore" }, LUAT, true).some((x) => /Đã có nước Singapore/.test(x)));
});

console.log("── Thị trường: form ⇄ file phủ ──");
t("mở form từ luật: mã campaign + team đọc ngược từ market_aliases, access.teams", () => {
    const sg = T.inputFromRules("Singapore", LUAT);
    assert.deepStrictEqual(sg.tokens, ["SG"]);
    assert.strictEqual(sg.team, "dong_nam_a");
    assert.strictEqual(sg.rate_vnd, 20000);
});
t("sửa nước có trong config: CHỈ ghi ô đã sửa — ô khác vẫn theo file gốc", () => {
    const sg = T.inputFromRules("Singapore", LUAT);
    assert.deepStrictEqual(T.overrideFromInput(sg, LUAT), {});
    assert.deepStrictEqual(T.overrideFromInput({ ...sg, rate_vnd: 19500 }, LUAT), { rate_vnd: 19500 });
    assert.deepStrictEqual(T.overrideFromInput({ ...sg, tokens: ["SG", "sgp"], team: "dong_a" }, LUAT), { tokens: ["SGP"], team: "dong_a" });
});
t("thêm nước: ghi đủ; phủ lại rồi mở form ra đúng cái đã nhập", () => {
    const khoi = T.overrideFromInput(thai(), LUAT);
    assert.strictEqual(khoi.shop_label, "TH");
    assert.deepStrictEqual(khoi.tokens, ["TH", "THAI"]);
    const sau = T.applyMarketOverrides(BO.luat, { markets: { Thailand: khoi } });
    assert.deepStrictEqual(T.inputFromRules("Thailand", sau), thai());
});

console.log("── Thị trường: camp thuộc nước nào (soát trước khi xoá nước) ──");
t("cùng kết quả campaignMarket của rules.ts trên luật đang chạy", () => {
    const luat = { market_aliases: R.RULES.market_aliases, camp_market_tokens: R.RULES.camp_market_tokens };
    for (const ten of ["TW/SAnh/001/ABC", "SG/Thai/x", "Thuong/JP/abc", "ae/loc", "khong ma nuoc", "", "Thuong/SG/TW"]) {
        const m = R.campaignMarket(ten);
        assert.strictEqual(T.marketOfCampaign(ten, luat), m.source === "mac_dinh" ? null : m.market, ten);
    }
});
t("nước vừa thêm trên trang (chưa khởi động lại) đã nhận camp mang mã của nó", () => {
    const sau = T.applyMarketOverrides(BO.luat, { markets: { Thailand: { display: "Thái Lan", shop_label: "TH", tokens: ["TH", "THAI"] } } });
    assert.strictEqual(T.marketOfCampaign("TH/SAnh/001", sau), "Thailand");
    assert.strictEqual(T.marketOfCampaign("Thuong/thai/abc", sau), "Thailand");
    assert.strictEqual(T.marketOfCampaign("TH/SAnh/001", BO.luat), null);
});

console.log(`${ok} phép thử thị trường qua.`);
