// node tests/inbox-rules.test.cjs (chạy qua npm test — tsc dựng .test-build trước)
// Tab Tin nhắn — gán hội thoại + tag nội bộ (17/11/2026): soát thao tác, ai gán được cho ai.
const assert = require("assert");
const R = require("../.test-build/inbox-rules.js");

let ok = 0;
const t = (name, fn) => { try { fn(); ok++; console.log("  ✓", name); } catch (e) { console.error("  ✗", name); throw e; } };

console.log("── Tin nhắn: gán + tag ──");
t("tạo tag: tên gọn khoảng trắng, cắt độ dài, màu lạ → slate", () => {
    assert.deepStrictEqual(R.parseInboxAction({ action: "create_tag", name: "  Chốt   đơn ", color: "emerald" }),
        { action: "create_tag", name: "Chốt đơn", color: "emerald" });
    assert.strictEqual(R.parseInboxAction({ action: "create_tag", name: "x".repeat(99) }).name.length, R.TAG_NAME_MAX);
    assert.strictEqual(R.parseInboxAction({ action: "create_tag", name: "A", color: "đỏ" }).color, "slate");
    assert.ok("error" in R.parseInboxAction({ action: "create_tag", name: "   " }));
});
t("gán: user_id rỗng / null = bỏ gán; thiếu hội thoại = lỗi", () => {
    assert.deepStrictEqual(R.parseInboxAction({ action: "assign", page_id: "p1", conversation_id: "c1", user_id: "u7" }),
        { action: "assign", page_id: "p1", conversation_id: "c1", user_id: "u7" });
    assert.strictEqual(R.parseInboxAction({ action: "assign", page_id: "p1", conversation_id: "c1", user_id: "" }).user_id, null);
    assert.strictEqual(R.parseInboxAction({ action: "assign", page_id: "p1", conversation_id: "c1" }).user_id, null);
    assert.ok("error" in R.parseInboxAction({ action: "assign", page_id: "p1", user_id: "u7" }));
    assert.ok("error" in R.parseInboxAction({ action: "assign", page_id: "p1", conversation_id: "c1", user_id: {} }));
});
t("gắn / gỡ tag: tag_id số nguyên dương, on mặc định true", () => {
    assert.deepStrictEqual(R.parseInboxAction({ action: "tag", page_id: "p", conversation_id: "c", tag_id: "3" }),
        { action: "tag", page_id: "p", conversation_id: "c", tag_id: 3, on: true });
    assert.strictEqual(R.parseInboxAction({ action: "tag", page_id: "p", conversation_id: "c", tag_id: 3, on: false }).on, false);
    assert.ok("error" in R.parseInboxAction({ action: "tag", page_id: "p", conversation_id: "c", tag_id: -1 }));
    assert.ok("error" in R.parseInboxAction({ action: "xoa_het" }));
    assert.ok("error" in R.parseInboxAction(null));
});
const users = [
    { id: "gd", name: "Sỹ Anh", role: "director", full: true, codes: ["TW", "SG", "AE", "JP", "VN"] },
    { id: "loc", name: "Lộc", role: "leader", full: false, codes: ["AE"] },
    { id: "thai", name: "Thái", role: "leader", full: false, codes: ["SG"] },
    { id: "thuong", name: "Thương", role: "sale", full: false, codes: ["TW", "SG", "AE", "JP"] },
];
t("gán được cho: người xem nước đó + giám đốc; page chưa gán nước → chỉ giám đốc", () => {
    assert.deepStrictEqual(R.assignableFor(users, "SG").map((u) => u.id), ["gd", "thai", "thuong"]);
    assert.deepStrictEqual(R.assignableFor(users, "VN").map((u) => u.id), ["gd"]);
    assert.deepStrictEqual(R.assignableFor(users, null).map((u) => u.id), ["gd"]);
});
t("bộ lọc người phụ trách: leader thấy người chung nước + giám đốc, giám đốc thấy hết", () => {
    assert.deepStrictEqual(R.visibleUsersFor({ full: false, codes: ["AE"] }, users).map((u) => u.id), ["gd", "loc", "thuong"]);
    assert.strictEqual(R.visibleUsersFor({ full: true, codes: [] }, users).length, 4);
});
console.log(`${ok} phép thử gán + tag tin nhắn qua.`);
