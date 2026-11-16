/**
 * GOM CẢNH BÁO + MỘT DÒNG KẾT LUẬN — phần trình bày của luật cảnh báo (rules.ts).
 *
 * Tách khỏi rules.ts: rules.ts trả lời "có lệch gì", file này trả lời "người đọc nhìn vào
 * đâu trước". Mã cảnh báo (THE_TRU_MA_KHONG_CO_HOA_DON…) và khoá kết luận (muc, tieu_de…)
 * được lưu cùng mỗi kỳ và màn Thanh toán quảng cáo đọc lại — giữ nguyên.
 */
import { fmtVND } from "./normalize.ts";
import type { Alert, Severity, Verdict } from "./types.ts";

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warn: 1, info: 2 };

/**
 * MỘT DÒNG KẾT LUẬN, ĐẶT TRÊN MỌI CON SỐ.
 *
 * Sỹ Anh: "cách check đối soát đang phức tạp, tối ưu cho dễ nhìn ra vấn đề".
 * Đúng — mở màn ra là sáu con số với một chồng cảnh báo, mà câu hỏi thật sự
 * chỉ có một: SỐ NÀY CÓ TIN ĐƯỢC KHÔNG, VÀ PHẢI LÀM GÌ.
 *
 * Chỗ nguy hiểm là ba loại cảnh báo dưới đây: chúng không nói "mất tiền", mà
 * nói "dữ liệu chưa đủ hoặc đọc sai". Còn chúng thì MỌI con số bên dưới đều
 * sai bản chất — kể cả những con số trông rất bình thường. Phải tách hẳn ra,
 * không để nằm lẫn giữa các cảnh báo mất tiền.
 */
const BLOCKING_CODES = ["FILE_KHONG_DOC_DUOC", "NGUON_LECH_NHAU", "THIEU_BAN_KE_TKQC", "THIEU_COT"];

export function buildVerdict(alerts: Alert[]): Verdict {
    const blocking = alerts.filter((a) => BLOCKING_CODES.includes(a.code) && a.severity !== "info");
    const critical = alerts.filter((a) => a.severity === "critical" && !BLOCKING_CODES.includes(a.code));
    const toReview = alerts.filter((a) => a.severity === "warn" && !BLOCKING_CODES.includes(a.code));

    if (blocking.length) {
        return {
            muc: "khong_tin",
            tieu_de: "Chưa tin được số — dữ liệu đầu vào còn thiếu hoặc đọc sai",
            giai_thich: "Khi một phía thiếu dữ liệu thì mọi dòng bên kia đều trông như 'không có hoá đơn'. " +
                        "Xử xong mấy việc dưới đây rồi hãy đọc các con số.",
            viec: blocking.map((a) => ({ code: a.code, title: a.title, hint: a.hint })),
        };
    }
    if (critical.length) {
        const amount = critical.reduce((s2, a) => s2 + (a.amount || 0), 0);
        return {
            muc: "co_van_de",
            tieu_de: `Số tin được — có ${critical.length} việc phải xử, ${fmtVND(amount)} cần đòi hoặc làm rõ`,
            giai_thich: "Hai nguồn khớp đủ để kết luận. Danh sách dưới đây là tiền thật đang lệch.",
            viec: critical.slice(0, 3).map((a) => ({ code: a.code, title: a.title, hint: a.hint })),
        };
    }
    if (toReview.length) {
        return {
            muc: "can_xem", tieu_de: `Không có gì nghiêm trọng — ${toReview.length} mục nên xem qua`,
            giai_thich: "Không mất tiền, nhưng có vài chỗ nên liếc lại.",
            viec: toReview.slice(0, 3).map((a) => ({ code: a.code, title: a.title, hint: a.hint })),
        };
    }
    return { muc: "sach", tieu_de: "Khớp sạch — không có gì phải làm", giai_thich: "", viec: [] };
}

/**
 * GOM CẢNH BÁO CÙNG LOẠI.
 *
 * Trên dữ liệu thật, một kỳ đẻ ra 167 cảnh báo — trong đó 68 cái cùng là "phí
 * thẻ lẻ". Không ai đọc hết 167 thẻ, mà không đọc hết thì cái nghiêm trọng
 * nằm lẫn ở giữa cũng trôi luôn. Cùng một loại quá 3 cái thì gộp thành MỘT,
 * mang tổng tiền và vài dòng nặng nhất; chi tiết từng dòng vẫn nằm đủ trong
 * bảng bên dưới và trong file CSV xuất ra.
 */
const GROUP_LABELS: Record<string, string> = {
    THE_TRU_MA_KHONG_CO_HOA_DON: "khoản thẻ bị trừ mà TKQC không có hoá đơn",
    TRU_TRUNG: "khoản nghi bị trừ trùng",
    FB_THU_MA_THE_KHONG_TRU: "hoá đơn TKQC chưa thấy thẻ trừ",
    FB_LOI_MA_VAN_TRU: "hoá đơn báo lỗi mà thẻ vẫn trừ",
    PHI_AN: "giao dịch ngân hàng trừ nhiều hơn hoá đơn",
    TRU_THIEU: "giao dịch ngân hàng trừ ít hơn hoá đơn",
    PHI_THE_RIENG: "khoản phí thẻ lẻ",
    LECH_THE: "cặp hoá đơn và sao kê ghi hai thẻ khác nhau",
    NGAY_DOT_BIEN: "ngày chi đột biến",
    TRUNG_GIUA_FILE: "nhóm dòng trùng giữa các file",
};
const GROUP_THRESHOLD = 3;

export function groupAlerts(alerts: Alert[]): Alert[] {
    const byCode = new Map<string, Alert[]>();
    for (const a of alerts) {
        let list = byCode.get(a.code);
        if (!list) { list = []; byCode.set(a.code, list); }
        list.push(a);
    }

    const out: Alert[] = [];
    for (const [code, list] of byCode) {
        if (list.length <= GROUP_THRESHOLD || !GROUP_LABELS[code]) { out.push(...list); continue; }

        const mostSevere = list.reduce((m, a) => (SEVERITY_RANK[a.severity] < SEVERITY_RANK[m.severity] ? a : m), list[0]);
        const total = list.reduce((s2, a) => s2 + (a.amount || 0), 0);
        const top = [...list].sort((a, b) => (b.amount || 0) - (a.amount || 0)).slice(0, 5);

        // Thứ tự khoá giữ như bản trước để JSON lưu xuống không đổi.
        out.push({
            code, severity: mostSevere.severity,
            title: `${list.length} ${GROUP_LABELS[code]} — tổng ${fmtVND(total)}`,
            detail: "Nặng nhất: " + top.map((a) => a.title.replace(/^\d+ /, "")).join(" · ") +
                    (list.length > 5 ? ` … và ${list.length - 5} khoản nữa.` : ""),
            hint: mostSevere.hint,
            amount: total,
            count: list.length,
            items: list.flatMap((a) => a.items || []),
        });
    }
    return out;
}
