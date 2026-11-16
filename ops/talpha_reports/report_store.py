"""
Ghi số báo cáo tháng vào Postgres: bảng monthly_report_tabs (tab TỔNG TEAM — dashboard Tổng quan / P&L /
Marketer và bot Zalo đọc) và bảng market_monthly_reports (số nước × người cho bot Zalo).

Tách khỏi format_all.py (16/11/2026) — code chuyển nguyên văn, gom vào hàm; format_all gọi đúng chỗ
và đúng thứ tự như trước (monthly_report_tabs → file TỔNG TEAM trên Sheet → market_monthly_reports).
"""
import datetime

from psycopg.types.json import Jsonb

from report_data import EXT_PREFIX, UNASSIGNED
from talpha_rules import RATE, MONEY_DIV


def write_summary_tabs(pg, year: int, month: int, summary_tabs: list) -> None:
    """Thay trọn tab TỔNG TEAM của tháng trong monthly_report_tabs (MỘT transaction)."""
    # ── GHI POSTGRES (monthly_report_tabs) — nguồn của tab Tổng quan / P&L / Marketer và bot Zalo ── Thay trọn
    # tháng trong MỘT transaction: người đang xem thấy bản cũ tới lúc COMMIT, lỗi giữa chừng thì giữ bản
    # cũ. Hàng ghi ĐÚNG như lên Sheet (hàng đầu tiêu đề, hàng cuối TỔNG) — route đọc theo cùng bố cục.
    _month=f"{year}-{month:02d}"
    with pg.transaction():
        pg.execute("DELETE FROM monthly_report_tabs WHERE month = %s AND report_key = 'tong_team'", (_month,))
        for _i,(_tab_name,_rows) in enumerate(summary_tabs):
            pg.execute("INSERT INTO monthly_report_tabs (month, report_key, tab_order, tab_name, rows) VALUES (%s, 'tong_team', %s, %s, %s)",
                       (_month, _i, _tab_name, Jsonb(_rows)))
    print(f"POSTGRES monthly_report_tabs {_month}: {len(summary_tabs)} tab — " + " · ".join(t for t,_ in summary_tabs))


def write_market_report(pg, year: int, month: int, cell: dict) -> None:
    """Số theo nước × người cho bot Zalo → market_monthly_reports. Lỗi thì chỉ in CANH BAO."""
    # ── SỐ THEO NƯỚC × NGƯỜI cho bot Zalo (Sỹ Anh chốt 08/10/2026: mỗi nước một nhóm "ADS + VẬN
    # ĐƠN") ── File TỔNG TEAM chỉ có tab nước (gộp người) và tab người (gộp nước); bảng xếp hạng
    # người TRONG một nước không có ở đâu. Ghi vào bảng market_monthly_reports (15/11/2026 — trước đó
    # file data/bao_cao_nuoc/<tháng>.json) NGAY SAU bảng TỔNG TEAM, cùng một bộ ô `cell` → tổng người
    # trong nước = đúng tab nước. Bot đọc qua /api/talpha/market-report.
    # Chỉ người trong team (như tab nước), "(không gán)" để riêng; người ngoài team bỏ. Hỏng thì
    # chỉ log — không bao giờ làm chết vòng ghi Sheet.
    try:
        _by_market={}
        for (_nv,_m,_tab,_d),_c in cell.items():
            if str(_nv).startswith(EXT_PREFIX) or _m not in RATE: continue
            _o=_by_market.setdefault(_m,{}).setdefault(_d,{}).setdefault(_nv,{"ads":0.0,"mess":0,"don":0,"doanh_so":0.0,"ds_giao_tc":0.0})
            _o["ads"]+=_c["spend"]; _o["mess"]+=_c["msg"]; _o["don"]+=_c["orders"]
            _o["doanh_so"]+=_c["cod"]/MONEY_DIV[_m]*RATE[_m]; _o["ds_giao_tc"]+=_c["cod_gtc"]/MONEY_DIV[_m]*RATE[_m]
        for _m in _by_market.values():
            for _people in _m.values():
                for _o in _people.values():
                    for _k in ("ads","doanh_so","ds_giao_tc"): _o[_k]=round(_o[_k])
        _report_month=f"{year}-{month:02d}"
        pg.execute("INSERT INTO market_monthly_reports (month, content, written_at) VALUES (%s, %s, now()) "
                   "ON CONFLICT (month) DO UPDATE SET content = EXCLUDED.content, written_at = now()",
                   (_report_month, Jsonb({"thang":_report_month,"ghi_luc":datetime.datetime.utcnow().isoformat()+"Z",
                                       "khong_gan":UNASSIGNED,"nuoc":_by_market})))
        print(f"BAN NUOC: market_monthly_reports {_report_month} ({', '.join(sorted(_by_market))})")
    except Exception as _e:
        print(f"CANH BAO: khong ghi duoc so theo nuoc cho bot Zalo: {_e}")
