"""
Đọc số tháng từ kho số Postgres (fb_ads_data, fb_adset_data, sale_order) và gom vào các ô
(marketer, nước, tab theo page, ngày) cho vòng ghi báo cáo tháng — format_all.py.

Tách khỏi format_all.py (16/11/2026 — file đó chạy thẳng ở top-level, 532 dòng). Code chuyển nguyên
văn, chỉ gom vào hàm; chú thích nghiệp vụ đi theo code. File này CHỈ ĐỌC kho số, không ghi gì.
Một ô = {"spend", "msg", "pur", "orders", "cod", "cod_gtc"} — tiền POS còn THÔ (chưa chia số chia,
chưa nhân tỷ giá); report_tables.py quy đổi khi dựng bảng.
"""
import collections
from dataclasses import dataclass
from functools import partial

from psycopg.rows import namedtuple_row

import pancake_mess   # tin nhắn Nhật từ Pancake — Meta không báo mess ở Nhật (09/10/2026)
# ── RULE CHUNG: đọc từ talpha_rules.json qua loader (golden-test 29/07 = 100% khớp bản cũ).
# Sửa rule (marketer/tỷ giá/thị trường/test) → sửa talpha_rules.json, KHÔNG sửa tại đây.
from talpha_rules import (MARKETS, SHOP2MKT, GTC_CAT, POS_TZ, NO_TEST_MARKETS, RULES as _RULES,
                          norm_nv, norm_pos_nv, is_test, PRIMARY_MARKET, DISPLAY,
                          norm_pos_external, norm_nv_external, UNASSIGN, bucket_nv, campaign_market,
                          parse_camp_product, build_page_index, find_campaign_by_page,
                          build_page_tab_names, order_tab_name, sql_is_empty_order, MESS_PANCAKE,
                          credited_marketer)

RULES_MARKETS = {m: v for m, v in _RULES["markets"].items() if isinstance(v, dict)}
# ĐƠN HÀNG — MARKETER: ưu tiên TAG marketer trong POS (JSON $.name) (rule CEO, không đổi).
# Đơn KHÔNG tag → chủ CAMPAIGN nối được theo nguồn đơn → chủ campaign của quảng cáo (ad_id).
# Vẫn không gán được → gom "(không gán)" (chỉ hiện ở file TỔNG THÁNG, không bỏ lặng lẽ).
UNASSIGNED = "(không gán)"
# Tiền tố đánh dấu người ngoài team — để grand_tab() loại khỏi TỔNG mà vẫn có tab riêng.
EXT_PREFIX = "~ngoai~"


@dataclass
class ReportCells:
    """Số đã gom của một tháng: ô thường, ô camp TEST, và các bộ đếm in cảnh báo cuối log."""
    cell: dict
    cell_test: dict
    match_counts: collections.Counter
    empty_orders: list
    dropped: dict
    missing_market: dict
    pancake_mess: dict


def run_select(pg, sql: str) -> list:
    """Chạy một câu SELECT, trả các dòng đọc được theo tên cột (r.campaign_name…)."""
    with pg.cursor(row_factory=namedtuple_row) as cur:
        return cur.execute(sql).fetchall()


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


def _add_ads(query, date_from: str, date_to: str, camp_tab: dict, cell: dict, cell_test: dict,
             test_pages: set, main_pages: set) -> tuple[dict, dict]:
    """Tiền ads / tin nhắn / purchases theo campaign vào ô. Trả (DROPPED, MISSING_MARKET)."""
    # ADS: spend/tin nhắn/purchases theo campaign (giữ nguyên) — tab = page của campaign.
    # 20/08: camp không parse được (typo thị trường 'TAIWAIN', tên không theo format 'tt 20/7')
    # trước đây bị bỏ IM LẶNG — spend biến mất khỏi mọi báo cáo mà không ai biết. Nay gom lại
    # và in cảnh báo ở cuối (report_health đọc tail log → bot WA thấy được).
    DROPPED=collections.defaultdict(float)
    # 15/09/2026 — ba thị trường. Campaign KHÔNG ghi nước ở tên (tên cũ "Lộc/Philippine/…")
    # vẫn tính Đài (Sỹ Anh chốt), nhưng gom lại để in cảnh báo: có Singapore, UAE rồi thì
    # một campaign Singapore quên ghi "SG/" sẽ lặng lẽ chạy vào số của Đài.
    MISSING_MARKET=collections.defaultdict(float)
    for r in query(f"SELECT date, campaign_name, SUM(spend)::float8 spend, SUM(messaging_conversations_started)::bigint msg, SUM(purchases)::bigint pur FROM fb_ads_data WHERE date BETWEEN '{date_from}' AND '{date_to}' GROUP BY 1, 2"):
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
        tab=camp_tab.get(r.campaign_name) or "(khác)"
        c=(cell_test if t else cell)[(nv,mkt,tab,str(r.date))]; c["spend"]+=r.spend or 0; c["pur"]+=r.pur or 0
        # Nước lấy tin nhắn từ Pancake (Nhật): BỎ số Meta (luôn 0 ở Nhật) — số thật cộng ở khối dưới.
        if mkt not in MESS_PANCAKE: c["msg"]+=r.msg or 0
    return DROPPED, MISSING_MARKET


def _add_pancake_messages(index_ads: list, date_from: str, date_to: str, camp_tab: dict, cell: dict,
                          cell_test: dict) -> dict:
    """Tin nhắn từ Pancake cho nước Meta không báo mess. Trả PANCAKE_MESS {nước: (tin, page, không gán)}."""
    # ── TIN NHẮN TỪ PANCAKE cho nước Meta không báo mess (Nhật, Sỹ Anh yêu cầu 09/10/2026) ──
    # Hội thoại không ghi đến từ camp nào → gom theo page rồi gán cho camp tiêu nhiều nhất trên page đó
    # trong ngày (ngày page không tiêu: camp gần nhất trước đó). Pancake hỏng → giữ 0, có CANH BAO.
    PANCAKE_MESS={}
    for _m in sorted(MESS_PANCAKE):
        _shop_label=RULES_MARKETS[_m]["shop_label"]
        _ad_rows=[(r.campaign_name, str(r.date), r.spend or 0) for r in index_ads]
        _is_market_camp=lambda cn,_m=_m: campaign_market(cn)[0]==_m
        _pages={parse_camp_product(cn)[1] for cn,_,_ in _ad_rows if _is_market_camp(cn)}
        _page_counts=pancake_mess.messages_by_page(_pages, _shop_label, date_from, date_to, log=print)
        if _page_counts is None: continue
        _assigned,_unassigned=pancake_mess.assign_to_campaigns(_page_counts, _ad_rows, _is_market_camp, lambda cn: parse_camp_product(cn)[1])
        _n=0
        for (_cn,_d),_k in _assigned.items():
            if not (date_from <= _d <= date_to): continue
            _mk,_nv,_=parse_camp(_cn)
            if not _mk or not _nv: continue
            _c=(cell_test if is_test(_cn,_mk) else cell)[(bucket_nv(_nv),_mk,camp_tab.get(_cn) or "(khác)",_d)]
            _c["msg"]+=_k; _n+=_k
        PANCAKE_MESS[_m]=(_n,len(_page_counts),_unassigned)
        print(f"PANCAKE MESS {_shop_label}: {_n} tin nhan tu {len(_page_counts)} page" + (f" · KHONG GAN DUOC (page chua co camp): {_unassigned}" if _unassigned else ""))
    return PANCAKE_MESS


def _ad_owner_lookup(query, date_from: str, date_to: str) -> tuple[dict, set, dict]:
    """ad/adset id → (chủ campaign, có phải camp test, tên campaign). Trả (ad2nv, test_ads, ad2camp)."""
    # ad_id → chủ campaign (marketer) — dùng cho FALLBACK đơn không tag (duyệt 06/07).
    # X9 (06/08): POS không phải lúc nào cũng ghi ad_id vào ô `ad_id` — 999 đơn/10.634 (9,4%)
    # mang ADSET id ở ô đó. Nạp CẢ adset vào chung bảng tra; ad_id nạp SAU để đè lên adset
    # nếu trùng (bản ad chính xác hơn). Trượt cả hai mới coi là không gán được.
    ad2nv={}; test_ads=set(); ad2camp={}   # ad/adset → tên campaign — dự phòng khi nguồn đơn không khớp
    for _tbl,_col in (("fb_adset_data","adset_id"), ("fb_ads_data","ad_id")):
        for r in query(f"SELECT DISTINCT {_col} ad_id, campaign_name FROM {_tbl} WHERE date BETWEEN '{date_from}' AND '{date_to}' AND {_col} IS NOT NULL"):
            _m,_nv,_p=parse_camp(r.campaign_name)
            # Người đã nghỉ không vào bảng tra — nếu không, đơn không tag lại theo ad_id
            # chui ngược vào ô của họ, đúng thứ vừa bỏ đi.
            if _nv and _nv not in UNASSIGN and r.ad_id: ad2nv[r.ad_id]=_nv
            if r.ad_id and is_test(r.campaign_name, _m): test_ads.add(r.ad_id)
            if r.ad_id: ad2camp[r.ad_id]=r.campaign_name
    return ad2nv, test_ads, ad2camp


def _add_orders(orders: list, page_index: dict, pos_names: dict, camp_tab: dict, ad2nv: dict,
                test_ads: set, ad2camp: dict, purely_test_pages: set, cell: dict,
                cell_test: dict) -> collections.Counter:
    """Đơn POS vào ô — marketer theo tag POS → camp nối theo nguồn đơn → chủ quảng cáo. Trả MATCH_COUNTS."""
    MATCH_COUNTS=collections.Counter()
    for r in orders:
        mkt=SHOP2MKT.get((r.shop_label or "").upper())
        if not mkt: continue
        cqc=ad2camp.get(r.ad_id or "") or ad2camp.get(r.adset_id or "")
        # Đơn shop nước nào chỉ theo camp nước đó — cả khi nối theo page lẫn khi dự phòng theo quảng cáo.
        # 17/09/2026: đơn Đài #381 (0 TWD, không tag) mang quảng cáo + page của camp Singapore của Lộc →
        # Lộc ngày 15/09 ra 3 đơn, POS 2.
        ad_same_market = bool(cqc) and campaign_market(cqc)[0]==mkt
        if not ad_same_market: cqc=None
        camp,match_type=find_campaign_by_page(r.page_name, str(r.d), page_index, cqc, market=mkt)   # chỉ camp cùng nước với shop
        MATCH_COUNTS[match_type]+=1
        nv_camp=parse_camp(camp)[1] if camp else None
        # Người NGOÀI TEAM chạy chung TKQC + bán chung shop POS. Nhận diện TRƯỚC bậc 2 để
        # camp/ad_id không đẩy đơn của họ sang người trong team.
        nv = norm_pos_nv(r.nm)
        if not nv:
            ex = norm_pos_external(r.nm)
            nv = EXT_PREFIX + ex if ex else (nv_camp or (ad_same_market and (ad2nv.get(r.ad_id or "") or ad2nv.get(r.adset_id or ""))) or UNASSIGNED)
        prod = order_tab_name(r.page_name, pos_names) or camp_tab.get(camp or cqc or "") or "(khác)"   # tab = page
        # Đã nghỉ → "(không gán)" (bucket_nv), kể cả khi tag POS ghi đúng tên họ.
        nv=bucket_nv(nv)
        # Đơn từ camp TEST (ad_id thuộc camp test, hoặc page chỉ chạy test) → tách khỏi báo cáo doanh số.
        # Thị trường miễn rule test (Taiwan) → đơn LUÔN tính thật.
        t=(mkt not in NO_TEST_MARKETS) and ((r.ad_id in test_ads) or (str(r.page_id) in purely_test_pages))
        c=(cell_test if t else cell)[(nv,mkt,prod,str(r.d))]; c["orders"]+=1; c["cod"]+=r.cod or 0; c["cod_gtc"]+=r.cod_gtc or 0
    return MATCH_COUNTS


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


def collect_cells(pg, date_from: str, date_to: str) -> ReportCells:
    """Đọc số tháng [date_from, date_to] (giờ VN) và gom vào ô — đúng thứ tự các bước của bản cũ."""
    Q = partial(run_select, pg)
    cell=collections.defaultdict(lambda:{"spend":0.0,"msg":0,"pur":0,"orders":0,"cod":0.0,"cod_gtc":0.0})
    # ── CAMP TEST (duyệt 06/07): campaign chứa từ "test/TEST/Test" = test sản phẩm →
    # TÁCH khỏi mọi báo cáo doanh số (file thị trường + TỔNG marketer + TỔNG TEAM),
    # gom vào 1 file Test riêng cho mỗi marketer (chung mọi thị trường, tab theo page).
    cell_test=collections.defaultdict(lambda:{"spend":0.0,"msg":0,"pur":0,"orders":0,"cod":0.0,"cod_gtc":0.0})
    test_pages=set(); main_pages=set()  # page thuộc camp test / camp thường (để chia đơn không có ad_id)
    # ── NỐI ĐƠN → CAMPAIGN THEO NGUỒN ĐƠN (Sỹ Anh chốt 17/09/2026) ──
    # Đơn lấy từ POS → cột "Nguồn đơn" (tên page) → khớp ô tên page trong tên camp Meta → ra camp
    # đó → ra marketer, tiền ads. Luật khớp và chọn camp khi một page chạy nhiều camp nằm ở
    # tim_camp_theo_page (talpha_rules.py, có test). Chỉ mục lấy thêm 30 ngày trước đầu tháng:
    # đơn đầu tháng hay đến từ camp chạy cuối tháng trước.
    INDEX_ADS=Q(
        f"SELECT date, campaign_name, SUM(spend)::float8 spend FROM fb_ads_data "
        f"WHERE date BETWEEN DATE '{date_from}' - 30 AND DATE '{date_to}' GROUP BY 1, 2")
    PAGE_INDEX=build_page_index([(r.campaign_name, str(r.date), r.spend or 0) for r in INDEX_ADS])
    # ── TAB THEO PAGE (Sỹ Anh chốt 17/09/2026) ── file riêng của từng người: MỖI PAGE MỘT TAB, đặt
    # theo tên page. Tên lấy theo cách viết trên POS (cột Nguồn đơn) để tiền ads của camp và đơn của
    # page rơi cùng một tab; page chưa có đơn trên POS thì lấy tên ghi trong camp. Xem tao_ten_tab_page.
    POS_NAMES, CAMP_TAB = build_page_tab_names(
        [r.page_name for r in Q("SELECT page_name FROM sale_order") if r.page_name],
        [r.campaign_name for r in INDEX_ADS])
    DROPPED, MISSING_MARKET = _add_ads(Q, date_from, date_to, CAMP_TAB, cell, cell_test, test_pages, main_pages)
    PANCAKE_MESS = _add_pancake_messages(INDEX_ADS, date_from, date_to, CAMP_TAB, cell, cell_test)
    ad2nv, test_ads, ad2camp = _ad_owner_lookup(Q, date_from, date_to)
    purely_test_pages=test_pages-main_pages  # page CHỈ chạy camp test → đơn không ad_id trên page đó = test
    ORDERS=Q(f"""SELECT id, ngay_theo_mui(inserted_at,'{POS_TZ}') d,
    safe_json(marketer) ->> 'name' nm, shop_label, page_id, page_name, seller_name,
    ad_id, adset_id, status_name,
    COALESCE(cod,0) cod, CASE WHEN status_category='{GTC_CAT}' THEN COALESCE(cod,0) ELSE 0 END cod_gtc
  FROM sale_order
  WHERE ngay_theo_mui(inserted_at,'{POS_TZ}') BETWEEN '{date_from}' AND '{date_to}' AND status_category NOT IN ('HUY','DON_THO')
    AND NOT {sql_is_empty_order()}
  ORDER BY d DESC, shop_label, id""")
    # Đơn TRỐNG (không sản phẩm, 0 tiền) KHÔNG tính vào số đơn — Sỹ Anh chốt 17/09/2026, xem la_don_trong.
    # Không bỏ lặng lẽ: đếm lại để in cuối log.
    EMPTY_ORDERS=Q(f"""SELECT shop_label, COUNT(*) n FROM sale_order
  WHERE ngay_theo_mui(inserted_at,'{POS_TZ}') BETWEEN '{date_from}' AND '{date_to}' AND status_category NOT IN ('HUY','DON_THO')
    AND {sql_is_empty_order()} GROUP BY 1 ORDER BY 1""")
    MATCH_COUNTS = _add_orders(ORDERS, PAGE_INDEX, POS_NAMES, CAMP_TAB, ad2nv, test_ads, ad2camp,
                               purely_test_pages, cell, cell_test)
    cell,_CROSS_MARKET=_reassign_cross_market(cell); cell_test,_=_reassign_cross_market(cell_test)
    for (_a,_b,_m),(_s,_o) in sorted(_CROSS_MARKET.items()):
        print(f"LAN NUOC: {DISPLAY.get(_a,_a)} chay {_m} → tinh cho {DISPLAY.get(_b,_b)}: {_s:,.0f} d ads · {_o} don")
    return ReportCells(cell, cell_test, MATCH_COUNTS, EMPTY_ORDERS, DROPPED, MISSING_MARKET, PANCAKE_MESS)
