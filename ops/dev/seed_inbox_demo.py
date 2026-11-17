"""Dữ liệu THỬ cho tab Tin nhắn (17/11/2026) — CHỈ cho máy dev, để thử giao diện khi chưa có token Pancake có gói cước.

    docker compose run --rm --entrypoint python migrate ops/dev/seed_inbox_demo.py --yes     # tạo
    docker compose run --rm --entrypoint python migrate ops/dev/seed_inbox_demo.py --clean   # xoá đúng phần thử

Tạo 3 page "[THỬ]" (TW · SG · JP), 20 hội thoại, ĐÚNG 100 tin, 4 tag mẫu. Mọi page_id bắt đầu "demo-" — --clean chỉ
xoá những dòng đó (gán + tag của chúng xoá theo; nhật ký KPI của hội thoại thử cũng xoá). Việc nền kéo Pancake không
đụng page thử (Pancake không có page đó). Đừng chạy trên máy chủ thật.
"""
import json
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from sync.core.pg import get_connection  # noqa: E402

PAGES = [("demo-tw", "[THỬ] Serene Jewelry Taiwan", "TW"), ("demo-sg", "[THỬ] Lucky Charm Store SG", "SG"),
         ("demo-jp", "[THỬ] Luxeora Gold Jewelry JP", "JP")]
CUSTOMERS = ["Nguyễn Thị Lan", "Trần Văn Hùng", "Maria Santos", "Siti Rahayu", "Lê Thu Hà", "Juan Dela Cruz",
             "Phạm Minh Tuấn", "Dewi Lestari", "Hoàng Anh Thư", "Rosa Bautista", "Đỗ Quang Huy", "Nur Aini",
             "Vũ Thị Mai", "Angelica Reyes", "Bùi Văn Nam", "Putri Ayu", "Ngô Thanh Tâm", "Liza Mendoza",
             "Đặng Hồng Nhung", "Agus Salim"]
CUSTOMER_LINES = ["Shop ơi vòng này còn hàng không ạ?", "Giá bao nhiêu vậy shop?", "Có ship COD không ạ?",
                  "Mình ở Đài Trung, mấy ngày nhận được hàng?", "Vàng này có bị đen không shop?", "Cho mình xem thêm mẫu khác",
                  "Mình lấy 2 cái được giảm không?", "Ok shop, chốt cho mình 1 cái nhé", "Địa chỉ: 台中市西屯區…, sđt 0912 345 678",
                  "Bao giờ shop gửi hàng ạ?", "Hàng nhận rồi, đẹp lắm shop ơi", "Size tay mình 16cm có vừa không?",
                  "How much is this bracelet?", "Is it real gold?", "Berapa harganya kak?", "Can I pay when it arrives?"]
PAGE_LINES = ["Dạ còn hàng chị ạ 💛", "Dạ giá 1.290 TWD, freeship và COD toàn Đài ạ", "Dạ shop gửi COD, nhận hàng mới trả tiền ạ",
              "Dạ 3–5 ngày chị nhận được hàng nhé", "Dạ vàng mạ 18K, bảo hành màu 12 tháng ạ", "Dạ chị xem thêm mẫu này nha",
              "Dạ lấy 2 cái shop giảm 10% ạ", "Dạ chị cho shop xin tên, số điện thoại, địa chỉ nhận hàng nhé",
              "Dạ shop lên đơn rồi ạ, mã vận đơn shop gửi sau nhé", "Cảm ơn chị đã ủng hộ shop 🥰", "Yes, it's 18K gold plated 😊",
              "Iya kak, bisa COD ya"]
TAGS = [("Hỏi giá", "sky"), ("Chốt đơn", "emerald"), ("Khách cũ", "violet"), ("Spam", "red")]


def seed(conn):
    rnd = random.Random(20261117)
    now = datetime.now(timezone.utc).replace(microsecond=0)
    sizes = [5] * 20                                    # 20 hội thoại × 5 tin = 100 tin
    for _ in range(30):                                 # xáo độ dài cho giống thật, tổng vẫn 100
        i, j = rnd.randrange(20), rnd.randrange(20)
        if sizes[i] > 2:
            sizes[i] -= 1
            sizes[j] += 1
    with conn.transaction():
        for pid, name, market in PAGES:
            conn.execute("""INSERT INTO pancake_pages (page_id, name, platform, market, last_sync_at, updated_at)
                            VALUES (%s, %s, 'facebook', %s, now(), now())
                            ON CONFLICT (page_id) DO UPDATE SET name = EXCLUDED.name, market = EXCLUDED.market""", (pid, name, market))
        for tname, color in TAGS:
            conn.execute("INSERT INTO inbox_tags (name, color, created_by) VALUES (%s, %s, 'demo') ON CONFLICT DO NOTHING", (tname, color))
        total = 0
        for k, (customer, n) in enumerate(zip(CUSTOMERS, sizes)):
            pid = PAGES[k % len(PAGES)][0]
            cid = f"demo-conv-{k + 1:02d}"
            start = now - timedelta(hours=72 - k * 3.4, minutes=rnd.randrange(50))
            phones = [f"09{rnd.randrange(10_000_000, 99_999_999)}"] if k % 3 == 0 else []
            t = start
            last_text = ""
            for m in range(n):
                t += timedelta(minutes=rnd.randrange(1, 40), seconds=k + m)
                from_page = m % 2 == 1
                text = rnd.choice(PAGE_LINES if from_page else CUSTOMER_LINES)
                last_text = text
                conn.execute("""INSERT INTO pancake_messages (page_id, conversation_id, message_id, from_page, sender_name, body, attachments, sent_at)
                                VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s) ON CONFLICT DO NOTHING""",
                             (pid, cid, f"{cid}-m{m + 1:02d}", from_page, "Nhân viên A" if from_page else customer, text,
                              json.dumps([]), t))
                total += 1
            conn.execute("""INSERT INTO pancake_conversations (page_id, conversation_id, type, customer_name, customer_id, phone_numbers,
                                                              snippet, tags, inserted_at, updated_at, messages_synced_at)
                            VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, '[]'::jsonb, %s, %s, %s)
                            ON CONFLICT (page_id, conversation_id) DO UPDATE SET snippet = EXCLUDED.snippet, updated_at = EXCLUDED.updated_at""",
                         (pid, cid, "COMMENT" if k % 7 == 6 else "INBOX", customer, f"demo-cust-{k + 1}", json.dumps(phones),
                          last_text, start, t, t))
    print(f"Đã tạo {len(PAGES)} page thử · {len(CUSTOMERS)} hội thoại · {total} tin · {len(TAGS)} tag mẫu.")


def clean(conn):
    with conn.transaction():
        ev = conn.execute("DELETE FROM inbox_events WHERE page_id LIKE 'demo-%'").rowcount
        ms = conn.execute("DELETE FROM pancake_messages WHERE page_id LIKE 'demo-%'").rowcount
        cv = conn.execute("DELETE FROM pancake_conversations WHERE page_id LIKE 'demo-%'").rowcount
        pg = conn.execute("DELETE FROM pancake_pages WHERE page_id LIKE 'demo-%'").rowcount
        tg = conn.execute("""DELETE FROM inbox_tags t WHERE t.created_by = 'demo'
                             AND NOT EXISTS (SELECT 1 FROM inbox_conversation_tags ct WHERE ct.tag_id = t.id)""").rowcount
    print(f"Đã xoá dữ liệu thử: {pg} page · {cv} hội thoại · {ms} tin · {ev} dòng nhật ký · {tg} tag mẫu chưa ai dùng.")


if __name__ == "__main__":
    if "--clean" in sys.argv:
        with get_connection() as c:
            clean(c)
    elif "--yes" in sys.argv:
        with get_connection() as c:
            seed(c)
    else:
        print(__doc__)
        sys.exit(2)
