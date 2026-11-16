import { readStoreFresh } from "@/lib/talpha/store";
import { loadTwOrderLedger } from "@/lib/talpha/tw-order-ledger";
import { summarise, filterByOrderDate, todayVn, sortNewestFirst } from "@/lib/talpha/order-ledger";
import { readPurchaseSheet, matchPaymentsToPeriods, statementDateFromName } from "@/lib/talpha/purchase-sheet";
import { PARTNER_STATUS_VI } from "@/lib/talpha/partner-file";
import { bankKey, emptyActions, fxLoss, type CodActions } from "@/lib/talpha/cod-actions";
import { buildPeriods, buildRateTrend, buildDeliveredUnpaid } from "./periods";
import { buildChecks } from "./checks";
import { buildTasks } from "./tasks";
import { buildWarnings } from "./warnings";
import { buildMoneyBack, buildOverview } from "./money-summary";

/**
 * Dựng toàn bộ sổ đơn Đài tính tới `asOf`. `from` (27/10/2026) chỉ lọc danh sách `rows` —
 * xem chú thích cuối hàm.
 */
export async function buildOrderLedger(asOf: string, from: string | null) {
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

    const byPeriod = buildPeriods(stm.statements, rows, extra, batchByStatement, bankOf);

    // Ngày chốt của mọi kỳ, cũ → mới. Dùng để đếm "đã qua mấy kỳ" cho cả
    // đơn quá hạn lẫn việc đã đòi mà NAZA vẫn im.
    const periodEnds = byPeriod.map((p) => p.period_date).filter(Boolean).sort();

    const rateTrend = buildRateTrend(byPeriod);

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

    const deliveredUnpaid = buildDeliveredUnpaid(rows, doneOf, periodEnds);

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
    const latestRate = rateTrend[0];

    const checks = buildChecks(latest, latestStatement, latestRate, fx, purchaseSheet);
    const tasks = buildTasks(deliveredUnpaid, doneOf, periodEnds, latest, byPeriod, asOf);
    const { notes, dups } = buildWarnings(orders, stm, rows, summary, extra, paid, fees);

    // Sổ đơn gửi kèm `from` (27/10/2026): danh sách chỉ còn đơn lên trong khoảng from → to.
    // Tiền COD về gọi không có `from` — màn đó tính theo kỳ sao kê, cần mọi đơn. Kỳ sao kê,
    // khung Đòi tiền NAZA và cảnh báo ở trên vẫn tính trên MỌI đơn: tiền còn nợ của đơn
    // tháng trước không được biến mất chỉ vì đang xem tháng này.
    const ledgerRows = from ? filterByOrderDate(rows, from, asOf, todayVn()) : rows;

    return {
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
        tien_ve: buildMoneyBack(byPeriod, rows, purchaseSheet, asOf),
        tong_quan: buildOverview(byPeriod),
        statements: stm.statements.map((s) => ({ id: s.id, filename: s.filename })),
        warnings: notes,
    };
}
