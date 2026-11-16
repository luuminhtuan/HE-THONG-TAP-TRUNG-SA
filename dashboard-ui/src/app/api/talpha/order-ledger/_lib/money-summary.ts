import { expectedShipFee, matchChannel, OP_FEE_PER_PARCEL } from "@/lib/talpha/naza-statement";
import type { PurchaseSheetResult } from "@/lib/talpha/purchase-sheet";
import { BANK_TOLERANCE_VND } from "@/lib/talpha/cod-actions";
import { daysSince, oldestDays, undeliveredAge, type AgeBucket, type CodComposition, type MoneyAge } from "@/lib/talpha/cod-money-age";
import type { LedgerRows, Period } from "./periods";

// ── TIỀN VỀ: NAZA đã gửi bao nhiêu, còn phải gửi bao nhiêu ──
//
// "Đã gửi về" = cộng số "phải trả" NAZA ghi trên sao kê từng kỳ — đó là
// tiền họ thật sự chuyển. "Phải nhận" tính lại theo file tiền hàng; hai
// số chỉ khác nhau khi NAZA trừ tiền hàng lệch file. Kỳ âm không có
// số phải trả: NAZA đã trừ nó vào kỳ sau nên cộng là đủ, không sót.
// Chưa kỳ nào đối chiếu ngân hàng thì đó vẫn là số NAZA CAM KẾT.
export function buildMoneyBack(byPeriod: Period[], rows: LedgerRows, purchaseSheet: PurchaseSheetResult, asOf: string) {
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
    const deliveredUnpaid = unpaid.filter((r) => r.status === "Delivered");
    const inTransit = unpaid.filter((r) => r.status !== "Delivered" && !NEVER_PAID.has(r.status || ""));
    const returned = unpaid.filter((r) => r.status === "Returned");
    const cancelled = unpaid.filter((r) => r.status === "Cancelled");
    const destroyed = unpaid.filter((r) => r.status === "Destroyed");

    // ── TIỀN ĐANG CHỜ BAO LÂU (13/11/2026) ──
    // Không có ngày giao thật → đếm từ ngày gửi (ship_date, thiếu thì ngày lên đơn). Đơn đã giao
    // chia theo số KỲ đã qua — cùng thước đèn Sổ đơn hàng: 0 kỳ = đúng nhịp, 1 kỳ = theo dõi,
    // ≥2 kỳ = quá hạn phải đòi. Đơn chưa giao chia theo NGÀY: quá 30 ngày gần như chắc hoàn.
    const days = (r: LedgerRows[number]) => daysSince(r.ship_date || r.order_date, asOf);
    const bucket = (ds: LedgerRows): AgeBucket => { const u = estimate(ds); return { so_don: u.so_don, cod: u.cod_twd, vnd_uoc: u.vnd_uoc }; };
    const age: MoneyAge = {
        da_giao: {
            dung_nhip: bucket(deliveredUnpaid.filter((r) => r.ky_da_qua === 0)),
            qua_1_ky: bucket(deliveredUnpaid.filter((r) => r.ky_da_qua === 1)),
            qua_han: bucket(deliveredUnpaid.filter((r) => r.ky_da_qua >= 2)),
            lau_nhat_ngay: oldestDays(deliveredUnpaid, days),
        },
        chua_giao: undeliveredAge(inTransit, days, bucket),
    };

    // ── TIỀN HÀNG ĐÃ TRỪ + COD VỀ TAY ĐƯỢC BAO NHIÊU ──
    // COD quy VND theo tỷ giá CHÍNH kỳ đó (chưa trừ gì) — mẫu số của tỉ lệ thực nhận.
    let codVnd = 0, feesVnd = 0, goodsDeducted = 0, countedPeriods = 0;
    for (const p of periodsWithPayable) {
        const l = p.luong;
        if (!l || l.cod_twd == null || l.ty_gia_twd_rmb == null || l.ty_gia_rmb_vnd == null) continue;
        countedPeriods++;
        codVnd += l.cod_twd * l.ty_gia_twd_rmb * l.ty_gia_rmb_vnd;
        feesVnd += (l.phi_thao_tac_rmb + l.phi_ship_rmb) * l.ty_gia_rmb_vnd;
        goodsDeducted += l.tien_hang.trong_luong_vnd;
    }
    const composition: CodComposition | null = countedPeriods === periodsWithPayable.length && codVnd > 0 ? {
        so_ky: countedPeriods, cod_quy_vnd: codVnd, phi_vnd: feesVnd, tien_hang_vnd: goodsDeducted,
        ve_tay_vnd: remitted, ty_le_ve_tay: remitted / codVnd,
    } : null;

    return {
        tuoi: age,
        co_cau: composition,
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
        con_lai_da_giao: estimate(deliveredUnpaid),
        con_lai_chua_giao: estimate(inTransit),
        khong_tinh: {
            hoan: returned.length, huy: cancelled.length, tieu_huy: destroyed.length,
            cod_twd: [...returned, ...cancelled, ...destroyed].reduce((a, r) => a + r.cod_twd, 0),
        },
        tien_hang: {
            loi: purchaseSheet.loi, so_dot: purchaseSheet.dot.length, doc_luc: purchaseSheet.doc_luc,
            nghi_ngo: purchaseSheet.nghi_ngo.map((x) => x.ly_do),
        },
    };
}

// Con số mở đầu màn hình: bao nhiêu tiền đã đi qua chuyển khoản mà
// chưa ai đối chiếu với ngân hàng. Đây là lỗ to nhất của cả tab.
export function buildOverview(byPeriod: Period[]) {
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
}
