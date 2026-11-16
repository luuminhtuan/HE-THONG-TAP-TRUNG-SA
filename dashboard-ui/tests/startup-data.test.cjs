// node tests/startup-data.test.cjs (chạy qua npm test — tsc dựng .test-build trước)
// Nạp số lúc khởi động (instrumentation.ts → primeStartupData, 16/11/2026): kho lỗi hay treo thì dashboard vẫn
// mở cửa, đánh dấu để thử lại nền; bản rõ của khoá chỉ giao MỘT lần.
const assert = require("assert");

const SLOT = Symbol.for("talpha.startupData");
process.env.DATABASE_URL = "postgresql://gia:gia@127.0.0.1:1/gia";
process.env.TALPHA_ENCRYPTION_KEY = "chia-thu";
const S = require("../.test-build/startup-data.js");

let ok = 0;
const t = async (name, fn) => {
    try { await fn(); ok++; console.log("  ✓", name); } catch (e) { console.error("  ✗", name); throw e; }
};
const quiet = async (fn) => {
    const err = console.error;
    console.error = () => {};
    try { return await fn(); } finally { console.error = err; }
};

(async () => {
    console.log("── Nạp số lúc khởi động ──");
    await t("kho trả lời: nhận phần phủ thị trường + khoá, không đánh dấu lỗi", async () => {
        const query = async (sql) => sql.includes("market_overrides")
            ? [{ market_key: "Taiwan", settings: { rate_vnd: 999 } }]
            : [{ name: "TALPHA_META_ACCESS_TOKEN", value: "EAA-x", note: null, updated_at: "t", updated_by: null }];
        await S.primeStartupData(query);
        assert.deepStrictEqual(S.getStartupData().marketOverrides, { markets: { Taiwan: { rate_vnd: 999 } } });
        assert.strictEqual(S.startupMarketOverridesFailed(), false);
    });
    await t("khoá giao MỘT lần rồi xoá khỏi globalThis", async () => {
        const first = S.takeStartupCredentials();
        assert.strictEqual(first.rows[0].name, "TALPHA_META_ACCESS_TOKEN");
        assert.strictEqual(S.takeStartupCredentials(), null);
        assert.strictEqual(globalThis[SLOT].credentials, null);
    });
    await t("kho lỗi: chạy luật gốc, đánh dấu lỗi để thử lại nền", async () => {
        await quiet(() => S.primeStartupData(async () => { throw new Error("ECONNREFUSED"); }));
        assert.strictEqual(S.getStartupData().marketOverrides, null);
        assert.strictEqual(S.startupMarketOverridesFailed(), true);
        assert.strictEqual(S.takeStartupCredentials(), null);
    });
    await t("kho treo: hết hạn thì vẫn trả về (server mở cửa), đánh dấu lỗi", async () => {
        const started = Date.now();
        await quiet(() => S.primeStartupData(() => new Promise(() => {}), 50));
        assert.ok(Date.now() - started < 2000);
        assert.strictEqual(S.startupMarketOverridesFailed(), true);
    });
    await t("chưa ai nhập thị trường: null nhưng KHÔNG phải lỗi", async () => {
        await S.primeStartupData(async () => []);
        assert.strictEqual(S.getStartupData().marketOverrides, null);
        assert.strictEqual(S.startupMarketOverridesFailed(), false);
    });
    console.log(`${ok} phép thử nạp lúc khởi động qua.`);
})().catch((e) => { console.error(e); process.exit(1); });
