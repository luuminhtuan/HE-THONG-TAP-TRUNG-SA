"""
sync/core/ad_accounts.py — danh bạ TKQC tự động (04/11/2026).

Trước: danh sách TKQC gõ tay ở config/projects/talpha.yaml. Token đổi, BM đổi, TK chết / TK mới là phải
sửa file rồi deploy — 28/10 và 03/11/2026 đều mất nửa ngày chi tiêu vì danh sách lệch với token.
Nay mỗi vòng sync hỏi Meta token đọc được TKQC nào (/me/adaccounts) rồi kéo chi tiêu của TẤT CẢ; danh bạ
ghi ở bảng ad_accounts. Loại của từng TKQC (vào báo cáo hay không) quyết ở talpha_rules.json → ad_account_categories và
/admin → TKQC — bản dashboard của file này: dashboard-ui/src/lib/talpha/ad-accounts.ts (cùng luật, có test).
"""
import logging
import os

import requests

log = logging.getLogger(__name__)
GRAPH = "https://graph.facebook.com/v21.0"
ACCOUNT_FIELDS = "account_id,name,account_status,currency,timezone_name"
# Nhiều token Meta (04/11/2026): TKQC nằm ở nhiều BM / app. Thứ tự này là thứ tự ưu tiên — TKQC đọc bằng
# token ĐẦU TIÊN thấy nó. Cùng danh sách với dashboard-ui/src/lib/talpha/ad-account-rules.ts → BIEN_TOKEN_META.
TOKEN_VARS = ("TALPHA_META_ACCESS_TOKEN", "TALPHA_META_ACCESS_TOKEN_2", "TALPHA_META_ACCESS_TOKEN_3")


def meta_tokens(env=None) -> list:
    """[(tên biến, token)] của các token Meta đã khai, theo thứ tự ưu tiên."""
    env = os.environ if env is None else env
    return [(b, env[b].strip()) for b in TOKEN_VARS if (env.get(b) or "").strip()]


def initial_account_type(account_id: str, currency: str, rules: dict) -> str:
    """Loại của TKQC thấy LẦN ĐẦU: gán sẵn trong luật → theo tiền tệ (VND → mặc định, tiền khác →
    ad_account_categories.non_vnd, vì engine coi chi tiêu là VND). Đã có trong bảng thì KHÔNG gọi hàm này nữa —
    loại người chọn trên trang giữ nguyên."""
    cfg = rules.get("ad_account_categories") or {}
    preassigned = {k: v for k, v in (cfg.get("preassigned") or {}).items() if not str(k).startswith("_")}
    if str(account_id) in preassigned:
        return preassigned[str(account_id)]
    if (currency or "VND").upper() != "VND":
        return cfg.get("non_vnd") or "other"
    return cfg.get("default") or "antalo"


def list_token_ad_accounts(token: str, timeout: int = 60) -> list:
    """Mọi TKQC token đọc được: [{account_id, name, account_status, currency, timezone_name}]."""
    url, params, out = f"{GRAPH}/me/adaccounts", {"fields": ACCOUNT_FIELDS, "limit": 200, "access_token": token}, []
    while url:
        r = requests.get(url, params=params, timeout=timeout)
        j = r.json()
        if "error" in j:
            raise RuntimeError(f"Meta /me/adaccounts: {j['error'].get('message', j['error'])}")
        out.extend(j.get("data") or [])
        url, params = (j.get("paging") or {}).get("next"), None   # link next đã mang sẵn tham số
    return out


def write_ad_account_directory(conn, ds: list, rules: dict) -> list:
    """Ghi danh bạ: TKQC mới thì thêm với loại lần đầu; TKQC đã có thì cập nhật tên / trạng thái / múi
    giờ / token đọc nó / lần cuối thấy, GIỮ loại + ghi chú. Mỗi dòng của `ds` là dict Meta trả, kèm
    "token_env_var" nếu có. Trả danh sách TKQC MỚI [(account_id, tên, loại)]."""
    existing = {r[0] for r in conn.execute("SELECT account_id FROM ad_accounts")}
    new_accounts = []
    with conn.transaction():
        for a in ds:
            aid = str(a.get("account_id") or "").replace("act_", "")
            if not aid:
                continue
            name, currency_code = a.get("name") or "", (a.get("currency") or "").upper()
            if aid in existing:
                conn.execute(
                    "UPDATE ad_accounts SET name = %s, account_status = %s, currency = %s, timezone_name = %s, "
                    "token_env_var = COALESCE(%s, token_env_var), last_seen_at = now() WHERE account_id = %s",
                    (name, a.get("account_status"), currency_code, a.get("timezone_name"), a.get("token_env_var"), aid))
                continue
            account_type = initial_account_type(aid, currency_code, rules)
            conn.execute(
                "INSERT INTO ad_accounts (account_id, name, account_status, currency, timezone_name, category, token_env_var) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (aid, name, a.get("account_status"), currency_code, a.get("timezone_name"), account_type, a.get("token_env_var")))
            new_accounts.append((aid, name, account_type))
    return new_accounts


def ad_accounts_to_fetch(conn, tokens: list, rules: dict) -> list:
    """TKQC phải kéo chi tiêu vòng này: [{'id': 'act_…', 'name', 'token', 'token_env_var'}] — MỌI TKQC mọi token thấy,
    mỗi TK một lần, đọc bằng token ĐẦU TIÊN thấy nó. tokens = cac_token().
    Không token nào hỏi được Meta (token chết…) thì trả các TKQC thấy trong 7 ngày gần nhất để vòng kéo
    báo lỗi đúng tên từng TK thay vì im lặng không kéo gì."""
    collected, token_by_var = {}, dict(tokens)
    for token_var, tok in tokens:
        try:
            ds = list_token_ad_accounts(tok)
        except Exception as e:   # noqa: BLE001
            log.error(f"  {token_var}: hỏi Meta danh sách TKQC lỗi ({e})")
            continue
        log.info(f"  {token_var}: thấy {len(ds)} TKQC")
        for a in ds:
            aid = str(a.get("account_id") or "").replace("act_", "")
            if aid and aid not in collected:
                collected[aid] = {**a, "token_env_var": token_var}
    if not collected:
        log.error("  Không token nào hỏi được danh sách TKQC — kéo theo danh bạ 7 ngày gần nhất")
        tok0 = tokens[0][1] if tokens else ""
        return [{"id": f"act_{aid}", "name": name or aid, "token_env_var": token_var, "token": token_by_var.get(token_var) or tok0}
                for aid, name, token_var in conn.execute(
                    "SELECT account_id, name, token_env_var FROM ad_accounts WHERE last_seen_at > now() - interval '7 days' ORDER BY name")]
    for aid, name, category in write_ad_account_directory(conn, list(collected.values()), rules):
        log.warning(f"  TKQC MỚI: {name} (act_{aid}) — loại '{category}'. Xem lại loại ở /admin → TKQC.")
    return [{"id": f"act_{aid}", "name": a.get("name") or aid, "token_env_var": a["token_env_var"], "token": token_by_var[a["token_env_var"]]}
            for aid, a in collected.items()]
