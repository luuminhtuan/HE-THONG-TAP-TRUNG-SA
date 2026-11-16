/**
 * CHẠY TRONG TRANG khachhang.jtexpress.vn (đã đăng nhập) — Claude dán qua công cụ Chrome, hoặc
 * người dán vào Console. Gọi đúng các API mà trang Dòng tiền gọi, bằng phiên đăng nhập của chính
 * trang (token không rời khỏi trang), rồi tải về file jt_vn_raw.json — đã BỎ tên, số điện thoại,
 * địa chỉ người nhận. Nạp file đó vào dashboard bằng ops/jt_vn/load.cjs.
 *
 * Khoá của file xuất (xuat_luc, ky, chi_tiet, dang_chay, tong, tq) là dạng dữ liệu mà
 * lib/talpha/jt-vn.ts → snapshotFromExport đọc — đổi ở đây thì đổi cả bên đó.
 */
(async () => {
    const FROM_DATE = "2026-10-15";   // ≡ talpha_rules.json → cod_settlement.jt_vn.from_date
    const API = "https://ylvipapi.jtexpress.vn/api/fcf/";
    const HEADERS = { "Content-Type": "application/json;charset=UTF-8", authToken: localStorage.YL_TOKEN, langType: "VN" };
    const call = async (endpoint, body) => {
        const r = await fetch(API + endpoint, { method: "POST", headers: HEADERS, body: JSON.stringify(body || {}) });
        if (!r.ok) throw new Error(endpoint + " HTTP " + r.status + " — đăng nhập lại J&T");
        const j = await r.json();
        if (j.code !== 1) throw new Error(endpoint + ": " + j.msg);
        return j.data;
    };
    const allPages = async (endpoint, body) => {
        const out = [];
        for (let page = 1; page <= 50; page++) {
            const d = await call(endpoint(page), body(page));
            out.push(...(d.records || []));
            if (!d.pages || page >= Number(d.pages)) break;
        }
        return out;
    };
    const pick = (r, keys) => Object.fromEntries(keys.map((k) => [k, r[k] ?? null]));
    const to = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
    const periods = await allPages(() => "queryFreightCheckForPage", (page) => ({
        reconciliationNumber: "", startCreateTime: FROM_DATE + " 00:00:00", endCreateTime: to + " 23:59:59",
        createTime: [FROM_DATE + " 00:00:00", to + " 23:59:59"], current: page, size: 100,
    }));
    const details = {};
    for (const p of periods) {
        const rows = await allPages(() => "queryFreightCheckForDetail", (page) => ({ reconciliationNumber: p.reconciliationNumber, current: page, size: 500 }));
        details[p.reconciliationNumber] = rows.map((r) => pick(r, ["waybillNo", "customerOrderId", "sendTime", "signTime",
            "codAmount", "monthTaxAmount", "monthCodAmount", "monthRefundAmount", "monthPartialSignFee",
            "adjustmentAmount", "difference", "recipientProv", "recipientCity"]));
    }
    const inTransit = (await allPages((page) => "queryOngoingCodAmountDetail/codMoneyNum?current=" + page + "&size=500", () => ({})))
        .map((r) => pick(r, ["waybillNo", "customerOrderId", "waybillStatusCode", "codMoney", "taxAfterFee", "deliveryTime"]));
    const summary = await call("queryOngoingCodAmountSummary", {}).catch(() => null);
    const overview = await call("queryLatestOverviewByCustomer", {}).catch(() => null);
    const out = { xuat_luc: new Date().toISOString(), ky: periods, chi_tiet: details, dang_chay: inTransit, tong: summary, tq: overview };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: "application/json" }));
    a.download = "jt_vn_raw.json";
    document.body.appendChild(a); a.click(); a.remove();
    return "periods=" + periods.length + " period_orders=" + Object.values(details).reduce((s, x) => s + x.length, 0) + " in_transit=" + inTransit.length;
})()
