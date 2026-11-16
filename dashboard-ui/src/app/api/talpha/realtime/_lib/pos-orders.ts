import { query } from "@/lib/db";
import { EXCHANGE_RATES, posMoneyDivisor, isDelivered } from "@/lib/talpha/rules";
import { normalizeMarket } from "./campaign-keys";
import type { YamlConfig } from "./config";
import { addDaysStr } from "./time";

// ═══ POS: HYBRID — kho số (Postgres) for history + Direct API for today ═══

// Fetch historical orders from the kho số (synced data — accurate).
// inserted_at là chuỗi giờ UTC → 10 ký tự đầu là ngày UTC của đơn.
async function fetchPOSFromDb(fromDate: string, toDate: string) {
    const allOrders: any[] = [];
    try {
        const rows = await query(`
            SELECT
                id, shop_label AS shop_name, ad_id, page_id, total_price, cod,
                inserted_at,
                safe_json(marketer) ->> 'name' AS marketer, status, status_name, status_category,
                bill_full_name AS customer_name
            FROM sale_order
            WHERE SUBSTR(inserted_at, 1, 10) >= @fromDate
              AND SUBSTR(inserted_at, 1, 10) <= @toDate
            ORDER BY inserted_at DESC
        `, { fromDate, toDate });
        for (const row of rows) {
            const shopName = normalizeMarket(row.shop_name); // shop_label code → POS full name
            // Nước chưa khai tỷ giá → 0, KHÔNG dùng số dự phòng. Bản cũ rơi về 6.850 — tỷ giá AED
            // thời GCC — nên tiền của mọi nước lạ bị nhân 6.850 mà không báo gì.
            const rate = EXCHANGE_RATES[shopName] ?? 0;
            // X13: số chia tiền của POS khác nhau theo shop — GCC lưu minor units (÷100),
            // shop Đài lưu NGUYÊN TWD (÷1). Gõ thẳng /100 là làm tiền Đài tụt 100 lần.
            const priceLocal = (row.cod || row.total_price || 0) / posMoneyDivisor(shopName);
            allOrders.push({
                id: String(row.id || ''),
                shop_name: shopName,
                ad_id: row.ad_id ? String(row.ad_id) : null,
                page_id: row.page_id ? String(row.page_id) : null,
                marketer: String(row.marketer || ''),
                total_price_local: priceLocal,
                total_price_vnd: priceLocal * rate,
                status: String(row.status || ''),
                delivered: isDelivered(row.status_name, row.status_category),
                inserted_at: row.inserted_at,
                customer_name: String(row.customer_name || ''),
                source: 'kho',
            });
        }
        console.log(`Kho POS: ${allOrders.length} orders for ${fromDate}→${toDate}`);
    } catch (e: any) {
        console.error('Kho POS error:', e.message);
    }
    return allOrders;
}

// Fetch orders from direct POS API (realtime) within a UTC date window [startUtc, endUtc].
// Note: POS API ignores from_date/to_date params! We filter client-side.
// `inserted_at` is naive UTC, so we compare on its raw UTC date here; the precise
// per-account-timezone day bucketing happens later (after order↔ad matching).
// Results are sorted by -inserted_at (newest first), so we stop once we pass below startUtc.
async function fetchPOSFromDirectAPI(shops: YamlConfig["poscake"]["shops"], startUtc: string, endUtc: string, warnings: string[]) {
    const allOrders: any[] = [];

    await Promise.all(shops.map(async (shop) => {
        try {
            let page = 1;
            let reachedPast = false;
            while (!reachedPast && page <= 200) { // safety limit
                const url = `${shop.api_url}/shops/${shop.shop_id}/orders?api_key=${shop.api_key}&page=${page}&sort=-inserted_at`;
                const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
                if (!res.ok) { console.error(`POS ${shop.name}: ${res.status}`); break; }
                const data = await res.json();
                const orders = data.data || [];
                if (orders.length === 0) break;

                for (const o of orders) {
                    const insertedAt = String(o.inserted_at || '');
                    const utcDate = insertedAt.slice(0, 10); // raw UTC date

                    // Since sorted newest-first: skip future entries, stop once below the window
                    if (utcDate > endUtc) continue; // future relative to window? skip
                    if (utcDate < startUtc) {
                        reachedPast = true;
                        break; // all remaining are older, stop
                    }

                    // utcDate within [startUtc, endUtc] → include this order
                    const shopName = normalizeMarket(shop.name);
                    const rate = EXCHANGE_RATES[shopName] ?? 0;   // xem chú thích ở fetchPOSFromKho
                    // X13 — số chia theo shop (GCC 100, Đài 1), xem fetchPOSFromKho.
                    // Đơn ghi bằng VND trong shop TWD (shop 1022091930 còn 340 đơn như vậy):
                    // chia cho tỷ giá như bước sync làm (business_rules.convert_order_currency),
                    // để phép nhân tỷ giá bên dưới trả lại đúng số VND — không thì 730.000đ
                    // hoá 584 triệu. Đường kho số không cần: bảng đơn đã quy đổi sẵn.
                    const isVnd = String(o.order_currency || '').toUpperCase() === 'VND';
                    const priceLocal = (o.cod || o.total_price || 0) / (isVnd ? rate : posMoneyDivisor(shopName));
                    const mkRaw = o.marketer || o.pke_mkter || null;
                    const marketerName = mkRaw && typeof mkRaw === 'object' ? (mkRaw.name || '') : (mkRaw || '');
                    const custRaw = o.customer_name;
                    const customerName = custRaw && typeof custRaw === 'object' ? (custRaw.name || '') : (custRaw || '');
                    allOrders.push({
                        id: String(o.id || ''),
                        shop_name: shopName,
                        ad_id: o.ad_id ? String(o.ad_id) : null,
                        page_id: o.page_id ? String(o.page_id) : null,
                        marketer: marketerName,
                        total_price_local: priceLocal,
                        total_price_vnd: priceLocal * rate,
                        status: String(o.status || ''),
                        // POS API trả status_name thô (delivered/received_money/…) → suy ra GTC
                        delivered: isDelivered(o.status_name, null),
                        inserted_at: o.inserted_at,
                        customer_name: customerName,
                        source: 'direct_api',
                    });
                }

                page++;
            }
            // A3-P2: thoát vì hết 200 trang mà chưa chạm mốc ngày cũ = còn đơn chưa lấy
            if (!reachedPast && page > 200) {
                const msg = `POS ${shop.name}: chạm cap 200 trang mà chưa quét hết cửa sổ ${startUtc}→${endUtc} — đơn có thể thiếu`;
                console.warn(msg);
                warnings.push(msg);
            }
        } catch (e: any) {
            console.error(`POS ${shop.name} error:`, e.message);
        }
    }));

    console.log(`Direct POS: ${allOrders.length} orders for ${startUtc}→${endUtc} (UTC window)`);
    return allOrders;
}

// Hybrid: kho số for history (2+ days ago) + direct API for recent (today & yesterday).
// Why yesterday via API? The hourly sync often hasn't caught up on yesterday's data yet.
// All bounds are UTC dates (the fetched window is padded ±1 day vs the requested
// range so no order is dropped before per-account-timezone bucketing downstream).
export async function fetchPOSHybrid(shops: YamlConfig["poscake"]["shops"], fetchFrom: string, fetchTo: string, todayUtc: string, warnings: string[]) {
    const yesterday = addDaysStr(todayUtc, -1);
    const twoDaysAgo = addDaysStr(todayUtc, -2);

    const tasks: Promise<any[]>[] = [];

    // Kho số for the older part of the window (fetchFrom → min(fetchTo, twoDaysAgo))
    if (fetchFrom <= twoDaysAgo) {
        const dbEnd = fetchTo <= twoDaysAgo ? fetchTo : twoDaysAgo;
        tasks.push(fetchPOSFromDb(fetchFrom, dbEnd));
    }

    // Direct API for the recent part (yesterday → fetchTo), if any overlap
    const apiStart = fetchFrom > yesterday ? fetchFrom : yesterday;
    if (apiStart <= fetchTo) {
        tasks.push(fetchPOSFromDirectAPI(shops, apiStart, fetchTo, warnings));
    }

    const results = await Promise.all(tasks);
    return results.flat();
}
