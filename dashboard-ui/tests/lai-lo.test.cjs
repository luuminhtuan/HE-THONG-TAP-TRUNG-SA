/**
 * Lãi lỗ — kết quả kinh doanh (04/11/2026). Chỗ sai là số lãi sai hẳn: đếm hàng đang hoàn
 * vào "đang đi", tính giá vốn hai lần cho kiện giao lại, hay chia chi phí chung theo phần
 * nước người xem thấy (leader gánh 100%).
 */
const assert = require("assert");
const L = require("../.test-build/income-statement.js");

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("  ✓", name); };
const approx = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

const parcel = (o) => ({
    nuoc: "TW", ma: "X", ngay: "2026-10-01", nhom: "giao", trang_thai: "",
    cod_vnd: 1000, cod_that_vnd: null, gia_von_vnd: 100,
    phi_di_vnd: 50, phi_giao_vnd: 0, phi_hoan_vnd: 0, phi_that: true, hang_ve_kho: false, ...o,
});

console.log("── Phân kiện ──");
t("Delivered = giao · Returned/Destroyed = hoàn · Cancelled = huỷ", () => {
    assert.strictEqual(L.classifyParcel("Delivered"), "giao");
    assert.strictEqual(L.classifyParcel("Returned"), "hoan");
    assert.strictEqual(L.classifyParcel("Destroyed"), "hoan");
    assert.strictEqual(L.classifyParcel("Cancelled"), "huy");
});
t("chữ gốc 'Đang hoàn về kho' map ra DeliveryFailure vẫn là HOÀN, không phải đang đi", () => {
    assert.strictEqual(L.classifyParcel("DeliveryFailure", null, "Đang hoàn về kho", true), "hoan");
    assert.strictEqual(L.classifyParcel("Exception", "Exception_Returning", null, true), "hoan");
});
t("chưa có ngày gửi + InfoReceived = chờ gửi; đã gửi = đang đi", () => {
    assert.strictEqual(L.classifyParcel("InfoReceived", null, "Đã lên đơn", false), "cho_gui");
    assert.strictEqual(L.classifyParcel(null, null, null, false), "cho_gui");
    assert.strictEqual(L.classifyParcel("InTransit", null, null, true), "dang_di");
    assert.strictEqual(L.classifyParcel("NotFound", null, null, true), "dang_di");
});

console.log("── Tỉ lệ giao ──");
t("bỏ kiện mới (dưới 21 ngày), tính theo tiền COD", () => {
    const ks = [
        parcel({ ngay: "2026-09-01", nhom: "giao", cod_vnd: 3000 }),
        parcel({ ngay: "2026-09-02", nhom: "hoan", cod_vnd: 1000 }),
        parcel({ ngay: "2026-10-30", nhom: "giao", cod_vnd: 9999 }),  // quá gần — bỏ
    ];
    const r = L.computeDeliveryRate(ks, "2026-11-04", { cua_so_ngay: 90, bo_gan_ngay: 21, mau_toi_thieu: 2 });
    approx(r.r, 0.75); assert.strictEqual(r.giao, 1); assert.strictEqual(r.tam, false);
});
t("mẫu nhỏ → lấy mọi kiện xong và báo tạm", () => {
    const ks = [parcel({ ngay: "2026-10-30", nhom: "giao" }), parcel({ ngay: "2026-10-31", nhom: "hoan" })];
    const r = L.computeDeliveryRate(ks, "2026-11-04");
    approx(r.r, 0.5); assert.strictEqual(r.tam, true);
});
t("chưa kiện nào xong → r null", () => {
    assert.strictEqual(L.computeDeliveryRate([parcel({ nhom: "dang_di" })], "2026-11-04").r, null);
});

console.log("── Một kiện ──");
t("giao: doanh thu đủ, giá vốn đủ, phí giao + chênh tỷ giá", () => {
    const k = L.parcelAmounts(parcel({ cod_that_vnd: 930, phi_giao_vnd: 20 }), 1);
    approx(k.doanh_thu, 1000); approx(k.gia_von, 100); approx(k.phi.di, 50); approx(k.phi.giao, 20); approx(k.phi.ty_gia, 70);
});
t("hoàn ở Đài: không doanh thu, giá vốn MẤT, phí đi vẫn mất", () => {
    const k = L.parcelAmounts(parcel({ nhom: "hoan", phi_hoan_vnd: 10 }), 0);
    approx(k.doanh_thu, 0); approx(k.gia_von, 100); approx(k.phi.di, 50); approx(k.phi.hoan, 10); approx(k.phi.ty_gia, 0);
});
t("hoàn ở UAE (hàng về kho D&T): giá vốn KHÔNG mất", () => {
    const k = L.parcelAmounts(parcel({ nhom: "hoan", hang_ve_kho: true }), 0);
    approx(k.gia_von, 0); approx(k.phi.di, 50);
});
t("đang đi, tỉ lệ 0,8: doanh thu 80%, giá vốn đủ (Đài), UAE chỉ 80%", () => {
    const a = L.parcelAmounts(parcel({ nhom: "dang_di", phi_hoan_vnd: 10 }), 0.8);
    approx(a.doanh_thu, 800); approx(a.gia_von, 100); approx(a.phi.hoan, 2);
    const b = L.parcelAmounts(parcel({ nhom: "dang_di", hang_ve_kho: true }), 0.8);
    approx(b.gia_von, 80);
});
t("huỷ trước khi đi: chỉ tính phí nếu sao kê có thu", () => {
    approx(L.parcelAmounts(parcel({ nhom: "huy", phi_that: false }), 1).phi.di, 0);
    approx(L.parcelAmounts(parcel({ nhom: "huy", phi_that: true }), 1).phi.di, 50);
    approx(L.parcelAmounts(parcel({ nhom: "huy" }), 1).gia_von, 0);
});

console.log("── Tổng một nước ──");
t("dự kiến vs tối thiểu: tối thiểu coi kiện đang đi là hoàn", () => {
    const ks = [parcel({ nhom: "giao" }), parcel({ nhom: "dang_di" }), parcel({ nhom: "hoan", hoan_con_han: true })];
    const s = L.sumParcels(ks, 0.5);
    approx(s.doanh_thu_chac, 1000);
    approx(s.du_kien.doanh_thu, 1500);
    approx(s.toi_thieu.doanh_thu, 1000);
    approx(s.du_kien.gia_von, 300);
    assert.strictEqual(s.kien.tong.n, 3);
    assert.strictEqual(s.hoan_con_han.n, 1); approx(s.hoan_con_han.gia_von, 100);
});
t("kiện thiếu giá vốn được đếm, không âm thầm coi là 0", () => {
    const s = L.sumParcels([parcel({ gia_von_vnd: null }), parcel({ nhom: "huy", gia_von_vnd: null })], 1);
    assert.strictEqual(s.thieu_gia_von, 1);
});

console.log("── Chờ lên 3PL ──");
t("chỉ ước phần chênh của mấy ngày cuối; ngày cũ không ước", () => {
    const ds = [
        { date: "2026-10-20", doanh_so: 5000 },  // cũ — bỏ
        { date: "2026-11-03", doanh_so: 3000 },
        { date: "2026-11-04", doanh_so: 2000 },
    ];
    const ks = [parcel({ ngay: "2026-11-03", cod_vnd: 1000 })];
    const c = L.estimatePending3pl(ds, ks, 0.5, "2026-11-04", 3);
    approx(c.vnd, 4000);  // (3000−1000) + 2000
    approx(c.khoan.doanh_thu, 2000);  // 4000 × 0,5
    approx(c.khoan.gia_von, 400);     // 100 mỗi 1000 COD
});

console.log("── Chi phí vận hành ──");
t("chia theo ngày trong tháng, lặp mỗi tháng tới den_thang", () => {
    const k = { id: "a", nhom: "Lương", ten: "x", so_tien_thang_vnd: 3_100_000, tu_thang: "2026-10", den_thang: null, thuoc: "CHUNG" };
    approx(L.opexInRange(k, "2026-10-01", "2026-10-31"), 3_100_000);
    approx(L.opexInRange(k, "2026-10-01", "2026-10-10"), 1_000_000);
    approx(L.opexInRange(k, "2026-09-01", "2026-09-30"), 0);
    approx(L.opexInRange({ ...k, den_thang: "2026-10" }, "2026-10-01", "2026-11-30"), 3_100_000);
});
t("chung chia theo doanh số MỌI nước; khoản riêng về đúng nước", () => {
    const items = [
        { id: "a", nhom: "Lương", ten: "chung", so_tien_thang_vnd: 3_000_000, tu_thang: "2026-11", den_thang: null, thuoc: "CHUNG" },
        { id: "b", nhom: "Lương", ten: "Lộc", so_tien_thang_vnd: 6_000_000, tu_thang: "2026-11", den_thang: null, thuoc: "AE" },
    ];
    const p = L.allocateOpex(items, "2026-11-01", "2026-11-30", { TW: 300, AE: 100 });
    approx(p.theo_nuoc.TW.chung, 2_250_000); approx(p.theo_nuoc.AE.chung, 750_000);
    approx(p.theo_nuoc.AE.rieng, 6_000_000);
});
t("kiểm khoản gõ tay", () => {
    assert.ok(L.opexItemError({ ten: "", nhom: "Lương", so_tien_thang_vnd: 1, tu_thang: "2026-11", thuoc: "CHUNG" }, ["TW"]));
    assert.ok(L.opexItemError({ ten: "a", nhom: "Lương", so_tien_thang_vnd: 1, tu_thang: "2026-13", thuoc: "CHUNG" }, ["TW"]));
    assert.ok(L.opexItemError({ ten: "a", nhom: "Lương", so_tien_thang_vnd: 1, tu_thang: "2026-11", thuoc: "XX" }, ["TW"]));
    assert.ok(L.opexItemError({ ten: "a", nhom: "Lương", so_tien_thang_vnd: 1, tu_thang: "2026-11", den_thang: "2026-10", thuoc: "TW" }, ["TW"]));
    assert.strictEqual(L.opexItemError({ ten: "a", nhom: "Lương", so_tien_thang_vnd: 1, tu_thang: "2026-11", den_thang: null, thuoc: "TW" }, ["TW"]), null);
});

console.log(`\n${pass} phép thử lãi lỗ qua.`);
