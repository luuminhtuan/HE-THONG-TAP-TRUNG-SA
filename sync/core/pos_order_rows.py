"""
sync/core/pos_order_rows.py — chuẩn hoá MỘT đơn Poscake → dòng sale_order + các dòng order_items.

Tách khỏi pos_client.py (16/11/2026) để file đó còn dưới 300 dòng; thân hàm chuyển nguyên văn từ
PoscakeClient._normalize_order (giờ là lớp vỏ gọi sang đây). Mọi cột ghi vào bảng đơn đi qua đây —
đổi tên / kiểu cột là đổi số trên báo cáo.
"""
import json

from sync.core.business_rules import STATUS_CATEGORY_MAP


def normalize_order(o: dict, *, shop_id: str, shop_label: str, currency: str,
                    sync_time: str) -> tuple[dict, list[dict]]:
    """Chuẩn hóa 1 order dict từ Poscake API → dòng sale_order.

    `shop_id` / `shop_label` / `currency` / `sync_time` là thuộc tính của PoscakeClient đang kéo
    shop đó (trước đây đọc thẳng self.*).
    """
    marketer_raw = o.get("marketer")
    marketer_str = (
        json.dumps(marketer_raw, ensure_ascii=False)
        if isinstance(marketer_raw, dict)
        else str(marketer_raw or "")
    )
    status_name = str(o.get("status_name", ""))
    category, sub = STATUS_CATEGORY_MAP.get(status_name, ("UNKNOWN", "unknown"))

    order_row = {
        "id":              str(o.get("id", "")),
        "shop_id":         str(o.get("shop_id", shop_id)),
        "shop_label":      shop_label,
        "status":          str(o.get("status", 0)),
        "status_name":     status_name,
        "status_category": category,
        "status_sub":      sub,
        "total_price":     float(o.get("total_price", 0) or 0),
        "shipping_fee":    float(o.get("shipping_fee", 0) or 0),
        "cod":             float(o.get("cod", 0) or 0),
        "total_discount":  float(o.get("total_discount", 0) or 0),
        "partner_fee":     float(o.get("partner_fee", 0) or 0),
        "return_fee":      float(o.get("return_fee", 0) or 0),
        "surcharge":       float(o.get("surcharge", 0) or 0),
        "money_to_collect":float(o.get("money_to_collect", 0) or 0),
        "total_quantity":  str(o.get("total_quantity", 0) or 0),
        "marketer":        marketer_str,
        "ad_id":           str(o.get("ad_id", "") or ""),
        "adset_id":        str(o.get("adset_id", "") or ""),
        "ads_source":      str(o.get("ads_source", "") or ""),
        "page_id":         str(o.get("page_id", "") or ""),
        # Tên page = cột "Nguồn đơn" trên màn POS. Báo cáo nối đơn → campaign bằng tên này
        # (ô tên page trong tên camp Meta) — Sỹ Anh chốt 17/09/2026.
        "page_name":       str((o.get("page") or {}).get("name") or o.get("account_name") or ""),
        # Sale = người được gán bán đơn trên POS (assigning_seller).
        "seller_name":     str((o.get("assigning_seller") or {}).get("name") or ""),
        "post_id":         str(o.get("post_id", "") or ""),
        "p_utm_source":    str(o.get("p_utm_source", "") or ""),
        "p_utm_campaign":  str(o.get("p_utm_campaign", "") or ""),
        "p_utm_medium":    str(o.get("p_utm_medium", "") or ""),
        "p_utm_content":   str(o.get("p_utm_content", "") or ""),
        "p_utm_term":      str(o.get("p_utm_term", "") or ""),
        "p_utm_id":        str(o.get("p_utm_id", "") or ""),
        # Loại tiền THẬT của đơn, không phải của shop. Gán cứng currency
        # là dán nhãn TWD lên cả đơn ghi bằng VND — shop Đài đang lẫn 71 đơn
        # VND (650.000–1.000.000) giữa 200 đơn TWD (749–1.399). Dán nhãn sai
        # thì bộ lọc ở talpha_sync không nhận ra, đơn VND lọt vào rồi bị nhân
        # tỷ giá 800 như thể là TWD.
        "order_currency":  str(o.get("order_currency") or currency),
        "customer_id":     str((o.get("customer") or {}).get("id", "")),
        "customer_name":   str((o.get("customer") or {}).get("name", "")),
        "bill_full_name":  str(o.get("bill_full_name", "") or ""),
        "bill_phone_number": str(o.get("bill_phone_number", "") or ""),
        "shipping_address":  str((o.get("shipping_address") or {}).get("full_address", "") or ""),
        "shipping_province": str((o.get("shipping_address") or {}).get("province_name", "") or ""),
        "shipping_district": str((o.get("shipping_address") or {}).get("district_name", "") or ""),
        "partner":         str(o.get("partner", "") or ""),
        "warehouse_id":    str(o.get("warehouse_id", "") or ""),
        "tracking_link":   str(o.get("tracking_link", "") or ""),
        "inserted_at":     str(o.get("inserted_at", "") or ""),
        "updated_at":      str(o.get("updated_at", "") or ""),
        "time_send_partner": str(o.get("time_send_partner", "") or ""),
        "estimate_delivery_date": str(o.get("estimate_delivery_date", "") or ""),
        "note":            str(o.get("note", "") or ""),
        "tags":            str(o.get("tags", "") or ""),
        "order_link":      str(o.get("order_link", "") or ""),
        "sync_time":       sync_time,
    }

    item_rows = []
    for item in (o.get("items", []) or []):
        item_rows.append({
            "item_id":         str(item.get("id", "")),
            "order_id":        str(o.get("id", "")),
            "shop_id":         str(o.get("shop_id", shop_id)),
            "shop_name":       str(o.get("shop_name", "")),
            "project_id":      f"talpha_{shop_label.lower()}",
            "product_id":      str(item.get("product_id", "")),
            "variation_id":    str(item.get("variation_id", "")),
            # Pancake lồng tên/giá trong variation_info (top-level không có → toàn rỗng/0)
            "product_name":    str((item.get("variation_info") or {}).get("name", "") or item.get("product_name", "") or ""),
            "variation_name":  str((item.get("variation_info") or {}).get("detail", "") or item.get("variation_name", "") or ""),
            "barcode":         str((item.get("variation_info") or {}).get("barcode", "") or item.get("barcode", "") or ""),
            "quantity":        int(item.get("quantity", 0) or 0),
            "return_quantity": int(item.get("return_quantity", 0) or 0),
            "returned_count":  int(item.get("returned_count", 0) or 0),
            "returning_quantity": int(item.get("returning_quantity", 0) or 0),
            "retail_price":    float((item.get("variation_info") or {}).get("retail_price", 0) or item.get("retail_price", 0) or 0),
            "discount_each_product": float(item.get("discount_each_product", 0) or 0),
            "total_discount":  float(item.get("total_discount", 0) or 0),
            "same_price_discount": float(item.get("same_price_discount", 0) or 0),
            "avg_imported_price": float((item.get("variation_info") or {}).get("last_imported_price", 0) or (item.get("variation_info") or {}).get("avg_price", 0) or item.get("avg_imported_price", 0) or 0),
            "is_bonus_product": str(item.get("is_bonus_product", "false")),
            "is_composite":    str(item.get("is_composite", "false")),
            "is_wholesale":    str(item.get("is_wholesale", "false")),
            "order_inserted_at": str(o.get("inserted_at", "") or ""),
            "sync_time":       sync_time,
        })

    return order_row, item_rows
