"""
Sản phẩm + page của campaign, nối đơn POS → campaign theo NGUỒN ĐƠN, tên tab theo page.

Tách khỏi talpha_rules.py (16/11/2026, file đó vượt 300 dòng) — thân hàm chuyển nguyên văn. Các hàm
đọc luật ĐÃ NẠP của talpha_rules (MARKETS, norm_nv, NUMID, campaign_market) nên nhập từ đó; ngược
lại talpha_rules trả các tên dưới đây qua __getattr__ (nạp lười) — `from talpha_rules import
parse_camp_product` vẫn chạy như cũ. Máy chủ chạy bản chép phẳng: deploy_runtime.sh chép kèm file này.
"""
import re
import unicodedata

from talpha_rules import MARKETS, NUMID, campaign_market, norm_nv


# ═══ SẢN PHẨM + PAGE CỦA CAMPAIGN, VÀ GÁN ĐƠN → SẢN PHẨM THEO PAGE ═══════════════════
# Chuẩn tên (docs/CAMPAIGN_NAMING.md): NƯỚC/MARKETER/TỆPKHÁCH/MÃSANPHAM/TENTRANG/NGAY.
# Tên cũ bỏ ô nước: MARKETER/TỆPKHÁCH/MÃSANPHAM/TENTRANG/NGAY. Hai kiểu cùng một luật:
# SẢN PHẨM = ô thứ HAI sau ô marketer, TÊN TRANG = ô thứ ba (ô ngay sau marketer là tệp khách).
# Cùng luật với tenNganCamp của bot Zalo (ops/zalo-alerts/rules.js).
#
# 16/09/2026 sửa hai lỗi đọc ô của format_all.py:
#   · tên có ô nước lấy ô NGAY SAU marketer làm sản phẩm → ra tệp khách: file Lộc có tab
#     "PHI" 4,98tr và "INDO" 1,64tr tiền ads, không phải sản phẩm nào;
#   · tên có số page lấy ô SAU con số làm sản phẩm — kiểu GCC cũ số page đứng trước tên
#     trang, nay đứng sau → ra NGÀY: file Thắng có tab "4-9 TEST", file Thương có tab "7-9".
def parse_camp_product(cn):
    """Tên campaign → (sản phẩm, tên trang, page_id). Không nhận ra marketer → (None, None, None)."""
    p = [x.strip() for x in (cn or "").split("/")]
    mi = next((i for i, s in enumerate(p) if s.upper() in MARKETS), None)
    if mi is not None:
        k = mi + 1
    else:
        k = next((i for i, s in enumerate(p[:2]) if norm_nv(s)), None)
        if k is None:
            return None, None, None
    sp = p[k + 2] if len(p) > k + 2 else ""
    page = p[k + 3] if len(p) > k + 3 else ""
    # Số page (6+ chữ số) ở bất kỳ ô nào sau marketer — kiểu GCC cũ đứng trước tên trang,
    # kiểu hiện tại đứng sau. Ngày "2808" chỉ 4 số nên không lẫn.
    page_id = next((s.replace(" ", "") for s in p[k + 1:] if NUMID.match(s.replace(" ", ""))), None)
    if page_id and NUMID.match(sp.replace(" ", "")):
        sp = page                                   # kiểu GCC: số page chiếm ô sản phẩm → sản phẩm là tên trang (luồng cũ)
    if sp.upper() == "TEST":
        sp = f"TEST · {page}" if page else "TEST"  # camp thử: tách theo trang, không dồn chung một tab "TEST"
    return (sp or "(khác)"), (page or None), page_id


def normalize_page_name(s):
    """Tên page để SO KHỚP: bỏ kiểu chữ trang trí (𝑻𝒂𝒊𝒘𝒂𝒏 → taiwan), hoa thường, dấu câu,
    khoảng trắng thừa. POS và tên camp thường cùng kiểu chữ, nhưng gõ tay thì không chắc."""
    s = unicodedata.normalize("NFKC", str(s or "")).casefold()
    return " ".join(re.sub(r"[^\w]+", " ", s).split())


def build_page_index(ad_rows):
    """[(campaign_name, ngày 'YYYY-MM-DD', tiền), …] → chỉ mục page để khớp NGUỒN ĐƠN của POS.

    Trả {"trang": {tên page chuẩn: {camp: {ngày: tiền}}},
         "o_khac": {ô khác sau marketer: {camp: {ngày: tiền}}}}.
    "o_khac" đỡ tên camp đặt lệch ô — tên page nằm ở ô sản phẩm, kiểu
    TW/THAI/PHI/Jewelry GJ International - TW - 05/09 (10 đơn tháng 9)."""
    page, other_cells = {}, {}
    for cn, date, spend in ad_rows:
        p = [x.strip() for x in (cn or "").split("/")]
        mi = next((i for i, x in enumerate(p) if x.upper() in MARKETS), None)
        k = mi + 1 if mi is not None else next((i for i, x in enumerate(p[:2]) if norm_nv(x)), None)
        if k is None:
            continue
        _sp, camp_page_name, _pid = parse_camp_product(cn)
        targets = [(page, normalize_page_name(camp_page_name))] if camp_page_name else []
        targets += [(other_cells, normalize_page_name(x)) for x in p[k + 1:] if x]
        for table, key in targets:
            if key:
                spend_by_date = table.setdefault(key, {}).setdefault(cn, {})
                spend_by_date[str(date)] = spend_by_date.get(str(date), 0) + (spend or 0)
    return {"trang": page, "o_khac": other_cells}


def find_campaign_by_page(page_name, date, page_index, ad_campaign=None, market=None):
    """NGUỒN ĐƠN của POS (tên page) → campaign. Luật Sỹ Anh chốt 17/09/2026:
    đơn lấy từ POS → cột "Nguồn đơn" → khớp ô tên page trong tên camp Meta → ra camp đó →
    ra sản phẩm, marketer, tiền ads.

    Thứ tự khớp, dừng ở bậc đầu tiên có kết quả:
      dung_ten  ô tên page trong camp TRÙNG tên nguồn đơn;
      dau_ten   ô tên page BẮT ĐẦU bằng tên nguồn đơn (ngày viết kiểu 05/09 dính vào tên page);
      lech_o    tên page nằm ở ô khác của tên camp (trùng, hoặc là phần đầu).
    Page có NHIỀU camp: camp là quảng cáo của chính đơn nếu nằm trong số đó; không thì camp
    tiêu tiền trên page vào NGÀY đơn về, thiếu thì ngày có tiền gần nhất TRƯỚC đó (một page
    có thể chuyển từ camp người này sang người khác giữa tháng — 𝐁𝐢𝐲𝐚𝐲𝐚 𝐓𝐖: Thắng rồi Thương);
    vẫn không có thì camp tiêu nhiều nhất trên page.
    `nuoc` (tên chuẩn, vd "Taiwan"): chỉ nhận camp CÙNG NƯỚC với shop của đơn — một page có
    thể chạy camp ở cả Đài lẫn Singapore; đơn Đài #381 từng bị nối vào camp Singapore của Lộc
    (17/09/2026). Bậc nào chỉ khớp camp nước khác thì coi như không khớp, xuống bậc sau.
    Trả (campaign_name, cách khớp) · (None, "khong_co_nguon") · (None, "khong_khop")."""
    p = normalize_page_name(page_name)
    if not p:
        return None, "khong_co_nguon"
    prefix = p + " "
    tiers = (
        ("dung_ten", [page_index["trang"].get(p, {})]),
        ("dau_ten", [v for k, v in page_index["trang"].items() if k.startswith(prefix)]),
        ("lech_o", [page_index["o_khac"].get(p, {})] + [v for k, v in page_index["o_khac"].items() if k.startswith(prefix)]),
    )
    for match_type, group in tiers:
        candidates = {}
        for d in group:
            for cn, amount_by_date in d.items():
                g = candidates.setdefault(cn, {})
                for nd, t in amount_by_date.items():
                    g[nd] = max(g.get(nd, 0), t)
        if market:
            candidates = {cn: v for cn, v in candidates.items() if campaign_market(cn)[0] == market}
        if candidates:
            break
    else:
        return None, "khong_khop"
    if len(candidates) == 1:
        return next(iter(candidates)), match_type
    if ad_campaign in candidates:
        return ad_campaign, match_type
    date = str(date)
    spend_dates = sorted({nd for v in candidates.values() for nd, t in v.items() if t > 0 and nd <= date})
    if spend_dates:
        nd = spend_dates[-1]
        return max(candidates, key=lambda cn: (candidates[cn].get(nd, 0), cn)), match_type
    return max(candidates, key=lambda cn: (sum(candidates[cn].values()), cn)), match_type


# ═══ TÊN TAB THEO PAGE (Sỹ Anh chốt 17/09/2026) ═══════════════════════════════════════
# File báo cáo riêng của từng người: MỖI PAGE MỘT TAB, đặt theo tên page — không theo mã sản
# phẩm nữa (mã sản phẩm hay bị gõ mỗi camp một kiểu: "042" và "042 - BLACK" thành hai tab).
# Tên tab lấy theo cách viết TRÊN POS (cột Nguồn đơn) để tiền ads của camp và đơn của page rơi
# đúng cùng một tab; page chưa có đơn nào trên POS thì lấy tên ghi trong camp.
_DATE_LIKE = re.compile(r"[\d\s./\-]*(\s*vd\s*\d*)?(\s*test)?", re.I)
_DATE_SUFFIX = re.compile(r"\s*-\s*\d{1,2}\s*$")


def camp_page_cells(cn):
    """(tên page ghi trong camp, [các ô sau marketer]). Ô tên page trống, là NGÀY hay số page
    — tên page bị viết vào ô sản phẩm, kiểu TW/THAI/PHI/Jewelry GJ International - TW - 05/09,
    hoặc kiểu GCC số page đứng trước tên — thì lấy ô sản phẩm. Không nhận ra marketer → (None, [])."""
    p = [x.strip() for x in (cn or "").split("/")]
    mi = next((i for i, s in enumerate(p) if s.upper() in MARKETS), None)
    k = mi + 1 if mi is not None else next((i for i, s in enumerate(p[:2]) if norm_nv(s)), None)
    if k is None:
        return None, []
    sp = p[k + 2] if len(p) > k + 2 else ""
    page = p[k + 3] if len(p) > k + 3 else ""
    not_a_name = lambda x: not x or _DATE_LIKE.fullmatch(x) or NUMID.match(x.replace(" ", ""))
    if not_a_name(page):
        page = "" if (not_a_name(sp) or sp.upper() == "TEST") else sp
    return (page or None), [x for x in p[k + 1:] if x]


def build_page_tab_names(pos_page_names, campaign_names):
    """Bảng tên tab theo page.
    ten_page_pos: tên page trong bảng đơn POS (lặp lại được — chọn cách viết gặp nhiều nhất).
    ten_camp: tên các campaign cần xếp tab.
    Trả (pos_ten {tên chuẩn: tên tab}, camp_tab {campaign: tên tab hoặc None}).

    Camp → page POS theo cùng thứ tự khớp với tim_camp_theo_page: trùng tên → tên page trong camp
    BẮT ĐẦU bằng tên POS (ngày dính vào) → tên POS nằm ở ô khác; nhiều tên POS cùng khớp thì lấy
    tên DÀI nhất (cụ thể nhất). Camp không khớp page POS nào: dùng tên trong camp, các biến thể
    chỉ khác đuôi ("LuxeGold Jewelry - 27" / "LuxeGold Jewelry") gộp về tên ngắn nhất."""
    counts = {}
    for t in pos_page_names:
        k = normalize_page_name(t)
        if k:
            d = counts.setdefault(k, {})
            d[str(t).strip()] = d.get(str(t).strip(), 0) + 1
    pos_names = {k: max(d.items(), key=lambda x: (x[1], x[0]))[0] for k, d in counts.items()}

    def match_pos_name(text):
        if text in pos_names:
            return text
        candidates = [k for k in pos_names if text.startswith(k + " ")]
        return max(candidates, key=len) if candidates else None

    camp_tab, unmatched = {}, {}
    for cn in dict.fromkeys(campaign_names):
        page, cells = camp_page_cells(cn)
        if page is None and not cells:
            camp_tab[cn] = None
            continue
        k = match_pos_name(normalize_page_name(page)) if page else None
        for o in ([] if k else cells):
            k = match_pos_name(normalize_page_name(o))
            if k:
                break
        if k:
            camp_tab[cn] = pos_names[k]
        elif page:
            # "DD/MM" viết trong tên camp bị dấu / cắt đôi, nửa ngày dính vào đuôi tên page.
            page = _DATE_SUFFIX.sub("", page) or page
            unmatched.setdefault(normalize_page_name(page), page)
            camp_tab[cn] = ("__le__", normalize_page_name(page))
        else:
            camp_tab[cn] = None
    canonical = {}
    for k in sorted(unmatched, key=len):                       # ngắn trước: tên gốc trước biến thể dính đuôi
        canonical[k] = next((canonical[g] for g in canonical if k.startswith(g + " ")), unmatched[k])
    for cn, v in camp_tab.items():
        if isinstance(v, tuple):
            camp_tab[cn] = canonical[v[1]]
    return pos_names, camp_tab


def order_tab_name(page_name, pos_name):
    """Tên tab của một đơn = tên page trên POS (cách viết chuẩn trong bảng); không có nguồn → None."""
    k = normalize_page_name(page_name)
    return pos_name.get(k, str(page_name).strip()) if k else None
