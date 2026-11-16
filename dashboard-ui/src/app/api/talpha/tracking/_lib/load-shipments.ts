import { query } from "@/lib/db";
import {
    DISPLAY, UNASSIGNED, SALE_DISPLAY, SALE_UNASSIGNED,
    attributeOrder, buildAdidOwner, resolveSale, normPosMarketer,
} from "@/lib/talpha/rules";
import { trackingFromLink } from "@/lib/talpha/cod-recon";
import { fixTrack17Code, pickupCode, type Shipment, type TrackMarket } from "@/lib/talpha/tracking";
import { track17CodeFor } from "@/lib/talpha/partner-file";
import { readStoreFresh } from "@/lib/talpha/store";
import { loadMarketShipments } from "@/lib/talpha/tracking-market";
import { clean, emptyStore, type Store } from "./store-types";

/**
 * Danh sách vận đơn = HỢP của hai nguồn, khớp theo mã vận đơn:
 *   • đơn trong kho số (có tên khách, SĐT, marketer, sale)
 *   • dòng trong file đối tác (có trạng thái giao hàng)
 *
 * Phải là hợp chứ không phải giao: lúc mới dựng, kho số còn trống mà file đối
 * tác đã có 600 đơn — lấy giao thì màn hình trắng trơn dù dữ liệu nằm sẵn đó.
 * Ngược lại, đơn vừa lên trong POS mà file đối tác chưa cập nhật cũng phải hiện.
 */
export async function loadShipments(mk: TrackMarket, from: string, to: string): Promise<{ shipments: Shipment[]; store: Store; lastImport: string | null }> {
    if (mk.code !== "TW") return loadMarket(mk);
    const store = await readStoreFresh<Store>(mk.store, emptyStore());
    const partner = store.partner || {};
    const byTracking = new Map<string, Shipment>();
    // Mã 17TRACK đã đăng ký — hai dòng đối tác chung một mã thì dòng thứ hai cũng coi là
    // đã đăng ký, không đem đăng ký lần nữa.
    const regNumbers = new Set(Object.entries(store.registered).map(([k, r]) => r.number || clean(k)));

    const shipmentFrom = (tracking: string): Shipment => {
        const saved = store.statuses[tracking];
        const pm = partner[tracking];
        // Mã đối tác điền tay trước, không có thì sinh theo luật (8 số → 73N…).
        // code_fixes sửa mã hỏng từ Sheet (FamilyMart mất số 0 đầu) — cả mã đối tác điền tay.
        const t17 = fixTrack17Code(clean(pm?.track17_code) || track17CodeFor(clean(pm?.tracking || tracking)) || null);
        return {
            tracking,
            track17_code: t17,
            order_uid: null,
            order_id: pm?.order_no || "",
            // NGÀY TẠO đơn (cột ngày lên đơn của đối tác) — khung theo dõi 17TRACK lọc theo
            // ngày này. Trước đây gán nhầm ngày xuất kho vào đây.
            order_date: pm?.order_date ?? saved?.order_date ?? pm?.ship_date ?? null,
            // Tên và SĐT LẤY TỪ FILE ĐỐI TÁC. Bản trước để trống rồi chờ
            // kho số điền — mà POS mới có vài đơn nên gần như dòng nào cũng
            // trống, và tab này thành vô dụng cho việc gọi khách.
            customer: pm?.contact_name || "",
            phone: pm?.phone || "",
            // Cần cho việc soạn tin nhắn báo khách ra lấy hàng.
            store_name: pm?.store_name || "",
            store_code: pm?.store_code || "",
            // Mã khách đọc khi ra cửa hàng lấy — mã tracking, không phải mã cửa hàng.
            pickup_code: pickupCode(clean(pm?.tracking || tracking), t17),
            ship_method: pm?.ship_method || "",
            // Tên trong file đối tác phải đi qua luật gán người, không dùng thô:
            // họ ghi "Lâm" mà trong hệ thống là "Lộc" — cùng một người.
            marketer: (() => {
                const key = normPosMarketer(pm?.marketer);
                return key ? (DISPLAY[key] || key) : (pm?.marketer || null);
            })(),
            sale: SALE_UNASSIGNED,
            cod_local: pm?.cod_local ?? 0,
            status: saved?.status ?? null,
            sub_status: saved?.sub_status ?? null,
            status_since: saved?.status_since ?? null,
            last_event_time: saved?.last_event_time ?? null,
            last_event: saved?.last_event ?? null,
            registered: !!store.registered[tracking] || (!!t17 && regNumbers.has(t17)),
            source: saved?.source ?? null,
            raw_status: saved?.raw_status ?? null,
            ship_date: saved?.ship_date ?? pm?.ship_date ?? saved?.order_date ?? null,
            t17_status: saved?.t17_status ?? null,
            t17_sub_status: saved?.t17_sub_status ?? null,
            t17_event: saved?.t17_event ?? null,
        };
    };

    // ── Nguồn 1: file đối tác ──
    for (const tracking of Object.keys(partner)) {
        byTracking.set(tracking, shipmentFrom(tracking));
    }

    // ── Nguồn 2: kho số — bổ sung thông tin khách và người phụ trách ──
    try {
        const adRows = await query<{ ad_id: string; campaign_name: string }>(
            `SELECT DISTINCT ad_id::text AS ad_id, campaign_name
             FROM fb_ads_data
             WHERE ad_id IS NOT NULL AND campaign_name IS NOT NULL`,
        );
        const adidOwner = buildAdidOwner(adRows);

        const rows = await query<Record<string, unknown>>(
            `
                SELECT
                    v.order_uid, v.order_id, v.order_date, v.pos_money_divisor,
                    v.marketer_name, v.resolved_ad_id,
                    o.cod, o.tracking_link, o.page_id, o.tags, o.seller_name,
                    o.bill_full_name, o.bill_phone_number
                FROM vw_orders_std v
                LEFT JOIN sale_order o
                       ON v.shop_id = o.shop_id AND v.order_id = o.id
                WHERE v.order_date BETWEEN @from::date AND @to::date
                  -- CHỈ shop Đài: trước khi tách thị trường, đơn Singapore có link vận
                  -- đơn trên POS lọt vào danh sách Đài (gặp thật 25/09/2026).
                  AND v.market = 'TW'
                  AND o.tracking_link IS NOT NULL AND TRIM(o.tracking_link) != ''
                  -- Đơn huỷ/đơn thô chưa có hàng đi đường, theo dõi làm gì.
                  AND v.status_category NOT IN ('HUY', 'DON_THO')`,
            { from, to },
        );

        for (const r of rows) {
            const tracking = trackingFromLink(r.tracking_link as string | null);
            if (!tracking) continue;
            const divisor = Number(r.pos_money_divisor) || 1;
            const { key } = attributeOrder(
                r.marketer_name as string | null, r.resolved_ad_id as string | null, adidOwner);
            const saleKey = resolveSale({
                order_uid: r.order_uid as string,
                seller_name: r.seller_name as string | null,
                page_id: r.page_id as string | null,
                tags: r.tags as string | null,
            });
            const base = byTracking.get(tracking) ?? shipmentFrom(tracking);
            byTracking.set(tracking, {
                ...base,
                order_uid: r.order_uid as string,
                order_id: String(r.order_id ?? base.order_id),
                order_date: String(r.order_date ?? base.order_date ?? ""),
                customer: (r.bill_full_name as string) || "",
                phone: (r.bill_phone_number as string) || "",
                marketer: key === UNASSIGNED ? UNASSIGNED : (DISPLAY[key] || key),
                sale: saleKey ? (SALE_DISPLAY[saleKey] || saleKey) : SALE_UNASSIGNED,
                // Tiền lấy từ POS khi có — đó là nguồn chuẩn của doanh thu.
                cod_local: (Number(r.cod) || 0) / divisor || base.cod_local,
            });
        }
    } catch (e) {
        // Kho số hỏng hoặc chưa có số thì vẫn trả được phần từ file đối tác,
        // thay vì để cả tab trắng trơn.
        console.warn("tracking: không đọc được Postgres, chỉ dùng file đối tác:", e);
    }

    return { shipments: [...byTracking.values()], store, lastImport: store.partner_import?.imported_at ?? null };
}

/** Thị trường ngoài Đài — đọc chung với màn Đối soát COD (lib/talpha/tracking-market.ts). */
const loadMarket = (mk: TrackMarket) => loadMarketShipments<Store>(mk, emptyStore);

export function undeclaredStatuses(shipments: Shipment[]): { value: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const s of shipments) {
        if ((s.source !== "doi_tac" && s.source !== "weship" && s.source !== "pos") || s.status || !s.raw_status) continue;
        counts.set(s.raw_status, (counts.get(s.raw_status) || 0) + 1);
    }
    return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
}
