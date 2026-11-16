import os, sys, collections, datetime, time, re, json
# ── NGUỒN SỐ: Postgres (04/11/2026 — trước đó BigQuery) ── Số tính xong ghi vào bảng bao_cao_tab
# TRƯỚC; tab Tổng quan / P&L / Marketer của dashboard và bot Zalo đọc từ đó. File Google Sheet
# "TỔNG TEAM THÁNG n" + file riêng từng người là TUỲ CHỌN: có khoá Google (tài khoản máy) thì ghi
# thêm cho team xem như cũ, không có thì bỏ qua — báo cáo trên dashboard vẫn đủ.
# Khoá: env thắng → key runtime (máy chạy launchd) → key trong repo.
_KEY_CANDIDATES=[os.environ.get('GOOGLE_APPLICATION_CREDENTIALS'),
              os.path.expanduser('~/talpha_reports/runtime/bigquery_key.json'),
              os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),'bigquery_key.json')]
KEY=next((k for k in _KEY_CANDIDATES if k and os.path.exists(k)), None)
if KEY: os.environ['GOOGLE_APPLICATION_CREDENTIALS']=KEY
import calendar as _cal
# ── THÁNG ĐANG CHẠY + BỘ FILE CỦA CHÍNH THÁNG ĐÓ (Sỹ Anh chốt 01/10/2026) ──
# Ngày theo giờ VIỆT NAM (máy chủ để UTC: date.today() làm tháng lật lúc 07:00 sáng ngày 1).
# TALPHA_REPORT_MONTH=YYYY-MM: dựng lại một tháng đã qua (đủ ngày tháng đó).
# Bộ file: report_files.py — khai tay report_files/YYYY-MM.json, không có thì quét thư mục
# "Tháng N" trên Drive. Trước đây GRAND_KEY + <nước>_files.json là MỘT bộ ID cố định: 01/10/2026
# sang tháng không ai đổi ID, 16 file tháng 9 bị xoá sạch rồi ghi số tháng 10.
import report_files as _rf
import talpha_paths   # repo_dir(): gốc repo, để import sync.core (kho số, khoá kết nối)
import pancake_mess   # tin nhắn Nhật từ Pancake — Meta không báo mess ở Nhật (09/10/2026)
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
          f"(hoac chay Apps Script tao_thang_moi.gs), share thu muc goc cho service account.")
WRITE_SHEET=bool(KEY and FILE_SET)
FROM=_T.replace(day=1).isoformat(); TO=_T.isoformat()  # đầu tháng -> hôm nay (tháng cũ: -> cuối tháng)
# ── RULE CHUNG: đọc từ talpha_rules.json qua loader (golden-test 29/07 = 100% khớp bản cũ).
# Sửa rule (marketer/tỷ giá/thị trường/test) → sửa talpha_rules.json, KHÔNG sửa tại đây.
from talpha_rules import (RATE, LOCALCUR, MONEY_DIV, ALLM, MARKETS, SHOP2MKT, GTC_CAT, POS_TZ,
                          NUMID, norm_nv, norm_pos_nv, is_test, PRIMARY_MARKET,
                          DISPLAY, EXTERNAL_DISPLAY, norm_pos_external, norm_nv_external,
                          UNASSIGN, bucket_nv, campaign_market,
                          parse_camp_product, build_page_index, find_campaign_by_page,
                          build_page_tab_names, order_tab_name, sql_is_empty_order, MESS_PANCAKE, credited_marketer)
# SHOP2MKT + norm_pos_nv: import từ talpha_rules (xem trên)
def parse_camp(cn):
    p=[x.strip() for x in (cn or "").split("/")]
    if not p: return None,None,None
    # Tìm ô đầu tiên là tên thị trường (bất kể tiền tố như "Tặng/", "LADI/"...);
    # marketer là ô ngay SAU thị trường.
    mi=next((i for i,s in enumerate(p) if s.upper() in MARKETS), None)
    if mi is not None:
        # CHUẨN: NƯỚC/MARKETER/TỆPKHÁCH/MÃSANPHAM/TENTRANG/NGAY — marketer là ô ngay SAU nước.
        mkt=MARKETS[p[mi].upper()]
        nv=norm_nv(p[mi+1]) if mi+1<len(p) else None
    else:
        # KIỂU MỚI (chuẩn 09/2026, xem talpha_rules._camp_naming_note):
        #   MARKETER/TỆPKHÁCH/SANPHAM/TRANG/NGAY — KHÔNG ghi thị trường nữa vì chỉ còn một.
        # Nhánh này TRƯỚC ĐÂY return None: càng đặt tên đúng chuẩn mới thì càng bị vứt.
        # Ngày 10/09/2026 nó nuốt 17,6tr / 26,8tr tiền ads tháng 9 (66%) mà không ai thấy.
        # Quét ô đầu và ô hai để chịu được tiền tố lạ ("Tặng/", "LADI/").
        idx=next((i for i,s in enumerate(p[:2]) if norm_nv(s)), None)
        if idx is None: return None,None,None
        nv=norm_nv(p[idx]); mkt=PRIMARY_MARKET
    # Sản phẩm = ô thứ HAI sau marketer (ô ngay sau là tệp khách) — cả tên có lẫn không có ô
    # nước. Xem camp_san_pham trong talpha_rules.py: hai lỗi đọc ô sửa 16/09/2026 nằm ở đó.
    prod=parse_camp_product(cn)[0] or "(khác)"
    return mkt,nv,prod
# File theo nước của từng marketer: bộ file của tháng (report_files.py) — xem FILE_NUOC bên dưới.
# (MARKET_MAP gõ tay trong code — bộ 30 file GCC của team cũ — bỏ 09/09/2026.)
TOTALS_MAP={}  # Không còn file "TỔNG ADS" riêng từng người. Tổng MỌI nước của một người nằm ở
# tab của người đó trong file TỔNG TEAM.
# Vòng lặp file riêng + TEST bên dưới duyệt theo FILE_NUOC/TESTMAP, KHÔNG theo TONG_MAP nữa.
# File TỔNG TEAM THÁNG n của tháng đang chạy — lấy từ bộ file của tháng (report_files.py).
# write_file() xoá sạch tab rồi ghi đè, nên ID này TUYỆT ĐỐI không được là file của tháng khác.
GRAND_KEY=FILE_SET.get('grand') or ""
DAYS=[datetime.date(_T.year,_T.month,d) for d in range(1,_cal.monthrange(_T.year,_T.month)[1]+1)]  # đủ ngày tháng hiện tại
sys.path.insert(0, talpha_paths.repo_dir())
from sync.core.pg import get_connection
from sync.core.credentials import load_credentials_to_env
from psycopg.rows import namedtuple_row
from psycopg.types.json import Jsonb
load_credentials_to_env()   # token Pancake (mess Nhật) nhập ở /admin → Khoá kết nối — bảng api_credentials
pg=get_connection()
def Q(sql):
    """Chạy một câu SELECT, trả các dòng đọc được theo tên cột (r.campaign_name…)."""
    with pg.cursor(row_factory=namedtuple_row) as cur:
        return cur.execute(sql).fetchall()
cell=collections.defaultdict(lambda:{"spend":0.0,"msg":0,"pur":0,"orders":0,"cod":0.0,"cod_gtc":0.0})
# ── CAMP TEST (duyệt 06/07): campaign chứa từ "test/TEST/Test" = test sản phẩm →
# TÁCH khỏi mọi báo cáo doanh số (file thị trường + TỔNG marketer + TỔNG TEAM),
# gom vào 1 file Test riêng cho mỗi marketer (chung mọi thị trường, tab theo page).
from talpha_rules import NO_TEST_MARKETS  # is_test đã import ở đầu file; rule test nằm trong talpha_rules.json
from talpha_rules import RULES as _RULES
RULES_MARKETS={m: v for m, v in _RULES["markets"].items() if isinstance(v, dict)}
cell_test=collections.defaultdict(lambda:{"spend":0.0,"msg":0,"pur":0,"orders":0,"cod":0.0,"cod_gtc":0.0})
test_pages=set(); main_pages=set()  # page thuộc camp test / camp thường (để chia đơn không có ad_id)
# ── NỐI ĐƠN → CAMPAIGN THEO NGUỒN ĐƠN (Sỹ Anh chốt 17/09/2026) ──
# Đơn lấy từ POS → cột "Nguồn đơn" (tên page) → khớp ô tên page trong tên camp Meta → ra camp
# đó → ra marketer, tiền ads. Luật khớp và chọn camp khi một page chạy nhiều camp nằm ở
# tim_camp_theo_page (talpha_rules.py, có test). Chỉ mục lấy thêm 30 ngày trước đầu tháng:
# đơn đầu tháng hay đến từ camp chạy cuối tháng trước.
INDEX_ADS=Q(
    f"SELECT date, campaign_name, SUM(spend)::float8 spend FROM fb_ads_data "
    f"WHERE date BETWEEN DATE '{FROM}' - 30 AND DATE '{TO}' GROUP BY 1, 2")
PAGE_INDEX=build_page_index([(r.campaign_name, str(r.date), r.spend or 0) for r in INDEX_ADS])
# ── TAB THEO PAGE (Sỹ Anh chốt 17/09/2026) ── file riêng của từng người: MỖI PAGE MỘT TAB, đặt
# theo tên page. Tên lấy theo cách viết trên POS (cột Nguồn đơn) để tiền ads của camp và đơn của
# page rơi cùng một tab; page chưa có đơn trên POS thì lấy tên ghi trong camp. Xem tao_ten_tab_page.
POS_NAMES, CAMP_TAB = build_page_tab_names(
    [r.page_name for r in Q("SELECT page_name FROM sale_order") if r.page_name],
    [r.campaign_name for r in INDEX_ADS])
# ADS: spend/tin nhắn/purchases theo campaign (giữ nguyên) — tab = page của campaign.
# 20/08: camp không parse được (typo thị trường 'TAIWAIN', tên không theo format 'tt 20/7')
# trước đây bị bỏ IM LẶNG — spend biến mất khỏi mọi báo cáo mà không ai biết. Nay gom lại
# và in cảnh báo ở cuối (report_health đọc tail log → bot WA thấy được).
DROPPED=collections.defaultdict(float)
# 15/09/2026 — ba thị trường. Campaign KHÔNG ghi nước ở tên (tên cũ "Lộc/Philippine/…")
# vẫn tính Đài (Sỹ Anh chốt), nhưng gom lại để in cảnh báo: có Singapore, UAE rồi thì
# một campaign Singapore quên ghi "SG/" sẽ lặng lẽ chạy vào số của Đài.
MISSING_MARKET=collections.defaultdict(float)
for r in Q(f"SELECT date, campaign_name, SUM(spend)::float8 spend, SUM(messaging_conversations_started)::bigint msg, SUM(purchases)::bigint pur FROM fb_ads_data WHERE date BETWEEN '{FROM}' AND '{TO}' GROUP BY 1, 2"):
    mkt,nv,prod=parse_camp(r.campaign_name)
    if not mkt or not nv:
        _p=[x.strip() for x in (r.campaign_name or '').split('/')]
        _mi=next((i for i,s in enumerate(_p) if s.upper() in MARKETS), None)
        _slot=_p[_mi+1] if (_mi is not None and _mi+1<len(_p)) else ''
        if not norm_nv_external(_slot):   # người ngoài team là CỐ Ý loại, không cảnh báo
            DROPPED[r.campaign_name or '(tên rỗng)']+=r.spend or 0
        continue
    # Người đã nghỉ (unassign_marketers): ĐỔI Ô ĐÍCH sang "(không gán)", KHÔNG bỏ camp.
    # Đặt SAU nhánh DROPPED ở trên để spend còn sót của họ vẫn được đếm và soi được,
    # chỉ là không mang tên ai.
    if campaign_market(r.campaign_name)[1]=="mac_dinh": MISSING_MARKET[r.campaign_name or "(tên rỗng)"]+=r.spend or 0
    nv=bucket_nv(nv)
    t=is_test(r.campaign_name, mkt)
    pid=parse_camp_product(r.campaign_name)[2]
    if pid:
        (test_pages if t else main_pages).add(pid)
    tab=CAMP_TAB.get(r.campaign_name) or "(khác)"
    c=(cell_test if t else cell)[(nv,mkt,tab,str(r.date))]; c["spend"]+=r.spend or 0; c["pur"]+=r.pur or 0
    # Nước lấy tin nhắn từ Pancake (Nhật): BỎ số Meta (luôn 0 ở Nhật) — số thật cộng ở khối dưới.
    if mkt not in MESS_PANCAKE: c["msg"]+=r.msg or 0
# ── TIN NHẮN TỪ PANCAKE cho nước Meta không báo mess (Nhật, Sỹ Anh yêu cầu 09/10/2026) ──
# Hội thoại không ghi đến từ camp nào → gom theo page rồi gán cho camp tiêu nhiều nhất trên page đó
# trong ngày (ngày page không tiêu: camp gần nhất trước đó). Pancake hỏng → giữ 0, có CANH BAO.
PANCAKE_MESS={}
for _m in sorted(MESS_PANCAKE):
    _shop_label=RULES_MARKETS[_m]["shop_label"]
    _ad_rows=[(r.campaign_name, str(r.date), r.spend or 0) for r in INDEX_ADS]
    _is_market_camp=lambda cn,_m=_m: campaign_market(cn)[0]==_m
    _pages={parse_camp_product(cn)[1] for cn,_,_ in _ad_rows if _is_market_camp(cn)}
    _page_counts=pancake_mess.messages_by_page(_pages, _shop_label, FROM, TO, log=print)
    if _page_counts is None: continue
    _assigned,_unassigned=pancake_mess.assign_to_campaigns(_page_counts, _ad_rows, _is_market_camp, lambda cn: parse_camp_product(cn)[1])
    _n=0
    for (_cn,_d),_k in _assigned.items():
        if not (FROM <= _d <= TO): continue
        _mk,_nv,_=parse_camp(_cn)
        if not _mk or not _nv: continue
        _c=(cell_test if is_test(_cn,_mk) else cell)[(bucket_nv(_nv),_mk,CAMP_TAB.get(_cn) or "(khác)",_d)]
        _c["msg"]+=_k; _n+=_k
    PANCAKE_MESS[_m]=(_n,len(_page_counts),_unassigned)
    print(f"PANCAKE MESS {_shop_label}: {_n} tin nhan tu {len(_page_counts)} page" + (f" · KHONG GAN DUOC (page chua co camp): {_unassigned}" if _unassigned else ""))
# ad_id → chủ campaign (marketer) — dùng cho FALLBACK đơn không tag (duyệt 06/07).
# X9 (06/08): POS không phải lúc nào cũng ghi ad_id vào ô `ad_id` — 999 đơn/10.634 (9,4%)
# mang ADSET id ở ô đó. Nạp CẢ adset vào chung bảng tra; ad_id nạp SAU để đè lên adset
# nếu trùng (bản ad chính xác hơn). Trượt cả hai mới coi là không gán được.
ad2nv={}; test_ads=set(); ad2camp={}   # ad/adset → tên campaign — dự phòng khi nguồn đơn không khớp
for _tbl,_col in (("fb_adset_data","adset_id"), ("fb_ads_data","ad_id")):
    for r in Q(f"SELECT DISTINCT {_col} ad_id, campaign_name FROM {_tbl} WHERE date BETWEEN '{FROM}' AND '{TO}' AND {_col} IS NOT NULL"):
        _m,_nv,_p=parse_camp(r.campaign_name)
        # Người đã nghỉ không vào bảng tra — nếu không, đơn không tag lại theo ad_id
        # chui ngược vào ô của họ, đúng thứ vừa bỏ đi.
        if _nv and _nv not in UNASSIGN and r.ad_id: ad2nv[r.ad_id]=_nv
        if r.ad_id and is_test(r.campaign_name, _m): test_ads.add(r.ad_id)
        if r.ad_id: ad2camp[r.ad_id]=r.campaign_name
purely_test_pages=test_pages-main_pages  # page CHỈ chạy camp test → đơn không ad_id trên page đó = test
# ĐƠN HÀNG — MARKETER: ưu tiên TAG marketer trong POS (JSON $.name) (rule CEO, không đổi).
# Đơn KHÔNG tag → chủ CAMPAIGN nối được theo nguồn đơn → chủ campaign của quảng cáo (ad_id).
# Vẫn không gán được → gom "(không gán)" (chỉ hiện ở file TỔNG THÁNG, không bỏ lặng lẽ).
UNASSIGNED="(không gán)"
# Tiền tố đánh dấu người ngoài team — để grand_tab() loại khỏi TỔNG mà vẫn có tab riêng.
EXT_PREFIX="~ngoai~"
ORDERS=Q(f"""SELECT id, ngay_theo_mui(inserted_at,'{POS_TZ}') d,
    safe_json(marketer) ->> 'name' nm, shop_label, page_id, page_name, seller_name,
    ad_id, adset_id, status_name,
    COALESCE(cod,0) cod, CASE WHEN status_category='{GTC_CAT}' THEN COALESCE(cod,0) ELSE 0 END cod_gtc
  FROM sale_order
  WHERE ngay_theo_mui(inserted_at,'{POS_TZ}') BETWEEN '{FROM}' AND '{TO}' AND status_category NOT IN ('HUY','DON_THO')
    AND NOT {sql_is_empty_order()}
  ORDER BY d DESC, shop_label, id""")
# Đơn TRỐNG (không sản phẩm, 0 tiền) KHÔNG tính vào số đơn — Sỹ Anh chốt 17/09/2026, xem la_don_trong.
# Không bỏ lặng lẽ: đếm lại để in cuối log.
EMPTY_ORDERS=Q(f"""SELECT shop_label, COUNT(*) n FROM sale_order
  WHERE ngay_theo_mui(inserted_at,'{POS_TZ}') BETWEEN '{FROM}' AND '{TO}' AND status_category NOT IN ('HUY','DON_THO')
    AND {sql_is_empty_order()} GROUP BY 1 ORDER BY 1""")
MATCH_COUNTS=collections.Counter()
for r in ORDERS:
    mkt=SHOP2MKT.get((r.shop_label or "").upper())
    if not mkt: continue
    cqc=ad2camp.get(r.ad_id or "") or ad2camp.get(r.adset_id or "")
    # Đơn shop nước nào chỉ theo camp nước đó — cả khi nối theo page lẫn khi dự phòng theo quảng cáo.
    # 17/09/2026: đơn Đài #381 (0 TWD, không tag) mang quảng cáo + page của camp Singapore của Lộc →
    # Lộc ngày 15/09 ra 3 đơn, POS 2.
    ad_same_market = bool(cqc) and campaign_market(cqc)[0]==mkt
    if not ad_same_market: cqc=None
    camp,match_type=find_campaign_by_page(r.page_name, str(r.d), PAGE_INDEX, cqc, nuoc=mkt)   # chỉ camp cùng nước với shop
    MATCH_COUNTS[match_type]+=1
    nv_camp=parse_camp(camp)[1] if camp else None
    # Người NGOÀI TEAM chạy chung TKQC + bán chung shop POS. Nhận diện TRƯỚC bậc 2 để
    # camp/ad_id không đẩy đơn của họ sang người trong team.
    nv = norm_pos_nv(r.nm)
    if not nv:
        ex = norm_pos_external(r.nm)
        nv = EXT_PREFIX + ex if ex else (nv_camp or (ad_same_market and (ad2nv.get(r.ad_id or "") or ad2nv.get(r.adset_id or ""))) or UNASSIGNED)
    prod = order_tab_name(r.page_name, POS_NAMES) or CAMP_TAB.get(camp or cqc or "") or "(khác)"   # tab = page
    # Đã nghỉ → "(không gán)" (bucket_nv), kể cả khi tag POS ghi đúng tên họ.
    nv=bucket_nv(nv)
    # Đơn từ camp TEST (ad_id thuộc camp test, hoặc page chỉ chạy test) → tách khỏi báo cáo doanh số.
    # Thị trường miễn rule test (Taiwan) → đơn LUÔN tính thật.
    t=(mkt not in NO_TEST_MARKETS) and ((r.ad_id in test_ads) or (str(r.page_id) in purely_test_pages))
    c=(cell_test if t else cell)[(nv,mkt,prod,str(r.d))]; c["orders"]+=1; c["cod"]+=r.cod or 0; c["cod_gtc"]+=r.cod_gtc or 0
# ── LẤN NƯỚC → NGƯỜI CẦM NƯỚC (Sỹ Anh chốt 10/10/2026) ── tiền ads, tin nhắn, đơn, doanh số của
# một người ở nước thuộc team khác (camp cũ chưa đổi tên) chuyển cho người cầm nước đó: Đài →
# Sỹ Anh (từ 03/11/2026, trước là Thương), Singapore → Thái, UAE → Lộc (talpha_rules.credited_marketer).
# Số của người đã ngừng chạy (Thương từ 01/10/2026) cũng chuyển theo ngày. Làm SAU khi gom đủ ads + đơn,
# TRƯỚC khi ghi file — Sheet, file riêng và số cho bot Zalo cùng một cách tính.
def _reassign_cross_market(cells):
    merged=collections.defaultdict(lambda:{"spend":0.0,"msg":0,"pur":0,"orders":0,"cod":0.0,"cod_gtc":0.0}); cross=collections.defaultdict(lambda:[0.0,0])
    for (nv,mkt,tab,d),c in cells.items():
        nv2=credited_marketer(nv,mkt,d)
        if nv2!=nv: cross[(nv,nv2,mkt)][0]+=c["spend"]; cross[(nv,nv2,mkt)][1]+=c["orders"]
        x=merged[(nv2,mkt,tab,d)]
        for kk in x: x[kk]+=c.get(kk,0)
    return merged,cross
cell,_CROSS_MARKET=_reassign_cross_market(cell); cell_test,_=_reassign_cross_market(cell_test)
for (_a,_b,_m),(_s,_o) in sorted(_CROSS_MARKET.items()):
    print(f"LAN NUOC: {DISPLAY.get(_a,_a)} chay {_m} → tinh cho {DISPLAY.get(_b,_b)}: {_s:,.0f} d ads · {_o} don")
def H(local): return ["Ngày","TỔNG TIỀN ADS","SỐ TIN NHẮN","Giá Tiền/TN","CPO","Tỷ lệ chốt","Số đơn",local,"Tỉ giá","Doanh Số","DS Giao TC","% Ads/DT","% Ads/DT giao","TB đơn"]
def drow(day,c,rate,div):
    # X13: `div` là số chia của CHÍNH thị trường đó (MONEY_DIV) — GCC 100, Đài 1.
    # Gõ thẳng /100 ở đây là làm tiền Đài tụt 100 lần trên Sheet.
    s=c["spend"];m=c["msg"];o=c["orders"];rev=c["cod"]/div*rate;loc=c["cod"]/div;gtc=c["cod_gtc"]/div*rate
    return [day,round(s),m,round(s/m) if m else 0,round(s/o) if o else 0,round(o/m*100,2) if m else 0,o,round(loc),rate,round(rev),round(gtc),round(s/rev*100,2) if rev else 0,round(s/gtc*100,2) if gtc else 0,round(rev/o) if o else 0]
def market_tab(cells,rate,local,div):
    pd={str(d):{"spend":0.0,"msg":0,"orders":0,"cod":0.0,"cod_gtc":0.0} for d in DAYS}
    for k,c in cells.items():
        if k[3] in pd:
            for kk in("spend","msg","orders","cod","cod_gtc"): pd[k[3]][kk]+=c[kk]
    rows=[H(local)]; tot={"spend":0,"msg":0,"orders":0,"cod":0,"cod_gtc":0}
    for d in DAYS:
        c=pd[str(d)]; rows.append(drow(d.strftime("%d/%m/%Y"),c,rate,div))
        for kk in tot: tot[kk]+=c[kk]
    rows.append(drow("TỔNG",tot,rate,div)); return rows
def vrow(day,c):
    s=c["spend"];m=c["msg"];o=c["orders"];rev=c["rev"];gtc=c["rev_gtc"]
    return [day,round(s),m,round(s/m) if m else 0,round(s/o) if o else 0,round(o/m*100,2) if m else 0,o,"","",round(rev),round(gtc),round(s/rev*100,2) if rev else 0,round(s/gtc*100,2) if gtc else 0,round(rev/o) if o else 0]
def combined_tab(nv):  # cộng tất cả thị trường, VND
    pd={str(d):{"spend":0.0,"msg":0,"orders":0,"rev":0.0,"rev_gtc":0.0} for d in DAYS}
    for k,c in cell.items():
        if k[0]!=nv or k[3] not in pd: continue
        pd[k[3]]["spend"]+=c["spend"]; pd[k[3]]["msg"]+=c["msg"]; pd[k[3]]["orders"]+=c["orders"]; pd[k[3]]["rev"]+=c["cod"]/MONEY_DIV[k[1]]*RATE[k[1]]; pd[k[3]]["rev_gtc"]+=c["cod_gtc"]/MONEY_DIV[k[1]]*RATE[k[1]]
    rows=[H("Tiền (local)")]; tot={"spend":0,"msg":0,"orders":0,"rev":0,"rev_gtc":0}
    for d in DAYS:
        c=pd[str(d)]; rows.append(vrow(d.strftime("%d/%m/%Y"),c))
        for kk in tot: tot[kk]+=c[kk]
    rows.append(vrow("TỔNG",tot)); return rows
def test_tab(nv, prod=None):  # file TEST: gộp mọi thị trường (VND); prod=None → tất cả sản phẩm test
    pd={str(d):{"spend":0.0,"msg":0,"orders":0,"rev":0.0,"rev_gtc":0.0} for d in DAYS}
    for k,c in cell_test.items():
        if k[0]!=nv or (prod is not None and k[2]!=prod) or k[3] not in pd: continue
        pd[k[3]]["spend"]+=c["spend"]; pd[k[3]]["msg"]+=c["msg"]; pd[k[3]]["orders"]+=c["orders"]; pd[k[3]]["rev"]+=c["cod"]/MONEY_DIV[k[1]]*RATE[k[1]]; pd[k[3]]["rev_gtc"]+=c["cod_gtc"]/MONEY_DIV[k[1]]*RATE[k[1]]
    rows=[H("Tiền (local)")]; tot={"spend":0,"msg":0,"orders":0,"rev":0,"rev_gtc":0}
    for d in DAYS:
        c=pd[str(d)]; rows.append(vrow(d.strftime("%d/%m/%Y"),c))
        for kk in tot: tot[kk]+=c[kk]
    rows.append(vrow("TỔNG",tot)); return rows
def grand_tab():  # cộng marketer TRONG TEAM + TẤT CẢ thị trường, quy VND
    # 10/08: TỔNG chỉ gồm người TRONG TEAM. Trước đây cộng tất cả các ô nên đơn của
    # người ngoài team (nằm ở "(không gán)") bị tính vào số của team — lệch ~381tr/10 ngày.
    # 02/09 (CEO chốt): loại luôn cả ô "(không gán)". Từ khi Mai/Thế nghỉ, ô này ôm số
    # của người đã nghỉ nên cộng vào TỔNG là thổi số team lên (đo 01–02/09: +34,6tr).
    # TỔNG = đúng người đang chạy; tab "(không gán)" vẫn còn nguyên để CEO lọc tay.
    # Đây cũng là cách tin WhatsApp tính TỔNG TEAM — hai báo cáo nay khớp nhau.
    pd={str(d):{"spend":0.0,"msg":0,"orders":0,"rev":0.0,"rev_gtc":0.0} for d in DAYS}
    for k,c in cell.items():
        if k[3] not in pd or k[0]==UNASSIGNED or str(k[0]).startswith(EXT_PREFIX): continue
        pd[k[3]]["spend"]+=c["spend"]; pd[k[3]]["msg"]+=c["msg"]; pd[k[3]]["orders"]+=c["orders"]; pd[k[3]]["rev"]+=c["cod"]/MONEY_DIV[k[1]]*RATE[k[1]]; pd[k[3]]["rev_gtc"]+=c["cod_gtc"]/MONEY_DIV[k[1]]*RATE[k[1]]
    rows=[H("Tiền (local)")]; tot={"spend":0,"msg":0,"orders":0,"rev":0,"rev_gtc":0}
    for d in DAYS:
        c=pd[str(d)]; rows.append(vrow(d.strftime("%d/%m/%Y"),c))
        for kk in tot: tot[kk]+=c[kk]
    rows.append(vrow("TỔNG",tot)); return rows
def safe(t,used):
    t=re.sub(r'[\[\]\:\*\?/\\]',' ',str(t)).strip()[:90] or "(khác)"; b=t; i=2
    while t.lower() in used: t=f"{b} {i}"; i+=1
    used.add(t.lower()); return t
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
if WRITE_SHEET:
    import gspread
    from google.oauth2.service_account import Credentials
    from gspread.exceptions import APIError, SpreadsheetNotFound
    gc=gspread.authorize(Credentials.from_service_account_file(KEY,scopes=['https://www.googleapis.com/auth/spreadsheets','https://www.googleapis.com/auth/drive']))
else:
    class APIError(Exception): pass
    class SpreadsheetNotFound(Exception): pass
def do(fn):
    for a in range(7):
        try: return fn()
        except APIError as e:
            es=str(e)
            # 20/08: thêm '-1]'/'DOCTYPE' — Google có lúc trả trang HTML lỗi thay vì JSON
            # (log 09/08: APIError [-1]: <!DOCTYPE html>), bản cũ không retry → chết cả chain.
            if any(x in es for x in ('429','500','502','503','RATE','unavailable','Internal','[-1]','DOCTYPE')): time.sleep(15); continue
            raise
    return fn()
# TALPHA_FORMAT_DRY=1: chỉ IN file nào sẽ nhận tab nào, KHÔNG mở Sheets — để soát bố cục
# bằng số thật trước khi đổi cách ghi (đổi bố cục là write_file xoá sạch tab cũ của file).
DRY=os.environ.get("TALPHA_FORMAT_DRY")=="1"
def write_file(key, tabs, title=None, month_suffix=False):
    if DRY:
        print(f"    [DRY] {key}: {len(tabs)} tab — " + " · ".join(f"{t} ({rows[-1][6]} đơn)" for t,rows in tabs)); return
    # 20/08 FIX: `sh.sheet1` CŨNG gọi API (fetch_sheet_metadata). Bản cũ để nó NGOÀI do()
    # nên 1 lần Google trả 503 là chết cả chain → file thị trường mang số mới, file TỔNG
    # mang số cũ (báo cáo nửa vời, đã xảy ra 18/344 vòng). Nay bọc chung trong do().
    sh, first = do(lambda: (lambda s: (s, s.sheet1))(gc.open_by_key(key))); nr=len(tabs[0][1])
    # Tên file tự đặt theo tháng đang chạy — trước đây gõ tay nên tháng 8 vẫn ghi
    # "THÁNG 7" suốt (CEO phát hiện 10/08).
    # month_suffix: giữ nguyên tên gốc, chỉ thay đuôi ' T<tháng>' (file [Test] mỗi người
    # đặt tên một kiểu — Loc/Chu Thuý/Nhung — nên KHÔNG dựng lại tên từ đầu).
    if month_suffix and not title:
        title = re.sub(r'\s*[Tt]\d{1,2}$', '', sh.title).strip() + f' T{_T.month}'
    if title and sh.title != title:
        try: do(lambda: sh.update_title(title)); print(f'    đổi tên file → {title}')
        except Exception as e: print(f'    (không đổi được tên file: {e})')
    ex=do(lambda: sh.worksheets())
    dr=[{"deleteSheet":{"sheetId":w.id}} for w in ex[1:]]
    if dr: do(lambda: sh.batch_update({"requests":dr}))
    # 01/09 FIX: lưới phải ĐÚNG nr dòng, không phải nr+2. Bản cũ chừa 2 dòng thừa mà
    # values_batch_update chỉ ghi đè tới dòng nr → tháng ngắn hơn tháng trước thì dòng
    # TỔNG của tháng cũ SỐNG SÓT ngay dưới dòng TỔNG mới. Tháng 9 (30 ngày) kế tháng 8
    # (31 ngày) là dính: dòng 33 còn nguyên tổng tháng 8 trong cả 46 file.
    # freq() format tới hết dòng nr (dòng đỏ ở t=nr-1) nên rowCount=nr là vừa đủ.
    rq=[{"updateSpreadsheetProperties":{"properties":{"locale":"vi_VN"},"fields":"locale"}},{"updateSheetProperties":{"properties":{"sheetId":first.id,"title":tabs[0][0],"gridProperties":{"rowCount":nr,"columnCount":14}},"fields":"title,gridProperties"}}]
    for t,_ in tabs[1:]: rq.append({"addSheet":{"properties":{"title":t,"gridProperties":{"rowCount":nr,"columnCount":14}}}})
    do(lambda: sh.batch_update({"requests":rq}))
    do(lambda: sh.values_batch_update({"valueInputOption":"RAW","data":[{"range":f"'{t}'!A1","values":rows} for t,rows in tabs]}))
    wm={w.title:w.id for w in do(lambda: sh.worksheets())}
    fr=[]
    for t,_ in tabs: fr+=freq(wm[t],nr)
    do(lambda: sh.batch_update({"requests":fr}))
n=0
# 8 TỔNG files
for emp,key in TOTALS_MAP.items():
    used=set(); tabs=[("Tổng",combined_tab(emp))]; used.add("tổng")
    for mkt in ALLM:
        sub={k:v for k,v in cell.items() if k[0]==emp and k[1]==mkt}
        tabs.append((safe(mkt.upper(),used),market_tab(sub,RATE[mkt],LOCALCUR[mkt],MONEY_DIV[mkt])))
    # title: trước đây chỉ file GRAND được đổi tên → 7 file này kẹt tên 'THÁNG 7' suốt tháng 8.
    write_file(key,tabs,title=f"TỔNG ADS THÁNG {_T.month}"); n+=1; print(f"[{n}] TỔNG {emp}: {len(tabs)} tab"); time.sleep(1.0)
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
_MARKET_NAMES={m: v.get("display", m) for m, v in RULES_MARKETS.items()}
def markets_with_data(cells, loc=lambda k: True):
    """Các nước có số (chi tiêu hoặc đơn) trong tập ô, xếp Đài trước rồi theo thứ tự cấu hình."""
    found={k[1] for k,c in cells.items() if loc(k) and (c["spend"] or c["orders"] or c["msg"])}
    return [m for m in ALLM if m in found]
def market_file_tabs(emp, mkt):
    sub={k:v for k,v in cell.items() if k[0]==emp and k[1]==mkt}
    used=set(); used.add("tổng")
    tabs=[("Tổng",market_tab(sub,RATE[mkt],LOCALCUR[mkt],MONEY_DIV[mkt]))]
    # Page không có gì trong tháng (0 tiền, 0 tin nhắn, 0 đơn) thì không mọc tab: camp đã tắt vẫn
    # để lại dòng 0 đồng trong dữ liệu Meta, thành tab trống như "Taiwan Savings Center".
    with_data={k[2] for k,c in sub.items() if c["spend"] or c["msg"] or c["orders"]}
    prods=sorted(with_data, key=lambda p:(-sum(sub[x]["spend"] for x in sub if x[2]==p), str(p)))
    for prod in prods:
        psub={k:v for k,v in sub.items() if k[2]==prod}; tabs.append((safe(prod,used),market_tab(psub,RATE[mkt],LOCALCUR[mkt],MONEY_DIV[mkt])))
    return tabs
LOST_FILES=[]
for mkt in ALLM:
    for emp,key in MARKET_FILES[mkt].items():
        if not key: continue
        tabs=market_file_tabs(emp,mkt)
        # File đã bị xoá HẲN (thùng rác Drive tự dọn sau 30 ngày) hoặc bị gỡ quyền: bỏ qua riêng
        # file đó, KHÔNG làm chết cả vòng — nổ ở đây là file TỔNG TEAM ghi phía sau đứng số, và
        # tin Zalo 8h30 đọc đúng file đó. Dính thật 16/09/2026: thư mục ANH nằm trong thùng rác
        # từ trước, job vẫn ghi vào file trong đó mỗi giờ — tới ngày thùng rác dọn là nổ.
        try: write_file(key,tabs)
        except SpreadsheetNotFound:
            LOST_FILES.append((emp,mkt,key)); print(f"[SKIP] FILE {emp}/{mkt}: không mở được {key} — đã xoá hẳn hoặc mất quyền"); continue
        n+=1; print(f"[{n}] FILE {emp}/{mkt}: {len(tabs)} tab — https://docs.google.com/spreadsheets/d/{key}")
# Người CÓ SỐ ở một nước mà chưa có file nước đó: số KHÔNG mất — vẫn nằm trong file TỔNG TEAM
# (tab của người đó + tab nước) — nhưng thư mục riêng của họ thiếu file. Cảnh báo ở cuối log.
MISSING_FILES=[] if not WRITE_SHEET else sorted({(k[0],k[1]) for k,c in cell.items()
                   if (c["spend"] or c["orders"] or c["msg"]) and k[0] in DISPLAY and k[0] not in UNASSIGN
                   and not MARKET_FILES.get(k[1],{}).get(k[0])})
HAS_FILE={emp for m in MARKET_FILES.values() for emp,key in m.items() if key}
# TỔNG TEAM THÁNG — gộp tất cả marketer: tab "Tổng" (all mkt) + 1 tab mỗi marketer. Tính LUÔN (không
# cần file Sheet) vì dashboard + bot đọc bảng này từ Postgres; có file Sheet thì ghi thêm lên Sheet.
def team_summary_tabs():
    used=set(); tabs=[("Tổng",grand_tab())]; used.add("tổng")
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
        if emp not in HAS_FILE and not any(k[0] == emp for k in cell): continue
        tabs.append((safe(emp,used),combined_tab(emp)))
    # Người NGOÀI TEAM: KHÔNG có tab trong báo cáo của team (CEO chốt 10/08).
    # Số của họ vẫn bị loại khỏi tab Tổng nhờ EXT_PREFIX ở grand_tab() — chỉ là
    # không hiển thị nữa. Cần soi thì xem khối "NGOÀI TEAM" trên dashboard.
    # Đơn không gán được cho ai (không tag + ad không thuộc team) — hiện riêng, không giấu
    if any(k[0]==UNASSIGNED for k in cell): tabs.append((safe(UNASSIGNED,used),combined_tab(UNASSIGNED)))
    # Ba thị trường (15/09/2026): từ HAI nước có số trở lên thì thêm mỗi nước một tab,
    # CHỈ người trong team như tab Tổng, tiền địa phương + tỷ giá của nước đó.
    market_list=markets_with_data(cell, lambda k: k[0]!=UNASSIGNED and not str(k[0]).startswith(EXT_PREFIX))
    if len(market_list)>1:
        for mkt in market_list:
            sub={k:v for k,v in cell.items() if k[1]==mkt and k[0]!=UNASSIGNED and not str(k[0]).startswith(EXT_PREFIX)}
            tabs.append((safe(_MARKET_NAMES[mkt],used),market_tab(sub,RATE[mkt],LOCALCUR[mkt],MONEY_DIV[mkt])))
    return tabs
SUMMARY_TABS=team_summary_tabs()
# ── GHI POSTGRES (bao_cao_tab) — nguồn của tab Tổng quan / P&L / Marketer và bot Zalo ── Thay trọn
# tháng trong MỘT transaction: người đang xem thấy bản cũ tới lúc COMMIT, lỗi giữa chừng thì giữ bản
# cũ. Hàng ghi ĐÚNG như lên Sheet (hàng đầu tiêu đề, hàng cuối TỔNG) — route đọc theo cùng bố cục.
if not DRY:
    _month=f"{_T.year}-{_T.month:02d}"
    with pg.transaction():
        pg.execute("DELETE FROM bao_cao_tab WHERE thang = %s AND tep = 'tong_team'", (_month,))
        for _i,(_tab_name,_rows) in enumerate(SUMMARY_TABS):
            pg.execute("INSERT INTO bao_cao_tab (thang, tep, thu_tu, ten_tab, hang) VALUES (%s, 'tong_team', %s, %s, %s)",
                       (_month, _i, _tab_name, Jsonb(_rows)))
    print(f"POSTGRES bao_cao_tab {_month}: {len(SUMMARY_TABS)} tab — " + " · ".join(t for t,_ in SUMMARY_TABS))
if WRITE_SHEET and GRAND_KEY and not GRAND_KEY.endswith("placeholder"):
    write_file(GRAND_KEY,SUMMARY_TABS,title=f"TỔNG TEAM THÁNG {_T.month}"); n+=1; print(f"[{n}] GRAND TỔNG THÁNG: {len(SUMMARY_TABS)} tab")
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
    _report_month=f"{_T.year}-{_T.month:02d}"
    pg.execute("INSERT INTO market_monthly_reports (month, content, written_at) VALUES (%s, %s, now()) "
               "ON CONFLICT (month) DO UPDATE SET content = EXCLUDED.content, written_at = now()",
               (_report_month, Jsonb({"thang":_report_month,"ghi_luc":datetime.datetime.utcnow().isoformat()+"Z",
                                   "khong_gan":UNASSIGNED,"nuoc":_by_market})))
    print(f"BAN NUOC: market_monthly_reports {_report_month} ({', '.join(sorted(_by_market))})")
except Exception as _e:
    print(f"CANH BAO: khong ghi duoc so theo nuoc cho bot Zalo: {_e}")
# ── FILE TEST mỗi marketer (chung mọi thị trường, tab theo page) ──
# ID từ bộ file của tháng: file có chữ TEST trong tên, người theo thư mục/tên file.
TESTMAP=dict(FILE_SET.get('test') or {})
for emp in (sorted({k[0] for k in cell_test} | set(TESTMAP)) if WRITE_SHEET else []):
    sub={k:v for k,v in cell_test.items() if k[0]==emp}
    if not sub: continue
    key=TESTMAP.get(emp)
    if not key:
        # SA KHÔNG tự tạo được file (Google chặn quota) — người tạo sheet có chữ TEST trong thư
        # mục của người đó ở tháng này. Thiếu file thì bỏ qua người này, KHÔNG làm chết cả chain.
        print(f"[SKIP] TEST {emp}: thư mục 'Tháng {_T.month}' chưa có file TEST của người này — số test của họ chưa ghi.")
        continue
    prods=sorted({k[2] for k in sub}, key=lambda p:(-sum(sub[x]["spend"] for x in sub if x[2]==p), str(p)))
    used=set(); tabs=[("Tổng",test_tab(emp))]; used.add("tổng")
    for prod in prods: tabs.append((safe(prod,used),test_tab(emp,prod)))
    write_file(key,tabs,month_suffix=True); n+=1
    print(f"[{n}] TEST {emp}: {len(tabs)} tab — https://docs.google.com/spreadsheets/d/{key}")
print("ALL DONE", n)
print("NOI NGUON DON: " + " · ".join(f"{k} {v}" for k,v in sorted(MATCH_COUNTS.items())))
if EMPTY_ORDERS:
    print("BO DON TRONG (khong san pham, 0 tien — khong tinh vao so don): " + " · ".join(f"{r.shop_label} {r.n}" for r in EMPTY_ORDERS))
if LOST_FILES:
    print(f"CANH BAO: {len(LOST_FILES)} file rieng KHONG MO DUOC (da xoa han hoac mat quyen) — kiem thu muc 'Tháng {_T.month}' tren Drive.")
    for _e,_m,_k in LOST_FILES:
        print(f"    {_e:8s} {_m:10s} {_k}")
if MISSING_FILES:
    print(f"CANH BAO: {len(MISSING_FILES)} cap nguoi/nuoc CO SO nhung CHUA CO FILE rieng — so van nam trong TONG TEAM. Tao sheet '<NUOC> T{_T.month}' trong thu muc nguoi do o 'Tháng {_T.month}' — vong sau tu thay.")
    for _e,_m in MISSING_FILES:
        print(f"    {_e:8s} {_m:10s}")
if MISSING_MARKET:
    _tn=sum(MISSING_MARKET.values())
    print(f"CANH BAO: {len(MISSING_MARKET)} campaign KHONG GHI NUOC o dau ten — {_tn:,.0f} d dang tinh ve {PRIMARY_MARKET}. Doi ten thanh TW/… SG/… AE/… JP/… de khoi nham nuoc.")
    for _c,_s in sorted(MISSING_MARKET.items(), key=lambda x:-x[1])[:10]:
        print(f"    {_s:>12,.0f} d | {_c[:90]}")
if DROPPED:
    _ts=sum(DROPPED.values())
    print(f"CANH BAO: {len(DROPPED)} campaign KHONG VAO BAO CAO — {_ts:,.0f} d bi roi (ten camp sai format/typo thi truong)")
    for _c,_s in sorted(DROPPED.items(), key=lambda x:-x[1])[:10]:
        print(f"    {_s:>12,.0f} d | {_c[:90]}")
if WRITE_SHEET and not GRAND_KEY:
    # Dashboard + bot vẫn có số (đọc Postgres) — chỉ là team chưa có file Sheet tháng này để xem.
    print(f"CANH BAO: thu muc 'Tháng {_T.month}' CHUA CO file 'TỔNG TEAM THÁNG {_T.month}' — chua ghi Sheet tong thang nay (dashboard van du so).")
