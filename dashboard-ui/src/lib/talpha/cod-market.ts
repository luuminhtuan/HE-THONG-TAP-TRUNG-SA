/**
 * ĐỐI SOÁT COD THỊ TRƯỜNG NGOÀI ĐÀI (Singapore, UAE…) — bước 1, Sỹ Anh chốt 26/09/2026.
 *
 * Chưa có sao kê của bên giao hàng nào ngoài NAZA Đài, nên chưa khớp được từng kỳ. Bước này
 * chỉ trả lời câu Sỹ Anh hỏi trên màn Đài: tiền còn ở đâu —
 *   • ĐÃ GIAO  : khách đã trả, tiền đang nằm ở bên giao hàng, chờ họ gửi về;
 *   • CHƯA GIAO: tiền còn ngoài đường;
 *   • KHÔNG TÍNH: hoàn, huỷ, tiêu huỷ — không bao giờ có tiền.
 * Tiền quy VND theo tỷ giá khai ở talpha_rules.json → markets.*.rate_vnd, CHƯA trừ phí
 * (phí ship, phí thu hộ) — chưa có sao kê thì không biết họ trừ bao nhiêu.
 *
 * Hàm thuần — không gọi mạng, không đọc file — để test được.
 */
import { statusLabel } from "./tracking";

export type OrderGroup = "da_giao" | "chua_giao" | "khong_tinh";
export type ExclusionReason = "hoan" | "huy" | "tieu_huy";

export type CodOrder = {
    order_id: string;
    tracking: string;
    order_date: string | null;
    trang_thai: string;
    nhom: OrderGroup;
    ly_do?: ExclusionReason;
    cod_local: number;
    khach: string;
};

type Classification = { nhom: OrderGroup; ly_do?: ExclusionReason };

/**
 * Theo trạng thái vận đơn chuẩn (bảng đối tác + 17TRACK). Hàng ĐANG hoàn (17TRACK báo
 * Exception_Returning) cũng không tính: tiền không về nữa, đếm vào "chưa giao" là hứa hão.
 */
export function classifyByShipment(status?: string | null, sub?: string | null): Classification {
    if (status === "Delivered") return { nhom: "da_giao" };
    if (status === "Returned" || status === "Expired") return { nhom: "khong_tinh", ly_do: "hoan" };
    if (status === "Exception" && /Return/.test(String(sub || ""))) return { nhom: "khong_tinh", ly_do: "hoan" };
    if (status === "Cancelled") return { nhom: "khong_tinh", ly_do: "huy" };
    if (status === "Destroyed") return { nhom: "khong_tinh", ly_do: "tieu_huy" };
    return { nhom: "chua_giao" };
}

/**
 * Theo nhóm trạng thái POS (vw_orders_std.status_category) — cho nước chưa có bảng đối tác.
 * Đơn thô (DON_THO) chưa phải đơn thật, chưa đi đâu cả → trả null, bỏ khỏi danh sách.
 */
export function classifyByPos(category?: string | null): Classification | null {
    const c = String(category || "").toUpperCase();
    if (c === "DON_THO") return null;
    if (c === "GIAO_THANH_CONG") return { nhom: "da_giao" };
    if (c === "DON_HOAN") return { nhom: "khong_tinh", ly_do: "hoan" };
    if (c === "HUY") return { nhom: "khong_tinh", ly_do: "huy" };
    return { nhom: "chua_giao" };
}

// Tên trạng thái POS (vw_orders_std.status_name, tiếng Anh) → chữ đọc được. "pending" giữ kèm
// chữ gốc vì POS dùng nó cho cả "chờ hàng" lẫn "chờ gửi" — dịch cứng một nghĩa là đoán.
const POS_VI: Record<string, string> = {
    new: "Đơn mới, chưa xác nhận",
    submitted: "Đã xác nhận, chưa gửi hàng",
    pending: "Chờ xử lý (pending)",
    shipped: "Đã gửi hàng, đang giao",
    delivered: "Đã giao",
    received_money: "Đã nhận tiền",
    returned: "Đã hoàn",
    canceled: "Đã huỷ",
};

/** Chữ trạng thái POS: tên đã dịch, chưa dịch thì chữ gốc, không có thì nhóm trạng thái. */
export function posStatusText(name?: string | null, category?: string | null): string {
    const n = String(name || "").trim();
    return POS_VI[n.toLowerCase()] || n || String(category || "") || "Chưa rõ";
}

/** Chữ trạng thái hiển thị: nhãn chuẩn, không có thì chữ gốc của nguồn. */
export function statusText(status?: string | null, raw?: string | null): string {
    return status ? statusLabel(status) : (String(raw || "").trim() || "Chưa rõ");
}

export type Khoan = { so_don: number; cod_local: number; vnd_uoc: number | null };
export type CodSummary = {
    da_giao: Khoan;
    chua_giao: Khoan & { theo_trang_thai: { trang_thai: string; so_don: number; cod_local: number }[] };
    khong_tinh: Khoan & { hoan: number; huy: number; tieu_huy: number };
};

/** Cộng từng nhóm. rateVnd ≤ 0 (chưa khai tỷ giá) → vnd_uoc null, KHÔNG nhân bừa. */
export function summarizeCod(orders: CodOrder[], rateVnd: number): CodSummary {
    const vnd = (x: number) => (rateVnd > 0 ? Math.round(x * rateVnd) : null);
    const sumGroup = (xs: CodOrder[]): Khoan => {
        const cod = xs.reduce((n, d) => n + (Number(d.cod_local) || 0), 0);
        return { so_don: xs.length, cod_local: Math.round(cod * 100) / 100, vnd_uoc: vnd(cod) };
    };
    const delivered = orders.filter((d) => d.nhom === "da_giao");
    const undelivered = orders.filter((d) => d.nhom === "chua_giao");
    const excluded = orders.filter((d) => d.nhom === "khong_tinh");

    const byStatus = new Map<string, { trang_thai: string; so_don: number; cod_local: number }>();
    for (const d of undelivered) {
        const x = byStatus.get(d.trang_thai) || { trang_thai: d.trang_thai, so_don: 0, cod_local: 0 };
        x.so_don++;
        x.cod_local += Number(d.cod_local) || 0;
        byStatus.set(d.trang_thai, x);
    }
    return {
        da_giao: sumGroup(delivered),
        chua_giao: { ...sumGroup(undelivered), theo_trang_thai: [...byStatus.values()].sort((a, b) => b.so_don - a.so_don) },
        khong_tinh: {
            ...sumGroup(excluded),
            hoan: excluded.filter((d) => d.ly_do === "hoan").length,
            huy: excluded.filter((d) => d.ly_do === "huy").length,
            tieu_huy: excluded.filter((d) => d.ly_do === "tieu_huy").length,
        },
    };
}
