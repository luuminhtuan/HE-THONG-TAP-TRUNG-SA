import { query } from "@/lib/db";
import {
    DISPLAY, UNASSIGNED, SALE_DISPLAY, SALE_UNASSIGNED,
    attributeOrder, buildAdidOwner, resolveSale,
} from "@/lib/talpha/rules";
import { trackingFromLink, type PosOrder } from "@/lib/talpha/cod-recon";
import { readStoreFresh } from "@/lib/talpha/store";

/** Đơn đã giao trong kỳ, kèm mã vận đơn và người phụ trách. */
export async function loadDeliveredOrders(from: string, to: string): Promise<PosOrder[]> {
    const adRows = await query<{ ad_id: string; campaign_name: string }>(
        `SELECT DISTINCT ad_id::text AS ad_id, campaign_name
         FROM fb_ads_data
         WHERE ad_id IS NOT NULL AND campaign_name IS NOT NULL`,
    );
    const adidOwner = buildAdidOwner(adRows);

    const rows = await query<Record<string, unknown>>(
        `SELECT
             v.order_uid, v.order_id, v.order_date,
             v.status_category, v.status_name, v.pos_money_divisor,
             v.marketer_name, v.resolved_ad_id,
             o.cod, o.tracking_link, o.page_id, o.tags, o.seller_name
         FROM vw_orders_std v
         LEFT JOIN sale_order o
                ON v.shop_id = o.shop_id AND v.order_id = o.id
         WHERE v.order_date BETWEEN @from::date AND @to::date
           AND v.status_category = 'GIAO_THANH_CONG'
           AND COALESCE(o.cod, 0) > 0
         ORDER BY v.order_date, v.order_uid`,   // thứ tự dòng đối soát cố định giữa các lần / các máy
        { from, to },
    );

    return rows.map((r) => {
        const divisor = Number(r.pos_money_divisor) || 1;
        const { key } = attributeOrder(
            r.marketer_name as string | null,
            r.resolved_ad_id as string | null,
            adidOwner,
        );
        const saleKey = resolveSale({
            order_uid: r.order_uid as string,
            seller_name: r.seller_name as string | null,
            page_id: r.page_id as string | null,
            tags: r.tags as string | null,
        });
        return {
            order_uid: r.order_uid as string,
            order_id: String(r.order_id ?? ""),
            tracking: trackingFromLink(r.tracking_link as string | null),
            order_date: String(r.order_date ?? ""),
            status_category: r.status_category as string,
            status_name: r.status_name as string,
            cod_local: (Number(r.cod) || 0) / divisor,
            marketer: key === UNASSIGNED ? UNASSIGNED : (DISPLAY[key] || key),
            sale: saleKey ? (SALE_DISPLAY[saleKey] || saleKey) : SALE_UNASSIGNED,
        };
    });
}

// ─────────────────────────────────────────────────────────────────────────
// NGUỒN ĐƠN DỰ PHÒNG — file đối tác
//
// Đối soát cần biết "đơn nào đã giao, thu bao nhiêu". Nguồn chuẩn là POS qua
// kho số, nhưng chừng nào chưa có key Poscake thì kho đó trống, và đối soát
// sẽ hiện toàn số 0 dù sao kê đã tải lên đầy đủ.
//
// File đối tác 3PL trả lời được đúng câu hỏi đó: có mã vận đơn, tiền COD, trạng
// thái giao. Nên khi kho số không trả về đơn nào, lấy tạm từ đó — kèm cờ
// `order_source` để màn hình nói rõ số đang đọc từ đâu, không giả vờ là POS.
//
// Đây là cùng một lối đã dùng ở tab Theo dõi vận đơn: hợp hai nguồn thay vì
// đứng chờ nguồn chuẩn.
// ─────────────────────────────────────────────────────────────────────────
type PartnerMeta = {
    order_no: string; ship_method: string; cod_local: number; marketer: string;
    recon: string; store_name: string; store_code: string;
    ship_date: string | null; track17_code: string | null;
};
type TrackingStore = {
    statuses: Record<string, { status: string | null; ship_date?: string | null; order_date?: string | null }>;
    partner?: Record<string, PartnerMeta>;
};

export async function loadPartnerDelivered(from: string, to: string): Promise<PosOrder[]> {
    const store = await readStoreFresh<TrackingStore>("tracking", { statuses: {}, partner: {} });
    const partner = store.partner || {};
    const out: PosOrder[] = [];

    for (const [tracking, p] of Object.entries(partner)) {
        const st = store.statuses[tracking];
        if (st?.status !== "Delivered") continue;          // chưa giao thì 3PL chưa nợ tiền
        if (!(p.cod_local > 0)) continue;

        // Mốc thời gian: ưu tiên ngày lên đơn, lùi về ngày xuất kho. Đơn thiếu
        // cả hai vẫn phải được soát — bỏ đi là giấu mất tiền đang treo.
        const d = st?.order_date || p.ship_date || st?.ship_date || null;
        if (d && (d < from || d > to)) continue;

        out.push({
            order_uid: `PARTNER:${tracking}`,
            order_id: p.order_no || tracking,
            tracking,
            order_date: d || "",
            status_category: "GIAO_THANH_CONG",
            status_name: "Đã giao thành công",
            cod_local: p.cod_local,
            marketer: p.marketer || UNASSIGNED,
            sale: SALE_UNASSIGNED,
        });
    }
    return out;
}
