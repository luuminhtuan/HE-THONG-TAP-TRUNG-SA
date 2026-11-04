// node thi_truong.test.js   (không gọi mạng, không cần cài zca-js)
// Thị trường nhập ở /admin → Thị trường (04/11/2026): bản bot phủ lên talpha_rules.json phải ra
// CÙNG kết quả với bản dashboard và bản Python — bộ dữ liệu chung tests/fixtures/thi_truong_phu.json.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { phuLuat, docPhu } = require("./thi_truong");

let ok = 0;
const t = (ten, fn) => {
    try { fn(); ok++; }
    catch (e) { console.error(`✗ ${ten}`); throw e; }
};
const BO = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "tests", "fixtures", "thi_truong_phu.json"), "utf8"));
const khongGhiChu = (d) => Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith("_")));

t("ra đúng kết quả chung của ba bản", () => {
    const ra = phuLuat(BO.luat, BO.phu);
    const md = BO.mong_doi;
    assert.deepStrictEqual(khongGhiChu(ra.markets), md.markets);
    assert.deepStrictEqual(khongGhiChu(ra.market_aliases), md.market_aliases);
    assert.deepStrictEqual(ra.camp_market_tokens, md.camp_market_tokens);
    assert.deepStrictEqual(Object.fromEntries(Object.entries(ra.access.teams).map(([k, v]) => [k, v.markets])), md.teams);
});

t("không sửa luật gốc; không có file phủ thì y nguyên", () => {
    const truoc = JSON.stringify(BO.luat);
    phuLuat(BO.luat, BO.phu);
    assert.strictEqual(JSON.stringify(BO.luat), truoc);
    assert.deepStrictEqual(phuLuat(BO.luat, null), BO.luat);
});

t("file phủ hỏng thì bỏ qua, không làm sập bot", () => {
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tt-")), "thi_truong.json");
    fs.writeFileSync(p, "{hỏng");
    const cu = process.env.TALPHA_THI_TRUONG;
    process.env.TALPHA_THI_TRUONG = p;
    const loi = console.error;
    console.error = () => {};
    try { assert.strictEqual(docPhu(), null); }
    finally { console.error = loi; if (cu === undefined) delete process.env.TALPHA_THI_TRUONG; else process.env.TALPHA_THI_TRUONG = cu; }
});

console.log(`thi_truong.test.js: ${ok}/${ok} PASS`);
