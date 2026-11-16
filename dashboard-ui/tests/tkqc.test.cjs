// Loại TKQC (04/11/2026) — bản dashboard (src/lib/talpha/tkqc-luat.ts) phải ra CÙNG loại với bản sync
// (sync/core/tkqc.py → loai_lan_dau, tests/test_tkqc.py). Lệch là trang /admin → TKQC "Quét ngay" gán một
// loại, vòng sync gán loại khác cho TKQC mới.
const assert = require("assert");
const L = require("../.test-build/tkqc-luat.js");

let pass = 0;
const t = (ten, fn) => { fn(); pass++; console.log("  ✓ " + ten); };

console.log("── Loại TKQC thấy lần đầu ──");
t("VND → loại mặc định (antalo, vào báo cáo)", () => {
    assert.strictEqual(L.initialAccountKind("111", "VND"), "antalo");
    assert.strictEqual(L.initialAccountKind("act_111", "vnd"), "antalo");
    assert.ok(L.listAccountKinds().find((l) => l.ma === "antalo").vao_bao_cao);
});
t("tiền khác VND → khac, KHÔNG vào báo cáo (engine coi chi tiêu là VND)", () => {
    assert.strictEqual(L.initialAccountKind("222", "USD"), "khac");
    assert.ok(!L.listAccountKinds().find((l) => l.ma === "khac").vao_bao_cao);
});
t("TKQC bán hạt giống trong nước gán sẵn → hat_giong, không vào báo cáo", () => {
    assert.strictEqual(L.initialAccountKind("2332183394212686", "VND"), "hat_giong");
    assert.strictEqual(L.initialAccountKind("act_2332183394212686", "VND"), "hat_giong");
    assert.ok(!L.listAccountKinds().find((l) => l.ma === "hat_giong").vao_bao_cao);
});
t("danh sách loại bỏ khoá ghi chú _…", () => {
    assert.deepStrictEqual(L.listAccountKinds().map((l) => l.ma), ["antalo", "hat_giong", "khac"]);
});

console.log(`\n${pass} phép thử loại TKQC qua.`);
