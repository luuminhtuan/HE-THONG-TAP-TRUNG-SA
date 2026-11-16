import type { NazaStatement } from "@/lib/talpha/naza-statement";
import type { PurchasePayment } from "@/lib/talpha/purchase-sheet";

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

export function periodCashFlow(
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
