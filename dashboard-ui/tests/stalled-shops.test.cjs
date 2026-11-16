/** Shop đứng im (12/11/2026): ads còn tiêu mà shop không có đơn mới nhiều ngày. */
const assert = require("assert");
const { findStalledShops } = require("../.test-build/stalled-shops.js");

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("  ✓", name); };
const SHOPS = ["TW", "SG", "JP"];

console.log("── Shop đứng im ──");
t("ads tiêu, 3 ngày không đơn → kêu", () => {
    const r = findStalledShops(SHOPS, { TW: "2026-11-09", SG: "2026-11-12" }, { TW: 900000, SG: 900000 }, "2026-11-12");
    assert.deepStrictEqual(r, [{ shop: "TW", last_order_date: "2026-11-09", days: 3, ads_vnd: 900000 }]);
});
t("nước nghỉ (không tiêu ads) → không kêu dù lâu không có đơn", () => {
    assert.deepStrictEqual(findStalledShops(SHOPS, { JP: "2026-10-26" }, { JP: 0 }, "2026-11-12"), []);
});
t("ads dưới ngưỡng → không kêu", () => {
    assert.deepStrictEqual(findStalledShops(SHOPS, { TW: "2026-11-01" }, { TW: 499999 }, "2026-11-12"), []);
});
t("mới 2 ngày → chưa kêu", () => {
    assert.deepStrictEqual(findStalledShops(SHOPS, { TW: "2026-11-10" }, { TW: 900000 }, "2026-11-12"), []);
});
t("shop chưa từng có đơn mà ads tiêu → kêu, không rõ số ngày", () => {
    const r = findStalledShops(SHOPS, {}, { SG: 700000 }, "2026-11-12");
    assert.deepStrictEqual(r, [{ shop: "SG", last_order_date: null, days: null, ads_vnd: 700000 }]);
});
t("ngưỡng đổi được", () => {
    const r = findStalledShops(SHOPS, { TW: "2026-11-10" }, { TW: 100000 }, "2026-11-12", { days: 2, minAds: 50000 });
    assert.strictEqual(r.length, 1);
});
console.log(`stalled-shops: ${pass} test qua`);
