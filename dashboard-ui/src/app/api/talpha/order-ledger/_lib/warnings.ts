import {
    redeliveryOrigin, nazaRedeliveryOrigin, orderKey, trackKey, type LedgerSummary,
} from "@/lib/talpha/order-ledger";
import type { LedgerData, LedgerExtra, LedgerRows } from "./periods";

// ── Cảnh báo — KÈM CHI TIẾT ĐỦ ĐỂ SỬA NGAY ────────────────────
//
// Bản trước chỉ nói "thiếu 6 mã: 002, 011…" rồi bảo mở file JSON ra sửa.
// Đọc xong vẫn phải tự đi tra mã nào là hàng gì, bao nhiêu đơn dính, có
// đáng ưu tiên không. Nên mỗi cảnh báo giờ mang theo BẢNG chi tiết —
// nhìn là biết sửa cái nào trước.
export type Note = {
    id: string; level: "canh_bao" | "nhac";
    title: string; detail: string;
    cols?: string[];
    items?: (string | number)[][];
    fix?: string;
};

/** Cảnh báo của sổ đơn, kèm danh sách mã vận đơn bị nhiều dòng Sheet dùng chung (`dups`). */
export function buildWarnings(
    orders: LedgerData["orders"], stm: LedgerData["stm"], rows: LedgerRows, summary: LedgerSummary,
    extra: LedgerExtra, paid: LedgerData["paid"], fees: LedgerData["fees"],
) {
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

    return { notes, dups };
}
