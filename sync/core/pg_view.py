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
  python -m sync.core.pg view --ep     # dựng lại dù luật không đổi
"""
import hashlib
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
VIEWS_DIR = REPO / "db" / "views"
RULES_FILE = REPO / "config" / "talpha_rules.json"
YAML_FILE = REPO / "config" / "projects" / "talpha.yaml"
# Bảng vai chỉ đọc (/api/query, "CEO hỏi") KHÔNG được thấy — cùng danh sách REVOKE cuối migration 0001.
PRIVATE_TABLES = ("app_documents", "market_overrides", "market_monthly_reports", "users",
              "api_credentials", "file_imports", "zalo_bot_status", "zalo_requests",
              "zalo_session", "zalo_market_groups", "zalo_bot_state")


def _rules() -> dict:
    from sync.core.market_config import load_rules
    return load_rules(str(RULES_FILE), str(REPO))


def ad_tz_sql(column: str = "f.account_id") -> str:
    """CASE account_id → múi giờ của TKQC khai tay (talpha.yaml → meta_ads.ad_account_timezones) — DỰ PHÒNG
    cho TKQC cũ mà bảng ad_accounts chưa có múi giờ; múi giờ chính lấy từ Meta (ad_accounts.timezone_name). Đơn gom ngày theo
    múi của TKQC để ngày POS khớp ngày Meta báo tiền."""
    import yaml
    with open(YAML_FILE, encoding="utf-8") as f:
        tzs = (yaml.safe_load(f).get("meta_ads") or {}).get("ad_account_timezones") or {}
    if not tzs:
        raise SystemExit("❌ talpha.yaml thiếu meta_ads.ad_account_timezones — không sinh được múi giờ.")
    rows = []
    for aid, tz in tzs.items():
        account_digits = str(aid).replace("act_", "")
        # Tên IANA có thể mang số và dấu ± (Etc/GMT-5). Vẫn cấm dấu nháy / khoảng trắng.
        if not account_digits.isdigit() or not re.match(r"^[A-Za-z_]+(/[A-Za-z0-9_+\-]+)+$", str(tz)):
            raise SystemExit(f"❌ mục múi giờ lạ: {aid} → {tz}")
        rows.append(f"                WHEN '{account_digits}' THEN '{tz}'")
    return (f"CASE {column}\n" + "\n".join(rows) +
            "\n                ELSE 'Asia/Ho_Chi_Minh'  -- TKQC chưa khai trong talpha.yaml\n            END")


def _shop_markets(markets) -> list:
    out = [v for v in markets.values() if isinstance(v, dict) and v.get("shop_label")]
    for v in out:
        if not str(v["shop_label"]).isalnum():
            raise SystemExit(f"❌ shop_label lạ, chặn để khỏi phá SQL: {v['shop_label']!r}")
    return out


def fx_sql() -> tuple:
    """(CASE tỷ giá về VND, điều kiện is_fx_known). Nước chưa có tỷ giá (sắp chạy) không có dòng —
    rơi vào ELSE 0.0 và is_fx_known = FALSE, KHÔNG đoán."""
    pairs = [(v["shop_label"], float(v["rate_vnd"])) for v in _shop_markets(_rules()["markets"]) if v.get("rate_vnd")]
    if not pairs:
        raise SystemExit(f"❌ {RULES_FILE}: mục `markets` rỗng — không sinh được tỷ giá.")
    case = "CASE o.shop_label\n" + "\n".join(
        f"            WHEN '{lb}' THEN {r}    -- → VND" for lb, r in pairs
    ) + "\n            ELSE 0.0  -- shop chưa khai tỷ giá: doanh thu 0, is_fx_known = FALSE — KHÔNG đoán\n        END"
    known = "(o.shop_label IN (" + ", ".join(f"'{lb}'" for lb, _ in pairs) + "))"
    return case, known


def money_divisor_sql() -> str:
    """CASE shop_label → số chia đưa tiền POS về đơn vị thật (Đài 1, Sing / UAE 100 — X13)."""
    cap = []
    for v in _shop_markets(_rules()["markets"]):
        div = v.get("pos_money_divisor")
        # Nước sắp chạy: chưa có đơn, chưa đo số chia — /admin → Thị trường cho lưu thiếu số chia (market-config.ts
        # chỉ bắt buộc với active / disabled), nên phải bỏ qua chứ không dừng: dừng là `migrate` thoát 1, compose
        # không bật dashboard + scheduler, vòng sync không dựng lại view được nữa (16/11/2026 sửa: trước so "sap_chay").
        if div is None and v.get("status") == "upcoming":
            continue
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
    r = _rules()

    def like(rules, label):
        out = []
        for x in rules:
            s = x["contains"]
            if "'" in s or "%" in s or "_" in s:
                raise SystemExit(f"❌ rule `contains` chứa ký tự phá SQL: {s!r}")
            out.append(f"        WHEN UPPER({col}) LIKE '%{s}%' THEN '{label}'")
        return out

    team = like(r.get("pos_marketer_rules", []), "team")
    external = like(r.get("pos_external_rules", []), "external")
    if not team:
        raise SystemExit("❌ rules file thiếu `pos_marketer_rules` — không sinh được phân loại.")
    return "CASE\n" + "\n".join(team + external) + "\n        ELSE 'unknown'\n    END"


def product_costs_sql() -> str:
    """Danh sách VALUES (sku, giá vốn VND/đơn vị) — giá vốn khai bằng tệ × cost_rate_rmb_vnd."""
    r = _rules()
    rate = r.get("cost_rate_rmb_vnd")
    if not isinstance(rate, (int, float)) or rate <= 0:
        raise SystemExit(f"❌ {RULES_FILE}: thiếu `cost_rate_rmb_vnd` — không quy được giá vốn tệ ra VND.")
    rows = sorted((sku, int(round(v["cost_price_rmb"] * rate)))
                  for sku, v in (r.get("products") or {}).items()
                  if not sku.startswith("_") and isinstance(v, dict)
                  and isinstance(v.get("cost_price_rmb"), (int, float)) and v["cost_price_rmb"] > 0)
    if not rows:
        raise SystemExit(f"❌ {RULES_FILE}: mục `products` rỗng — view sẽ có COGS = 0 toàn bộ.")
    invalid = [sku for sku, _ in rows if not sku.replace("-", "").replace("_", "").isalnum()]
    if invalid:
        raise SystemExit(f"❌ SKU không hợp lệ trong rules file (chỉ cho chữ/số/-/_): {invalid}")
    return ",\n        ".join(f"('{sku}', {cost})" for sku, cost in rows)


def test_campaign_re() -> str:
    """Mẫu nhận camp test — dùng NGUYÊN mẫu trong rules file: regex của Postgres có lookbehind /
    lookahead như Python (BigQuery thì không, nên trước đây phải dịch tay)."""
    pat = (_rules().get("test_campaign") or {}).get("pattern")
    if not pat or "'" in pat:
        raise SystemExit("❌ config/talpha_rules.json → test_campaign.pattern thiếu hoặc chứa dấu nháy.")
    return pat


def ad_account_types() -> tuple:
    """(loại mặc định, danh sách loại vào báo cáo dạng SQL) — talpha_rules.json → ad_account_categories."""
    cfg = _rules().get("ad_account_categories") or {}
    account_types = {k: v for k, v in (cfg.get("categories") or {}).items() if not k.startswith("_") and isinstance(v, dict)}
    report_types = [k for k, v in account_types.items() if v.get("include_in_report")]
    default_type = cfg.get("default") or "antalo"
    for k in report_types + [default_type]:
        if not re.match(r"^[a-z0-9_]+$", k):
            raise SystemExit(f"❌ ad_account_categories: tên loại lạ {k!r} — chỉ chữ thường, số, gạch dưới.")
    if not report_types:
        raise SystemExit("❌ ad_account_categories: không loại nào include_in_report — mọi báo cáo sẽ không có chi tiêu quảng cáo.")
    return default_type, ", ".join(f"'{k}'" for k in report_types)


def thresholds() -> dict:
    th = _rules().get("thresholds", {})
    if not th:
        raise SystemExit("❌ config/talpha_rules.json thiếu mục `thresholds` — view dùng {TH_*} không render được.")
    return {k: v for k, v in th.items() if not k.startswith("_")}


def _apply_thresholds(sql: str, name: str) -> str:
    used = set(re.findall(r"\{TH_([A-Z0-9_]+)\}", sql))
    if not used:
        return sql
    th = thresholds()
    missing = sorted(t for t in used if t.lower() not in th)
    if missing:
        raise SystemExit(f"❌ {name} dùng ngưỡng chưa khai trong talpha_rules.json → thresholds: {', '.join(missing)}")
    for k, v in th.items():
        sql = sql.replace("{TH_" + k.upper() + "}", repr(v))
    return sql


def render(name: str) -> str:
    sql = _apply_thresholds((VIEWS_DIR / name).read_text(encoding="utf-8"), name)
    replacements = {
        "{PRODUCT_COSTS}": product_costs_sql,
        "{MARKETER_GROUP}": marketer_group_sql,
        "{AD_TZ_CASE}": ad_tz_sql,
        "{MONEY_DIV_CASE}": money_divisor_sql,
        "{TEST_CAMPAIGN_RE}": test_campaign_re,
    }
    for token, builder in replacements.items():
        if token in sql:
            sql = sql.replace(token, builder())
    if "{AD_ACCOUNT_DEFAULT_CATEGORY}" in sql or "{AD_ACCOUNT_REPORT_CATEGORIES}" in sql:
        default_type, report_types = ad_account_types()
        sql = sql.replace("{AD_ACCOUNT_DEFAULT_CATEGORY}", default_type).replace("{AD_ACCOUNT_REPORT_CATEGORIES}", report_types)
    if "{FX_CASE}" in sql or "{FX_KNOWN}" in sql:
        case, known = fx_sql()
        sql = sql.replace("{FX_CASE}", case).replace("{FX_KNOWN}", known)
    leftover = re.findall(r"\{[A-Z_]+\}", sql)
    if leftover:
        raise SystemExit(f"❌ {name}: còn token chưa thay {sorted(set(leftover))}")
    return sql


def list_view_files() -> list:
    """File view theo thứ tự phụ thuộc (tiền tố số)."""
    return sorted(p.name for p in VIEWS_DIR.glob("*.sql"))


def view_name(file: str) -> str:
    m = re.search(r"CREATE VIEW\s+([a-z0-9_]+)", (VIEWS_DIR / file).read_text(encoding="utf-8"))
    if not m:
        raise SystemExit(f"❌ {file}: không thấy CREATE VIEW")
    return m.group(1)


def render_all() -> tuple:
    """([(tên view, SQL)], vân tay)."""
    ds = [(view_name(f), render(f)) for f in list_view_files()]
    fingerprint = hashlib.sha256("\n".join(sql for _, sql in ds).encode("utf-8")).hexdigest()[:16]
    return ds, fingerprint


def rebuild_views(conn, force: bool = False) -> bool:
    """Dựng lại bộ view nếu luật đổi, hoặc có migration mới (view `SELECT f.*` chốt danh sách cột lúc
    dựng — bảng thêm cột mà không dựng lại là view thiếu cột), hoặc ep=True. Trả True nếu đã dựng."""
    ds, fingerprint = render_all()
    mig = conn.execute("SELECT COALESCE(string_agg(name, ',' ORDER BY name), '') FROM schema_migrations").fetchone()[0]
    fingerprint = hashlib.sha256(f"{fingerprint}|{mig}".encode("utf-8")).hexdigest()[:16]
    previous = conn.execute("SELECT fingerprint FROM view_fingerprints WHERE id = 1").fetchone()
    if previous and previous[0] == fingerprint and not force:
        return False
    with conn.transaction():
        for name, _ in reversed(ds):
            conn.execute(f"DROP VIEW IF EXISTS {name} CASCADE")
        for _, sql in ds:
            conn.execute(sql)
        # Quyền của hai vai chỉ đọc (migration 0001, mục 6) mất theo view cũ — cấp lại. talpha_readonly_market
        # chỉ được đúng những view mà scopeQuery (access-rules.ts) lọc được theo nước.
        conn.execute("DO $$ BEGIN EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO talpha_readonly', "
                     "current_schema()); END $$")
        # …trừ bảng riêng: mật khẩu, khoá kết nối, sao kê tiền.
        existing = [r[0] for r in conn.execute(
            "SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename = ANY(%s)",
            (list(PRIVATE_TABLES),))]
        if existing:
            conn.execute(f"REVOKE ALL ON {', '.join(existing)} FROM talpha_readonly, talpha_readonly_market")
        conn.execute("GRANT SELECT ON vw_orders_std, vw_fb_ads_std, vw_ad_windows TO talpha_readonly_market")
        conn.execute(
            "INSERT INTO view_fingerprints (id, fingerprint, built_at) VALUES (1, %s, now()) "
            "ON CONFLICT (id) DO UPDATE SET fingerprint = EXCLUDED.fingerprint, built_at = now()", (fingerprint,))
    return True
