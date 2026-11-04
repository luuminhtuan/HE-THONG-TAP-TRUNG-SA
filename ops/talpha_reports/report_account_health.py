#!/usr/bin/env python3
# TALPHA B5 — sync health THEO TỪNG account/shop (bổ sung cho report_health.py mức-vòng-chạy).
#
# Vì sao cần: report_health.py chỉ biết "cả vòng ok hay fail". Nhưng lỗi đắt nhất của hệ
# này là lỗi ÂM THẦM — 1 TKQC rơi khỏi danh sách config (14 TKQC nằm ở ~6 nơi) hoặc 1 shop
# POS fetch thiếu → vòng chạy vẫn rc=0, Sheet vẫn xanh, chỉ có spend/đơn của mục đó biến
# mất. Bug 06/07 mất ~2000 đơn SA đúng kiểu này.
#
# Bắt bằng cách nào: cả fb_ads_data lẫn sale_order đều ghi WRITE_TRUNCATE TOÀN BẢNG mỗi
# vòng → mục nào rơi khỏi vòng sync là MẤT SẠCH dòng, không còn dấu vết. So với chính lần
# chạy trước (đọc từ sync_health_accounts), không so Sheet↔BQ (cùng nguồn, cùng sai).
#
# "Số dòng tụt" LÀ MẤT DỮ LIỆU THẬT — đừng giải thích cho qua:
# Bản đầu của script này báo 7/15 mục có vấn đề ngay vòng chạy đầu; tôi từng kết luận đó là
# co ngót tự nhiên vì POS lọc theo updated_at. KẾT LUẬN ĐÓ SAI. Điều tra sau đó cho thấy
# `should_stop_fetching` dừng fetch khi gặp 10 đơn liên tiếp cũ, trong khi feed POS sắp theo
# inserted_at desc → mỗi vòng cắt ở độ sâu NGẪU NHIÊN. Bằng chứng: tổng đơn dao động cả hai
# chiều 3.730 → 5.220 → 3.380 (co ngót tự nhiên chỉ đi xuống), và số page × 10 khớp chính
# xác số dòng trong BQ. Chi tiết + hướng sửa gốc: memory pos-smart-stop-truncates-orders.
# ⇒ Bảng ghi WRITE_TRUNCATE nên vòng ngắn GHI ĐÈ MẤT bộ đầy đủ. Tụt quá ngưỡng = phải kêu.
# Ngoại lệ duy nhất: 2 ngày đầu tháng, cửa sổ sync reset về đầu tháng nên tụt là đương nhiên.
#
# Gọi từ daily_guarded.sh sau report_health.py, ghi vào bảng Postgres sync_health_accounts
# (04/11/2026 — trước đó BigQuery). Fail ở đây KHÔNG được làm vỡ vòng chạy — luôn exit 0.
import os, sys, socket, argparse, datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from talpha_rules import MONEY_DIV_SHOP  # X13 — số chia tiền POS theo shop, KHÔNG gõ 100
import talpha_paths

TABLE = "sync_health_accounts"

# Ngưỡng tụt coi là mất dữ liệu. 5% lấy đúng theo chốt chặn đề xuất cho bản sửa gốc POS
# ("tụt quá ~5% thì giữ bảng cũ"), để cảnh báo và chốt chặn nói cùng một ngôn ngữ.
# DROP_ABS chặn nhiễu ở mục bé (OM chỉ ~20 dòng): tụt 1-2 dòng không đáng bắn tin.
DROP_PCT = 0.05
DROP_ABS = 10
# 2 ngày đầu tháng cửa sổ sync reset về đầu tháng → tụt là đương nhiên, không phải lỗi.
MONTH_RESET_DAYS = 2

# X13 — CASE shop_label → số chia tiền POS, sinh từ talpha_rules.json (GCC 100, Đài 1).
MONEY_DIV_CASE = "CASE shop_label " + " ".join(
    f"WHEN '{lb}' THEN {d}" for lb, d in MONEY_DIV_SHOP.items()
) + " ELSE 100 END"

STATE_SQL = """
SELECT 'ads' AS kind,
       account_id AS entity_id,
       -- Gộp theo ID, tên lấy bản MỚI NHẤT. Gộp theo cả tên thì Meta đổi tên TK là một TK
       -- tách làm hai dòng, dòng tên mới ít dòng → báo "drop" oan (30/09/2026: Sỹ Anh Taiwan 6
       -- đổi thành ANTALO 4, 248 dòng cũ vẫn nguyên mà bị báo tụt còn 6).
       (ARRAY_AGG(account_name ORDER BY date DESC))[1] AS entity_name,
       COUNT(*)     AS rows_total,
       COUNT(*) FILTER (WHERE date >= CURRENT_DATE - 1) AS rows_recent,
       ROUND(SUM(spend)::numeric) AS metric
FROM fb_ads_data
-- GROUP BY 1, 2 — bản 30/09 ghi "GROUP BY 1" (gom theo hằng 'ads') mà vẫn chọn account_id: câu
-- đó không chạy được, và lỗi bị nuốt ở cuối file nên kiểm theo TKQC im lặng từ đó.
GROUP BY 1, 2
UNION ALL
SELECT 'orders',
       shop_label,
       shop_label,
       COUNT(*),
       COUNT(*) FILTER (WHERE SUBSTR(inserted_at, 1, 10) >= to_char(CURRENT_DATE - 1, 'YYYY-MM-DD')),
       -- rule CEO: doanh thu (tệ địa phương) chỉ tính đơn GIAO_THANH_CONG.
       -- X13: số chia theo TỪNG shop (sinh từ talpha_rules.json) — Đài lưu nguyên TWD,
       -- chia 100 như GCC là tụt 100 lần.
       ROUND((SUM(CASE WHEN status_category = 'GIAO_THANH_CONG' AND cod > 0 THEN cod ELSE 0 END) / ({MONEY_DIV_CASE}))::numeric)
FROM sale_order
GROUP BY 1, 2, 3
"""

PREV_SQL = """
SELECT kind, entity_id, rows_total, rows_recent
FROM sync_health_accounts
WHERE run_ts = (SELECT MAX(run_ts) FROM sync_health_accounts)
"""


def classify(cur_total, cur_recent, prev, month_reset=False):
    """prev = (rows_total, rows_recent) của lần chạy trước, hoặc None nếu chưa từng thấy.
    month_reset = đang trong mấy ngày đầu tháng (cửa sổ sync vừa reset → tụt là bình thường)."""
    if prev is None:
        return "new"
    prev_total, prev_recent = prev
    if cur_total == 0 and prev_total > 0:
        return "empty"          # mất sạch — sync sót hẳn mục này (CẢNH BÁO)
    if not month_reset and prev_total - cur_total > max(DROP_ABS, prev_total * DROP_PCT):
        return "drop"           # vòng này ghi đè bảng bằng bộ THIẾU (CẢNH BÁO)
    if month_reset and prev_total - cur_total > max(DROP_ABS, prev_total * DROP_PCT):
        return "month-reset"    # tụt do cửa sổ đầu tháng — ghi lại, không cảnh báo
    # Còn dòng cũ nhưng 2 ngày gần nhất không có dòng mới. Mục đó thật sự không phát sinh
    # (sync sót thì mất sạch = 'empty'). Ghi để tra, KHÔNG cảnh báo — 6/14 TKQC thường
    # xuyên tạm dừng camp, bắn tin mỗi lần dừng là spam nhóm.
    if cur_recent == 0 and prev_recent > 0:
        return "stale"
    return "ok"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="in ra, không ghi")
    a = ap.parse_args()

    sys.path.insert(0, talpha_paths.repo_dir())
    from sync.core.pg import ket_noi
    from psycopg.rows import namedtuple_row
    conn = ket_noi()
    with conn.cursor(row_factory=namedtuple_row) as c:
        cur = c.execute(STATE_SQL.format(MONEY_DIV_CASE=MONEY_DIV_CASE)).fetchall()
        # Lần chạy đầu: bảng trống → không có mốc so sánh, mọi mục là 'new'.
        prev = {(r.kind, r.entity_id): (int(r.rows_total or 0), int(r.rows_recent or 0))
                for r in c.execute(PREV_SQL).fetchall()}

    now = datetime.datetime.utcnow()
    month_reset = now.day <= MONTH_RESET_DAYS
    run_ts = now.isoformat() + "Z"
    host = socket.gethostname()
    seen = set()
    rows = []
    for r in cur:
        key = (r.kind, r.entity_id)
        seen.add(key)
        p = prev.get(key)
        status = classify(int(r.rows_total or 0), int(r.rows_recent or 0), p, month_reset)
        rows.append({
            "ts": run_ts, "run_ts": run_ts, "host": host,
            "kind": r.kind, "entity_id": r.entity_id, "entity_name": r.entity_name,
            "rows_total": int(r.rows_total or 0), "rows_recent": int(r.rows_recent or 0),
            "metric": float(r.metric or 0),
            "prev_rows_total": p[0] if p else None,
            "status": status,
        })

    # Mục lần trước CÓ, lần này biến mất khỏi kết quả GROUP BY = mất sạch dòng.
    # Không có trong `cur` nên vòng trên không bắt được — phải bù ở đây.
    for (kind, entity_id), (prev_total, prev_recent) in prev.items():
        if (kind, entity_id) in seen or prev_total == 0:
            continue
        rows.append({
            "ts": run_ts, "run_ts": run_ts, "host": host,
            "kind": kind, "entity_id": entity_id, "entity_name": entity_id,
            "rows_total": 0, "rows_recent": 0, "metric": 0.0,
            "prev_rows_total": prev_total, "status": "empty",
        })

    bad = [r for r in rows if r["status"] in ("empty", "drop")]
    for r in sorted(rows, key=lambda x: (x["kind"], -x["rows_total"])):
        print("  {:6s} {:7d} rows (trước {}) {:6s} {}".format(
            r["kind"], r["rows_total"],
            "?" if r["prev_rows_total"] is None else r["prev_rows_total"],
            r["status"], r["entity_name"]))
    print("sync_health_accounts: {} mục, {} mục CÓ VẤN ĐỀ".format(len(rows), len(bad)))

    if a.dry_run:
        print("(dry-run — không ghi)")
        return

    cot = ("ts", "run_ts", "host", "kind", "entity_id", "entity_name", "rows_total", "rows_recent",
           "metric", "prev_rows_total", "status")
    with conn.transaction():
        with conn.cursor() as c:
            c.executemany(
                f"INSERT INTO {TABLE} ({', '.join(cot)}) VALUES ({', '.join(['%s'] * len(cot))})",
                [tuple(r[k] for k in cot) for r in rows])
    conn.close()

if __name__ == "__main__":
    try:
        main()
    except Exception as e:                                   # noqa: BLE001
        print("report_account_health FAILED (bỏ qua, không chặn vòng chạy):", e, file=sys.stderr)
