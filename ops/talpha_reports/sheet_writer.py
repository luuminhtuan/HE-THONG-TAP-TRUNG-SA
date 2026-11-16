"""
Ghi bảng báo cáo tháng lên Google Sheet (file TỔNG TEAM + file riêng từng người × nước + file TEST).

Tách khỏi format_all.py (16/11/2026) — thân hàm chuyển nguyên văn; gc / DRY / tháng trước đây là biến
toàn cục, nay là thuộc tính của SheetWriter. Ghi Sheet là TUỲ CHỌN: không có khoá Google (tài khoản
máy) thì format_all không ghi Sheet, số vẫn vào Postgres. write_file() XOÁ SẠCH tab cũ của file rồi ghi
đè — ID file phải là file của ĐÚNG tháng đang chạy (report_files.py).
"""
import re
import time

from report_tables import market_file_tabs, safe, test_tab

DG=(.21,.34,.14);ORG=(.96,.69,.52);PCH=(.99,.89,.84);PNK=(.93,.76,.84);LBL=(.87,.92,.97);BLU=(.74,.84,.93);GRN=(.66,.82,.56);GRND=(.78,.94,.81);YEL=(1.,1.,0.);WHT=(1,1,1);RED=(.86,0.,0.)


def cc(r): return {"red":r[0],"green":r[1],"blue":r[2]}


NUM="#,##0";DDv='#,##0" đ"';PCT='0.00"%"'
CMETA=[(DG,1,WHT,None),(ORG,0,PCH,NUM),(PNK,0,PCH,NUM),(LBL,0,WHT,DDv),(LBL,0,WHT,DDv),(LBL,0,WHT,PCT),(BLU,0,PCH,NUM),(ORG,0,PCH,NUM),(ORG,0,PCH,NUM),(GRN,0,GRND,NUM),(GRN,0,GRND,NUM),(YEL,0,WHT,PCT),(YEL,0,WHT,PCT),(YEL,0,WHT,DDv)]


def freq(sid,nr):
    t=nr-1; R=[{"updateSheetProperties":{"properties":{"sheetId":sid,"gridProperties":{"frozenRowCount":1}},"fields":"gridProperties.frozenRowCount"}}]
    for ci,(hbg,hw,dbg,nf) in enumerate(CMETA):
        R.append({"repeatCell":{"range":{"sheetId":sid,"startRowIndex":0,"endRowIndex":1,"startColumnIndex":ci,"endColumnIndex":ci+1},"cell":{"userEnteredFormat":{"backgroundColor":cc(hbg),"horizontalAlignment":"CENTER","verticalAlignment":"MIDDLE","wrapStrategy":"WRAP","textFormat":{"bold":True,"fontSize":9,"foregroundColor":cc(WHT if hw else (0,0,0))}}},"fields":"userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)"}})
        cf={"backgroundColor":cc(dbg)};fl="userEnteredFormat.backgroundColor"
        if nf: cf["numberFormat"]={"type":"NUMBER","pattern":nf};fl+=",userEnteredFormat.numberFormat"
        if ci>=1: cf["horizontalAlignment"]="RIGHT";fl+=",userEnteredFormat.horizontalAlignment"
        cf["textFormat"]={"foregroundColor":cc((0,0,0)),"bold":False}; fl+=",userEnteredFormat.textFormat"  # ép chữ ĐEN, xoá chữ trắng sót
        R.append({"repeatCell":{"range":{"sheetId":sid,"startRowIndex":1,"endRowIndex":nr,"startColumnIndex":ci,"endColumnIndex":ci+1},"cell":{"userEnteredFormat":cf},"fields":fl}})
    R.append({"repeatCell":{"range":{"sheetId":sid,"startRowIndex":t,"endRowIndex":t+1,"startColumnIndex":0,"endColumnIndex":14},"cell":{"userEnteredFormat":{"backgroundColor":cc(RED),"textFormat":{"bold":True,"foregroundColor":cc(WHT)}}},"fields":"userEnteredFormat.backgroundColor,userEnteredFormat.textFormat"}})
    return R


class SheetWriter:
    """Kết nối Google Sheets của một vòng chạy (chỉ mở khi write_sheet) + cách ghi một file."""

    def __init__(self, key: str | None, write_sheet: bool, month: int, dry: bool) -> None:
        if write_sheet:
            import gspread
            from google.oauth2.service_account import Credentials
            from gspread.exceptions import APIError, SpreadsheetNotFound
            self.gc=gspread.authorize(Credentials.from_service_account_file(key,scopes=['https://www.googleapis.com/auth/spreadsheets','https://www.googleapis.com/auth/drive']))
        else:
            class APIError(Exception): pass
            class SpreadsheetNotFound(Exception): pass
            self.gc=None
        self.APIError=APIError; self.SpreadsheetNotFound=SpreadsheetNotFound
        self.month=month
        # TALPHA_FORMAT_DRY=1: chỉ IN file nào sẽ nhận tab nào, KHÔNG mở Sheets — để soát bố cục
        # bằng số thật trước khi đổi cách ghi (đổi bố cục là write_file xoá sạch tab cũ của file).
        self.dry=dry

    def do(self, fn):
        for a in range(7):
            try: return fn()
            except self.APIError as e:
                es=str(e)
                # 20/08: thêm '-1]'/'DOCTYPE' — Google có lúc trả trang HTML lỗi thay vì JSON
                # (log 09/08: APIError [-1]: <!DOCTYPE html>), bản cũ không retry → chết cả chain.
                if any(x in es for x in ('429','500','502','503','RATE','unavailable','Internal','[-1]','DOCTYPE')): time.sleep(15); continue
                raise
        return fn()

    def write_file(self, key, tabs, title=None, month_suffix=False):
        if self.dry:
            print(f"    [DRY] {key}: {len(tabs)} tab — " + " · ".join(f"{t} ({rows[-1][6]} đơn)" for t,rows in tabs)); return
        # 20/08 FIX: `sh.sheet1` CŨNG gọi API (fetch_sheet_metadata). Bản cũ để nó NGOÀI do()
        # nên 1 lần Google trả 503 là chết cả chain → file thị trường mang số mới, file TỔNG
        # mang số cũ (báo cáo nửa vời, đã xảy ra 18/344 vòng). Nay bọc chung trong do().
        sh, first = self.do(lambda: (lambda s: (s, s.sheet1))(self.gc.open_by_key(key))); nr=len(tabs[0][1])
        # Tên file tự đặt theo tháng đang chạy — trước đây gõ tay nên tháng 8 vẫn ghi
        # "THÁNG 7" suốt (CEO phát hiện 10/08).
        # month_suffix: giữ nguyên tên gốc, chỉ thay đuôi ' T<tháng>' (file [Test] mỗi người
        # đặt tên một kiểu — Loc/Chu Thuý/Nhung — nên KHÔNG dựng lại tên từ đầu).
        if month_suffix and not title:
            title = re.sub(r'\s*[Tt]\d{1,2}$', '', sh.title).strip() + f' T{self.month}'
        if title and sh.title != title:
            try: self.do(lambda: sh.update_title(title)); print(f'    đổi tên file → {title}')
            except Exception as e: print(f'    (không đổi được tên file: {e})')
        ex=self.do(lambda: sh.worksheets())
        dr=[{"deleteSheet":{"sheetId":w.id}} for w in ex[1:]]
        if dr: self.do(lambda: sh.batch_update({"requests":dr}))
        # 01/09 FIX: lưới phải ĐÚNG nr dòng, không phải nr+2. Bản cũ chừa 2 dòng thừa mà
        # values_batch_update chỉ ghi đè tới dòng nr → tháng ngắn hơn tháng trước thì dòng
        # TỔNG của tháng cũ SỐNG SÓT ngay dưới dòng TỔNG mới. Tháng 9 (30 ngày) kế tháng 8
        # (31 ngày) là dính: dòng 33 còn nguyên tổng tháng 8 trong cả 46 file.
        # freq() format tới hết dòng nr (dòng đỏ ở t=nr-1) nên rowCount=nr là vừa đủ.
        rq=[{"updateSpreadsheetProperties":{"properties":{"locale":"vi_VN"},"fields":"locale"}},{"updateSheetProperties":{"properties":{"sheetId":first.id,"title":tabs[0][0],"gridProperties":{"rowCount":nr,"columnCount":14}},"fields":"title,gridProperties"}}]
        for t,_ in tabs[1:]: rq.append({"addSheet":{"properties":{"title":t,"gridProperties":{"rowCount":nr,"columnCount":14}}}})
        self.do(lambda: sh.batch_update({"requests":rq}))
        self.do(lambda: sh.values_batch_update({"valueInputOption":"RAW","data":[{"range":f"'{t}'!A1","values":rows} for t,rows in tabs]}))
        wm={w.title:w.id for w in self.do(lambda: sh.worksheets())}
        fr=[]
        for t,_ in tabs: fr+=freq(wm[t],nr)
        self.do(lambda: sh.batch_update({"requests":fr}))


def write_market_files(writer: SheetWriter, market_files: dict, cell: dict, days: list, all_markets: list,
                       n: int) -> tuple[int, list]:
    """File riêng: mỗi marketer × mỗi nước một file. Trả (n sau khi ghi, LOST_FILES)."""
    LOST_FILES=[]
    for mkt in all_markets:
        for emp,key in market_files[mkt].items():
            if not key: continue
            tabs=market_file_tabs(emp,mkt,cell,days)
            # File đã bị xoá HẲN (thùng rác Drive tự dọn sau 30 ngày) hoặc bị gỡ quyền: bỏ qua riêng
            # file đó, KHÔNG làm chết cả vòng — nổ ở đây là file TỔNG TEAM ghi phía sau đứng số, và
            # tin Zalo 8h30 đọc đúng file đó. Dính thật 16/09/2026: thư mục ANH nằm trong thùng rác
            # từ trước, job vẫn ghi vào file trong đó mỗi giờ — tới ngày thùng rác dọn là nổ.
            try: writer.write_file(key,tabs)
            except writer.SpreadsheetNotFound:
                LOST_FILES.append((emp,mkt,key)); print(f"[SKIP] FILE {emp}/{mkt}: không mở được {key} — đã xoá hẳn hoặc mất quyền"); continue
            n+=1; print(f"[{n}] FILE {emp}/{mkt}: {len(tabs)} tab — https://docs.google.com/spreadsheets/d/{key}")
    return n, LOST_FILES


def write_test_files(writer: SheetWriter, file_set: dict, cell_test: dict, days: list, write_sheet: bool,
                     month: int, n: int) -> int:
    """File TEST mỗi marketer (chung mọi thị trường, tab theo page). Trả n sau khi ghi."""
    # ── FILE TEST mỗi marketer (chung mọi thị trường, tab theo page) ──
    # ID từ bộ file của tháng: file có chữ TEST trong tên, người theo thư mục/tên file.
    TESTMAP=dict(file_set.get('test') or {})
    for emp in (sorted({k[0] for k in cell_test} | set(TESTMAP)) if write_sheet else []):
        sub={k:v for k,v in cell_test.items() if k[0]==emp}
        if not sub: continue
        key=TESTMAP.get(emp)
        if not key:
            # SA KHÔNG tự tạo được file (Google chặn quota) — người tạo sheet có chữ TEST trong thư
            # mục của người đó ở tháng này. Thiếu file thì bỏ qua người này, KHÔNG làm chết cả chain.
            print(f"[SKIP] TEST {emp}: thư mục 'Tháng {month}' chưa có file TEST của người này — số test của họ chưa ghi.")
            continue
        prods=sorted({k[2] for k in sub}, key=lambda p:(-sum(sub[x]["spend"] for x in sub if x[2]==p), str(p)))
        used=set(); tabs=[("Tổng",test_tab(emp,cell_test,days))]; used.add("tổng")
        for prod in prods: tabs.append((safe(prod,used),test_tab(emp,cell_test,days,prod)))
        writer.write_file(key,tabs,month_suffix=True); n+=1
        print(f"[{n}] TEST {emp}: {len(tabs)} tab — https://docs.google.com/spreadsheets/d/{key}")
    return n
