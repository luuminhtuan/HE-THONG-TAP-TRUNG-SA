"""
sync/core/tkqc.py — danh bạ TKQC tự động (04/11/2026).

Trước: danh sách TKQC gõ tay ở config/projects/talpha.yaml. Token đổi, BM đổi, TK chết / TK mới là phải
sửa file rồi deploy — 28/10 và 03/11/2026 đều mất nửa ngày chi tiêu vì danh sách lệch với token.
Nay mỗi vòng sync hỏi Meta token đọc được TKQC nào (/me/adaccounts) rồi kéo chi tiêu của TẤT CẢ; danh bạ
ghi ở bảng tkqc. Loại của từng TKQC (vào báo cáo hay không) quyết ở talpha_rules.json → tkqc_loai và
/admin → TKQC — bản dashboard của file này: dashboard-ui/src/lib/talpha/ad-accounts.ts (cùng luật, có test).
"""
import logging
import os

import requests

log = logging.getLogger(__name__)
GRAPH = "https://graph.facebook.com/v21.0"
TRUONG = "account_id,name,account_status,currency,timezone_name"
# Nhiều token Meta (04/11/2026): TKQC nằm ở nhiều BM / app. Thứ tự này là thứ tự ưu tiên — TKQC đọc bằng
# token ĐẦU TIÊN thấy nó. Cùng danh sách với dashboard-ui/src/lib/talpha/ad-account-rules.ts → BIEN_TOKEN_META.
BIEN_TOKEN = ("TALPHA_META_ACCESS_TOKEN", "TALPHA_META_ACCESS_TOKEN_2", "TALPHA_META_ACCESS_TOKEN_3")


def cac_token(env=None) -> list:
    """[(tên biến, token)] của các token Meta đã khai, theo thứ tự ưu tiên."""
    env = os.environ if env is None else env
    return [(b, env[b].strip()) for b in BIEN_TOKEN if (env.get(b) or "").strip()]


def loai_lan_dau(account_id: str, tien_te: str, luat: dict) -> str:
    """Loại của TKQC thấy LẦN ĐẦU: gán sẵn trong luật → theo tiền tệ (VND → mặc định, tiền khác →
    loai_tien_khac, vì engine coi chi tiêu là VND). Đã có trong bảng thì KHÔNG gọi hàm này nữa —
    loại người chọn trên trang giữ nguyên."""
    cfg = luat.get("tkqc_loai") or {}
    gan = {k: v for k, v in (cfg.get("gan_san") or {}).items() if not str(k).startswith("_")}
    if str(account_id) in gan:
        return gan[str(account_id)]
    if (tien_te or "VND").upper() != "VND":
        return cfg.get("loai_tien_khac") or "khac"
    return cfg.get("mac_dinh") or "antalo"


def doc_tkqc_token(token: str, timeout: int = 60) -> list:
    """Mọi TKQC token đọc được: [{account_id, name, account_status, currency, timezone_name}]."""
    url, tham_so, out = f"{GRAPH}/me/adaccounts", {"fields": TRUONG, "limit": 200, "access_token": token}, []
    while url:
        r = requests.get(url, params=tham_so, timeout=timeout)
        j = r.json()
        if "error" in j:
            raise RuntimeError(f"Meta /me/adaccounts: {j['error'].get('message', j['error'])}")
        out.extend(j.get("data") or [])
        url, tham_so = (j.get("paging") or {}).get("next"), None   # link next đã mang sẵn tham số
    return out


def ghi_danh_ba(conn, ds: list, luat: dict) -> list:
    """Ghi danh bạ: TKQC mới thì thêm với loại lần đầu; TKQC đã có thì cập nhật tên / trạng thái / múi
    giờ / token đọc nó / lần cuối thấy, GIỮ loại + ghi chú. Mỗi dòng của `ds` là dict Meta trả, kèm
    "bien_token" nếu có. Trả danh sách TKQC MỚI [(account_id, tên, loại)]."""
    co_san = {r[0] for r in conn.execute("SELECT account_id FROM tkqc")}
    moi = []
    with conn.transaction():
        for a in ds:
            aid = str(a.get("account_id") or "").replace("act_", "")
            if not aid:
                continue
            ten, tien = a.get("name") or "", (a.get("currency") or "").upper()
            if aid in co_san:
                conn.execute(
                    "UPDATE tkqc SET ten = %s, trang_thai = %s, tien_te = %s, mui_gio = %s, "
                    "bien_token = COALESCE(%s, bien_token), thay_lan_cuoi = now() WHERE account_id = %s",
                    (ten, a.get("account_status"), tien, a.get("timezone_name"), a.get("bien_token"), aid))
                continue
            loai = loai_lan_dau(aid, tien, luat)
            conn.execute(
                "INSERT INTO tkqc (account_id, ten, trang_thai, tien_te, mui_gio, loai, bien_token) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (aid, ten, a.get("account_status"), tien, a.get("timezone_name"), loai, a.get("bien_token")))
            moi.append((aid, ten, loai))
    return moi


def tkqc_can_keo(conn, tokens: list, luat: dict) -> list:
    """TKQC phải kéo chi tiêu vòng này: [{'id': 'act_…', 'name', 'token', 'bien'}] — MỌI TKQC mọi token thấy,
    mỗi TK một lần, đọc bằng token ĐẦU TIÊN thấy nó. tokens = cac_token().
    Không token nào hỏi được Meta (token chết…) thì trả các TKQC thấy trong 7 ngày gần nhất để vòng kéo
    báo lỗi đúng tên từng TK thay vì im lặng không kéo gì."""
    gom, token_cua = {}, dict(tokens)
    for bien, tok in tokens:
        try:
            ds = doc_tkqc_token(tok)
        except Exception as e:   # noqa: BLE001
            log.error(f"  {bien}: hỏi Meta danh sách TKQC lỗi ({e})")
            continue
        log.info(f"  {bien}: thấy {len(ds)} TKQC")
        for a in ds:
            aid = str(a.get("account_id") or "").replace("act_", "")
            if aid and aid not in gom:
                gom[aid] = {**a, "bien_token": bien}
    if not gom:
        log.error("  Không token nào hỏi được danh sách TKQC — kéo theo danh bạ 7 ngày gần nhất")
        tok0 = tokens[0][1] if tokens else ""
        return [{"id": f"act_{aid}", "name": ten or aid, "bien": bien, "token": token_cua.get(bien) or tok0}
                for aid, ten, bien in conn.execute(
                    "SELECT account_id, ten, bien_token FROM tkqc WHERE thay_lan_cuoi > now() - interval '7 days' ORDER BY ten")]
    for aid, ten, loai in ghi_danh_ba(conn, list(gom.values()), luat):
        log.warning(f"  TKQC MỚI: {ten} (act_{aid}) — loại '{loai}'. Xem lại loại ở /admin → TKQC.")
    return [{"id": f"act_{aid}", "name": a.get("name") or aid, "bien": a["bien_token"], "token": token_cua[a["bien_token"]]}
            for aid, a in gom.items()]
