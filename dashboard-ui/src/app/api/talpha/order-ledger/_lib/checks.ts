import { sgMergeWarning } from "@/lib/talpha/naza-statement";
import type { PurchaseSheetResult } from "@/lib/talpha/purchase-sheet";
import type { fxLoss } from "@/lib/talpha/cod-actions";
import { vnd } from "./format";
import type { LedgerStatement, Period, RateTrendRow } from "./periods";

export type Check = { nhom: "A" | "B"; ten: string; ok: boolean | null; chi_tiet: string };

// ── 8 MỤC KIỂM TRA ────────────────────────────────────────────
// Nhóm A soát chính FILE (tin được số trong đó không), nhóm B soát ĐƠN
// (file đúng rồi thì so với đơn của mình). Thứ tự này không đảo được:
// file sai mà đem so đơn thì mọi kết luận đều vô nghĩa.
//
// MỌI mục ở đây thuộc phạm vi MỘT KỲ — kỳ đang chọn, không phải cộng
// dồn. Bản trước để lẫn một mục cộng dồn cả 7 kỳ vào giữa, thành ra
// "80 đơn sao kê bỏ sót" trông như NAZA vừa bỏ sót 80 đơn trong một
// tuần, trong khi 76 đơn trong đó hoàn toàn bình thường. Mục đó nay
// nằm riêng ở khối "tiền còn nằm ở NAZA".
export function buildChecks(
    latest: Period | undefined,
    latestStatement: LedgerStatement | undefined,
    latestRate: RateTrendRow | undefined,
    fx: ReturnType<typeof fxLoss>,
    purchaseSheet: PurchaseSheetResult,
): Check[] {
    const fa = latestStatement?.naza?.fee_audit;
    const checks: Check[] = [];
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
                if (purchaseSheet.nghi_ngo.length) detail += " Có đợt nghi gõ nhầm ngày trong file — xem mục “Ngày đợt trong file tiền hàng”.";
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
        // Ngày đợt gõ nhầm trong file tiền hàng (13/11/2026: "30/11" thay vì 30/10 làm kỳ
        // 30/10 mất đợt). Đợt nghi ngờ đã bị bỏ khỏi phép ghép — nói ra để người sửa file.
        if (!purchaseSheet.loi || purchaseSheet.nghi_ngo.length) {
            const suspects = purchaseSheet.nghi_ngo;
            checks.push({
                nhom: "B", ten: "Ngày đợt trong file tiền hàng",
                ok: suspects.length === 0,
                chi_tiet: suspects.length === 0
                    ? `${purchaseSheet.dot.length} đợt, ngày đi đúng thứ tự.`
                    : suspects.map((x) => x.ly_do).join(" · ") +
                      " Đợt này tạm KHÔNG ghép vào kỳ sao kê nào — sửa ngày trong Sheet, 5 phút sau dashboard tự đọc lại.",
            });
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
    return checks;
}
