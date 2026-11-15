"""
sync/core/pg_view.py — dựng bộ view phân tích trong Postgres (04/11/2026, thay
sql/talpha/deploy_talpha_analytics.py của thời BigQuery).

View đúc luật vào câu SQL lúc dựng: tỷ giá, số chia tiền POS, giá vốn, múi giờ TKQC, nhóm marketer,
ngưỡng, mẫu camp test — tất cả sinh từ config/talpha_rules.json (đã phủ thị trường nhập ở /admin) và
config/projects/talpha.yaml. KHÔNG gõ số nào trong file view.

Dựng lại khi nào: vân tay = băm toàn bộ SQL đã sinh. Đổi luật nào làm SQL đổi (thêm nước, sửa tỷ giá,
khai giá vốn, thêm TKQC…) là vân tay đổi → dựng lại trong MỘT transaction (người đang đọc thấy view cũ
tới lúc COMMIT). Gọi ở `python -m sync.core.pg migrate` và đầu mỗi vòng sync. View không giữ dữ liệu
nên xoá dựng lại không mất gì.

  python -m sync.core.pg view          # dựng lại nếu luật đổi
  python -m sync.core.pg view --in     # in SQL đã sinh, không chạy
"""
import hashlib
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
THU_MUC_VIEW = REPO / "db" / "views"
RULES_FILE = REPO / "config" / "talpha_rules.json"
YAML_FILE = REPO / "config" / "projects" / "talpha.yaml"
# Bảng vai chỉ đọc (/api/query, "CEO hỏi") KHÔNG được thấy — cùng danh sách REVOKE của migration 0006.
BANG_RIENG = ("app_documents", "market_overrides", "market_monthly_reports", "users",
              "api_credentials", "file_imports")


def _luat() -> dict:
    from sync.core.thi_truong import doc_luat
    return doc_luat(str(RULES_FILE), str(REPO))


def ad_tz_sql(cot: str = "f.account_id") -> str:
    """CASE account_id → múi giờ của TKQC khai tay (talpha.yaml → meta_ads.ad_account_timezones) — DỰ PHÒNG
    cho TKQC cũ mà bảng tkqc chưa có múi giờ; múi giờ chính lấy từ Meta (tkqc.mui_gio). Đơn gom ngày theo
    múi của TKQC để ngày POS khớp ngày Meta báo tiền."""
    import yaml
    with open(YAML_FILE, encoding="utf-8") as f:
        tzs = (yaml.safe_load(f).get("meta_ads") or {}).get("ad_account_timezones") or {}
    if not tzs:
        raise SystemExit("❌ talpha.yaml thiếu meta_ads.ad_account_timezones — không sinh được múi giờ.")
    dong = []
    for aid, tz in tzs.items():
        so = str(aid).replace("act_", "")
        # Tên IANA có thể mang số và dấu ± (Etc/GMT-5). Vẫn cấm dấu nháy / khoảng trắng.
        if not so.isdigit() or not re.match(r"^[A-Za-z_]+(/[A-Za-z0-9_+\-]+)+$", str(tz)):
            raise SystemExit(f"❌ mục múi giờ lạ: {aid} → {tz}")
        dong.append(f"                WHEN '{so}' THEN '{tz}'")
    return (f"CASE {cot}\n" + "\n".join(dong) +
            "\n                ELSE 'Asia/Ho_Chi_Minh'  -- TKQC chưa khai trong talpha.yaml\n            END")


def _nhan_shop(markets) -> list:
    out = [v for v in markets.values() if isinstance(v, dict) and v.get("shop_label")]
    for v in out:
        if not str(v["shop_label"]).isalnum():
            raise SystemExit(f"❌ shop_label lạ, chặn để khỏi phá SQL: {v['shop_label']!r}")
    return out


def fx_sql() -> tuple:
    """(CASE tỷ giá về VND, điều kiện is_fx_known). Nước chưa có tỷ giá (sắp chạy) không có dòng —
    rơi vào ELSE 0.0 và is_fx_known = FALSE, KHÔNG đoán."""
    cap = [(v["shop_label"], float(v["rate_vnd"])) for v in _nhan_shop(_luat()["markets"]) if v.get("rate_vnd")]
    if not cap:
        raise SystemExit(f"❌ {RULES_FILE}: mục `markets` rỗng — không sinh được tỷ giá.")
    case = "CASE o.shop_label\n" + "\n".join(
        f"            WHEN '{lb}' THEN {r}    -- → VND" for lb, r in cap
    ) + "\n            ELSE 0.0  -- shop chưa khai tỷ giá: doanh thu 0, is_fx_known = FALSE — KHÔNG đoán\n        END"
    known = "(o.shop_label IN (" + ", ".join(f"'{lb}'" for lb, _ in cap) + "))"
    return case, known


def money_divisor_sql() -> str:
    """CASE shop_label → số chia đưa tiền POS về đơn vị thật (Đài 1, Sing / UAE 100 — X13)."""
    cap = []
    for v in _nhan_shop(_luat()["markets"]):
        div = v.get("pos_money_divisor")
        if div is None and v.get("status") == "sap_chay":
            continue   # nước sắp chạy: chưa có đơn, chưa đo số chia
        if div is None:
            raise SystemExit(f"❌ market {v['shop_label']} thiếu `pos_money_divisor` trong {RULES_FILE}. "
                             f"Khai bằng cách LẤY ĐƠN THẬT TỪ POS API so với giá bán, đừng đoán.")
        if not isinstance(div, int) or div <= 0:
            raise SystemExit(f"❌ pos_money_divisor lạ ({v['shop_label']}): {div!r} — phải là số nguyên > 0.")
        cap.append((v["shop_label"], div))
    if not cap:
        raise SystemExit(f"❌ {RULES_FILE}: mục `markets` rỗng — không sinh được số chia tiền.")
    return "CASE o.shop_label\n" + "\n".join(
        f"            WHEN '{lb}' THEN {d}" for lb, d in cap
    ) + "\n            ELSE 100  -- shop mới chưa khai: giữ mặc định minor units\n        END"


def marketer_group_sql(col: str = "_mk_name") -> str:
    """CASE 'team' / 'external' / 'unknown' từ pos_marketer_rules + pos_external_rules (X10)."""
    r = _luat()

    def like(rules, nhan):
        out = []
        for x in rules:
            s = x["contains"]
            if "'" in s or "%" in s or "_" in s:
                raise SystemExit(f"❌ rule `contains` chứa ký tự phá SQL: {s!r}")
            out.append(f"        WHEN UPPER({col}) LIKE '%{s}%' THEN '{nhan}'")
        return out

    team = like(r.get("pos_marketer_rules", []), "team")
    ngoai = like(r.get("pos_external_rules", []), "external")
    if not team:
        raise SystemExit("❌ rules file thiếu `pos_marketer_rules` — không sinh được phân loại.")
    return "CASE\n" + "\n".join(team + ngoai) + "\n        ELSE 'unknown'\n    END"


def product_costs_sql() -> str:
    """Danh sách VALUES (sku, giá vốn VND/đơn vị) — giá vốn khai bằng tệ × cost_rate_rmb_vnd."""
    r = _luat()
    rate = r.get("cost_rate_rmb_vnd")
    if not isinstance(rate, (int, float)) or rate <= 0:
        raise SystemExit(f"❌ {RULES_FILE}: thiếu `cost_rate_rmb_vnd` — không quy được giá vốn tệ ra VND.")
    dong = sorted((sku, int(round(v["cost_price_rmb"] * rate)))
                  for sku, v in (r.get("products") or {}).items()
                  if not sku.startswith("_") and isinstance(v, dict)
                  and isinstance(v.get("cost_price_rmb"), (int, float)) and v["cost_price_rmb"] > 0)
    if not dong:
        raise SystemExit(f"❌ {RULES_FILE}: mục `products` rỗng — view sẽ có COGS = 0 toàn bộ.")
    xau = [sku for sku, _ in dong if not sku.replace("-", "").replace("_", "").isalnum()]
    if xau:
        raise SystemExit(f"❌ SKU không hợp lệ trong rules file (chỉ cho chữ/số/-/_): {xau}")
    return ",\n        ".join(f"('{sku}', {gia})" for sku, gia in dong)


def test_campaign_re() -> str:
    """Mẫu nhận camp test — dùng NGUYÊN mẫu trong rules file: regex của Postgres có lookbehind /
    lookahead như Python (BigQuery thì không, nên trước đây phải dịch tay)."""
    pat = (_luat().get("test_campaign") or {}).get("pattern")
    if not pat or "'" in pat:
        raise SystemExit("❌ config/talpha_rules.json → test_campaign.pattern thiếu hoặc chứa dấu nháy.")
    return pat


def tkqc_loai() -> tuple:
    """(loại mặc định, danh sách loại vào báo cáo dạng SQL) — talpha_rules.json → tkqc_loai."""
    cfg = _luat().get("tkqc_loai") or {}
    loai = {k: v for k, v in (cfg.get("loai") or {}).items() if not k.startswith("_") and isinstance(v, dict)}
    vao = [k for k, v in loai.items() if v.get("vao_bao_cao")]
    mac_dinh = cfg.get("mac_dinh") or "antalo"
    for k in vao + [mac_dinh]:
        if not re.match(r"^[a-z0-9_]+$", k):
            raise SystemExit(f"❌ tkqc_loai: tên loại lạ {k!r} — chỉ chữ thường, số, gạch dưới.")
    if not vao:
        raise SystemExit("❌ tkqc_loai: không loại nào vao_bao_cao — mọi báo cáo sẽ không có chi tiêu quảng cáo.")
    return mac_dinh, ", ".join(f"'{k}'" for k in vao)


def thresholds() -> dict:
    th = _luat().get("thresholds", {})
    if not th:
        raise SystemExit("❌ config/talpha_rules.json thiếu mục `thresholds` — view dùng {TH_*} không render được.")
    return {k: v for k, v in th.items() if not k.startswith("_")}


def _nguong(sql: str, ten: str) -> str:
    dung = set(re.findall(r"\{TH_([A-Z0-9_]+)\}", sql))
    if not dung:
        return sql
    th = thresholds()
    thieu = sorted(t for t in dung if t.lower() not in th)
    if thieu:
        raise SystemExit(f"❌ {ten} dùng ngưỡng chưa khai trong talpha_rules.json → thresholds: {', '.join(thieu)}")
    for k, v in th.items():
        sql = sql.replace("{TH_" + k.upper() + "}", repr(v))
    return sql


def render(ten: str) -> str:
    sql = _nguong((THU_MUC_VIEW / ten).read_text(encoding="utf-8"), ten)
    thay = {
        "{PRODUCT_COSTS}": product_costs_sql,
        "{MARKETER_GROUP}": marketer_group_sql,
        "{AD_TZ_CASE}": ad_tz_sql,
        "{MONEY_DIV_CASE}": money_divisor_sql,
        "{TEST_CAMPAIGN_RE}": test_campaign_re,
    }
    for token, ham in thay.items():
        if token in sql:
            sql = sql.replace(token, ham())
    if "{TKQC_MAC_DINH}" in sql or "{TKQC_VAO_BAO_CAO}" in sql:
        mac_dinh, vao = tkqc_loai()
        sql = sql.replace("{TKQC_MAC_DINH}", mac_dinh).replace("{TKQC_VAO_BAO_CAO}", vao)
    if "{FX_CASE}" in sql or "{FX_KNOWN}" in sql:
        case, known = fx_sql()
        sql = sql.replace("{FX_CASE}", case).replace("{FX_KNOWN}", known)
    sot = re.findall(r"\{[A-Z_]+\}", sql)
    if sot:
        raise SystemExit(f"❌ {ten}: còn token chưa thay {sorted(set(sot))}")
    return sql


def danh_sach() -> list:
    """File view theo thứ tự phụ thuộc (tiền tố số)."""
    return sorted(p.name for p in THU_MUC_VIEW.glob("*.sql"))


def ten_view(file: str) -> str:
    m = re.search(r"CREATE VIEW\s+([a-z0-9_]+)", (THU_MUC_VIEW / file).read_text(encoding="utf-8"))
    if not m:
        raise SystemExit(f"❌ {file}: không thấy CREATE VIEW")
    return m.group(1)


def sinh_tat_ca() -> tuple:
    """([(tên view, SQL)], vân tay)."""
    ds = [(ten_view(f), render(f)) for f in danh_sach()]
    van_tay = hashlib.sha256("\n".join(sql for _, sql in ds).encode("utf-8")).hexdigest()[:16]
    return ds, van_tay


def dung_view(conn, ep: bool = False) -> bool:
    """Dựng lại bộ view nếu luật đổi, hoặc có migration mới (view `SELECT f.*` chốt danh sách cột lúc
    dựng — bảng thêm cột mà không dựng lại là view thiếu cột), hoặc ep=True. Trả True nếu đã dựng."""
    ds, van_tay = sinh_tat_ca()
    mig = conn.execute("SELECT COALESCE(string_agg(ten, ',' ORDER BY ten), '') FROM schema_migrations").fetchone()[0]
    van_tay = hashlib.sha256(f"{van_tay}|{mig}".encode("utf-8")).hexdigest()[:16]
    cu = conn.execute("SELECT van_tay FROM view_van_tay WHERE id = 1").fetchone()
    if cu and cu[0] == van_tay and not ep:
        return False
    with conn.transaction():
        for ten, _ in reversed(ds):
            conn.execute(f"DROP VIEW IF EXISTS {ten} CASCADE")
        for _, sql in ds:
            conn.execute(sql)
        # Quyền của hai vai chỉ đọc (migration 0003) mất theo view cũ — cấp lại. talpha_doc_nuoc
        # chỉ được đúng những view mà scopeQuery (access-rules.ts) lọc được theo nước.
        conn.execute("DO $$ BEGIN EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO talpha_doc', "
                     "current_schema()); END $$")
        # …trừ bảng riêng (migration 0006): mật khẩu, khoá kết nối, sao kê tiền.
        co = [r[0] for r in conn.execute(
            "SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename = ANY(%s)",
            (list(BANG_RIENG),))]
        if co:
            conn.execute(f"REVOKE ALL ON {', '.join(co)} FROM talpha_doc, talpha_doc_nuoc")
        conn.execute("GRANT SELECT ON vw_orders_std, vw_fb_ads_std, vw_ad_windows TO talpha_doc_nuoc")
        conn.execute(
            "INSERT INTO view_van_tay (id, van_tay, dung_luc) VALUES (1, %s, now()) "
            "ON CONFLICT (id) DO UPDATE SET van_tay = EXCLUDED.van_tay, dung_luc = now()", (van_tay,))
    return True
