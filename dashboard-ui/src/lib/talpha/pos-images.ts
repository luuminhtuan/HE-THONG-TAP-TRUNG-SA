/**
 * TALPHA — đọc tồn kho + danh mục sản phẩm THẲNG từ POS (Poscake/Pancake).
 *
 * POS là nguồn CHUẨN của tab Sản phẩm & Kho: `product.name`/`custom_id` là mã SKU,
 * ảnh nằm ở `product.image` hoặc `variations[].images[0]`, tồn vật lý ở
 * `variations_warehouses[].actual_remain_quantity`.
 *
 * Danh sách shop sinh từ talpha_rules.json → markets (SHOP_POS trong rules.ts, 04/11/2026 — trước
 * đó đọc ở talpha.yaml → poscake.shops). Một thị trường = một shop; thêm thị trường ở config hoặc
 * /admin → Thị trường, KHÔNG thêm map trong file này.
 */

import { docKhoa } from "@/lib/talpha/khoa";
import { MARKET_DANG_BAN, SHOP2MKT, SHOP_POS } from "@/lib/talpha/rules";

interface Shop { name: string; api_url: string; api_key: string; shop_id: string }

// Shop POS của nước ĐANG BÁN, key đã giải (Khoá kết nối trước, rồi .env.local). Nguồn là
// talpha_rules.json → markets (đã phủ thị trường nhập trên trang) — xem SHOP_POS. Nước đã tắt / sắp
// chạy không gọi: tab Kho và Ads Command Center chỉ gọi POS của nước đang bán.
export function loadShops(): Shop[] {
    return SHOP_POS.filter((s) => MARKET_DANG_BAN.has(s.name))
        .map((s) => ({ name: s.name, api_url: s.api_url, api_key: docKhoa(s.bien_key), shop_id: s.shop_id }));
}

/**
 * Tên shop POS ("Taiwan") → khoá thị trường viết thường ("tw").
 *
 * Suy từ config/talpha_rules.json → markets[<tên shop>].shop_label, KHÔNG còn
 * bảng tên-shop-cứng như trước (bản cũ khai sẵn 7 dòng Saudi/UAE/…; thêm shop mà
 * quên thêm dòng là kho đó biến mất khỏi dashboard mà chẳng báo gì).
 * Không khai trong rules thì lấy tên shop viết thường làm khoá.
 */
export function posMarketKey(shopName: string): string {
    const label = Object.entries(SHOP2MKT).find(([, market]) => market === shopName)?.[0];
    return (label || shopName).toLowerCase();
}


/**
 * Chuẩn hoá mã SKU cho khớp giữa POS, đơn hàng và bảng tồn.
 * Ưu tiên tiền tố số (bỏ số 0 đầu): "015"→"15", "16-Green"→"16", "0100…"→"100".
 * Không bắt đầu bằng số thì lấy token đầu, viết hoa ("X-A", "SPTEST").
 */
export function normCode(raw: string): string {
    const s = (raw ?? "").trim();
    const num = s.match(/^0*(\d+)/);
    if (num) return num[1];
    return s.split(/\s+/)[0].toUpperCase();
}

// remain_quantity có thể là số hoặc object {warehouse_id: qty} → gộp về 1 số.
function remainQty(rq: unknown): number {
    if (typeof rq === "number") return rq;
    if (rq && typeof rq === "object") {
        return Object.values(rq as Record<string, unknown>).reduce<number>((a, b) => a + (Number(b) || 0), 0);
    }
    return 0;
}

// TỒN KHO VẬT LÝ của 1 biến thể = tổng actual_remain_quantity qua các kho (khớp cột
// "Tổng tồn kho" trên POS; remain_quantity là "có thể bán" = đã trừ hàng giữ cho đơn).
function actualStock(v: any): number {
    const ws = v?.variations_warehouses;
    if (Array.isArray(ws) && ws.length) return ws.reduce((s: number, w: any) => s + (Number(w?.actual_remain_quantity) || 0), 0);
    return remainQty(v?.remain_quantity);
}

export interface PosInvItem { code: string; name: string; cat: string; img: string | null }
export interface PosInventory {
    stock: Record<string, Record<string, number>>;         // market → code → tồn (actual_remain_quantity)
    catalog: Map<string, PosInvItem>;                       // code → tên/ngành/ảnh (first-wins)
    variationToCode: Map<string, string>;                   // variation_id (UUID) → mã SKU (để map đơn hàng)
    marketTotals: Record<string, { skus: number; stock: number }>;
    shops: number;
    ok: boolean;
}

/** Toàn bộ tồn kho + danh mục SP từ các shop POS Poscake đang bật. */
export async function fetchPosInventory(revalidate = 300): Promise<PosInventory> {
    const shops = loadShops();
    const stock: Record<string, Record<string, number>> = {};
    const catalog = new Map<string, PosInvItem>();
    const variationToCode = new Map<string, string>();
    const marketTotals: Record<string, { skus: number; stock: number }> = {};
    let ok = false;
    for (const s of shops) {
        const mk = posMarketKey(s.name);
        stock[mk] = stock[mk] || {};
        let page = 1, pages = 1;
        do {
            const url = `${s.api_url}/shops/${s.shop_id}/products/variations?api_key=${s.api_key}&page_number=${page}&page_size=100`;
            let j: any;
            try {
                const r = await fetch(url, { signal: AbortSignal.timeout(20000), next: { revalidate } });
                if (!r.ok) { console.error(`POS inv ${s.name}: HTTP ${r.status}`); break; }
                j = await r.json();
                ok = true;
            } catch (e) {
                console.error(`POS inv ${s.name} lỗi:`, e);
                break;
            }
            pages = j.total_pages || 1;
            for (const v of j.data ?? []) {
                const p = v.product || {};
                const code = normCode(p.name || v.custom_id || "");
                if (!code) continue;
                if (v.id) variationToCode.set(String(v.id), code); // để map đơn hàng (order_items.variation_id)
                stock[mk][code] = (stock[mk][code] || 0) + actualStock(v);
                if (!catalog.has(code)) {
                    const img = (Array.isArray(v.images) && v.images[0]) || p.image || null;
                    const cat = Array.isArray(p.categories) && p.categories[0] ? (p.categories[0].name || "") : "";
                    catalog.set(code, { code, name: String(p.name || "").trim() || code, cat, img });
                }
            }
            page++;
        } while (page <= pages && page <= 15);
        const codes = Object.values(stock[mk]);
        marketTotals[mk] = { skus: codes.length, stock: codes.reduce((a, b) => a + b, 0) };
    }
    return { stock, catalog, variationToCode, marketTotals, shops: shops.length, ok };
}
