import { RULES } from "@/lib/talpha/rules";
import { sgMergeWarning } from "@/lib/talpha/naza-statement";
import type { Statement } from "./statement-store";

function shipFeeDeclared(): boolean {
    const fees = (RULES as unknown as { shipping_fees?: Record<string, { declared?: boolean }> }).shipping_fees || {};
    return !!fees.TW?.declared;
}

const vnd = (n: number) => Math.round(n).toLocaleString("vi-VN");

/** Cảnh báo về CHÍNH BẢN SAO KÊ — những thứ phải hỏi 3PL, tách khỏi kết quả khớp đơn. */
export function warnings(st?: Statement): string[] {
    const w: string[] = [];
    if (!shipFeeDeclared()) {
        w.push(
            "Chưa khai phí 3PL cho Đài Loan (talpha_rules.json → shipping_fees.TW). " +
            "Đối soát tiền COD vẫn đúng, nhưng phần phí trên sao kê chưa có gì để đối chiếu.",
        );
    }
    const n = st?.naza;
    if (!n) return w;

    if (n.checks.math_ok === false) w.push(`Sheet TỔNG: ${n.checks.math_note}`);
    if (n.checks.cod_gap !== null && Math.abs(n.checks.cod_gap) > 0.5) {
        w.push(
            `Chi tiết COD cộng ra ${vnd(n.checks.cod_detail_total)} TWD nhưng sheet TỔNG ghi ` +
            `${vnd(n.checks.cod_summary_total ?? 0)} TWD — lệch ${vnd(n.checks.cod_gap)} TWD. Hỏi lại 3PL.`,
        );
    }
    if (n.fee_audit.wrong > 0) {
        w.push(
            `${n.fee_audit.wrong} dòng phí không đúng bảng giá, chênh ${vnd(n.fee_audit.overcharge_rmb)} RMB. ` +
            "Xem mục Soát phí bên dưới.",
        );
    }
    if (n.fee_audit.unknown_channel > 0) {
        w.push(
            `${n.fee_audit.unknown_channel} dòng không nhận ra kênh giao hàng nên chưa soát được phí. ` +
            "Khai thêm token kênh vào shipping_fees.TW.channels.",
        );
    }
    if (n.summary.purchase_vnd) {
        w.push(
            `Kỳ này bị trừ ${vnd(n.summary.purchase_vnd)} VND phí mua hàng Đài trước khi chuyển tiền về. ` +
            "Khoản này không nằm trong bảng giá vận chuyển — đối chiếu với đơn mua hàng.",
        );
    }
    if (n.sg_gop) w.push(sgMergeWarning(n.sg_gop, n.summary.payable_vnd));
    return w;
}
