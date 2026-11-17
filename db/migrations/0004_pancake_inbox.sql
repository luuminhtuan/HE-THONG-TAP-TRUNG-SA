-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 0004 — hộp thư Pancake trong database (17/11/2026): tab Khách hàng → Tin nhắn
--
-- Máy chủ kéo hội thoại + tin nhắn của mọi page các token Pancake đọc được, mỗi 5 phút
-- (sync/talpha/pancake_inbox_sync.py, luật ở talpha_rules.json → pancake_inbox); dashboard XEM từ đây,
-- không gọi Pancake lúc xem. Tin cũ hơn retention_days tự xoá. Có tên + số điện thoại khách → bảng RIÊNG.
-- ═══════════════════════════════════════════════════════════════════════════════════════

-- Page mà token Pancake thấy. market = mã nước (TW…) gán theo tên camp / đuôi tên page — NULL = chưa gán
-- (chỉ giám đốc xem). synced_until = updated_at mới nhất đã kéo xong (lượt sau chỉ lấy hội thoại mới hơn).
CREATE TABLE pancake_pages (
    page_id        text PRIMARY KEY,
    name           text NOT NULL DEFAULT '',
    platform       text,
    market         text,
    token_var      text,                         -- biến khoá của token đọc được page (TALPHA_PANCAKE_API_TOKEN, _2, _3)
    synced_until   timestamptz,
    last_sync_at   timestamptz,
    last_error     text,
    updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pancake_conversations (
    page_id          text NOT NULL,
    conversation_id  text NOT NULL,
    type             text,                       -- INBOX / COMMENT
    customer_name    text,
    customer_id      text,                       -- id khách phía Facebook / Pancake
    phone_numbers    jsonb NOT NULL DEFAULT '[]'::jsonb,
    snippet          text,                       -- tin cuối (Pancake trả sẵn)
    tags             jsonb NOT NULL DEFAULT '[]'::jsonb,
    inserted_at      timestamptz,
    updated_at       timestamptz,                -- lần có tin mới nhất (Pancake)
    messages_synced_at timestamptz,              -- updated_at của hội thoại lúc đã kéo xong tin
    PRIMARY KEY (page_id, conversation_id)
);
CREATE INDEX pancake_conversations_page_updated_idx ON pancake_conversations (page_id, updated_at DESC);
CREATE INDEX pancake_conversations_updated_idx ON pancake_conversations (updated_at DESC);

CREATE TABLE pancake_messages (
    page_id          text NOT NULL,
    conversation_id  text NOT NULL,
    message_id       text NOT NULL,
    from_page        boolean NOT NULL DEFAULT false,   -- true = page (nhân viên / bot) gửi, false = khách
    sender_name      text,
    body             text,
    attachments      jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{type, url, name}] — đường dẫn ảnh Facebook/Pancake có thể hết hạn
    sent_at          timestamptz,
    PRIMARY KEY (page_id, conversation_id, message_id)
);
CREATE INDEX pancake_messages_conv_sent_idx ON pancake_messages (page_id, conversation_id, sent_at);
CREATE INDEX pancake_messages_sent_idx ON pancake_messages (sent_at);

-- Bảng riêng (tên, số điện thoại, nội dung chat của khách) — hai vai chỉ đọc không được thấy. Cùng danh sách
-- PRIVATE_TABLES ở sync/core/pg_view.py.
REVOKE ALL ON pancake_pages, pancake_conversations, pancake_messages FROM talpha_readonly, talpha_readonly_market;
