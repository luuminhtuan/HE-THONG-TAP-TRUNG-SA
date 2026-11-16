/**
 * ĐỐI SOÁT COD VIỆT NAM — số của trang khách hàng J&T VIP (khachhang.jtexpress.vn).
 *
 * J&T Việt Nam KHÔNG có cổng API công khai cho đối soát; trang J&T VIP gọi API nội bộ
 * `ylvipapi.jtexpress.vn/api/fcf/*` bằng header `authToken` = localStorage.YL_TOKEN của phiên đăng
 * nhập (JWT, sống chưa tới một ngày). Hai đường nạp số (13/11/2026, docs/COD_RECONCILIATION.md):
 *   • CHÍNH — Claude chạy ops/jt_vn/export-from-jt-page.js trong trang J&T (token không rời trang), tải
 *     jt_vn_raw.json về, rồi ops/jt_vn/load.cjs đẩy lên dashboard → snapshotFromExport().
 *   • PHỤ — route nhận token (chìa nội bộ) rồi tự kéo → fetchJtSnapshot(). Màn KHÔNG có ô dán token.
 *
 * API đã soi (POST JSON, chỉ cần authToken — token sai trả HTTP 401):
 *   queryFreightCheckForPage  {startCreateTime,endCreateTime,current,size} — các kỳ đối soát
 *   queryFreightCheckForDetail {reconciliationNumber,current,size}          — từng vận đơn của kỳ
 *   queryOngoingCodAmountDetail/codMoneyNum?current&size  {}               — đơn đang luân chuyển
 *   queryOngoingCodAmountSummary · queryLatestOverviewByCustomer           — tổng + số dư
 *
 * Một kỳ (J&T chốt mỗi ngày ~04h, trả tiền vài ngày một lần):
 *   tiền đối soát (payCurrentPayableAmount) = COD ký nhận − phí (cước + thu hộ + hoàn) ± điều chỉnh
 *   thực nhận (endingBalance)               = tiền đối soát + dư nợ kỳ trước (openingBalance)
 *   thực nhận ÂM thì không trả, mang sang làm dư nợ của kỳ sau.
 *   → tiền J&T đã chuyển về = Σ max(0, thực nhận) của các kỳ "FINISH_PAY".
 *
 * Mã đơn KH của J&T (customerOrderId) = mã đơn POS "S<shop>O<số đơn>" → nối thẳng với POS.
 * Khoá JSON (`ma`, `tao_luc`, `don`…) là dạng dữ liệu cất trong kho `jt_vn` (app_documents) — giữ nguyên.
 */

export const JT_API = "https://ylvipapi.jtexpress.vn/api/fcf/";

export class JtTokenExpired extends Error {
    constructor() { super("Token J&T sai hoặc đã hết hạn"); }
}

// ─── Kiểu dữ liệu cất trong kho jt_vn (app_documents) ─────────────────────────

export type JtPeriodOrder = {
    van_don: string; ma_kh: string; order_id: string | null;
    gui_luc: string | null; ky_nhan_luc: string | null;
    cod: number; cuoc: number; phi_cod: number; phi_hoan: number; phi_giao_1_phan: number;
    dieu_chinh: number; rong: number; tinh: string;
};
export type JtPeriod = {
    ma: string; tao_luc: string; tra_luc: string | null; da_tra: boolean;
    cod: number; phi: number; dieu_chinh: number; du_no_truoc: number; doi_soat: number; thuc_nhan: number;
    /** null = chưa kéo được chi tiết kỳ này. */
    don: JtPeriodOrder[] | null;
};
export type JtInTransit = {
    van_don: string; ma_kh: string; order_id: string | null; trang_thai: string;
    cod: number; cuoc: number; giao_luc: string | null;
};
export type JtSnapshot = {
    keo_luc: string;
    so_du: number | null; so_du_cap_nhat: string | null;
    dang_chay_tong: { so_don: number; cod: number; cuoc: number } | null;
    ky: JtPeriod[];
    dang_chay: JtInTransit[];
};

// ─── Hàm thuần ───────────────────────────────────────────────────────────────────

/** Giờ hết hạn của token (trường exp của JWT) — không đọc được thì null. */
export function tokenExpiry(token: string): string | null {
    const p = String(token || "").trim().replace(/^"|"$/g, "").split(".");
    if (p.length !== 3) return null;
    try {
        const json = Buffer.from(p[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
        const exp = Number(JSON.parse(json).exp);
        return Number.isFinite(exp) && exp > 0 ? new Date(exp * 1000).toISOString() : null;
    } catch {
        return null;
    }
}

/** Token người dùng gửi: bỏ nháy, khoảng trắng; nhận cả khi dán nguyên "authToken: xxx". */
export function cleanToken(s: string): string {
    return String(s || "").replace(/^\s*authToken\s*[:=]\s*/i, "").trim().replace(/^["']|["']$/g, "").trim();
}

/** "S1329125435O159" → "159" (số đơn POS). */
export function orderIdFromCustomerCode(code: string | null | undefined): string | null {
    const m = String(code || "").match(/^S\d+O(\d+)$/i);
    return m ? m[1] : null;
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const str = (v: unknown) => (v == null ? "" : String(v));

/** Chữ trạng thái J&T trả bằng tiếng Trung → tiếng Việt (lạ thì giữ nguyên). */
const JT_STATUS_VI: Record<string, string> = {
    "运输中": "Đang vận chuyển", "派件中": "Đang giao", "已签收": "Đã ký nhận", "签收": "Đã ký nhận",
    "问题件": "Kiện có vấn đề", "退件登记": "Đăng ký hoàn", "退件确认": "Đã xác nhận hoàn",
    "退件中": "Đang hoàn", "退件签收": "Đã hoàn về", "已揽收": "Đã lấy hàng", "揽收": "Đã lấy hàng",
    "到件": "Đến bưu cục", "发件": "Rời bưu cục", "留仓": "Lưu kho", "未知状态": "Không rõ",
};
export const jtStatusLabel = (s: string) => JT_STATUS_VI[s] || s || "—";

export function normalizePeriod(r: Record<string, unknown>): JtPeriod {
    return {
        ma: str(r.reconciliationNumber),
        tao_luc: str(r.createTime),
        tra_luc: r.payTime ? str(r.payTime) : null,
        da_tra: str(r.totalPayStatus) === "FINISH_PAY",
        cod: num(r.totalCodFee), phi: num(r.totalMonthFee), dieu_chinh: num(r.monthAdjustmentAmount),
        du_no_truoc: num(r.openingBalance), doi_soat: num(r.payCurrentPayableAmount), thuc_nhan: num(r.endingBalance),
        don: null,
    };
}

export function normalizePeriodOrder(r: Record<string, unknown>): JtPeriodOrder {
    const code = str(r.customerOrderId);
    return {
        van_don: str(r.waybillNo), ma_kh: code, order_id: orderIdFromCustomerCode(code),
        gui_luc: r.sendTime ? str(r.sendTime) : null, ky_nhan_luc: r.signTime ? str(r.signTime) : null,
        cod: num(r.codAmount), cuoc: num(r.monthTaxAmount), phi_cod: num(r.monthCodAmount),
        phi_hoan: num(r.monthRefundAmount), phi_giao_1_phan: num(r.monthPartialSignFee),
        dieu_chinh: num(r.adjustmentAmount), rong: num(r.difference),
        tinh: [r.recipientProv, r.recipientCity].filter(Boolean).map(str).join(", "),
    };
}

export function normalizeInTransit(r: Record<string, unknown>): JtInTransit {
    const code = str(r.customerOrderId);
    return {
        van_don: str(r.waybillNo), ma_kh: code, order_id: orderIdFromCustomerCode(code),
        trang_thai: jtStatusLabel(str(r.waybillStatusCode)),
        cod: num(r.codMoney), cuoc: num(r.taxAfterFee), giao_luc: r.deliveryTime ? str(r.deliveryTime) : null,
    };
}

/** Phần đuôi chung: số dư + tổng đang luân chuyển (từ hai API tổng của J&T). */
function balanceFields(summary: Record<string, unknown> | null | undefined, overview: Record<string, unknown> | null | undefined) {
    return {
        so_du: overview && overview.notClearedBalance != null ? num(overview.notClearedBalance) : null,
        so_du_cap_nhat: overview?.lastUpdateTime ? str(overview.lastUpdateTime) : null,
        dang_chay_tong: summary ? { so_don: num(summary.codMoneyNum), cod: num(summary.codMoney), cuoc: num(summary.taxAfterFee) } : null,
    };
}

/** File jt_vn_raw.json do ops/jt_vn/export-from-jt-page.js tải về (khoá giữ như bản xuất). */
export type JtExport = {
    xuat_luc: string;
    ky: Record<string, unknown>[];
    chi_tiet: Record<string, Record<string, unknown>[] | undefined>;
    dang_chay: Record<string, unknown>[];
    tong?: Record<string, unknown> | null;
    tq?: Record<string, unknown> | null;
};

/** Bản xuất từ trang J&T → bản cất trong kho. File sai dạng thì ném lỗi đọc được. */
export function snapshotFromExport(raw: unknown): JtSnapshot {
    const r = raw as Partial<JtExport> | null;
    if (!r || !Array.isArray(r.ky) || !r.chi_tiet || typeof r.chi_tiet !== "object" || !Array.isArray(r.dang_chay)) {
        throw new Error("File không đúng dạng jt_vn_raw (thiếu ky / chi_tiet / dang_chay)");
    }
    const details = r.chi_tiet;
    return {
        keo_luc: str(r.xuat_luc) || new Date().toISOString(),
        ...balanceFields(r.tong, r.tq),
        ky: r.ky.map((x) => {
            const p = normalizePeriod(x);
            const rows = details[p.ma];
            return { ...p, don: Array.isArray(rows) ? rows.map(normalizePeriodOrder) : null };
        }),
        dang_chay: r.dang_chay.map(normalizeInTransit),
    };
}

/** Đơn POS tối thiểu để đối chiếu (route đọc từ cùng nguồn với màn Theo dõi vận đơn). */
export type VnPosOrder = {
    order_id: string; tracking: string; order_date: string | null; trang_thai: string;
    nhom: "da_giao" | "chua_giao" | "khong_tinh"; cod: number; khach: string;
};

export type JtLedger = {
    tong: {
        da_ve: number; so_ky_da_tra: number; so_lan_chuyen: number; lan_tra_cuoi: string | null;
        cho_tra: number; so_ky_cho_tra: number;
        so_du: number | null;
        dang_chay: { so_don: number; cod: number; cuoc: number };
        cod_da_doi_soat: number; phi_da_tru: number; don_da_doi_soat: number;
        cuoc_tb: number | null; don_co_cuoc: number;
    };
    /** ngay / den: ngày đầu–cuối kỳ đọc từ mã kỳ ("…-20261106-1108" = 06→08/11). */
    ky: (JtPeriod & { so_don: number | null; ngay: string; den: string })[];
    dang_chay: JtInTransit[];
    doi_chieu: {
        /** POS báo đã giao nhưng chưa thấy ở kỳ nào, cũng không nằm trong "đang luân chuyển". */
        da_giao_chua_doi_soat: VnPosOrder[];
        /** J&T trả COD khác số trên đơn POS. */
        lech_cod: { order_id: string; van_don: string; ky: string; cod_pos: number; cod_jt: number; khach: string }[];
        /** Vận đơn J&T có trong kỳ mà mã đơn không ra đơn POS nào. */
        khong_co_tren_pos: { van_don: string; ma_kh: string; ky: string; cod: number }[];
        so_don_pos: number;
    };
};

/** Ngày đầu–cuối của kỳ từ mã "238LC41894-20261106-1108"; mã lạ thì lấy ngày J&T tạo kỳ. */
export function periodDates(k: Pick<JtPeriod, "ma" | "tao_luc">): { ngay: string; den: string } {
    const m = k.ma.match(/-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
    if (!m) return { ngay: k.tao_luc.slice(0, 10), den: k.tao_luc.slice(0, 10) };
    const start = `${m[1]}-${m[2]}-${m[3]}`;
    // Kỳ vắt qua năm mới: tháng cuối nhỏ hơn tháng đầu.
    const endYear = Number(m[4]) < Number(m[2]) ? Number(m[1]) + 1 : Number(m[1]);
    return { ngay: start, den: `${endYear}-${m[4]}-${m[5]}` };
}

/** Dựng số cho màn hình từ lần kéo J&T + đơn POS. Thuần — có phép thử. */
export function buildJtLedger(d: JtSnapshot, pos: VnPosOrder[]): JtLedger {
    const periods = [...d.ky].sort((a, b) => b.tao_luc.localeCompare(a.tao_luc) || b.ma.localeCompare(a.ma));
    const paid = periods.filter((k) => k.da_tra);
    const awaiting = periods.filter((k) => !k.da_tra);

    const posById = new Map(pos.map((p) => [p.order_id, p]));
    const posByTracking = new Map(pos.filter((p) => p.tracking).map((p) => [p.tracking, p]));
    const findPos = (orderId: string | null, tracking: string) =>
        (orderId ? posById.get(orderId) : undefined) || posByTracking.get(tracking);

    const reconciled = new Set<string>();     // order_id hoặc mã vận đơn đã vào một kỳ
    const codMismatch: JtLedger["doi_chieu"]["lech_cod"] = [];
    const notOnPos: JtLedger["doi_chieu"]["khong_co_tren_pos"] = [];
    let codTotal = 0, feeTotal = 0, orderCount = 0, freightTotal = 0, ordersWithFreight = 0;
    for (const k of periods) {
        for (const x of k.don || []) {
            orderCount++;
            codTotal += x.cod;
            feeTotal += x.cuoc + x.phi_cod + x.phi_hoan + x.phi_giao_1_phan;
            if (x.cuoc > 0) { freightTotal += x.cuoc; ordersWithFreight++; }
            reconciled.add(x.van_don);
            if (x.order_id) reconciled.add(`#${x.order_id}`);
            const p = findPos(x.order_id, x.van_don);
            if (!p) { if (x.cod > 0 || x.cuoc > 0) notOnPos.push({ van_don: x.van_don, ma_kh: x.ma_kh, ky: k.ma, cod: x.cod }); continue; }
            if (x.cod > 0 && Math.abs(x.cod - p.cod) >= 1) {
                codMismatch.push({ order_id: p.order_id, van_don: x.van_don, ky: k.ma, cod_pos: p.cod, cod_jt: x.cod, khach: p.khach });
            }
        }
    }
    const inTransitKeys = new Set<string>();
    for (const x of d.dang_chay) { inTransitKeys.add(x.van_don); if (x.order_id) inTransitKeys.add(`#${x.order_id}`); }
    const deliveredNotReconciled = pos.filter((p) => p.nhom === "da_giao"
        && !reconciled.has(`#${p.order_id}`) && !(p.tracking && reconciled.has(p.tracking))
        && !inTransitKeys.has(`#${p.order_id}`) && !(p.tracking && inTransitKeys.has(p.tracking)));

    const inTransitTotal = d.dang_chay_tong || {
        so_don: d.dang_chay.length,
        cod: d.dang_chay.reduce((a, x) => a + x.cod, 0),
        cuoc: d.dang_chay.reduce((a, x) => a + x.cuoc, 0),
    };
    return {
        tong: {
            da_ve: paid.reduce((a, k) => a + Math.max(0, k.thuc_nhan), 0),
            so_ky_da_tra: paid.length,
            so_lan_chuyen: paid.filter((k) => k.thuc_nhan > 0).length,
            lan_tra_cuoi: paid.map((k) => k.tra_luc).filter((x): x is string => !!x).sort().pop() || null,
            cho_tra: awaiting.reduce((a, k) => a + Math.max(0, k.thuc_nhan), 0),
            so_ky_cho_tra: awaiting.length,
            so_du: d.so_du,
            dang_chay: inTransitTotal,
            cod_da_doi_soat: codTotal, phi_da_tru: feeTotal, don_da_doi_soat: orderCount,
            cuoc_tb: ordersWithFreight ? Math.round(freightTotal / ordersWithFreight) : null, don_co_cuoc: ordersWithFreight,
        },
        ky: periods.map((k) => ({ ...k, so_don: k.don ? k.don.length : null, ...periodDates(k) })),
        dang_chay: d.dang_chay,
        doi_chieu: { da_giao_chua_doi_soat: deliveredNotReconciled, lech_cod: codMismatch, khong_co_tren_pos: notOnPos, so_don_pos: pos.length },
    };
}

// ─── Gọi J&T (đường phụ: route nhận token qua chìa nội bộ) ─────────────────────

type JtResponse = { code?: number; msg?: string; data?: Record<string, unknown> & { records?: Record<string, unknown>[]; pages?: number } };

async function callJt(token: string, endpoint: string, body: unknown): Promise<JtResponse["data"]> {
    const r = await fetch(JT_API + endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json;charset=UTF-8", authToken: token, langType: "VN" },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(20000),
        cache: "no-store",
    });
    if (r.status === 401 || r.status === 403) throw new JtTokenExpired();
    if (!r.ok) throw new Error(`J&T trả HTTP ${r.status} ở ${endpoint}`);
    const j = (await r.json()) as JtResponse;
    if (j.code !== 1) {
        if (/token|登录|login|过期|expire/i.test(String(j.msg))) throw new JtTokenExpired();
        throw new Error(`J&T báo lỗi ở ${endpoint}: ${j.msg ?? "không rõ"}`);
    }
    return j.data;
}

/** Lật hết các trang của một API có phân trang. */
async function fetchAllPages(token: string, endpoint: (page: number) => string, body: (page: number) => unknown) {
    const out: Record<string, unknown>[] = [];
    for (let page = 1; page <= 50; page++) {
        const d = await callJt(token, endpoint(page), body(page));
        out.push(...(d?.records || []));
        if (!d?.pages || page >= Number(d.pages)) break;
    }
    return out;
}

/** Ngày giờ VN (yyyy-mm-dd). */
const vnDate = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);

/**
 * Kéo một lần đủ số. Chi tiết của kỳ ĐÃ TRẢ không đổi nữa → lấy lại từ lần kéo trước (`previous`),
 * chỉ kéo chi tiết kỳ mới hoặc chưa trả.
 */
export async function fetchJtSnapshot(token: string, fromDate: string, previous: JtSnapshot | null, now = new Date()): Promise<JtSnapshot> {
    const to = vnDate(now);
    const periodRows = await fetchAllPages(token, () => "queryFreightCheckForPage", (page) => ({
        reconciliationNumber: "", startCreateTime: `${fromDate} 00:00:00`, endCreateTime: `${to} 23:59:59`,
        createTime: [`${fromDate} 00:00:00`, `${to} 23:59:59`], current: page, size: 100,
    }));
    const previousByCode = new Map((previous?.ky || []).map((k) => [k.ma, k]));
    const periods: JtPeriod[] = [];
    for (const r of periodRows) {
        const k = normalizePeriod(r);
        const old = previousByCode.get(k.ma);
        if (old && old.da_tra && k.da_tra && old.don) { periods.push({ ...k, don: old.don }); continue; }
        const rows = await fetchAllPages(token, () => "queryFreightCheckForDetail",
            (page) => ({ reconciliationNumber: k.ma, current: page, size: 500 }));
        periods.push({ ...k, don: rows.map(normalizePeriodOrder) });
    }
    const inTransit = await fetchAllPages(token,
        (page) => `queryOngoingCodAmountDetail/codMoneyNum?current=${page}&size=500`, () => ({}));
    const [summary, overview] = await Promise.all([
        callJt(token, "queryOngoingCodAmountSummary", {}).catch(() => null),
        callJt(token, "queryLatestOverviewByCustomer", {}).catch(() => null),
    ]);
    return {
        keo_luc: now.toISOString(),
        ...balanceFields(summary, overview),
        ky: periods,
        dang_chay: inTransit.map(normalizeInTransit),
    };
}
