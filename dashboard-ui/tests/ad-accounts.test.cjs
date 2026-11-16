// Loại TKQC (04/11/2026) — bản dashboard (src/lib/talpha/ad-account-rules.ts) phải ra CÙNG loại với bản sync
// (sync/core/ad_accounts.py → initial_account_type, tests/test_tkqc.py). Lệch là trang /admin → TKQC "Quét ngay" gán một
// loại, vòng sync gán loại khác cho TKQC mới.
const assert = require("assert");
const L = require("../.test-build/ad-account-rules.js");

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("  ✓ " + name); };

console.log("── Loại TKQC thấy lần đầu ──");
t("VND → loại mặc định (antalo, vào báo cáo)", () => {
    assert.strictEqual(L.initialAccountKind("111", "VND"), "antalo");
    assert.strictEqual(L.initialAccountKind("act_111", "vnd"), "antalo");
    assert.ok(L.listAccountKinds().find((l) => l.code === "antalo").include_in_report);
});
t("tiền khác VND → other, KHÔNG vào báo cáo (engine coi chi tiêu là VND)", () => {
    assert.strictEqual(L.initialAccountKind("222", "USD"), "other");
    assert.ok(!L.listAccountKinds().find((l) => l.code === "other").include_in_report);
});
t("TKQC bán hạt giống trong nước gán sẵn → seed, không vào báo cáo", () => {
    assert.strictEqual(L.initialAccountKind("2332183394212686", "VND"), "seed");
    assert.strictEqual(L.initialAccountKind("act_2332183394212686", "VND"), "seed");
    assert.ok(!L.listAccountKinds().find((l) => l.code === "seed").include_in_report);
});
t("danh sách loại bỏ khoá ghi chú _…", () => {
    assert.deepStrictEqual(L.listAccountKinds().map((l) => l.code), ["antalo", "seed", "other"]);
});

console.log(`\n${pass} phép thử loại TKQC qua.`);
