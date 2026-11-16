"""
TKQC đọc lỗi thì sync BỎ QUA, vẫn ghi Sheet bằng các TK còn lại (28/10/2026).

Chạy: python3 -m pytest tests/test_sync_tk_mat_quyen.py -q

Sỹ Anh chốt 28/10: "tkqc nào die thì kệ nó, mày vẫn cứ báo cáo các tkqc còn lại". Luật cũ
(30/09) chỉ bỏ qua TK mất quyền mà 7 ngày không tiêu → 14/10 SA ANTALO 01 bị khoá lúc đang chạy,
Sheet đứng 23 giờ. Nay chỉ chặn khi KHÔNG TK nào đọc được (token chết / app bị chặn).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sync.core.tk_loi import split_failed_accounts  # noqa: E402

SA01 = {"name": "SA ANTALO 01", "id": "act_2201353496727281", "mat_quyen": True}
ANTALO1 = {"name": "ANTALO 1 - CHẠY ĐÀI", "id": "act_191133507087352", "mat_quyen": True}
NETWORK_ERROR = {"name": "Sỹ Anh Taiwan 4", "id": "act_256210853826298", "mat_quyen": False}


def test_no_failed_accounts_nothing_skipped_or_blocked():
    assert split_failed_accounts([], 12) == ([], [])


def test_account_dead_while_spending_still_skipped():
    # 14/10: SA ANTALO 01 bị khoá khi đang tiêu tiền — luật cũ chặn, Sheet đứng 23 giờ.
    skipped, blocked = split_failed_accounts([SA01], 11)
    assert skipped == [SA01] and blocked == []


def test_network_error_on_one_account_also_skipped():
    # Dòng cũ của TK lỗi giữ nguyên (append_and_rebuild_ads) nên bỏ qua không ghi số 0.
    skipped, chan = split_failed_accounts([NETWORK_ERROR], 12)
    assert skipped == [NETWORK_ERROR] and chan == []


def test_many_dead_accounts_with_readable_ones_skips_all():
    skipped, chan = split_failed_accounts([SA01, ANTALO1, NETWORK_ERROR], 4)
    assert skipped == [SA01, ANTALO1, NETWORK_ERROR] and chan == []


def test_no_readable_account_blocks():
    # Token chết / app bị chặn (02/09, 08/10): ghi Sheet là ghi tiền ads cũ cạnh đơn mới.
    skipped, chan = split_failed_accounts([SA01, ANTALO1, NETWORK_ERROR], 3)
    assert skipped == [] and chan == [SA01, ANTALO1, NETWORK_ERROR]
