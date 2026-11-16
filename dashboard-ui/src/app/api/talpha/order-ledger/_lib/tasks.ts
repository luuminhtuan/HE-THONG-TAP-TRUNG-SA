import { statementOverdue, STATEMENT_CYCLE_DAYS } from "@/lib/talpha/order-ledger";
import { doneKey, shouldResurface, type DoneEntry } from "@/lib/talpha/cod-actions";
import { vnd, dmy } from "./format";
import type { DeliveredUnpaid, Period } from "./periods";

export type Task = {
    id: string; muc: "gap" | "soat" | "ghi"; tieu_de: string;
    so: number; don_vi: string; chi_tiet: string;
    /** Khoá để bấm đóng. Rỗng = việc tự hết khi số liệu đổi, không đóng tay. */
    done_key: string;
    /** Nút nào hợp với việc này. */
    nut: ("da_doi" | "da_hoi" | "bo_qua" | "nhap_bank")[];
    /** Đã đóng lần nào chưa — để màn hình nói "đòi rồi mà vẫn im". */
    ghi_chu: string;
};

// ── VIỆC HÔM NAY, CÓ TRÍ NHỚ ──────────────────────────────────
//
// Bản trước không nhớ gì: "Nhắn NAZA đòi tiền 4 đơn" hiện y hệt mỗi
// ngày, đòi hôm qua rồi hôm nay vẫn thế. Nay mỗi việc có khoá riêng,
// bấm đóng là ghi vào kho `cod_actions` kèm ngày.
//
// Nhưng đóng KHÔNG phải là quên. NAZA trả tiền theo kỳ, nên phép thử
// thật là: sang kỳ sao kê sau, tiền về chưa? Chưa về thì việc nổi lại
// và nặng hơn, vì đã đòi một lần mà họ vẫn im (shouldResurface).
export function buildTasks(
    deliveredUnpaid: DeliveredUnpaid[],
    doneOf: (k: string) => DoneEntry | undefined,
    periodEnds: string[],
    latest: Period | undefined,
    byPeriod: Period[],
    asOf: string,
): Task[] {
    const overdue = deliveredUnpaid.filter((x) => x.qua_han);
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
    return tasks;
}
