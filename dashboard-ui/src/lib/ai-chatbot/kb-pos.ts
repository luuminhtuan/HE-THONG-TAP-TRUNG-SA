// ═══════════════════════════════════════════════════════════════════
// AI Chatbot — sản phẩm POS → mục Knowledge Base (THUẦN, có test). Nguồn: GET /shops/{id}/products/variations (OpenAPI
// POS chính thức: mỗi phần tử là MỘT biến thể kèm `product`). Chịu cả khuôn cũ GET /products (sản phẩm kèm `variations`).
//
// Tiền: chia posMoneyDivisor() của shop (Đài / Nhật / VN chia 1; SG / AE chia 100) — nơi gọi truyền `divisor`.
// `note` của sản phẩm là ghi chú NỘI BỘ → KHÔNG đưa vào kiến thức; mô tả cho khách là `note_product`.
// ═══════════════════════════════════════════════════════════════════
import { htmlToText } from "./pancake-parse";

type Raw = Record<string, any>;

export type PosProduct = {
    productId: string;
    name: string;
    code: string | null;
    description: string;
    categories: string[];
    variants: { id: string; name: string; price: number | null; stock: number | null }[];
};

function variantName(v: Raw): string {
    const fields = Array.isArray(v.fields) ? v.fields.map((f: Raw) => String(f?.value ?? "").trim()).filter(Boolean) : [];
    return fields.join(" / ") || String(v.display_id || v.barcode || v.id || "").trim() || "Mặc định";
}

function num(v: unknown): number | null {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
}

/** Gom phần tử API POS thành sản phẩm (bỏ biến thể ẩn / khoá, sản phẩm không còn biến thể nào). */
export function groupPosProducts(items: Raw[], divisor: number): PosProduct[] {
    const div = divisor > 0 ? divisor : 1;
    const byId = new Map<string, PosProduct>();
    const add = (product: Raw, v: Raw) => {
        const productId = String(product.id ?? v.product_id ?? "");
        if (!productId || v.is_hidden === true || v.is_locked === true) return;
        let p = byId.get(productId);
        if (!p) {
            p = {
                productId,
                name: String(product.name || "").trim(),
                code: product.display_id ? String(product.display_id) : product.custom_id ? String(product.custom_id) : null,
                description: htmlToText(String(product.note_product || "")).slice(0, 3000),
                categories: (Array.isArray(product.categories) ? product.categories : []).map((c: Raw) => String(c?.name || "").trim()).filter(Boolean),
                variants: [],
            };
            byId.set(productId, p);
        }
        const price = num(v.retail_price);
        p.variants.push({
            id: String(v.id ?? ""),
            name: variantName(v),
            price: price === null ? null : Math.round((price / div) * 100) / 100,
            stock: num(v.remain_quantity),
        });
    };
    for (const it of items || []) {
        if (!it || typeof it !== "object") continue;
        if (Array.isArray(it.variations)) {                       // khuôn cũ: sản phẩm kèm variations
            for (const v of it.variations) add(it, { ...v, product_id: it.id });
        } else {                                                  // khuôn chính thức: biến thể kèm product
            add(it.product && typeof it.product === "object" ? { id: it.product_id, ...it.product } : { id: it.product_id }, it);
        }
    }
    return [...byId.values()].filter((p) => p.name && p.variants.length);
}

/** Một sản phẩm → các trường của mục KB. Giá / tồn kho nằm ở metadata (chỉ đưa AI khi còn tươi — retrieval.ts). */
export function productToKb(p: PosProduct, shop: { shopId: string; market: string; currency: string }) {
    const content = [
        p.code ? `Mã sản phẩm: ${p.code}` : "",
        p.description,
        p.categories.length ? `Danh mục: ${p.categories.join(", ")}` : "",
    ].filter(Boolean).join("\n");
    const metadata = {
        currency: shop.currency,
        product_id: p.productId,
        shop_id: shop.shopId,
        variants: p.variants.slice(0, 30).map((v) => ({ name: v.name, price: v.price, stock: v.stock })),
    };
    return {
        sourceRef: `pos:${shop.shopId}:${p.productId}`,
        title: p.name.slice(0, 300),
        content: content.slice(0, 6000),
        keywords: [...new Set([p.code, ...p.categories].filter((x): x is string => !!x))].slice(0, 20),
        metadata,
        hash: simpleHash(JSON.stringify([p.name, content, metadata.variants])),
    };
}

/** Băm ngắn (FNV-1a) — biết mục có đổi không mà khỏi so cả nội dung. */
export function simpleHash(s: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16);
}
