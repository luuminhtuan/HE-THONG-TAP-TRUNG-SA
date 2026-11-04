"""
Cấu hình chung cho pytest.

Test soát luật của REPO (config/talpha_rules.json), không phải thị trường ai đó nhập trên trang của
máy đang chạy test (data/thi_truong.json, 04/11/2026). Trỏ file phủ vào chỗ không có, trước khi bất
kỳ test nào nạp business_rules / talpha_rules — test cần file phủ thì tự đặt TALPHA_THI_TRUONG.
"""
import os

os.environ.setdefault("TALPHA_THI_TRUONG", os.path.join(os.path.dirname(__file__), "_khong_co_thi_truong.json"))
