/** Tệp khách (14/11/2026): file config/customer_segments.json đúng khuôn + hàm thuần của lib/talpha/customer-segments.ts. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { midpoint, femaleShare, ageShares, filterByMarket, AGE_BANDS } = require("../.test-build/customer-segments.js");

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("  ✓", name); };
const FILE = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "config", "customer_segments.json"), "utf8"));
const SEGMENTS = ["VN", "PH", "ID"];
const isRange = (k) => Array.isArray(k) && k.length === 2 && k[0] > 0 && k[0] <= k[1];

console.log("── Tệp khách ──");
t("file có ít nhất một bản đo, mới nhất đứng đầu", () => {
    assert.ok(FILE.snapshots.length >= 1);
    const dates = FILE.snapshots.map((s) => s.measured_on);
    assert.deepStrictEqual(dates, [...dates].sort().reverse(), "snapshots phải xếp ngày mới → cũ");
    for (const n of SEGMENTS) assert.ok(FILE.groups[n] && isRange(FILE.groups[n].fb_global), n);
});
t("mỗi tệp đủ khoảng Facebook, nam nữ, 4 nhóm tuổi, số chính thức", () => {
    for (const s of FILE.snapshots) {
        assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(s.measured_on), s.measured_on);
        for (const [code, m] of Object.entries(s.markets)) {
            assert.ok(/^[A-Z]{2}$/.test(code), code);
            assert.ok(isRange(m.fb_country), code);
            for (const n of SEGMENTS) {
                const x = m.segments[n], o = `${s.measured_on} ${code}/${n}`;
                assert.ok(x, o);
                for (const k of ["fb", "male", "female"]) assert.ok(isRange(x[k]), `${o} ${k}`);
                for (const k of AGE_BANDS) assert.ok(isRange(x.ages[k]), `${o} tuổi ${k}`);
                assert.ok(x.official > 0 && ["statistic", "estimate"].includes(x.official_kind), o);
                // Nam + nữ không thể vượt xa cả tệp (Meta làm tròn nên cho lệch 10%).
                assert.ok(x.male[0] + x.female[0] <= x.fb[1] * 1.1, `${o}: nam + nữ vượt cả tệp`);
            }
        }
    }
});
t("bảng có dòng Tổng thì các dòng cộng lại đúng bằng Tổng", () => {
    for (const s of FILE.snapshots) for (const m of Object.values(s.markets)) for (const b of m.tables) {
        const total = b.rows.find((d) => d.total);
        if (!total || !b.share_of_total) continue;
        for (const n of SEGMENTS) {
            const sum = b.rows.filter((d) => !d.total).reduce((x, d) => x + d[n], 0);
            assert.strictEqual(sum, total[n], `${b.title} / ${n}`);
        }
    }
});
t("xu hướng: ba dãy số dài bằng số mốc", () => {
    for (const s of FILE.snapshots) for (const m of Object.values(s.markets)) {
        if (!m.trend) continue;
        for (const n of SEGMENTS) assert.strictEqual(m.trend[n].length, m.trend.periods.length, `${m.name} ${n}`);
    }
});
t("tỷ lệ nữ và tỷ trọng tuổi tính từ điểm giữa", () => {
    assert.strictEqual(midpoint([100, 300]), 200);
    const seg = { male: [90, 110], female: [280, 320], ages: { "18-24": [10, 10], "25-34": [20, 20], "35-44": [30, 30], "45+": [40, 40] } };
    assert.strictEqual(femaleShare(seg), 0.75);
    assert.deepStrictEqual(ageShares(seg), [0.1, 0.2, 0.3, 0.4]);
    assert.strictEqual(femaleShare({ male: [0, 0], female: [0, 0], ages: {} }), 0);
});
t("lọc theo nước: leader Sing chỉ thấy SG, bản đo hết nước thì bỏ", () => {
    const sg = filterByMarket(FILE, (c) => c === "SG");
    assert.ok(sg.snapshots.length >= 1);
    for (const s of sg.snapshots) assert.deepStrictEqual(Object.keys(s.markets), ["SG"]);
    assert.deepStrictEqual(filterByMarket(FILE, (c) => c === "AE").snapshots, []);
    // Không sửa bản gốc.
    assert.ok(Object.keys(FILE.snapshots[0].markets).length >= 3);
});
console.log(`customer-segments: ${pass} test qua`);
