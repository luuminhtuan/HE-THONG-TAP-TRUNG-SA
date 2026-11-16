// node market_config.test.js   (không gọi mạng, không cần cài zca-js)
// Thị trường nhập ở /admin → Thị trường (04/11/2026): bản bot phủ lên talpha_rules.json phải ra
// CÙNG kết quả với bản dashboard và bản Python — bộ dữ liệu chung tests/fixtures/market_overrides.json.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { applyMarketOverrides, loadMarketOverrides } = require("./market_config");

let ok = 0;
const t = (name, fn) => {
    try { fn(); ok++; }
    catch (e) { console.error(`✗ ${name}`); throw e; }
};
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "tests", "fixtures", "market_overrides.json"), "utf8"));
const withoutNotes = (d) => Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith("_")));

t("ra đúng kết quả chung của ba bản", () => {
    const result = applyMarketOverrides(FIXTURE.luat, FIXTURE.phu);
    const expected = FIXTURE.mong_doi;
    assert.deepStrictEqual(withoutNotes(result.markets), expected.markets);
    assert.deepStrictEqual(withoutNotes(result.market_aliases), expected.market_aliases);
    assert.deepStrictEqual(result.camp_market_tokens, expected.camp_market_tokens);
    assert.deepStrictEqual(Object.fromEntries(Object.entries(result.access.teams).map(([k, v]) => [k, v.markets])), expected.teams);
});

t("không sửa luật gốc; không có file phủ thì y nguyên", () => {
    const before = JSON.stringify(FIXTURE.luat);
    applyMarketOverrides(FIXTURE.luat, FIXTURE.phu);
    assert.strictEqual(JSON.stringify(FIXTURE.luat), before);
    assert.deepStrictEqual(applyMarketOverrides(FIXTURE.luat, null), FIXTURE.luat);
});

t("file phủ hỏng thì bỏ qua, không làm sập bot", () => {
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tt-")), "thi_truong.json");
    fs.writeFileSync(p, "{hỏng");
    const savedEnv = process.env.TALPHA_THI_TRUONG;
    process.env.TALPHA_THI_TRUONG = p;
    const origConsoleError = console.error;
    console.error = () => {};
    try { assert.strictEqual(loadMarketOverrides(), null); }
    finally { console.error = origConsoleError; if (savedEnv === undefined) delete process.env.TALPHA_THI_TRUONG; else process.env.TALPHA_THI_TRUONG = savedEnv; }
});

console.log(`market_config.test.js: ${ok}/${ok} PASS`);
