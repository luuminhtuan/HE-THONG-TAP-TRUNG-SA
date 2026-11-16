import { reconcile, type PosOrder } from "@/lib/talpha/cod-recon";
import { fillTrackingInStatements } from "@/lib/talpha/naza-statement";
import { loadDeliveredOrders, loadPartnerDelivered } from "./delivered-orders";
import { warnings } from "./statement-warnings";
import type { Statement } from "./statement-store";

/**
 * Đối soát GET: khớp đơn đã giao (POS ∪ file đối tác) với MỌI bản sao kê đã tải, trả kèm
 * danh sách bản sao kê (`list`) và phần quyết toán của bản đang chọn (`chosen`).
 */
export async function buildReconciliation(
    store: { statements: Statement[] }, chosen: Statement | undefined, list: unknown[],
    from: string, to: string,
) {
    // ĐỐI SOÁT THEO BẢN SAO KÊ, KHÔNG THEO KHOẢNG NGÀY.
    //
    // Một bản sao kê là một KỲ THANH TOÁN: nó trả tiền cho đơn đã giao xong,
    // mà đơn đó có thể được đặt từ hàng tháng trước. Kỳ 04/09 thật có đơn
    // đặt từ 10/07. Nếu chỉ nạp đơn trong khoảng ngày đang chọn rồi đem
    // khớp, những đơn cũ hơn sẽ không tìm thấy và bị kết luận là "3PL trả
    // cho đơn mình không có" — thử với khoảng 15/08–08/09 ra 28 đơn báo
    // động giả kiểu đó, trong khi đơn nằm sẵn trong hệ thống.
    //
    // Nên nạp TOÀN BỘ đơn đã giao. Khoảng ngày ở thanh trên không lọc phần
    // này; nó chỉ dùng làm mốc "hôm nay" để tính đơn nào quá hạn.
    const ALL_FROM = "2000-01-01";
    const ALL_TO = "2999-12-31";

    // HỢP hai nguồn, không chọn một.
    //
    // POS và file đối tác đều trả lời "đơn nào đã giao", nhưng lệch nhau rất
    // xa: POS mới có 5 đơn giao thành công có COD, file đối tác có 361 —
    // đội không cập nhật trạng thái lên POS kịp. Bản trước chỉ lấy file đối
    // tác KHI kho số trống; đến lúc POS có vài đơn thì hệ thống bỏ luôn
    // file đối tác, và đối soát tụt từ 316 đơn khớp xuống 0.
    //
    // Nên gộp: POS thắng khi cùng một mã vận đơn (có marketer, có sale),
    // đơn nào POS chưa biết thì lấy từ file đối tác.
    let posOrders: PosOrder[] = [];
    try {
        posOrders = await loadDeliveredOrders(ALL_FROM, ALL_TO);
    } catch (e) {
        console.warn("cod-recon: không đọc được đơn từ Postgres, chỉ dùng file đối tác:", e);
    }
    const partnerOrders = await loadPartnerDelivered(ALL_FROM, ALL_TO);

    const merged = new Map<string, PosOrder>();
    const keyOf = (o: PosOrder) => {
        const t = String(o.tracking ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
        const norm = /^\d+$/.test(t) ? t.replace(/^0+/, "") || t : t;
        return norm || `ORD:${o.order_id}`;
    };
    for (const o of partnerOrders) merged.set(keyOf(o), o);
    for (const o of posOrders) merged.set(keyOf(o), o);   // POS ghi đè
    const orders = [...merged.values()];

    const source: "pos" | "doi_tac" | "ca_hai" =
        posOrders.length && partnerOrders.length ? "ca_hai"
            : posOrders.length ? "pos" : "doi_tac";

    // Sao kê phải CỘNG DỒN cả các kỳ, không chỉ kỳ đang xem.
    //
    // Tiền của một đơn chỉ về đúng một lần, ở đúng một kỳ. Đem toàn bộ đơn
    // đã giao đi khớp với riêng một kỳ thì mọi đơn đã trả ở kỳ khác đều bị
    // kết luận "chưa về tiền" — sổ tiền treo phồng lên gấp mấy lần sự thật.
    //
    // Nên khớp với HỢP của mọi bản sao kê đã tải. Bản đang chọn chỉ quyết
    // định xem phần quyết toán và soát phí của kỳ nào.
    // Dòng COD mất mã vận đơn (kỳ 05/10–16/10/2026, cột tên 运单号) lấy lại từ sheet PHÍ.
    const allRows = fillTrackingInStatements(store.statements).flatMap((s) => s.rows);
    const result = reconcile(orders, allRows, { asOf: to });
    const notes = chosen
        ? warnings(chosen)
        : [...warnings(), "Chưa có bản sao kê nào — tải lên để đối soát."];
    const di = result.data_issues;
    if (di.duplicate_tracking.length) {
        notes.push(
            `${di.duplicate_tracking.length} mã vận đơn đang bị gán cho nhiều đơn khác nhau ` +
            `(${di.duplicate_tracking.slice(0, 4).map((d) => `${d.tracking} → ${d.orders.join(" / ")}`).join("; ")}` +
            `${di.duplicate_tracking.length > 4 ? "; …" : ""}). ` +
            "Đây là lỗi ở file đơn, không phải 3PL — sửa file nguồn, nếu không đối soát sẽ khớp nhầm đơn.",
        );
    }
    if (di.orders_without_tracking) {
        notes.push(
            `${di.orders_without_tracking} đơn đã giao không có mã vận đơn nên chỉ khớp được bằng mã đơn — ` +
            "kém chắc chắn hơn hẳn. Điền mã vận đơn vào file đơn.",
        );
    }
    if (source === "doi_tac") {
        notes.unshift(
            `Đang đối soát với ${orders.length} đơn đọc từ FILE ĐỐI TÁC, không phải từ POS. ` +
            "Số tiền COD lấy theo file đối tác.",
        );
    } else if (source === "ca_hai") {
        notes.unshift(
            `Đối soát với ${orders.length} đơn giao thành công, gộp từ hai nguồn: ` +
            `POS ${posOrders.length} đơn · file đối tác ${partnerOrders.length} đơn. ` +
            "Trùng mã vận đơn thì lấy theo POS.",
        );
        // POS chậm hơn hẳn thực tế thì phải nói ra, vì mọi báo cáo khác chỉ
        // đọc POS và sẽ thiếu đúng chừng đó đơn.
        if (partnerOrders.length > posOrders.length * 3) {
            notes.push(
                `POS mới ghi ${posOrders.length} đơn giao thành công trong khi đối tác báo ` +
                `${partnerOrders.length}. Trạng thái trên POS đang chậm hơn thực tế rất nhiều — ` +
                "các báo cáo doanh thu đọc POS sẽ thiếu đúng chừng đó đơn.",
            );
        }
    } else if (!orders.length) {
        notes.push(
            "Không có đơn đã giao nào trong kỳ này. Kiểm tra khoảng ngày, " +
            "hoặc vào tab Theo dõi vận đơn bấm Đọc bảng đối tác để nạp đơn.",
        );
    }

    return {
        from, to,
        statements: list,
        statement_id: chosen?.id || null,
        statement_name: chosen?.filename || null,
        naza: chosen?.naza || null,
        order_source: source,
        order_count: orders.length,
        statement_count: store.statements.length,
        statement_row_count: allRows.length,
        warnings: notes,
        ...result,
    };
}
