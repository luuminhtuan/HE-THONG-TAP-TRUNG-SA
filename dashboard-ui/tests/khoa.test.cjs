// node tests/khoa.test.cjs (chạy qua npm test — tsc dựng .test-build trước)
// Khoá kết nối nhập ở /admin (04/11/2026): file khoá dạng .env mà systemd đọc thẳng, nên ghi
// sai một dòng là sync mất khoá. Soát đọc, sửa, che.
const assert = require("assert");
const K = require("../.test-build/khoa-file.js");

let ok = 0;
const t = (ten, fn) => { try { fn(); ok++; console.log("  ✓", ten); } catch (e) { console.error("  ✗", ten); throw e; } };

const FILE = [
    "# Khoá kết nối nhập ở /admin → Khoá kết nối. Dashboard tự ghi file này — đừng sửa tay.",
    "",
    "# TALPHA_META_ACCESS_TOKEN: a@b.vn lưu lúc 03/11/2026 09:00",
    "TALPHA_META_ACCESS_TOKEN=EAAold111122223333",
    "TALPHA_POSCAKE_TW_KEY=\"abc123\"",
    "",
].join("\n");

console.log("── Khoá kết nối: file khoá ──");
t("đọc TÊN=giá trị, bỏ ghi chú, bỏ nháy bọc ngoài", () => {
    const m = K.docEnv(FILE);
    assert.strictEqual(m.get("TALPHA_META_ACCESS_TOKEN"), "EAAold111122223333");
    assert.strictEqual(m.get("TALPHA_POSCAKE_TW_KEY"), "abc123");
    assert.strictEqual(m.size, 2);
});
t("ghi chú ai lưu, lúc nào đọc theo tên khoá", () => {
    assert.strictEqual(K.docGhiChu(FILE).get("TALPHA_META_ACCESS_TOKEN"), "a@b.vn lưu lúc 03/11/2026 09:00");
});
t("thay khoá: giữ mọi dòng khác, không để lại dòng cũ hay ghi chú cũ", () => {
    const moi = K.suaEnv(FILE, "TALPHA_META_ACCESS_TOKEN", "EAAnew999988887777", "c@d.vn lưu lúc 04/11/2026 10:00");
    const m = K.docEnv(moi);
    assert.strictEqual(m.get("TALPHA_META_ACCESS_TOKEN"), "EAAnew999988887777");
    assert.strictEqual(m.get("TALPHA_POSCAKE_TW_KEY"), "abc123");
    assert.ok(!moi.includes("EAAold"), "khoá cũ còn sót");
    assert.strictEqual((moi.match(/^# TALPHA_META_ACCESS_TOKEN:/gm) || []).length, 1);
    assert.strictEqual(K.docGhiChu(moi).get("TALPHA_META_ACCESS_TOKEN"), "c@d.vn lưu lúc 04/11/2026 10:00");
    assert.ok(moi.startsWith("# Khoá kết nối"), "mất dòng đầu file");
    assert.ok(moi.endsWith("\n") && !moi.endsWith("\n\n"));
});
t("ghi chú nằm ở DÒNG RIÊNG — systemd không cắt ghi chú cuối dòng", () => {
    const moi = K.suaEnv("", "TRACK17_API_KEY", "k17abcdef", "x lưu lúc y");
    for (const dong of moi.trim().split("\n")) {
        if (dong.startsWith("TRACK17_API_KEY=")) assert.strictEqual(dong, "TRACK17_API_KEY=k17abcdef");
    }
});
t("bỏ khoá: mất cả dòng khoá lẫn ghi chú, khoá khác còn nguyên", () => {
    const moi = K.suaEnv(FILE, "TALPHA_META_ACCESS_TOKEN", null);
    const m = K.docEnv(moi);
    assert.ok(!m.has("TALPHA_META_ACCESS_TOKEN"));
    assert.ok(!moi.includes("# TALPHA_META_ACCESS_TOKEN:"));
    assert.strictEqual(m.get("TALPHA_POSCAKE_TW_KEY"), "abc123");
});
t("thêm khoá vào file trống", () => {
    assert.strictEqual(K.suaEnv("", "TALPHA_PANCAKE_API_TOKEN", "eyJ.a.b"), "TALPHA_PANCAKE_API_TOKEN=eyJ.a.b\n");
    assert.strictEqual(K.suaEnv("", "X", null), "");
});
t("tên khoá là tiền tố của tên khác không bị xoá nhầm (TRACK17_API_KEY vs _2)", () => {
    const f = "TRACK17_API_KEY=aaa\nTRACK17_API_KEY_2=bbb\n";
    const m = K.docEnv(K.suaEnv(f, "TRACK17_API_KEY", "ccc"));
    assert.strictEqual(m.get("TRACK17_API_KEY"), "ccc");
    assert.strictEqual(m.get("TRACK17_API_KEY_2"), "bbb");
});
t("khoá dán vào: từ chối trống, khoảng trắng, xuống dòng, ký tự làm hỏng file .env", () => {
    assert.ok(K.loiGiaTri(""));
    assert.ok(K.loiGiaTri("EAA abc"));
    assert.ok(K.loiGiaTri("abc\ndef"));
    for (const c of ['"', "'", "#", "\\", "$", "`"]) assert.ok(K.loiGiaTri(`abc${c}def`), c);
    assert.ok(K.loiGiaTri("a".repeat(4097)));
    assert.strictEqual(K.loiGiaTri("EAAGm0PX4ZCpsBAL9xyz"), null);
    assert.strictEqual(K.loiGiaTri("eyJhbGciOi.eyJleHAiOjE.sig-_x"), null);   // JWT Pancake
});
t("che khoá: chỉ lộ 4 ký tự cuối, khoá ngắn che hết", () => {
    assert.strictEqual(K.cheKhoa("EAAGm0PX4ZCpsBAL9xyz"), "••••9xyz");
    assert.strictEqual(K.cheKhoa("abc12345"), "••••");
    assert.strictEqual(K.cheKhoa(""), "");
});

console.log(`${ok} phép thử khoá kết nối qua.`);
