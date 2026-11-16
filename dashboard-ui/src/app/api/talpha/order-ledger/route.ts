import { NextRequest, NextResponse } from "next/server";
import { readStoreFresh } from "@/lib/talpha/store";
import { loadTwOrderLedger } from "@/lib/talpha/tw-order-ledger";
import {
    buildLedger, summarise, statementOverdue, filterByOrderDate, todayVn, STATEMENT_CYCLE_DAYS,
    redeliveryOrigin, nazaRedeliveryOrigin, orderKey, trackKey, sortNewestFirst,
    type OrderSource, type PaidLine, type FeeLine,
} from "@/lib/talpha/order-ledger";
import type { StatementRow } from "@/lib/talpha/cod-recon";
import {
    sgMergeWarning, fillTrackingInStatements, expectedShipFee, matchChannel, OP_FEE_PER_PARCEL, type NazaStatement,
} from "@/lib/talpha/naza-statement";
import {
    readPurchaseSheet, matchPaymentsToPeriods, statementDateFromName, type PurchasePayment,
} from "@/lib/talpha/purchase-sheet";
import { PARTNER_STATUS_VI } from "@/lib/talpha/partner-file";
import {
    bankKey, doneKey, chaseLabel, emptyActions, fxLoss, periodState,
    shouldResurface, STATE_LABEL, BANK_TOLERANCE_VND,
    type CodActions,
} from "@/lib/talpha/cod-actions";

export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════
// SỔ ĐƠN HÀNG — một dòng mỗi đơn, kèm đủ vòng đời của tiền.
//
// Ghép ba kho lại:
//   kho `tracking`         → đơn, khách, hàng, trạng thái giao (từ file đối tác)
//   kho `cod_statements`   → tiền 3PL đã trả + phí từng đơn + tỷ giá từng kỳ
//   config products        → giá vốn
//
// Chỉ ĐỌC. Mọi thay đổi dữ liệu đi qua route tracking/import và cod-recon.
// ═══════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════
// LUỒNG TIỀN MỘT KỲ — đi đúng từng bước của sheet TỔNG NAZA
// ───────────────────────────────────────────────────────────────────
//     Tổng COD (TWD) × tỷ giá → RMB − phí thao tác − phí ship → RMB ròng
//     × tỷ giá → VND − PHÍ MUA HÀNG → PHẢI NHẬN
//
// Trước 13/09/2026 thẻ kỳ lấy "Tiền COD" bằng cách cộng CHỈ những đơn tìm thấy
// trong sổ đơn: kỳ 9.11 hiện 57.946 NT$ trong khi sao kê là 64.740, và "Phí NAZA
// thu" hiện 1.035¥ trong khi NAZA trừ 2.573¥. Bốn con số trên cùng một thẻ không
// cộng trừ ra được "Phải nhận". Nay mọi số trên thẻ lấy từ chính luồng NAZA; phần
// đơn khớp sổ đơn hiện riêng.
//
// Tiền hàng (Sỹ Anh chốt 13/09/2026):
//   • kỳ NAZA ghi phí mua hàng → NAZA trừ vào COD, nhưng TIN SỐ TRONG FILE TIỀN
//     HÀNG nếu hai bên lệch — "phải nhận" tính lại theo file;
//   • kỳ NAZA không ghi (24/07 → 14/08) → Sỹ Anh tự chuyển khoản riêng, tiền hàng
//     là khoản chi riêng, KHÔNG trừ vào tiền NAZA trả.
//
// Kỳ 24/09/2026 NAZA GỘP Singapore (Sỹ Anh chốt dùng bản gộp 30/09): phí ship đơn
// Sing đã nằm trong dòng phí, còn tiền hàng Sing là một dòng riêng. Tiền hàng Sing
// trừ trong luồng theo số NAZA — file tiền hàng Đài không có nó nên không đem so.
// ═══════════════════════════════════════════════════════════════════
type SummaryNaza = NazaStatement["summary"];

function periodCashFlow(
    sm: SummaryNaza | null, batch: PurchasePayment | null, statementRowCount: number,
    sg: NazaStatement["sg_gop"] | null = null,
) {
    if (!sm) return null;
    const cod = sm.cod_twd ?? null;
    const tw = sm.rate_twd_rmb ?? null;
    const rv = sm.rate_rmb_vnd ?? null;
    const rmb = cod != null && tw != null ? cod * tw : null;
    const opFee = Math.abs(sm.op_fee_rmb ?? 0);
    const shippingFee = Math.abs(sm.ship_fee_rmb ?? 0);
    const netRmb = sm.net_rmb ?? (rmb != null ? rmb - opFee - shippingFee : null);
    const vnd = netRmb != null && rv != null ? netRmb * rv : null;

    const nazaDeduction = sm.purchase_vnd ?? null;
    const paymentMethod: "naza_tru" | "tu_chuyen" = nazaDeduction != null ? "naza_tru" : "tu_chuyen";
    // Số tiền hàng đem trừ trong luồng: kỳ NAZA trừ thì theo FILE (không có file
    // thì đành theo NAZA); kỳ tự chuyển khoản thì luồng NAZA không trừ gì.
    const twPurchase = paymentMethod === "naza_tru" ? (batch ? batch.tong_vnd : nazaDeduction!) : 0;
    const sgPurchase = sg?.tien_hang_vnd ?? sm.purchase_sg_vnd ?? 0;
    const purchaseInFlow = twPurchase + sgPurchase;
    const receivable = sm.payable_vnd == null ? null
        // Giữ nguyên phần điều chỉnh kỳ trước NAZA đã tính: payable = VND − tiền hàng NAZA ± chuyển kỳ.
        // Chỉ phần Đài được tính lại theo file; phần Sing đã nằm sẵn trong payable.
        : paymentMethod === "naza_tru" ? sm.payable_vnd + nazaDeduction! - twPurchase
        : sm.payable_vnd;

    let amountPaid: number | null = null, outstanding: number | null = null;
    if (batch && paymentMethod === "naza_tru") { amountPaid = batch.tong_vnd; outstanding = 0; }   // NAZA trừ rồi = đã trả
    else if (batch) {
        amountPaid = batch.da_tra_vnd ?? 0;
        outstanding = batch.con_thieu_vnd ?? Math.max(0, batch.tong_vnd - (batch.da_tra_vnd ?? 0));
    }

    return {
        so_dong_sao_ke: statementRowCount,
        cod_twd: cod, ty_gia_twd_rmb: tw, rmb,
        phi_thao_tac_rmb: opFee, phi_ship_rmb: shippingFee, phi_gop: !!sm.fees_combined,
        rmb_rong: netRmb, ty_gia_rmb_vnd: rv, vnd,
        tien_hang: {
            cach_tra: paymentMethod,
            naza_tru_vnd: nazaDeduction,
            file: batch ? {
                ngay: batch.ngay, tong_vnd: batch.tong_vnd, moi_vnd: batch.moi_vnd,
                no_ky_truoc_vnd: batch.no_ky_truoc_vnd, da_ghi_thanh_toan: batch.da_ghi_thanh_toan,
                dong: batch.dong,
            } : null,
            /** Tổng tiền hàng trừ trong luồng = Đài (theo file) + Sing (theo NAZA, kỳ gộp). */
            trong_luong_vnd: purchaseInFlow,
            dai_vnd: twPurchase,
            sing_vnd: sgPurchase || null,
            lech_naza_vnd: paymentMethod === "naza_tru" && batch ? nazaDeduction! - batch.tong_vnd : null,
            da_tra_vnd: amountPaid,
            con_no_vnd: outstanding,
        },
        phai_nhan_vnd: receivable,
        /** Phần Singapore NAZA gộp vào kỳ (chỉ kỳ 24/09/2026); null ở mọi kỳ khác. */
        sg_gop: sg ?? null,
    };
}

export async function GET(req: NextRequest) {
    const q = req.nextUrl.searchParams;
    const asOf = /^\d{4}-\d{2}-\d{2}$/.test(q.get("to") || "")
        ? (q.get("to") as string)
        : new Date().toISOString().slice(0, 10);

    try {
        const { track, stm, orders, paid, fees, rows: rawRows, extra } = await loadTwOrderLedger(asOf);
        // Mới nhất lên đầu (15/11/2026) — bảng NAZA để đơn cũ trên cùng; danh sách, thẻ, CSV cùng thứ tự này.
        const rows = sortNewestFirst(rawRows);
        // Việc do NGƯỜI ghi — tiền về tài khoản, đã đòi, đã bỏ qua. Kho riêng
        // với kho sao kê: nạp lại file thì số máy đọc phải tính lại, còn việc
        // người đã làm thì không được mất.
        const act = await readStoreFresh<CodActions>("cod_actions", emptyActions());
        const bankOf = (fn: string) => (act.bank || {})[bankKey(fn)];
        const doneOf = (k: string) => (act.done || {})[k];
        const summary = summarise(rows, extra);

        // ── BÁO CÁO TỪNG KỲ SAO KÊ ────────────────────────────────────
        //
        // Việc thật của mỗi tuần, đúng lời Sỹ Anh: "bên vận chuyển gửi file đối
        // soát — những đơn nào về, và có bị lệch không". Bốn loại lệch, do chính
        // Sỹ Anh chốt:
        //   1. 3PL trả khác số trên đơn
        //   2. Đã giao mà chưa về tiền   (không thuộc kỳ nào — tính toàn cục)
        //   3. 3PL trả cho đơn mình không có
        //   4. Phí thu sai bảng giá
        //
        // Tính theo TỪNG KỲ chứ không gộp: một tuần một file, và câu hỏi luôn là
        // "kỳ NÀY có vấn đề gì", không phải "từ đầu tới giờ".
        //
        // Đơn GIAO LẠI không còn lọt vào loại 1 vì Sheet ghi sai mã vận đơn:
        // buildLedger ghép chúng bằng mã gốc trong ngoặc (xem maGocGiaoLai). Mã vận
        // đơn bị hai dòng Sheet dùng chung thì nêu ở cảnh báo "trung-van-don".

        // File tiền hàng: đọc một lần mỗi 5 phút, lỗi không làm sập màn.
        const purchaseSheet = await readPurchaseSheet();
        const batchByStatement = matchPaymentsToPeriods(
            purchaseSheet.dot,
            stm.statements.map((x) => ({ id: x.id, ngay: statementDateFromName(x.filename) })),
        );

        const byPeriod = stm.statements.map((st) => {
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

        // Ngày chốt của mọi kỳ, cũ → mới. Dùng để đếm "đã qua mấy kỳ" cho cả
        // đơn quá hạn lẫn việc đã đòi mà NAZA vẫn im.
        const periodEnds = byPeriod.map((p) => p.period_date).filter(Boolean).sort();

        // ── TỶ GIÁ QUA CÁC KỲ ─────────────────────────────────────────
        //
        // Tỷ giá là số NAZA TỰ ĐẶT, không phải số thị trường, và họ đổi gần như
        // mỗi kỳ (đo thật: TWD→RMB 0,1995 → 0,2037, biến động 2,1%). Không ai
        // soát thì lệch 1% trên 300.000 TWD là ~2,3 triệu đồng bốc hơi lặng lẽ.
        // Nên so từng kỳ với kỳ LIỀN TRƯỚC và nói rõ lợi hay hại cho mình.
        const rateTrend = [...byPeriod].reverse().map((p, i, arr) => {
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

        // ── TỶ GIÁ ĐÃ LẤY CỦA MÌNH BAO NHIÊU ──────────────────────────
        //
        // Sỹ Anh chốt: tỷ giá NAZA đặt thì phải chịu, không cãi được. Vậy bảng
        // phần trăm không giúp quyết định gì. Đổi sang câu trả lời được: nó lấy
        // mất bao nhiêu TIỀN, lấy kỳ tốt nhất chính NAZA từng đặt làm mốc.
        //
        // Tiền đem nhân là COD của CẢ KỲ theo sheet TỔNG — NAZA quy đổi cả khoản
        // đó bằng tỷ giá của họ. Trước 29/09/2026 lấy `total_twd` (chỉ đơn khớp
        // sổ đơn), thành ra 5 kỳ hụt tổng 9.340 NT$ và tiền thiệt bị tính thiếu.
        const fx = fxLoss(byPeriod.map((p) => ({
            filename: p.filename,
            period_date: p.period_date,
            rate_twd_rmb: p.settlement?.rate_twd_rmb ?? null,
            rate_rmb_vnd: p.settlement?.rate_rmb_vnd ?? null,
            cod_twd: p.settlement?.cod_twd ?? p.total_twd,
        })));

        // Loại lệch thứ 2 KHÔNG thuộc kỳ nào: đơn đã giao mà chưa kỳ nào trả
        // tiền. Gắn nó vào một kỳ cụ thể là sai — nó là món nợ đang treo.
        const deliveredUnpaid = rows
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

        // ── VIỆC PHẢI LÀM HÔM NAY ─────────────────────────────────────
        //
        // Đây là thứ ĐẦU TIÊN Sỹ Anh muốn thấy khi mở màn: "hôm nay có việc gì
        // cần làm không". Không có việc thì phải NÓI RÕ là không có, chứ không
        // để màn hình trống cho người đọc tự đoán.
        //
        // Mọi việc ở đây TỰ HẾT khi tiền về — không có nút "đã làm", vì Sỹ Anh
        // chốt là máy tự lo, không thêm thao tác tay.
        const latest = byPeriod[0];
        const latestStatement = stm.statements.find((x) => x.id === latest?.id);
        const fa = latestStatement?.naza?.fee_audit;
        const latestRate = rateTrend[0];

        // ── 8 MỤC KIỂM TRA ────────────────────────────────────────────
        // Nhóm A soát chính FILE (tin được số trong đó không), nhóm B soát ĐƠN
        // (file đúng rồi thì so với đơn của mình). Thứ tự này không đảo được:
        // file sai mà đem so đơn thì mọi kết luận đều vô nghĩa.
        const vnd = (n: number) => Math.round(n).toLocaleString("vi-VN");
        /** Ngày đọc cho người, không đọc cho máy: 2026-08-25 → 25/08/2026. */
        const dmy = (s: string) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "—");
        // MỌI mục ở đây thuộc phạm vi MỘT KỲ — kỳ đang chọn, không phải cộng
        // dồn. Bản trước để lẫn một mục cộng dồn cả 7 kỳ vào giữa, thành ra
        // "80 đơn sao kê bỏ sót" trông như NAZA vừa bỏ sót 80 đơn trong một
        // tuần, trong khi 76 đơn trong đó hoàn toàn bình thường. Mục đó nay
        // nằm riêng ở khối "tiền còn nằm ở NAZA".
        const checks: { nhom: "A" | "B"; ten: string; ok: boolean | null; chi_tiet: string }[] = [];
        if (latest) {
            const ck = latestStatement?.naza?.checks;
            checks.push({
                nhom: "A", ten: "Phép tính trong file",
                ok: ck?.math_ok ?? null,
                chi_tiet: ck?.math_note || "Chưa đọc được sheet TỔNG.",
            });
            // Câu cũ in `orders_paid` và `total_twd` — số đơn KHỚP SỔ ĐƠN — trong khi
            // phép so thật là giữa chi tiết FILE và sheet TỔNG. Kỳ 9.11 màn hình ghi
            // "54 dòng COD cộng ra 57.946 NT$ — khớp sheet TỔNG" trong khi sheet TỔNG
            // là 60 dòng 64.740: một câu sai nằm dưới dấu tích xanh.
            //
            // Và phí chưa từng được soát: kỳ 9.11 bộ đọc bỏ sót cả sheet phí (NAZA đổi
            // tên cột), chi tiết ra 0¥ trong khi TỔNG trừ 2.573¥, mà không mục nào kêu.
            const gap = ck?.cod_gap ?? null;
            const latestSummary = latestStatement?.naza?.summary;
            const detailFees = (ck?.ship_fee_detail_total ?? 0) + (latestSummary?.fees_combined ? 0 : (ck?.op_fee_detail_total ?? 0));
            const totalFees = Math.abs(latestSummary?.ship_fee_rmb ?? 0) + Math.abs(latestSummary?.op_fee_rmb ?? 0);
            const feeDiff = latestSummary ? detailFees - totalFees : null;
            const codOk = gap !== null && Math.abs(gap) < 0.5;
            const feesOk = feeDiff === null || Math.abs(feeDiff) < 0.5;
            checks.push({
                nhom: "A", ten: "Chi tiết cộng ra đúng số tổng",
                ok: gap === null ? null : codOk && feesOk,
                chi_tiet: gap === null ? "Không đọc được số tổng."
                    : !codOk
                        ? `Chi tiết COD lệch sheet TỔNG ${vnd(gap)} NT$. Hỏi lại NAZA.`
                        : !feesOk
                            ? (detailFees === 0
                                ? `Không đọc được dòng phí nào trong sheet phí, trong khi sheet TỔNG trừ ${vnd(totalFees)}¥ — ` +
                                  "mục soát phí phía dưới đang không soát gì. Tải lại file sao kê kỳ này."
                                : `Sheet phí chi tiết cộng ra ${vnd(detailFees)}¥ nhưng sheet TỔNG trừ ${vnd(totalFees)}¥ — lệch ${vnd(feeDiff!)}¥.`)
                            : `${latestStatement?.rows.length ?? 0} dòng COD cộng ra ${vnd(ck?.cod_detail_total ?? 0)} NT$, ` +
                              `phí cộng ra ${vnd(detailFees)}¥ — khớp sheet TỔNG.`,
            });
            const dw = latestRate?.d_twd_rmb, dv = latestRate?.d_rmb_vnd;
            const describeRate = (label: string, rate: number | null, d: number | null, favorableWhenUp: boolean) => {
                if (rate == null) return `${label}: không đọc được.`;
                if (d == null) return `${label} ${rate} — chưa có kỳ trước để so.`;
                if (Math.abs(d) < 0.05) return `${label} ${rate} — giữ nguyên.`;
                const favorable = (d > 0) === favorableWhenUp;
                return `${label} ${rate} — ${d > 0 ? "tăng" : "giảm"} ${Math.abs(d).toFixed(2)}% so kỳ trước, ${favorable ? "có lợi" : "BẤT LỢI"} cho mình.`;
            };
            // Nói bằng TIỀN chứ không bằng phần trăm suông: "giảm 0,34%" không
            // ai hình dung được là mất bao nhiêu, mà tỷ giá thì không cãi được
            // nên thứ duy nhất còn đáng biết là mất bao nhiêu đồng.
            const latestFx = fx.rows.find((x) => x.filename === latest.filename);
            const lossVnd = latestFx?.thiet_vnd ?? null;
            checks.push({
                nhom: "A", ten: "Tỷ giá kỳ này",
                // Cố ý để null (dấu "i" xanh) chứ không phải false (dấu "!" đỏ):
                // Sỹ Anh phải chịu tỷ giá NAZA đặt, nên đây là tin để biết, không
                // phải việc để xử. Tô đỏ một thứ không xử được thì lần sau người
                // ta phớt lờ luôn cả dấu đỏ thật.
                ok: lossVnd != null && lossVnd < 1 ? true : null,
                chi_tiet: `${describeRate("TWD→RMB", latestRate?.rate_twd_rmb ?? null, dw ?? null, true)} ${describeRate("RMB→VND", latestRate?.rate_rmb_vnd ?? null, dv ?? null, true)}` +
                    (lossVnd == null ? " Chưa đọc được tỷ giá."
                        : latestFx?.tot_nhat ? " Đây là tỷ giá TỐT NHẤT NAZA từng đặt."
                            : ` So với kỳ tốt nhất NAZA từng đặt, kỳ này nhận ít đi ${vnd(lossVnd)}đ.`),
            });
            const dups = fa?.duplicates || [];
            checks.push({
                nhom: "A", ten: "Thu hai lần phí trên một đơn",
                ok: dups.length === 0,
                chi_tiet: dups.length === 0
                    ? "Không mã vận đơn nào bị tính phí quá một lần trong kỳ."
                    : `${dups.length} mã bị tính phí ${dups[0].times} lần — thu dư ${vnd(fa!.duplicate_extra_rmb)} ¥. ` +
                      dups.slice(0, 3).map((d) => `${d.order_ids.join("/")} · ${d.tracking}`).join(" · "),
            });

            checks.push({
                nhom: "B", ten: "3PL trả khác số trên đơn",
                ok: latest.lech_tien.length === 0,
                chi_tiet: latest.lech_tien.length === 0 ? "Mọi đơn trả đúng số."
                    : latest.lech_tien.slice(0, 3).map((l) =>
                        `${l.order_no}: đơn ghi ${vnd(l.cod_twd)} · họ trả ${vnd(l.paid_twd ?? 0)} NT$ ` +
                        `(${(l.diff_twd ?? 0) > 0 ? "dư" : "thiếu"} ${vnd(Math.abs(l.diff_twd ?? 0))})`).join(" · "),
            });
            // Soát 0 dòng thì KHÔNG phải "đúng": kỳ 9.11 hiện "0/0 dòng đúng bảng giá"
            // với dấu tích xanh, trong khi NAZA trừ 2.573¥ mà bộ đọc không thấy dòng nào.
            const feeRowCount = (fa?.ok ?? 0) + (fa?.wrong ?? 0) + (fa?.unknown_channel ?? 0);
            checks.push({
                nhom: "B", ten: "Phí vận chuyển đúng bảng giá",
                ok: feeRowCount === 0 && totalFees > 0 ? false : (fa?.wrong ?? 0) === 0,
                chi_tiet: feeRowCount === 0 && totalFees > 0
                    ? `Không có dòng phí nào để soát, trong khi NAZA trừ ${vnd(totalFees)}¥ — xem mục A, tải lại file sao kê kỳ này.`
                    : ((fa?.wrong ?? 0) === 0
                        ? `${fa?.ok ?? 0}/${feeRowCount} dòng phí CỦA KỲ NÀY đúng bảng giá — 7-Eleven/FamilyMart 27¥ · HCT 32¥ · Yamato 38¥.`
                        : `${fa!.wrong} dòng sai, chênh ${vnd(fa!.overcharge_rmb)} ¥.`)
                      + (latestStatement?.naza?.sg_gop?.don
                        ? ` ${latestStatement.naza.sg_gop.don} đơn Sing gộp kỳ này (${vnd(latestStatement.naza.sg_gop.phi_rmb)}¥) không soát theo bảng giá Đài.`
                        : ""),
            });
            // Tiền hàng — so số NAZA trừ với file tiền hàng của Sỹ Anh.
            {
                const purchase = latest.luong?.tien_hang;
                const f = purchase?.file;
                const dmyIso = (x?: string | null) => (x ? `${x.slice(8, 10)}/${x.slice(5, 7)}` : "—");
                let ok: boolean | null, detail: string;
                if (!purchase) { ok = null; detail = "Kỳ này không có sheet TỔNG để biết NAZA trừ tiền hàng hay không."; }
                else if (purchaseSheet.loi && !f) { ok = false; detail = purchaseSheet.loi; }
                else if (!f) {
                    ok = false;
                    detail = `File tiền hàng không có đợt thanh toán nào trong 4 ngày quanh ngày sao kê ${dmyIso(latest.ngay_sao_ke)}.`;
                } else if (purchase.cach_tra === "naza_tru") {
                    const diff = purchase.lech_naza_vnd ?? 0;
                    ok = Math.abs(diff) < 1;
                    detail = ok
                        ? `NAZA trừ tiền hàng ${vnd(purchase.naza_tru_vnd!)}đ — khớp file tiền hàng (đợt ${dmyIso(f.ngay)}, dòng ${f.dong}).`
                        : `NAZA trừ ${vnd(purchase.naza_tru_vnd!)}đ nhưng file tiền hàng ghi ${vnd(f.tong_vnd)}đ — ` +
                          `NAZA trừ ${diff > 0 ? "DƯ" : "THIẾU"} ${vnd(Math.abs(diff))}đ. Phải nhận đã tính lại theo file: ` +
                          `${vnd(latest.luong!.phai_nhan_vnd ?? 0)}đ.`;
                    if (!f.da_ghi_thanh_toan) detail += " File chưa ghi “đã thanh toán” cho đợt này, dù NAZA đã trừ.";
                } else {
                    // Còn nợ tiền hàng không phải lỗi đối soát, nhưng cũng không được tích xanh cho qua.
                    ok = (purchase.con_no_vnd ?? 0) > 0 ? null : true;
                    detail = `Kỳ này NAZA không trừ tiền hàng — đợt ${dmyIso(f.ngay)} ${vnd(f.tong_vnd)}đ tự chuyển khoản riêng. ` +
                        `Đã trả ${vnd(purchase.da_tra_vnd ?? 0)}đ` + ((purchase.con_no_vnd ?? 0) > 0 ? `, còn nợ ${vnd(purchase.con_no_vnd!)}đ.` : ".");
                }
                if (f && f.no_ky_truoc_vnd > 0) detail += ` Đợt này gồm ${vnd(f.no_ky_truoc_vnd)}đ nợ kỳ trước.`;
                if (purchase?.sing_vnd) {
                    detail += ` Ngoài ra NAZA trừ thêm ${vnd(purchase.sing_vnd)}đ tiền hàng Sing (kỳ gộp) — ` +
                        "file tiền hàng Đài không có khoản này nên không đem so.";
                }
                checks.push({ nhom: "B", ten: "Tiền hàng khớp file tiền hàng", ok, chi_tiet: detail });
            }
            // Kỳ NAZA gộp Singapore vào sao kê Đài — tin để biết, không phải lỗi (dấu "i").
            const sgMerged = latestStatement?.naza?.sg_gop;
            if (sgMerged) {
                checks.push({
                    nhom: "A", ten: "Kỳ gộp Singapore", ok: null,
                    chi_tiet: sgMergeWarning(sgMerged, latestStatement?.naza?.summary?.payable_vnd ?? null),
                });
            }
            const ow = fa?.op_wrong || [];
            checks.push({
                nhom: "B", ten: `Phí thao tác đúng ${fa?.op_expected ?? 3}¥/đơn`,
                ok: feeRowCount === 0 && totalFees > 0 ? false : ow.length === 0,
                chi_tiet: (feeRowCount === 0 && totalFees > 0
                    ? "Không có dòng phí nào để soát — xem mục A."
                    : ow.length === 0
                    ? `Cả kỳ đều đúng ${fa?.op_expected ?? 3}¥.`
                    : `${ow.length} đơn thu khác mức: ` + ow.slice(0, 3).map((o) => `${o.order_id} thu ${o.charged}¥`).join(" · "))
                    + " Lưu ý: bảng giá ghi MIỄN PHÍ, khoản này vẫn nên hỏi NAZA.",
            });
        }
        // ── VIỆC HÔM NAY, CÓ TRÍ NHỚ ──────────────────────────────────
        //
        // Bản trước không nhớ gì: "Nhắn NAZA đòi tiền 4 đơn" hiện y hệt mỗi
        // ngày, đòi hôm qua rồi hôm nay vẫn thế. Nay mỗi việc có khoá riêng,
        // bấm đóng là ghi vào kho `cod_actions` kèm ngày.
        //
        // Nhưng đóng KHÔNG phải là quên. NAZA trả tiền theo kỳ, nên phép thử
        // thật là: sang kỳ sao kê sau, tiền về chưa? Chưa về thì việc nổi lại
        // và nặng hơn, vì đã đòi một lần mà họ vẫn im (shouldResurface).
        const overdue = deliveredUnpaid.filter((x) => x.qua_han);
        type Task = {
            id: string; muc: "gap" | "soat" | "ghi"; tieu_de: string;
            so: number; don_vi: string; chi_tiet: string;
            /** Khoá để bấm đóng. Rỗng = việc tự hết khi số liệu đổi, không đóng tay. */
            done_key: string;
            /** Nút nào hợp với việc này. */
            nut: ("da_doi" | "da_hoi" | "bo_qua" | "nhap_bank")[];
            /** Đã đóng lần nào chưa — để màn hình nói "đòi rồi mà vẫn im". */
            ghi_chu: string;
        };
        const tasks: Task[] = [];

        // Đòi tiền: gộp các đơn CHƯA đòi hoặc đã đòi mà qua kỳ vẫn im.
        const toChase = overdue.filter((x) => shouldResurface(doneOf(x.doi_key), periodEnds).lai);
        if (toChase.length) {
            const chasedBefore = toChase.filter((x) => x.da_doi).length;
            tasks.push({
                id: "doi-naza", muc: "gap",
                tieu_de: "Nhắn NAZA đòi tiền",
                so: toChase.length, don_vi: "đơn",
                chi_tiet: "Đã qua từ 2 kỳ sao kê mà vẫn chưa được trả — tổng " +
                    `${Math.round(toChase.reduce((a, x) => a + x.cod_twd, 0)).toLocaleString("vi-VN")} NT$.` +
                    (chasedBefore ? ` ${chasedBefore} đơn đã đòi một lần rồi mà NAZA vẫn im.` : ""),
                done_key: "", nut: ["da_doi"],
                ghi_chu: chasedBefore ? `${chasedBefore}/${toChase.length} đơn đã đòi trước đó` : "",
            });
        }

        const unresolvedDiffs = (latest?.lech_tien || []).filter(
            (l) => !doneOf(doneKey("lech", l.tracking || l.order_no)),
        );
        if (unresolvedDiffs.length) {
            tasks.push({
                id: "lech-tien", muc: "soat",
                tieu_de: "NAZA trả khác số ghi trên đơn",
                so: unresolvedDiffs.length, don_vi: "đơn",
                chi_tiet: unresolvedDiffs.slice(0, 3).map((l) =>
                    `${l.order_no}: đơn ghi ${Math.round(l.cod_twd).toLocaleString("vi-VN")} · họ trả ${Math.round(l.paid_twd ?? 0).toLocaleString("vi-VN")}`).join(" · "),
                done_key: doneKey("lech", unresolvedDiffs[0].tracking || unresolvedDiffs[0].order_no),
                nut: ["da_hoi", "bo_qua"], ghi_chu: "",
            });
        }

        const unresolvedExtras = (latest?.thua_sao_ke || []).filter(
            (t) => !doneOf(doneKey("thua", t.tracking || t.order_no)),
        );
        if (unresolvedExtras.length) {
            tasks.push({
                id: "thua", muc: "soat",
                tieu_de: "Tra lại đơn NAZA trả mà mình không có",
                so: unresolvedExtras.length, don_vi: "dòng",
                chi_tiet: unresolvedExtras.slice(0, 3).map((t) => `${t.order_no} · ${t.tracking}`).join(" · "),
                done_key: doneKey("thua", unresolvedExtras[0].tracking || unresolvedExtras[0].order_no),
                nut: ["da_hoi", "bo_qua"], ghi_chu: "",
            });
        }

        const unresolvedFees = (latest?.phi_sai || []).filter(
            (f) => !doneOf(doneKey("phi", f.tracking || f.order_no)),
        );
        if (unresolvedFees.length) {
            tasks.push({
                id: "phi-sai", muc: "soat",
                tieu_de: "Hỏi NAZA về phí thu sai bảng giá",
                so: unresolvedFees.length, don_vi: "đơn",
                chi_tiet: unresolvedFees.slice(0, 3).map((f) => f.order_no).join(" · "),
                done_key: doneKey("phi", unresolvedFees[0].tracking || unresolvedFees[0].order_no),
                nut: ["da_hoi", "bo_qua"], ghi_chu: "",
            });
        }

        // KHÂU CUỐI — và là khâu chưa ai canh.
        //
        // GỘP thành MỘT việc chứ không tách mỗi kỳ một dòng. Sáu kỳ đang chờ mà
        // đẻ ra sáu dòng chữ giống hệt nhau thì danh sách việc dài gấp ba lần
        // phần còn lại, và ba việc thật sự khẩn — đòi tiền, soi lệch — bị đẩy
        // chìm xuống dưới. Chỗ nhập số của từng kỳ đã có sẵn ngay trong bảng ②.
        const awaitingBank = [...byPeriod].reverse().filter((p) => p.trang_thai === "cho_nhap");
        if (awaitingBank.length) {
            const oldest = awaitingBank[0];
            const total = awaitingBank.reduce((a, p) => a + (p.settlement?.payable_vnd ?? 0), 0);
            tasks.push({
                id: "bank", muc: "ghi",
                tieu_de: awaitingBank.length === 1
                    ? `Nhập tiền thật về của kỳ chốt ${dmy(oldest.period_date)}`
                    : `Đối chiếu ngân hàng ${awaitingBank.length} kỳ chưa ai kiểm`,
                so: Math.round(total), don_vi: "đ",
                chi_tiet: (awaitingBank.length === 1
                    ? "File đã soát xong. "
                    : `Từ kỳ chốt ${dmy(oldest.period_date)} tới nay. File kỳ nào cũng soát xong, nhưng `) +
                    "mở app ngân hàng gõ số thật vào mới biết NAZA chuyển đủ chưa — đây là khâu duy nhất " +
                    "hệ thống không tự thấy được. Kỳ để càng lâu càng khó tra lại sao kê ngân hàng.",
                done_key: oldest.filename, nut: ["nhap_bank"], ghi_chu: "",
            });
        }
        // Kỳ đã nhập mà lệch quá ngưỡng thì nặng hơn hẳn: tiền đã chuyển rồi,
        // thiếu là thiếu thật, không phải chờ nữa.
        for (const p of byPeriod) {
            if (p.trang_thai !== "lech") continue;
            if (doneOf(doneKey("lech", `BANK-${p.filename}`))) continue;
            tasks.push({
                id: `bank-lech:${p.filename}`, muc: "gap",
                tieu_de: `Kỳ chốt ${dmy(p.period_date)} — tiền về không khớp`,
                so: Math.round(p.lech_bank_vnd ?? 0), don_vi: "đ",
                chi_tiet: `Sao kê tính phải nhận ${vnd(p.settlement?.payable_vnd ?? 0)}đ, ` +
                    `thực nhận ${vnd(p.bank?.thuc_nhan_vnd ?? 0)}đ ngày ${dmy(p.bank?.ngay_ve || "")}. ` +
                    `${(p.lech_bank_vnd ?? 0) < 0 ? "Thiếu" : "Dư"} ${vnd(Math.abs(p.lech_bank_vnd ?? 0))}đ.`,
                done_key: doneKey("lech", `BANK-${p.filename}`),
                nut: ["da_hoi", "bo_qua"], ghi_chu: "",
            });
        }

        // Sao kê là thứ DUY NHẤT phải tải lên bằng tay — NAZA gửi file qua chat, máy
        // không có chỗ nào tự lấy. Không nhắc thì cả tháng không ai tải, mà màn hình
        // vẫn trông "sạch" vì số cũ không tự xấu đi.
        const lateStatement = statementOverdue(byPeriod.map((p) => p.ngay_sao_ke), asOf);
        if (lateStatement.tre) {
            tasks.push({
                id: "thieu-sao-ke", muc: "soat",
                tieu_de: "Chưa có sao kê kỳ mới",
                so: lateStatement.tre_ngay, don_vi: "ngày",
                chi_tiet: `Kỳ gần nhất là ${dmy(lateStatement.ky_gan_nhat || "")}. NAZA gửi đều mỗi ` +
                    `${STATEMENT_CYCLE_DAYS} ngày nên kỳ tiếp theo đáng lẽ có từ ${dmy(lateStatement.du_kien || "")}. ` +
                    "Xin NAZA file .xlsx rồi kéo vào ô trên cùng — chưa có nó thì tiền kỳ này chưa soát được.",
                done_key: "", nut: [], ghi_chu: "",
            });
        }

        // ── Cảnh báo — KÈM CHI TIẾT ĐỦ ĐỂ SỬA NGAY ────────────────────
        //
        // Bản trước chỉ nói "thiếu 6 mã: 002, 011…" rồi bảo mở file JSON ra sửa.
        // Đọc xong vẫn phải tự đi tra mã nào là hàng gì, bao nhiêu đơn dính, có
        // đáng ưu tiên không. Nên mỗi cảnh báo giờ mang theo BẢNG chi tiết —
        // nhìn là biết sửa cái nào trước.
        type Note = {
            id: string; level: "canh_bao" | "nhac";
            title: string; detail: string;
            cols?: string[];
            items?: (string | number)[][];
            fix?: string;
        };
        const notes: Note[] = [];

        if (!orders.length) {
            notes.push({
                id: "khong-don", level: "canh_bao",
                title: "Chưa có đơn nào",
                detail: "Vào tab Theo dõi vận đơn bấm “Đọc bảng đối tác” để nạp đơn từ file 3PL.",
            });
        }
        if (!stm.statements.length) {
            notes.push({
                id: "khong-sao-ke", level: "canh_bao",
                title: "Chưa tải bản sao kê nào",
                detail: "Chưa biết đơn nào đã về tiền. Leader vào Kế toán → Tiền COD về tải file NAZA lên.",
            });
        }

        // Đơn không ra giá vốn vì HAI lý do khác nhau, và cách sửa cũng khác nhau:
        // mã chưa khai giá thì Sỹ Anh đọc bảng giá cho một con số, còn ô SKU bỏ
        // trống thì phải điền vào file 3PL. Gộp chung một cảnh báo là đọc xong
        // vẫn không biết phải làm gì.
        const missingCogs = rows.filter((r) => r.cogs_missing.length > 0);
        const emptySku = rows.filter(
            (r) => r.cogs_vnd === null && r.cogs_missing.length === 0 && r.product_codes.length === 0,
        );

        if (missingCogs.length) {
            // Gom theo MÃ chứ không theo đơn: một mã khai một lần là sửa xong
            // hàng chục đơn. Xếp mã nhiều đơn nhất lên trước để biết sửa cái nào
            // đáng công nhất.
            const byCode = new Map<string, { orders: number; qty: number; skus: Set<string>; vd: string[] }>();
            for (const r of rows) {
                for (const c of r.cogs_missing) {
                    const e = byCode.get(c) || { orders: 0, qty: 0, skus: new Set<string>(), vd: [] };
                    e.orders++; e.qty += r.quantity;
                    if (r.sku) e.skus.add(r.sku);
                    if (e.vd.length < 3) e.vd.push(r.order_no);
                    byCode.set(c, e);
                }
            }
            const items = [...byCode.entries()]
                .sort((a, b) => b[1].orders - a[1].orders)
                .map(([code, e]) => [
                    code,
                    [...e.skus][0] || "(không rõ tên)",
                    e.orders, e.qty, e.vd.join(", "),
                ]);
            notes.push({
                id: "thieu-gia-von", level: "canh_bao",
                title: `${missingCogs.length}/${summary.total} đơn có mã hàng chưa khai giá vốn`,
                detail: `Thiếu giá nhập của ${items.length} mã dưới đây. Chừng nào chưa khai, cột “Còn lại” của những đơn đó là số TRƯỚC giá vốn — cao hơn thật.`,
                cols: ["Mã", "Tên hàng", "Số đơn", "Số lượng", "Ví dụ đơn"],
                items,
                fix: "Gửi giá nhập MỘT CÁI (bằng tệ) của từng mã để khai vào bảng giá — khai xong cột “Còn lại” tự đúng.",
            });
        }

        if (emptySku.length) {
            notes.push({
                id: "trong-o-sku", level: "canh_bao",
                title: `${emptySku.length}/${summary.total} đơn bỏ trống ô SKU trong file 3PL`,
                detail: "Những đơn này có tiền COD, có mã vận đơn, nhưng ô SKU trong file để trắng nên không biết bán hàng gì — không tra ra giá vốn được. Cột “Còn lại” của chúng là số TRƯỚC giá vốn, tức cao hơn thật.",
                cols: ["Mã đơn", "Ngày lên đơn", "Khách", "Tiền COD", "Trạng thái"],
                items: emptySku.map((r) => [
                    r.order_no, r.order_date || "(trống)", r.contact_name || "(trống)",
                    `${Math.round(r.cod_twd).toLocaleString("vi-VN")} NT$`,
                    r.status || "(chưa có)",
                ]),
                fix: "Mở Google Sheet đơn hàng, điền ô SKU cho các mã đơn trên rồi bấm Tải lại — không cần sửa gì trong hệ thống.",
            });
        }

        if (extra.length) {
            notes.push({
                id: "thua-sao-ke", level: "canh_bao",
                title: `${extra.length} dòng sao kê không ghép được vào đơn nào`,
                detail: "NAZA trả tiền cho những mã vận đơn này, nhưng file đơn của mình không có. Hoặc đơn chưa được nhập, hoặc mã vận đơn ghi sai.",
                cols: ["Mã đơn NAZA ghi", "Mã vận đơn", "Số tiền", "Kỳ sao kê"],
                items: extra.map((e) => [
                    e.order_no || "(trống)", e.tracking,
                    `${Math.round(e.amount_twd).toLocaleString("vi-VN")} NT$`,
                    (e.period || "").replace(/ĐỐI SOÁT COD|TAIWAN|\.xlsx/gi, "").trim(),
                ]),
                fix: "Tra các mã vận đơn này trong Google Sheet đơn hàng xem là đơn nào của mình.",
            });
        }

        const feeBad = rows.filter((r) => r.fee_wrong);
        if (feeBad.length) {
            notes.push({
                id: "phi-sai", level: "canh_bao",
                title: `${feeBad.length} đơn bị tính phí vận chuyển sai bảng giá`,
                detail: "Phí NAZA thu khác mức đã ký trong bảng giá.",
                cols: ["Mã đơn", "Mã vận đơn", "Kênh giao", "Phí đã thu"],
                items: feeBad.map((r) => [r.order_no, r.tracking, r.ship_method,
                    `${Math.round(r.ship_fee_rmb ?? 0).toLocaleString("vi-VN")}¥`]),
                fix: "Gửi danh sách này cho NAZA hỏi lại.",
            });
        }

        // Mã vận đơn nhiều đơn cùng mang — gõ nhầm mã của đơn bên cạnh trong Sheet.
        // Trước 17/09/2026 cảnh báo này không bao giờ nổ đúng: bộ nạp để dòng sau đè
        // dòng trước, nên trong kho chẳng còn hai đơn nào chung mã để mà thấy.
        // Khoá so đã chuẩn hoá (bỏ số 0 đầu), nhưng hiện mã NGUYÊN VĂN như Sheet ghi
        // để dán thẳng vào ô tìm kiếm của Sheet.
        const dupTrk = new Map<string, { ma: string; dons: string[] }>();
        for (const r of rows) {
            const k = trackKey(r.tracking);
            if (!k) continue;
            (dupTrk.get(k) || dupTrk.set(k, { ma: r.tracking, dons: [] }).get(k)!).dons.push(r.order_no);
        }
        // Cùng MỘT đơn nằm ở hai khoá là bản cũ trong kho (lần nạp sau tự gỡ), không
        // phải lỗi của Sheet — không kêu người đi sửa Sheet vì nó.
        const dups = [...dupTrk.entries()].filter(([, v]) => new Set(v.dons).size > 1);
        if (dups.length) {
            // Nói luôn phải sửa thành gì, lấy từ chính sao kê: dòng NAZA mang mã này
            // ghi mã đơn nào, và đơn còn lại NAZA gửi dưới mã vận đơn nào.
            const nazaLines: { tracking: string; order_no: string }[] = [...paid, ...fees];
            const isLineOfOrder = (orderNo: string, l: { order_no: string }) => {
                const g = redeliveryOrigin(orderNo);
                return g ? nazaRedeliveryOrigin(l.order_no) === g : orderKey(l.order_no) === orderKey(orderNo);
            };
            const nazaSays = (trackingCode: string, orderNos: string[]) => {
                const ownerLine = nazaLines.find((l) => trackKey(l.tracking) === trackingCode);
                const correctOrder = ownerLine && orderNos.find((d) => isLineOfOrder(d, ownerLine));
                const fixes = orderNos.filter((d) => d !== correctOrder).flatMap((d) => {
                    const l = nazaLines.find((x) => isLineOfOrder(d, x) && trackKey(x.tracking) !== trackingCode);
                    return l ? [`sửa ${d} thành ${l.tracking}`] : [];
                });
                const headline = correctOrder ? `Mã của ${correctOrder}` : ownerLine ? `NAZA ghi mã này cho ${ownerLine.order_no}` : "";
                return [headline, ...fixes].filter(Boolean).join(" · ") || "Chưa có trên sao kê nào — chưa biết đơn nào đúng.";
            };
            notes.push({
                id: "trung-van-don", level: "canh_bao",
                title: `${dups.length} mã vận đơn bị nhiều dòng trong Sheet dùng chung`,
                detail: "Một mã vận đơn chỉ thuộc về một đơn — thường là gõ nhầm mã của đơn bên cạnh. " +
                    "Máy đã dựa vào mã đơn NAZA ghi để ghép tiền cho đúng đơn, nhưng Sheet vẫn cần sửa.",
                cols: ["Mã vận đơn", "Các đơn cùng mang mã này", "Sao kê NAZA nói"],
                items: dups.map(([k, { ma: trackingCode, dons: orderNos }]) => [trackingCode, orderNos.join(" · "), nazaSays(k, orderNos)]),
                fix: "Sửa mã vận đơn trong Google Sheet đối tác theo cột cuối — lần nạp sau cảnh báo tự hết.",
            });
        }

        const missingTracking = rows.filter((r) => !r.tracking.trim());
        if (missingTracking.length) {
            notes.push({
                id: "thieu-van-don", level: "nhac",
                title: `${missingTracking.length} đơn không có mã vận đơn`,
                detail: "Không có mã vận đơn thì chỉ khớp được bằng mã đơn — kém chắc chắn hơn hẳn.",
                cols: ["Mã đơn", "Trạng thái", "Khách", "COD"],
                items: missingTracking.slice(0, 50).map((r) => [r.order_no, r.status_raw,
                    r.contact_name || "—", `${Math.round(r.cod_twd).toLocaleString("vi-VN")} NT$`]),
                fix: "Điền mã vận đơn vào Google Sheet đơn hàng.",
            });
        }

        // Sổ đơn gửi kèm `from` (27/10/2026): danh sách chỉ còn đơn lên trong khoảng from → to.
        // Tiền COD về gọi không có `from` — màn đó tính theo kỳ sao kê, cần mọi đơn. Kỳ sao kê,
        // khung Đòi tiền NAZA và cảnh báo ở trên vẫn tính trên MỌI đơn: tiền còn nợ của đơn
        // tháng trước không được biến mất chỉ vì đang xem tháng này.
        const ledgerRows = q.get("from") ? filterByOrderDate(rows, q.get("from"), asOf, todayVn()) : rows;

        return NextResponse.json({
            as_of: asOf,
            // Bảng đơn đối tác nạp lúc nào — màn hình PHẢI nói ra. Kho này chỉ đổi khi
            // việc nền 6h sáng chạy hoặc có người bấm "Đọc bảng đối tác"; không nói thì
            // số của tuần trước trông y hệt số hôm nay.
            nhap_bang_don: {
                luc: track.partner_import?.imported_at ?? null,
                nguon: track.partner_import?.filename ?? null,
                so_don: Object.keys(track.partner || {}).length,
                // Hiện ở cả màn Tiền COD về (Kế toán) — màn đó không có danh sách cảnh báo.
                ma_trung: dups.length,
            },
            rows: ledgerRows,
            summary,
            extra,
            status_vi: PARTNER_STATUS_VI,
            viec: tasks,
            checks,
            rate_trend: rateTrend,
            fx,
            periods: byPeriod,
            chua_ve_tien: deliveredUnpaid,
            tien_ve: (() => {
                // ── TIỀN VỀ: NAZA đã gửi bao nhiêu, còn phải gửi bao nhiêu ──
                //
                // "Đã gửi về" = cộng số "phải trả" NAZA ghi trên sao kê từng kỳ — đó là
                // tiền họ thật sự chuyển. "Phải nhận" tính lại theo file tiền hàng; hai
                // số chỉ khác nhau khi NAZA trừ tiền hàng lệch file. Kỳ âm không có
                // số phải trả: NAZA đã trừ nó vào kỳ sau nên cộng là đủ, không sót.
                // Chưa kỳ nào đối chiếu ngân hàng thì đó vẫn là số NAZA CAM KẾT.
                const periodsWithPayable = byPeriod.filter((p) => p.settlement?.payable_vnd != null);
                const remitted = periodsWithPayable.reduce((a, p) => a + (p.settlement?.payable_vnd ?? 0), 0);
                const receivableByFile = byPeriod.reduce((a, p) => a + (p.luong?.phai_nhan_vnd ?? 0), 0);
                const reconciledPeriods = byPeriod.filter((p) => p.bank?.thuc_nhan_vnd != null);

                // Dự tính theo đúng luồng NAZA, dùng tỷ giá của kỳ mới nhất có đủ hai
                // tỷ giá. Phí: đơn đã bị NAZA trừ phí ship ở một kỳ trước thì không trừ
                // lại; đơn chưa bị trừ thì trừ phí ship theo bảng giá kênh giao (kg đầu)
                // cộng phí thao tác. Tiền hàng các kỳ tới chưa biết nên CHƯA trừ.
                const ratePeriod = byPeriod.find((p) => p.luong?.ty_gia_twd_rmb && p.luong?.ty_gia_rmb_vnd);
                const tw = ratePeriod?.luong?.ty_gia_twd_rmb ?? null;
                const rv = ratePeriod?.luong?.ty_gia_rmb_vnd ?? null;
                const unpaid = rows.filter((r) => r.paid_twd === null);
                // Hàng hoàn nằm kho Đài 30 ngày rồi bị tiêu huỷ — cùng nhóm "không bao giờ
                // trả tiền" với đơn hoàn và đơn huỷ (Sỹ Anh giải thích 16/09/2026).
                const NEVER_PAID = new Set(["Returned", "Cancelled", "Destroyed"]);
                const estimate = (ds: typeof rows) => {
                    let cod = 0, feeRmb = 0, unchargedCount = 0;
                    for (const r of ds) {
                        cod += r.cod_twd;
                        if (r.ship_fee_rmb == null) {
                            unchargedCount++;
                            feeRmb += (expectedShipFee(matchChannel(r.ship_method || ""), null) ?? 0) + OP_FEE_PER_PARCEL;
                        }
                    }
                    const estimatedVnd = tw != null && rv != null ? (cod * tw - feeRmb) * rv : null;
                    return { so_don: ds.length, cod_twd: cod, don_chua_tru_phi: unchargedCount, phi_uoc_rmb: feeRmb, vnd_uoc: estimatedVnd };
                };
                const returned = unpaid.filter((r) => r.status === "Returned");
                const cancelled = unpaid.filter((r) => r.status === "Cancelled");
                const destroyed = unpaid.filter((r) => r.status === "Destroyed");
                return {
                    da_gui_ve_vnd: remitted,
                    phai_nhan_theo_file_vnd: receivableByFile,
                    so_ky: periodsWithPayable.length,
                    ky_da_doi_chieu_bank: reconciledPeriods.length,
                    thuc_nhan_vnd: reconciledPeriods.reduce((a, p) => a + (p.bank?.thuc_nhan_vnd ?? 0), 0),
                    ty_gia: { twd_rmb: tw, rmb_vnd: rv, ngay_sao_ke: ratePeriod?.ngay_sao_ke ?? null },
                    // HAI Ô RỜI NHAU, cộng lại không đếm hai lần (Sỹ Anh chốt 16/09/2026).
                    // Trước đó ô thứ hai là TẬP LỚN gồm cả đơn đã giao, nên nhìn tưởng hai
                    // khoản tách biệt rồi cộng nhầm: 82 đơn đã giao bị đếm ở cả hai ô.
                    //   · đã giao  = khách trả tiền rồi, NAZA đang giữ → họ NỢ mình;
                    //   · chưa giao = tiền còn ở ngoài đường, chưa tới lượt NAZA nợ.
                    con_lai_da_giao: estimate(unpaid.filter((r) => r.status === "Delivered")),
                    con_lai_chua_giao: estimate(unpaid.filter(
                        (r) => r.status !== "Delivered" && !NEVER_PAID.has(r.status || ""))),
                    khong_tinh: {
                        hoan: returned.length, huy: cancelled.length, tieu_huy: destroyed.length,
                        cod_twd: [...returned, ...cancelled, ...destroyed].reduce((a, r) => a + r.cod_twd, 0),
                    },
                    tien_hang: { loi: purchaseSheet.loi, so_dot: purchaseSheet.dot.length, doc_luc: purchaseSheet.doc_luc },
                };
            })(),
            // Con số mở đầu màn hình: bao nhiêu tiền đã đi qua chuyển khoản mà
            // chưa ai đối chiếu với ngân hàng. Đây là lỗ to nhất của cả tab.
            tong_quan: (() => {
                const awaitingBank = byPeriod.filter((p) => p.trang_thai === "cho_nhap");
                const diff = byPeriod.filter((p) => p.trang_thai === "lech");
                const matched = byPeriod.filter((p) => p.trang_thai === "khop");
                return {
                    ky_cho_nhap: awaitingBank.length,
                    tien_cho_nhap_vnd: awaitingBank.reduce((a, p) => a + (p.settlement?.payable_vnd ?? 0), 0),
                    ky_lech: diff.length,
                    tien_lech_vnd: diff.reduce((a, p) => a + (p.lech_bank_vnd ?? 0), 0),
                    ky_khop: matched.length,
                    bank_tolerance_vnd: BANK_TOLERANCE_VND,
                };
            })(),
            statements: stm.statements.map((s) => ({ id: s.id, filename: s.filename })),
            warnings: notes,
        });
    } catch (e) {
        console.error("order-ledger GET lỗi:", e);
        return NextResponse.json({ error: "Không dựng được sổ đơn hàng" }, { status: 500 });
    }
}
