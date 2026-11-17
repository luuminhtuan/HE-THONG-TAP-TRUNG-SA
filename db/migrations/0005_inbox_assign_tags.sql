-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 0005 — tab Tin nhắn: gán hội thoại cho người dùng + tag nội bộ + nhật ký để tính KPI (17/11/2026)
--
-- Gán / tag làm TRÊN DASHBOARD, không đẩy ngược về Pancake (tag của Pancake vẫn ở pancake_conversations.tags).
-- Mỗi hội thoại một người phụ trách. Mọi lần gán / bỏ gán / gắn / gỡ tag ghi vào inbox_events — KPI tính từ đây,
-- nên khi hội thoại bị xoá theo hạn giữ (pancake_inbox.retention_days) thì gán + tag xoá theo nhưng NHẬT KÝ GIỮ.
-- ═══════════════════════════════════════════════════════════════════════════════════════

CREATE TABLE inbox_tags (
    id          bigserial PRIMARY KEY,
    name        text NOT NULL,
    color       text NOT NULL DEFAULT 'slate',
    created_by  text,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX inbox_tags_name_idx ON inbox_tags (lower(name));

CREATE TABLE inbox_assignments (
    page_id          text NOT NULL,
    conversation_id  text NOT NULL,
    user_id          text NOT NULL,              -- users.id
    assigned_by      text,
    assigned_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (page_id, conversation_id),
    FOREIGN KEY (page_id, conversation_id) REFERENCES pancake_conversations (page_id, conversation_id) ON DELETE CASCADE
);
CREATE INDEX inbox_assignments_user_idx ON inbox_assignments (user_id);

CREATE TABLE inbox_conversation_tags (
    page_id          text NOT NULL,
    conversation_id  text NOT NULL,
    tag_id           bigint NOT NULL REFERENCES inbox_tags (id) ON DELETE CASCADE,
    tagged_by        text,
    tagged_at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (page_id, conversation_id, tag_id),
    FOREIGN KEY (page_id, conversation_id) REFERENCES pancake_conversations (page_id, conversation_id) ON DELETE CASCADE
);
CREATE INDEX inbox_conversation_tags_tag_idx ON inbox_conversation_tags (tag_id);

-- Nhật ký cho KPI: assign (user_id = người mới, prev_user_id = người trước) · unassign · tag · untag.
CREATE TABLE inbox_events (
    id               bigserial PRIMARY KEY,
    page_id          text NOT NULL,
    conversation_id  text NOT NULL,
    kind             text NOT NULL CHECK (kind IN ('assign', 'unassign', 'tag', 'untag')),
    user_id          text,
    prev_user_id     text,
    tag_id           bigint,
    tag_name         text,                       -- tên lúc gắn — tag đổi tên / xoá thì KPI cũ vẫn đọc được
    actor            text,
    at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inbox_events_user_at_idx ON inbox_events (user_id, at);
CREATE INDEX inbox_events_tag_at_idx ON inbox_events (tag_id, at);

-- Bảng riêng — hai vai chỉ đọc không được thấy. Cùng danh sách PRIVATE_TABLES ở sync/core/pg_view.py.
REVOKE ALL ON inbox_tags, inbox_assignments, inbox_conversation_tags, inbox_events FROM talpha_readonly, talpha_readonly_market;
