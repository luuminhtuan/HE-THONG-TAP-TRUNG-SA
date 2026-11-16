"""
Dựng bảng (danh sách hàng, hàng đầu tiêu đề, hàng cuối TỔNG) cho báo cáo tháng từ các ô đã gom
(report_data.py): tab nước, tab người (gộp mọi nước, VND), tab Tổng team, tab TEST.

Tách khỏi format_all.py (16/11/2026) — thân hàm chuyển nguyên văn; các ô và danh sách ngày trước đây
đọc từ biến toàn cục, nay truyền vào (`cell`, `cell_test`, `days`). Cùng một bộ hàng được ghi lên
Google Sheet VÀ vào bảng bao_cao_tab (dashboard + bot Zalo đọc) — đổi cột ở đây là đổi cả hai.
"""
import re

from report_data import EXT_PREFIX, RULES_MARKETS, UNASSIGNED
from talpha_rules import RATE, LOCALCUR, MONEY_DIV, ALLM, DISPLAY, UNASSIGN

_MARKET_NAMES = {m: v.get("display", m) for m, v in RULES_MARKETS.items()}


def H(local): return ["Ngày","TỔNG TIỀN ADS","SỐ TIN NHẮN","Giá Tiền/TN","CPO","Tỷ lệ chốt","Số đơn",local,"Tỉ giá","Doanh Số","DS Giao TC","% Ads/DT","% Ads/DT giao","TB đơn"]


def drow(day,c,rate,div):
    # X13: `div` là số chia của CHÍNH thị trường đó (MONEY_DIV) — GCC 100, Đài 1.
    # Gõ thẳng /100 ở đây là làm tiền Đài tụt 100 lần trên Sheet.
    s=c["spend"];m=c["msg"];o=c["orders"];rev=c["cod"]/div*rate;loc=c["cod"]/div;gtc=c["cod_gtc"]/div*rate
    return [day,round(s),m,round(s/m) if m else 0,round(s/o) if o else 0,round(o/m*100,2) if m else 0,o,round(loc),rate,round(rev),round(gtc),round(s/rev*100,2) if rev else 0,round(s/gtc*100,2) if gtc else 0,round(rev/o) if o else 0]


def market_tab(cells, rate, local, div, days: list) -> list:
    pd={str(d):{"spend":0.0,"msg":0,"orders":0,"cod":0.0,"cod_gtc":0.0} for d in days}
    for k,c in cells.items():
        if k[3] in pd:
            for kk in("spend","msg","orders","cod","cod_gtc"): pd[k[3]][kk]+=c[kk]
    rows=[H(local)]; tot={"spend":0,"msg":0,"orders":0,"cod":0,"cod_gtc":0}
    for d in days:
        c=pd[str(d)]; rows.append(drow(d.strftime("%d/%m/%Y"),c,rate,div))
        for kk in tot: tot[kk]+=c[kk]
    rows.append(drow("TỔNG",tot,rate,div)); return rows


def vrow(day,c):
    s=c["spend"];m=c["msg"];o=c["orders"];rev=c["rev"];gtc=c["rev_gtc"]
    return [day,round(s),m,round(s/m) if m else 0,round(s/o) if o else 0,round(o/m*100,2) if m else 0,o,"","",round(rev),round(gtc),round(s/rev*100,2) if rev else 0,round(s/gtc*100,2) if gtc else 0,round(rev/o) if o else 0]


def combined_tab(nv, cell: dict, days: list) -> list:  # cộng tất cả thị trường, VND
    pd={str(d):{"spend":0.0,"msg":0,"orders":0,"rev":0.0,"rev_gtc":0.0} for d in days}
    for k,c in cell.items():
        if k[0]!=nv or k[3] not in pd: continue
        pd[k[3]]["spend"]+=c["spend"]; pd[k[3]]["msg"]+=c["msg"]; pd[k[3]]["orders"]+=c["orders"]; pd[k[3]]["rev"]+=c["cod"]/MONEY_DIV[k[1]]*RATE[k[1]]; pd[k[3]]["rev_gtc"]+=c["cod_gtc"]/MONEY_DIV[k[1]]*RATE[k[1]]
    rows=[H("Tiền (local)")]; tot={"spend":0,"msg":0,"orders":0,"rev":0,"rev_gtc":0}
    for d in days:
        c=pd[str(d)]; rows.append(vrow(d.strftime("%d/%m/%Y"),c))
        for kk in tot: tot[kk]+=c[kk]
    rows.append(vrow("TỔNG",tot)); return rows


def test_tab(nv, cell_test: dict, days: list, prod=None) -> list:  # file TEST: gộp mọi thị trường (VND); prod=None → tất cả sản phẩm test
    pd={str(d):{"spend":0.0,"msg":0,"orders":0,"rev":0.0,"rev_gtc":0.0} for d in days}
    for k,c in cell_test.items():
        if k[0]!=nv or (prod is not None and k[2]!=prod) or k[3] not in pd: continue
        pd[k[3]]["spend"]+=c["spend"]; pd[k[3]]["msg"]+=c["msg"]; pd[k[3]]["orders"]+=c["orders"]; pd[k[3]]["rev"]+=c["cod"]/MONEY_DIV[k[1]]*RATE[k[1]]; pd[k[3]]["rev_gtc"]+=c["cod_gtc"]/MONEY_DIV[k[1]]*RATE[k[1]]
    rows=[H("Tiền (local)")]; tot={"spend":0,"msg":0,"orders":0,"rev":0,"rev_gtc":0}
    for d in days:
        c=pd[str(d)]; rows.append(vrow(d.strftime("%d/%m/%Y"),c))
        for kk in tot: tot[kk]+=c[kk]
    rows.append(vrow("TỔNG",tot)); return rows


def grand_tab(cell: dict, days: list) -> list:  # cộng marketer TRONG TEAM + TẤT CẢ thị trường, quy VND
    # 10/08: TỔNG chỉ gồm người TRONG TEAM. Trước đây cộng tất cả các ô nên đơn của
    # người ngoài team (nằm ở "(không gán)") bị tính vào số của team — lệch ~381tr/10 ngày.
    # 02/09 (CEO chốt): loại luôn cả ô "(không gán)". Từ khi Mai/Thế nghỉ, ô này ôm số
    # của người đã nghỉ nên cộng vào TỔNG là thổi số team lên (đo 01–02/09: +34,6tr).
    # TỔNG = đúng người đang chạy; tab "(không gán)" vẫn còn nguyên để CEO lọc tay.
    # Đây cũng là cách tin WhatsApp tính TỔNG TEAM — hai báo cáo nay khớp nhau.
    pd={str(d):{"spend":0.0,"msg":0,"orders":0,"rev":0.0,"rev_gtc":0.0} for d in days}
    for k,c in cell.items():
        if k[3] not in pd or k[0]==UNASSIGNED or str(k[0]).startswith(EXT_PREFIX): continue
        pd[k[3]]["spend"]+=c["spend"]; pd[k[3]]["msg"]+=c["msg"]; pd[k[3]]["orders"]+=c["orders"]; pd[k[3]]["rev"]+=c["cod"]/MONEY_DIV[k[1]]*RATE[k[1]]; pd[k[3]]["rev_gtc"]+=c["cod_gtc"]/MONEY_DIV[k[1]]*RATE[k[1]]
    rows=[H("Tiền (local)")]; tot={"spend":0,"msg":0,"orders":0,"rev":0,"rev_gtc":0}
    for d in days:
        c=pd[str(d)]; rows.append(vrow(d.strftime("%d/%m/%Y"),c))
        for kk in tot: tot[kk]+=c[kk]
    rows.append(vrow("TỔNG",tot)); return rows


def safe(t,used):
    t=re.sub(r'[\[\]\:\*\?/\\]',' ',str(t)).strip()[:90] or "(khác)"; b=t; i=2
    while t.lower() in used: t=f"{b} {i}"; i+=1
    used.add(t.lower()); return t


def markets_with_data(cells, loc=lambda k: True):
    """Các nước có số (chi tiêu hoặc đơn) trong tập ô, xếp Đài trước rồi theo thứ tự cấu hình."""
    found={k[1] for k,c in cells.items() if loc(k) and (c["spend"] or c["orders"] or c["msg"])}
    return [m for m in ALLM if m in found]


def market_file_tabs(emp, mkt, cell: dict, days: list) -> list:
    sub={k:v for k,v in cell.items() if k[0]==emp and k[1]==mkt}
    used=set(); used.add("tổng")
    tabs=[("Tổng",market_tab(sub,RATE[mkt],LOCALCUR[mkt],MONEY_DIV[mkt],days))]
    # Page không có gì trong tháng (0 tiền, 0 tin nhắn, 0 đơn) thì không mọc tab: camp đã tắt vẫn
    # để lại dòng 0 đồng trong dữ liệu Meta, thành tab trống như "Taiwan Savings Center".
    with_data={k[2] for k,c in sub.items() if c["spend"] or c["msg"] or c["orders"]}
    prods=sorted(with_data, key=lambda p:(-sum(sub[x]["spend"] for x in sub if x[2]==p), str(p)))
    for prod in prods:
        psub={k:v for k,v in sub.items() if k[2]==prod}; tabs.append((safe(prod,used),market_tab(psub,RATE[mkt],LOCALCUR[mkt],MONEY_DIV[mkt],days)))
    return tabs


# TỔNG TEAM THÁNG — gộp tất cả marketer: tab "Tổng" (all mkt) + 1 tab mỗi marketer. Tính LUÔN (không
# cần file Sheet) vì dashboard + bot đọc bảng này từ Postgres; có file Sheet thì ghi thêm lên Sheet.
def team_summary_tabs(cell: dict, days: list, has_file: set) -> list:
    used=set(); tabs=[("Tổng",grand_tab(cell,days))]; used.add("tổng")
    # Tab theo ROSTER trong talpha_rules.json (không phải TONG_MAP) — người mới vào team
    # là có tab ngay, không cần chờ tạo file Sheet riêng cho họ.
    # 01/09: người ĐÃ NGHỈ vẫn nằm trong roster (để đơn rơi rớt của họ không biến mất
    # vào "(không gán)") nhưng KHÔNG nên chiếm một tab trống trong báo cáo tháng sau.
    # Quy tắc: hiện tab nếu đang là thành viên chạy số (có file riêng ở một nước nào đó)
    # HOẶC tháng này còn phát sinh số. Người nghỉ mà hết đơn thì tab tự biến mất.
    for emp in DISPLAY:
        # Người đã nghỉ (unassign_marketers): KHÔNG tab — số của họ nằm ở "(không gán)".
        # Chặn tường minh ở đây để dù thư mục tháng còn file của họ cũng không mọc tab rỗng.
        if emp in UNASSIGN: continue
        if emp not in has_file and not any(k[0] == emp for k in cell): continue
        tabs.append((safe(emp,used),combined_tab(emp,cell,days)))
    # Người NGOÀI TEAM: KHÔNG có tab trong báo cáo của team (CEO chốt 10/08).
    # Số của họ vẫn bị loại khỏi tab Tổng nhờ EXT_PREFIX ở grand_tab() — chỉ là
    # không hiển thị nữa. Cần soi thì xem khối "NGOÀI TEAM" trên dashboard.
    # Đơn không gán được cho ai (không tag + ad không thuộc team) — hiện riêng, không giấu
    if any(k[0]==UNASSIGNED for k in cell): tabs.append((safe(UNASSIGNED,used),combined_tab(UNASSIGNED,cell,days)))
    # Ba thị trường (15/09/2026): từ HAI nước có số trở lên thì thêm mỗi nước một tab,
    # CHỈ người trong team như tab Tổng, tiền địa phương + tỷ giá của nước đó.
    market_list=markets_with_data(cell, lambda k: k[0]!=UNASSIGNED and not str(k[0]).startswith(EXT_PREFIX))
    if len(market_list)>1:
        for mkt in market_list:
            sub={k:v for k,v in cell.items() if k[1]==mkt and k[0]!=UNASSIGNED and not str(k[0]).startswith(EXT_PREFIX)}
            tabs.append((safe(_MARKET_NAMES[mkt],used),market_tab(sub,RATE[mkt],LOCALCUR[mkt],MONEY_DIV[mkt],days)))
    return tabs
