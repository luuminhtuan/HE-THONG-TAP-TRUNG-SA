"""
Báo cáo tháng "TỔNG TEAM THÁNG n": đọc kho số Postgres, ghi bảng monthly_report_tabs + market_monthly_reports,
và (có khoá Google) ghi các file Google Sheet của team.

Chạy: `python format_all.py` — vòng :20 của daily_guarded.sh, nút xuất báo cáo (/api/talpha/export-report),
lịch docker. Không có tham số dòng lệnh; biến môi trường: TALPHA_REPORT_MONTH=YYYY-MM (dựng lại một tháng
đã qua), TALPHA_FORMAT_DRY=1 (chỉ in bố cục, không ghi Sheet / monthly_report_tabs), GOOGLE_APPLICATION_CREDENTIALS,
TALPHA_RUNTIME_DIR, TALPHA_REPO.

16/11/2026: bỏ lối chạy thẳng ở top-level — gom vào main(). Đọc số + gom ô: report_data.py; dựng bảng:
report_tables.py; ghi Google Sheet: sheet_writer.py; ghi Postgres: report_store.py — code chuyển nguyên
văn, thứ tự đọc / ghi / in log giữ y hệt. Máy chủ chạy bản chép phẳng: deploy_runtime.sh chép kèm.
"""
import calendar as _cal
import datetime
import os
import sys
import time

# ── NGUỒN SỐ: Postgres (04/11/2026 — trước đó BigQuery) ── Số tính xong ghi vào bảng monthly_report_tabs
# TRƯỚC; tab Tổng quan / P&L / Marketer của dashboard và bot Zalo đọc từ đó. File Google Sheet
# "TỔNG TEAM THÁNG n" + file riêng từng người là TUỲ CHỌN: có khoá Google (tài khoản máy) thì ghi
# thêm cho team xem như cũ, không có thì bỏ qua — báo cáo trên dashboard vẫn đủ.
# ── THÁNG ĐANG CHẠY + BỘ FILE CỦA CHÍNH THÁNG ĐÓ (Sỹ Anh chốt 01/10/2026) ──
# Ngày theo giờ VIỆT NAM (máy chủ để UTC: date.today() làm tháng lật lúc 07:00 sáng ngày 1).
# TALPHA_REPORT_MONTH=YYYY-MM: dựng lại một tháng đã qua (đủ ngày tháng đó).
# Bộ file: report_files.py — khai tay report_files/YYYY-MM.json, không có thì quét thư mục
# "Tháng N" trên Drive. Trước đây GRAND_KEY + <nước>_files.json là MỘT bộ ID cố định: 01/10/2026
# sang tháng không ai đổi ID, 16 file tháng 9 bị xoá sạch rồi ghi số tháng 10.
import report_files as _rf
import talpha_paths   # repo_dir(): gốc repo, để import sync.core (kho số, khoá kết nối)
from report_data import collect_cells, parse_camp  # noqa: F401  (format_all.parse_camp: README)
from report_store import write_market_report, write_summary_tabs
from report_tables import combined_tab, market_tab, safe, team_summary_tabs
from sheet_writer import SheetWriter, write_market_files, write_test_files
# ── RULE CHUNG: đọc từ talpha_rules.json qua loader (golden-test 29/07 = 100% khớp bản cũ).
# Sửa rule (marketer/tỷ giá/thị trường/test) → sửa talpha_rules.json, KHÔNG sửa tại đây.
from talpha_rules import ALLM, DISPLAY, LOCALCUR, MONEY_DIV, PRIMARY_MARKET, RATE, UNASSIGN


def _google_key() -> str | None:
    """Khoá Google (tài khoản máy) đầu tiên tìm thấy; có thì đặt GOOGLE_APPLICATION_CREDENTIALS."""
    # Khoá: env thắng → key runtime (máy chạy launchd) → key trong repo.
    _KEY_CANDIDATES=[os.environ.get('GOOGLE_APPLICATION_CREDENTIALS'),
                  os.path.expanduser('~/talpha_reports/runtime/bigquery_key.json'),
                  os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),'bigquery_key.json')]
    KEY=next((k for k in _KEY_CANDIDATES if k and os.path.exists(k)), None)
    if KEY: os.environ['GOOGLE_APPLICATION_CREDENTIALS']=KEY
    return KEY


def _month_file_set(KEY: str | None) -> tuple[datetime.date, dict | None]:
    """Ngày chốt của tháng đang chạy (giờ VN) + bộ file Sheet của CHÍNH tháng đó. In dòng THANG …"""
    _T=_rf.report_end_date(os.environ.get('TALPHA_REPORT_MONTH'))
    _HERE=os.path.dirname(os.path.abspath(__file__))
    _RT=os.environ.get('TALPHA_RUNTIME_DIR') or os.path.expanduser('~/talpha_reports/runtime')
    if KEY:
        FILE_SET,FILE_SET_SOURCE=_rf.get_month_file_set(_T.year,_T.month,here=_HERE,cache_dir=os.path.join(_RT,'report_files_cache'),key=KEY)
    else:
        FILE_SET,FILE_SET_SOURCE={},"không có khoá Google — chỉ ghi Postgres, bỏ qua Google Sheet"
    print(f"THANG {_T.month}/{_T.year} (toi {_T}) · bo file: {FILE_SET_SOURCE}")
    if KEY and not FILE_SET:
        # KHÔNG ghi Sheet, KHÔNG lùi về file tháng khác — số vẫn ghi vào Postgres cho dashboard + bot.
        print(f"CANH BAO: CHUA CO BO FILE THANG {_T.month}/{_T.year} — KHONG GHI SHEET. {FILE_SET_SOURCE}")
        print(f"    Tao thu muc 'Tháng {_T.month}' trong BÁO CÁO ADS ANTALO + file 'TỔNG TEAM THÁNG {_T.month}' va file tung nguoi "
              f"(hoac chay Apps Script create_month_files.gs), share thu muc goc cho service account.")
    return _T, FILE_SET


def _print_final_warnings(n: int, data, LOST_FILES: list, MISSING_FILES: list, _T: datetime.date,
                          WRITE_SHEET: bool, GRAND_KEY: str) -> None:
    """Dòng ALL DONE + các CANH BAO cuối log (report_health đọc tail log → bot thấy được)."""
    print("ALL DONE", n)
    print("NOI NGUON DON: " + " · ".join(f"{k} {v}" for k,v in sorted(data.match_counts.items())))
    if data.empty_orders:
        print("BO DON TRONG (khong san pham, 0 tien — khong tinh vao so don): " + " · ".join(f"{r.shop_label} {r.n}" for r in data.empty_orders))
    if LOST_FILES:
        print(f"CANH BAO: {len(LOST_FILES)} file rieng KHONG MO DUOC (da xoa han hoac mat quyen) — kiem thu muc 'Tháng {_T.month}' tren Drive.")
        for _e,_m,_k in LOST_FILES:
            print(f"    {_e:8s} {_m:10s} {_k}")
    if MISSING_FILES:
        print(f"CANH BAO: {len(MISSING_FILES)} cap nguoi/nuoc CO SO nhung CHUA CO FILE rieng — so van nam trong TONG TEAM. Tao sheet '<NUOC> T{_T.month}' trong thu muc nguoi do o 'Tháng {_T.month}' — vong sau tu thay.")
        for _e,_m in MISSING_FILES:
            print(f"    {_e:8s} {_m:10s}")
    if data.missing_market:
        _tn=sum(data.missing_market.values())
        print(f"CANH BAO: {len(data.missing_market)} campaign KHONG GHI NUOC o dau ten — {_tn:,.0f} d dang tinh ve {PRIMARY_MARKET}. Doi ten thanh TW/… SG/… AE/… JP/… de khoi nham nuoc.")
        for _c,_s in sorted(data.missing_market.items(), key=lambda x:-x[1])[:10]:
            print(f"    {_s:>12,.0f} d | {_c[:90]}")
    if data.dropped:
        _ts=sum(data.dropped.values())
        print(f"CANH BAO: {len(data.dropped)} campaign KHONG VAO BAO CAO — {_ts:,.0f} d bi roi (ten camp sai format/typo thi truong)")
        for _c,_s in sorted(data.dropped.items(), key=lambda x:-x[1])[:10]:
            print(f"    {_s:>12,.0f} d | {_c[:90]}")
    if WRITE_SHEET and not GRAND_KEY:
        # Dashboard + bot vẫn có số (đọc Postgres) — chỉ là team chưa có file Sheet tháng này để xem.
        print(f"CANH BAO: thu muc 'Tháng {_T.month}' CHUA CO file 'TỔNG TEAM THÁNG {_T.month}' — chua ghi Sheet tong thang nay (dashboard van du so).")


def main() -> int:
    """Một vòng báo cáo tháng: đọc số → ghi Sheet file riêng → monthly_report_tabs → Sheet TỔNG TEAM →
    market_monthly_reports → Sheet TEST → cảnh báo cuối log. Trả mã thoát 0 (lỗi thì ném ra, rc 1)."""
    KEY=_google_key()
    _T, FILE_SET = _month_file_set(KEY)
    WRITE_SHEET=bool(KEY and FILE_SET)
    FROM=_T.replace(day=1).isoformat(); TO=_T.isoformat()  # đầu tháng -> hôm nay (tháng cũ: -> cuối tháng)
    # File theo nước của từng marketer: bộ file của tháng (report_files.py) — xem MARKET_FILES bên dưới.
    # (MARKET_MAP gõ tay trong code — bộ 30 file GCC của team cũ — bỏ 09/09/2026.)
    TOTALS_MAP={}  # Không còn file "TỔNG ADS" riêng từng người. Tổng MỌI nước của một người nằm ở
    # tab của người đó trong file TỔNG TEAM.
    # Vòng lặp file riêng + TEST bên dưới duyệt theo MARKET_FILES/TESTMAP, KHÔNG theo TONG_MAP nữa.
    # File TỔNG TEAM THÁNG n của tháng đang chạy — lấy từ bộ file của tháng (report_files.py).
    # write_file() xoá sạch tab rồi ghi đè, nên ID này TUYỆT ĐỐI không được là file của tháng khác.
    GRAND_KEY=FILE_SET.get('grand') or ""
    DAYS=[datetime.date(_T.year,_T.month,d) for d in range(1,_cal.monthrange(_T.year,_T.month)[1]+1)]  # đủ ngày tháng hiện tại
    sys.path.insert(0, talpha_paths.repo_dir())
    from sync.core.pg import get_connection
    from sync.core.credentials import load_credentials_to_env
    load_credentials_to_env()   # token Pancake (mess Nhật) nhập ở /admin → Khoá kết nối — bảng api_credentials
    pg=get_connection()
    data=collect_cells(pg, FROM, TO)
    cell=data.cell
    # TALPHA_FORMAT_DRY=1: chỉ IN file nào sẽ nhận tab nào, KHÔNG mở Sheets — xem sheet_writer.py.
    DRY=os.environ.get("TALPHA_FORMAT_DRY")=="1"
    writer=SheetWriter(KEY, WRITE_SHEET, _T.month, DRY)
    n=0
    # 8 TỔNG files
    for emp,key in TOTALS_MAP.items():
        used=set(); tabs=[("Tổng",combined_tab(emp,cell,DAYS))]; used.add("tổng")
        for mkt in ALLM:
            sub={k:v for k,v in cell.items() if k[0]==emp and k[1]==mkt}
            tabs.append((safe(mkt.upper(),used),market_tab(sub,RATE[mkt],LOCALCUR[mkt],MONEY_DIV[mkt],DAYS)))
        # title: trước đây chỉ file GRAND được đổi tên → 7 file này kẹt tên 'THÁNG 7' suốt tháng 8.
        writer.write_file(key,tabs,title=f"TỔNG ADS THÁNG {_T.month}"); n+=1; print(f"[{n}] TỔNG {emp}: {len(tabs)} tab"); time.sleep(1.0)
    # ── FILE RIÊNG: MỖI MARKETER × MỖI NƯỚC MỘT FILE ──
    # 16/09/2026 — Sỹ Anh chốt: mỗi nước một file ("TAIWAN T9", "SINGAPORE T9", "UAE T9"… trong
    # thư mục của từng người). Bản 15/09 gộp mọi nước vào MỘT file, mỗi nước một tab — nhưng tên
    # file vẫn là "TAIWAN T9", mở thư mục ra tưởng thiếu Singapore.
    # Nên file nào cũng chỉ MỘT nước, bố cục như trước giờ: "Tổng" = bảng của nước đó (tiền địa
    # phương + tỷ giá), rồi MỖI PAGE MỘT TAB đặt theo tên page (17/09/2026; trước đó theo mã sản
    # phẩm). Tên file do CEO đặt — code không đổi tên.
    # ID lấy từ bộ file của tháng (report_files.py) — {nước: {key marketer: ID}}, nhận theo thư mục
    # người (LOC, THAI…) và tên file "<NƯỚC> T<n>". Service account KHÔNG tự tạo được file (quota
    # Drive của nó = 0): người tạo sheet trong thư mục marketer của tháng là vòng sau tự thấy.
    MARKET_FILES={mkt: dict((FILE_SET.get('files') or {}).get(mkt) or {}) for mkt in ALLM}
    n, LOST_FILES = write_market_files(writer, MARKET_FILES, cell, DAYS, ALLM, n)
    # Người CÓ SỐ ở một nước mà chưa có file nước đó: số KHÔNG mất — vẫn nằm trong file TỔNG TEAM
    # (tab của người đó + tab nước) — nhưng thư mục riêng của họ thiếu file. Cảnh báo ở cuối log.
    MISSING_FILES=[] if not WRITE_SHEET else sorted({(k[0],k[1]) for k,c in cell.items()
                       if (c["spend"] or c["orders"] or c["msg"]) and k[0] in DISPLAY and k[0] not in UNASSIGN
                       and not MARKET_FILES.get(k[1],{}).get(k[0])})
    HAS_FILE={emp for m in MARKET_FILES.values() for emp,key in m.items() if key}
    SUMMARY_TABS=team_summary_tabs(cell, DAYS, HAS_FILE)
    if not DRY:
        write_summary_tabs(pg, _T.year, _T.month, SUMMARY_TABS)
    if WRITE_SHEET and GRAND_KEY and not GRAND_KEY.endswith("placeholder"):
        writer.write_file(GRAND_KEY,SUMMARY_TABS,title=f"TỔNG TEAM THÁNG {_T.month}"); n+=1; print(f"[{n}] GRAND TỔNG THÁNG: {len(SUMMARY_TABS)} tab")
    write_market_report(pg, _T.year, _T.month, cell)
    n=write_test_files(writer, FILE_SET, data.cell_test, DAYS, WRITE_SHEET, _T.month, n)
    _print_final_warnings(n, data, LOST_FILES, MISSING_FILES, _T, WRITE_SHEET, GRAND_KEY)
    return 0


if __name__ == "__main__":
    sys.exit(main())
