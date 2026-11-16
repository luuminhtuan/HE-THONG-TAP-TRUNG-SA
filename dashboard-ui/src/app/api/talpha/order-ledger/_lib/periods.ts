import type { loadTwOrderLedger } from "@/lib/talpha/tw-order-ledger";
import { statementDateFromName, type PurchasePayment } from "@/lib/talpha/purchase-sheet";
import {
    doneKey, chaseLabel, periodState, shouldResurface, STATE_LABEL,
    type BankEntry, type DoneEntry,
} from "@/lib/talpha/cod-actions";
import { periodCashFlow } from "./period-cash-flow";

/** Kết quả nạp sổ đơn Đài (lib/talpha/tw-order-ledger.ts). */
export type LedgerData = Awaited<ReturnType<typeof loadTwOrderLedger>>;
export type LedgerStatement = LedgerData["stm"]["statements"][number];
export type LedgerRows = LedgerData["rows"];
export type LedgerExtra = LedgerData["extra"];

/** Báo cáo từng kỳ sao kê — xem chú thích ở build-order-ledger.ts. */
export function buildPeriods(
    statements: LedgerStatement[], rows: LedgerRows, extra: LedgerExtra,
    batchByStatement: Map<string, PurchasePayment>,
    bankOf: (fn: string) => BankEntry | undefined,
) {
    return statements.map((st) => {
        const mine = rows.filter((r) => r.paid_period === st.filename);
        const diff = mine.filter((r) => r.diff_twd !== null && Math.abs(r.diff_twd) > 1);
        const wrongFees = mine.filter((r) => r.fee_wrong);
        const extraLines = extra.filter((e) => e.period === st.filename);
        const n = st.naza;
        // NGÀY CHỐT KỲ = ngày nhận hàng muộn nhất trong sheet COD của kỳ đó.
        // KHÔNG dùng uploaded_at để sắp thứ tự: tải bảy file lên cùng một lúc
        // thì thời điểm tải gần như bằng nhau và "kỳ mới nhất" hoá ra chỉ vào
        // kỳ cũ nhất. Đã dính thật.
        const periodDate = st.rows.reduce((mx, r) => (r.paid_date > mx ? r.paid_date : mx), "");
        return {
            id: st.id,
            filename: st.filename,
            uploaded_at: st.uploaded_at,
            period_date: periodDate,
            // Phần đơn KHỚP SỔ ĐƠN — không phải tổng của kỳ. Tổng kỳ ở `luong`.
            orders_paid: mine.length,
            total_twd: mine.reduce((a, r) => a + (r.paid_twd ?? 0), 0),
            fee_rmb: mine.reduce((a, r) => a + (r.ship_fee_rmb ?? 0) + (r.op_fee_rmb ?? 0), 0),
            ngay_sao_ke: statementDateFromName(st.filename),
            luong: periodCashFlow(n?.summary ?? null, batchByStatement.get(st.id) ?? null, st.rows.length, n?.sg_gop ?? null),
            // Bốn loại lệch
            lech_tien: diff.map((r) => ({
                order_no: r.order_no, tracking: r.tracking,
                cod_twd: r.cod_twd, paid_twd: r.paid_twd, diff_twd: r.diff_twd,
            })),
            phi_sai: wrongFees.map((r) => ({
                order_no: r.order_no, tracking: r.tracking, ship_fee_rmb: r.ship_fee_rmb,
            })),
            thua_sao_ke: extraLines.map((e) => ({
                order_no: e.order_no, tracking: e.tracking, amount_twd: e.amount_twd,
            })),
            // Phép quyết toán của chính kỳ đó, do NAZA khai
            settlement: n ? {
                cod_twd: n.summary.cod_twd,
                rate_twd_rmb: n.summary.rate_twd_rmb,
                ship_fee_rmb: n.summary.ship_fee_rmb,
                op_fee_rmb: n.summary.op_fee_rmb,
                rate_rmb_vnd: n.summary.rate_rmb_vnd,
                purchase_vnd: n.summary.purchase_vnd,
                purchase_sg_vnd: n.summary.purchase_sg_vnd ?? null,
                payable_vnd: n.summary.payable_vnd,
                math_ok: n.checks.math_ok,
                math_note: n.checks.math_note,
            } : null,
            // ── KHÂU CUỐI: tiền thật vào tài khoản ────────────────
            //
            // Sao kê chỉ nói NAZA PHẢI chuyển bao nhiêu. Họ chuyển thật bao
            // nhiêu thì chỉ ngân hàng biết, và Sỹ Anh xác nhận chưa ai kiểm
            // kỹ khoản này. Đây là chỗ tiền chảy ra mà cả hệ thống không
            // thấy: file soát sạch 8 mục vẫn không nói được gì về nó.
            bank: bankOf(st.filename) || null,
            ...(() => {
                const { state, lech_vnd: bankDiffVnd } = periodState(
                    n?.summary.payable_vnd ?? null, bankOf(st.filename),
                );
                return { trang_thai: state, trang_thai_chu: STATE_LABEL[state], lech_bank_vnd: bankDiffVnd };
            })(),
        };
    }).sort((a, b) => (a.period_date < b.period_date ? 1 : -1));
}

export type Period = ReturnType<typeof buildPeriods>[number];

// ── TỶ GIÁ QUA CÁC KỲ ─────────────────────────────────────────
//
// Tỷ giá là số NAZA TỰ ĐẶT, không phải số thị trường, và họ đổi gần như
// mỗi kỳ (đo thật: TWD→RMB 0,1995 → 0,2037, biến động 2,1%). Không ai
// soát thì lệch 1% trên 300.000 TWD là ~2,3 triệu đồng bốc hơi lặng lẽ.
// Nên so từng kỳ với kỳ LIỀN TRƯỚC và nói rõ lợi hay hại cho mình.
export function buildRateTrend(byPeriod: Period[]) {
    return [...byPeriod].reverse().map((p, i, arr) => {
        const prev = i > 0 ? arr[i - 1] : null;
        const tw = p.settlement?.rate_twd_rmb ?? null;
        const rv = p.settlement?.rate_rmb_vnd ?? null;
        const pct = (a: number | null, b: number | null) =>
            a == null || b == null || b === 0 ? null : (a / b - 1) * 100;
        return {
            filename: p.filename, period_date: p.period_date,
            rate_twd_rmb: tw, rate_rmb_vnd: rv,
            d_twd_rmb: pct(tw, prev?.settlement?.rate_twd_rmb ?? null),
            d_rmb_vnd: pct(rv, prev?.settlement?.rate_rmb_vnd ?? null),
        };
    }).reverse();
}

export type RateTrendRow = ReturnType<typeof buildRateTrend>[number];

// Loại lệch thứ 2 KHÔNG thuộc kỳ nào: đơn đã giao mà chưa kỳ nào trả
// tiền. Gắn nó vào một kỳ cụ thể là sai — nó là món nợ đang treo.
export function buildDeliveredUnpaid(
    rows: LedgerRows, doneOf: (k: string) => DoneEntry | undefined, periodEnds: string[],
) {
    return rows
        .filter((r) => (r.light === "vang" || r.light === "do") && r.paid_twd === null)
        .map((r) => {
            const k = doneKey("doi", r.tracking || r.order_no);
            const d = doneOf(k);
            const { ky_da_qua: periodsSinceChase } = shouldResurface(d, periodEnds);
            return {
                order_no: r.order_no, tracking: r.tracking, cod_twd: r.cod_twd,
                age_days: r.age_days, ky_da_qua: r.ky_da_qua, qua_han: r.light === "do",
                contact_name: r.contact_name, phone: r.phone,
                // Trí nhớ: đã đòi chưa, mấy lần, đòi rồi mà mấy kỳ vẫn im
                doi_key: k,
                da_doi: d ? { ...d, ky_tu_khi_doi: periodsSinceChase } : null,
                doi_chu: chaseLabel(d, periodsSinceChase),
            };
        })
        .sort((a, b) => b.ky_da_qua - a.ky_da_qua || b.cod_twd - a.cod_twd);
}

export type DeliveredUnpaid = ReturnType<typeof buildDeliveredUnpaid>[number];
