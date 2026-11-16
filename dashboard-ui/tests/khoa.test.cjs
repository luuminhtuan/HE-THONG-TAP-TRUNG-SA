// node tests/khoa.test.cjs (chạy qua npm test — tsc dựng .test-build trước)
// Khoá kết nối nhập ở /admin (04/11/2026; lưu ở bảng api_credentials từ 15/11/2026): soát khoá
// vừa dán và cách che khoá khi hiện trên trang.
const assert = require("assert");
const K = require("../.test-build/credential-utils.js");

let ok = 0;
const t = (ten, fn) => { try { fn(); ok++; console.log("  ✓", ten); } catch (e) { console.error("  ✗", ten); throw e; } };

console.log("── Khoá kết nối: soát khoá dán vào, che khoá ──");
t("khoá dán vào: từ chối trống, khoảng trắng, xuống dòng, ký tự lạ", () => {
    assert.ok(K.credentialValueError(""));
    assert.ok(K.credentialValueError("EAA abc"));
    assert.ok(K.credentialValueError("abc\ndef"));
    for (const c of ['"', "'", "#", "\\", "$", "`"]) assert.ok(K.credentialValueError(`abc${c}def`), c);
    assert.ok(K.credentialValueError("a".repeat(4097)));
    assert.strictEqual(K.credentialValueError("EAAGm0PX4ZCpsBAL9xyz"), null);
    assert.strictEqual(K.credentialValueError("eyJhbGciOi.eyJleHAiOjE.sig-_x"), null);   // JWT Pancake
});
t("che khoá: chỉ lộ 4 ký tự cuối, khoá ngắn che hết", () => {
    assert.strictEqual(K.maskCredential("EAAGm0PX4ZCpsBAL9xyz"), "••••9xyz");
    assert.strictEqual(K.maskCredential("abc12345"), "••••");
    assert.strictEqual(K.maskCredential(""), "");
});

console.log(`${ok} phép thử khoá kết nối qua.`);
