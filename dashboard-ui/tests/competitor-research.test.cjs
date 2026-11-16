/** Soi đối thủ (15/11/2026): file config/competitor_research.json đúng khuôn + hàm thuần của lib/talpha/competitor-research.ts. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { returnLevel, compactNumber, sortByLast7Days, topSellers, filterByMarket, PRODUCT_GROUPS } = require("../.test-build/competitor-research.js");

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("  ✓", name); };
const FILE = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "config", "competitor_research.json"), "utf8"));
const PUBLIC = path.join(__dirname, "..", "public");
const GROUPS = new Set(PRODUCT_GROUPS.map((n) => n.id));
const nonNegative = (x) => Number.isInteger(x) && x >= 0;

console.log("── Soi đối thủ ──");
t("có ít nhất một bản soi, mới nhất đứng đầu, ngày + thị trường đúng dạng", () => {
    assert.ok(FILE.snapshots.length >= 1);
    const dates = FILE.snapshots.map((s) => s.date);
    assert.deepStrictEqual(dates, [...dates].sort().reverse(), "snapshots phải xếp ngày mới → cũ");
    for (const s of FILE.snapshots) {
        assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(s.date), s.date);
        assert.ok(/^[A-Z]{2}$/.test(s.market), s.market);
        assert.ok(s.source && s.summary.length > 0 && s.limitations.length > 0, s.source);
    }
});
t("mỗi sản phẩm: mã không trùng, nhóm hợp lệ, số không âm, tỉ lệ hoàn khớp, ảnh có thật, link https", () => {
    for (const s of FILE.snapshots) {
        const ids = new Set();
        for (const p of s.products) {
            const o = `${s.date} ${p.name}`;
            assert.ok(!ids.has(p.id), `${o}: trùng mã ${p.id}`); ids.add(p.id);
            assert.ok(/^[a-z0-9-]+$/.test(p.id), `${o}: mã ${p.id}`);
            assert.ok(GROUPS.has(p.group), `${o}: nhóm ${p.group}`);
            for (const k of ["shipped", "shipped_7d", "returning", "on_order", "in_delivery"]) assert.ok(nonNegative(p[k]), `${o}: ${k}`);
            assert.ok(Number.isInteger(p.stock), `${o}: tồn`);
            if (p.shipped > 0) assert.ok(Math.abs(p.return_rate - p.returning / p.shipped) < 0.001, `${o}: tỉ lệ hoàn`);
            else assert.strictEqual(p.return_rate, null, o);
            if (p.image !== null) {
                assert.ok(p.image.startsWith("/competitor-research/"), `${o}: ảnh ${p.image}`);
                assert.ok(fs.existsSync(path.join(PUBLIC, p.image)), `${o}: thiếu file ảnh ${p.image}`);
            }
            assert.ok(p.links.length > 0, `${o}: không có link spy`);
            for (const l of p.links) assert.ok(l.label && /^https:\/\//.test(l.url), `${o}: link ${l.url}`);
        }
    }
});
t("kênh TikTok: username không có @, có video top với id số", () => {
    for (const s of FILE.snapshots) for (const k of s.tiktok_channels) {
        assert.ok(/^[a-z0-9._]+$/.test(k.user), k.user);
        assert.ok(/^\d{15,22}$/.test(k.top_video.id), `${k.user}: id ${k.top_video.id}`);
        assert.ok(k.total_views >= k.top_video.views, `${k.user}: video top nhiều view hơn cả kênh`);
        assert.ok(k.followers === null || nonNegative(k.followers), k.user);
    }
});
t("mức hoàn và số gọn", () => {
    assert.strictEqual(returnLevel({ return_rate: 0.039, is_new: false }), "good");
    assert.strictEqual(returnLevel({ return_rate: 0.08, is_new: false }), "fair");
    assert.strictEqual(returnLevel({ return_rate: 0.15, is_new: false }), "fair");
    assert.strictEqual(returnLevel({ return_rate: 0.261, is_new: false }), "bad");
    assert.strictEqual(returnLevel({ return_rate: 0.3, is_new: true }), "new");
    assert.strictEqual(returnLevel({ return_rate: null, is_new: false }), "new");
    assert.strictEqual(compactNumber(1400000), "1,4M");
    assert.strictEqual(compactNumber(11500000), "11,5M");
    assert.strictEqual(compactNumber(62000), "62K");
    assert.strictEqual(compactNumber(950), "950");
});
t("xếp theo 7 ngày trong nhóm, bán nhiều nhất mọi nhóm", () => {
    const products = [
        { id: "a", group: "running", shipped_7d: 5, shipped: 10 },
        { id: "b", group: "running", shipped_7d: 9, shipped: 3 },
        { id: "c", group: "best_seller", shipped_7d: 99, shipped: 50 },
    ];
    assert.deepStrictEqual(sortByLast7Days(products, "running").map((p) => p.id), ["b", "a"]);
    assert.deepStrictEqual(topSellers(products, 2).map((p) => p.id), ["c", "a"]);
    assert.deepStrictEqual(products.map((p) => p.id), ["a", "b", "c"], "không được sửa mảng gốc");
});
t("lọc theo nước: leader UAE không thấy bản soi Đài, leader Đài thấy", () => {
    assert.deepStrictEqual(filterByMarket(FILE, (c) => c === "AE").snapshots, []);
    const tw = filterByMarket(FILE, (c) => c === "TW");
    assert.strictEqual(tw.snapshots.length, FILE.snapshots.filter((s) => s.market === "TW").length);
});
console.log(`competitor-research: ${pass} test qua`);
