// node zalo_text.test.js   (không cần cài gì thêm)
const assert = require("assert");
const { B, I, M, clean, toZalo, splitMessage } = require("./zalo_text");

let ok = 0;
const t = (name, fn) => { fn(); ok++; };
const boldParts = (r) => r.styles.filter((s) => s.st === "b").map((s) => r.msg.slice(s.start, s.start + s.len));

t("chữ trơn không có style", () => {
    assert.deepStrictEqual(toZalo("Tiền ads: 100đ"), { msg: "Tiền ads: 100đ", styles: [] });
});

t("B() thành dải đậm đúng chỗ, không còn ký tự cờ", () => {
    const r = toZalo(`Tiền ads: ${B("3.317.921đ")} · Đơn ${B(10)}`);
    assert.strictEqual(r.msg, "Tiền ads: 3.317.921đ · Đơn 10");
    assert.deepStrictEqual(boldParts(r), ["3.317.921đ", "10"]);
});

t("emoji đứng trước vẫn đậm đúng chữ (vị trí tính theo UTF-16)", () => {
    const r = toZalo(`💰 Tiền ads: ${B("480.000đ")}`);
    assert.deepStrictEqual(boldParts(r), ["480.000đ"]);
    assert.strictEqual(r.styles[0].start, "💰 Tiền ads: ".length);
});

t("tên campaign có * và _ KHÔNG làm nghiêng/đậm loạn", () => {
    const r = toZalo("• SET_KIM_CUONG *hot* _x_");
    assert.strictEqual(r.msg, "• SET_KIM_CUONG *hot* _x_");
    assert.deepStrictEqual(r.styles, []);
});

t("ký tự cờ lọt vào dữ liệu thì bị lọc", () => {
    assert.strictEqual(clean("abc"), "abc");
    assert.deepStrictEqual(toZalo(B("xy")), { msg: "xy", styles: [{ start: 0, len: 2, st: "b" }] });
});

t("I() thành nghiêng; B() đặt trong I() bị bỏ cờ chứ không vỡ tin", () => {
    // B/I lọc cờ ở phần chữ được bọc — để dữ liệu lạ không mở được dải style — nên
    // không lồng nhau được. Bản tin không cần lồng; ghép cạnh nhau thì vẫn đúng.
    const r = toZalo(I(`số ${B("chưa chốt")} còn lên`));
    assert.deepStrictEqual(r, { msg: "số chưa chốt còn lên", styles: [{ start: 0, len: 20, st: "i" }] });
    const r2 = toZalo(`${B("SỐ CHƯA ĐỦ")} ${I("đợi sync")}`);
    assert.deepStrictEqual(r2.styles, [{ start: 0, len: 10, st: "b" }, { start: 11, len: 8, st: "i" }]);
});

t("cờ rỗng B('') không sinh style độ dài 0", () => {
    assert.deepStrictEqual(toZalo(`a${B("")}b`), { msg: "ab", styles: [] });
});

t("tin ngắn không bị chia", () => {
    const r = toZalo(`${B("TỔNG TEAM")}\nx`);
    assert.strictEqual(splitMessage(r, 1800).length, 1);
});

t("tin dài chia ở dòng trống, mỗi phần ≤ max, style dời đúng phần", () => {
    const block = (i) => `${B("Camp " + i)}\n` + "x".repeat(80);
    const r = toZalo(Array.from({ length: 30 }, (_, i) => block(i)).join("\n\n"));
    const parts = splitMessage(r, 500);
    assert.ok(parts.length > 1);
    for (const p of parts) {
        assert.ok(p.msg.length <= 500, `phần dài ${p.msg.length}`);
        assert.ok(!p.msg.startsWith("\n") && !p.msg.endsWith("\n"));
        for (const s of p.styles) assert.ok(s.start >= 0 && s.start + s.len <= p.msg.length);
    }
    // Không mất chữ đậm nào: gom lại đủ 30 tên camp, đúng thứ tự.
    const boldTexts = parts.flatMap((p) => boldParts(p));
    assert.deepStrictEqual(boldTexts, Array.from({ length: 30 }, (_, i) => "Camp " + i));
    // Không mất chữ: nối lại (bỏ khoảng trắng chỗ cắt) bằng bản gốc.
    assert.strictEqual(parts.map((p) => p.msg).join("").replace(/\s/g, ""), r.msg.replace(/\s/g, ""));
});

t("không có xuống dòng thì cắt cứng, không xẻ đôi emoji", () => {
    const r = toZalo("a" + "💰".repeat(300));
    const parts = splitMessage(r, 101);
    for (const p of parts) {
        const lastCode = p.msg.charCodeAt(p.msg.length - 1);
        assert.ok(!(lastCode >= 0xd800 && lastCode <= 0xdbff), "cắt giữa cặp surrogate");
        assert.ok(p.msg.length <= 101);
    }
    assert.strictEqual(parts.map((p) => p.msg).join(""), r.msg);
});

t("dải đậm vắt qua chỗ cắt thì mỗi phần giữ phần đậm của mình", () => {
    const r = toZalo(B("a".repeat(150) + "\n" + "b".repeat(150)));
    const parts = splitMessage(r, 200);
    assert.strictEqual(parts.length, 2);
    assert.deepStrictEqual(parts[0].styles, [{ start: 0, len: 150, st: "b" }]);
    assert.deepStrictEqual(parts[1].styles, [{ start: 0, len: 150, st: "b" }]);
});

t("nhắc tên: chữ @Thương hiện ra, kèm vị trí + uid để điện thoại người đó báo", () => {
    const r = toZalo("☎️ " + M("Thương", "3346668495041864321") + " gọi khách");
    assert.strictEqual(r.msg, "☎️ @Thương gọi khách");
    assert.deepStrictEqual(r.mentions, [{ pos: 3, len: 7, uid: "3346668495041864321" }]);
});
t("nhắc tên không có uid → chỉ là chữ, không có mention", () => {
    const r = toZalo(M("Thương"));
    assert.strictEqual(r.msg, "@Thương");
    assert.strictEqual(r.mentions, undefined);
});
t("nhắc tên đi cùng chữ đậm, và giữ đúng chỗ khi tin bị chia", () => {
    const r = toZalo(B("x".repeat(150)) + "\n" + M("Thương", "123") + " " + "y".repeat(100));
    const parts = splitMessage(r, 200);
    assert.strictEqual(parts.length, 2);
    assert.deepStrictEqual(parts[0].mentions, []);
    assert.deepStrictEqual(parts[1].mentions, [{ pos: 0, len: 7, uid: "123" }]);
});

console.log(`zalo_text.test.js: ${ok}/${ok} PASS`);
