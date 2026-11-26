-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 0009 — AI Chatbot (25/11/2026): AI trả lời tin nhắn Pancake mà luật tự động của POS không xử lý, chỉ khi có dữ liệu.
-- Thiết kế: docs/ai-chatbot/ARCHITECTURE.md · DATABASE-DESIGN.md. Code: dashboard-ui/src/lib/ai-chatbot/.
--
-- CHỈ THÊM bảng mới, không sửa / xoá cột bảng cũ. Gỡ: xem DEPLOYMENT.md → "Quay lui" (DROP các bảng ai_* — module tự
-- tắt khi không có bảng). Mặc định AN TOÀN: AI tắt, không page nào bật, chế độ shadow (không gửi tin).
-- Mọi bảng ở đây có nội dung chat / khoá / dữ liệu khách → REVOKE khỏi hai vai chỉ đọc (cùng PRIVATE_TABLES ở
-- sync/core/pg_view.py).
-- ═══════════════════════════════════════════════════════════════════════════════════════

-- Phần sửa cài đặt trên trang (PHỦ lên talpha_rules.json → ai_chatbot). Một dòng.
CREATE TABLE IF NOT EXISTS ai_bot_settings (
    id          smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    settings    jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  text
);

-- Page bật AI (mặc định không page nào). Token page nằm ở api_credentials (AI_PANCAKE_PAGE_TOKEN_<page_id>, mã hoá).
CREATE TABLE IF NOT EXISTS ai_bot_pages (
    page_id       text PRIMARY KEY,
    enabled       boolean NOT NULL DEFAULT false,
    note          text,
    poll_cursor   timestamptz,              -- updated_at mới nhất đã quét (poller)
    last_poll_at  timestamptz,
    last_error    text,
    updated_at    timestamptz NOT NULL DEFAULT now(),
    updated_by    text
);

-- ─── Knowledge Base ───
CREATE TABLE IF NOT EXISTS ai_kb_entries (
    id               bigserial PRIMARY KEY,
    scope            text NOT NULL CHECK (scope IN ('global', 'market', 'page')),
    market           text,                  -- mã nước (TW…) khi scope = market
    page_id          text,                  -- khi scope = page
    kind             text NOT NULL CHECK (kind IN ('product', 'service', 'policy', 'faq', 'page_info', 'pos_rule', 'document')),
    source           text NOT NULL CHECK (source IN ('pos_sync', 'admin', 'learning')),
    source_ref       text,                  -- 'pos:<shop_id>:<product_id>' — khoá đồng bộ
    is_official      boolean NOT NULL DEFAULT false,   -- true = dữ liệu chính thức (POS); false = admin bổ sung / FAQ
    title            text NOT NULL,
    content          text NOT NULL DEFAULT '',
    keywords         text[] NOT NULL DEFAULT '{}',
    metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- sản phẩm: {currency, variants:[{name, price, stock}]}
    enabled          boolean NOT NULL DEFAULT true,
    disabled_reason  text,
    synced_at        timestamptz,           -- lần đồng bộ nguồn gần nhất — giá / tồn kho cũ hơn price_max_age_hours không đưa AI
    valid_until      timestamptz,
    deleted_at       timestamptz,           -- xoá mềm (lịch sử giữ ở ai_kb_revisions)
    created_at       timestamptz NOT NULL DEFAULT now(),
    created_by       text,
    updated_at       timestamptz NOT NULL DEFAULT now(),
    updated_by       text,
    CHECK ((scope = 'global') OR (scope = 'market' AND market IS NOT NULL) OR (scope = 'page' AND page_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_kb_entries_source_ref_idx ON ai_kb_entries (source_ref) WHERE source_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_kb_entries_scope_idx ON ai_kb_entries (scope, market, page_id) WHERE enabled AND deleted_at IS NULL;

-- Lịch sử thay đổi kiến thức (không FK — mục xoá rồi lịch sử vẫn còn).
CREATE TABLE IF NOT EXISTS ai_kb_revisions (
    id        bigserial PRIMARY KEY,
    entry_id  bigint NOT NULL,
    action    text NOT NULL CHECK (action IN ('create', 'update', 'enable', 'disable', 'delete', 'sync', 'restore')),
    before    jsonb,
    after     jsonb,
    actor     text,
    at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_kb_revisions_entry_idx ON ai_kb_revisions (entry_id, at DESC);

-- Sổ luật trả lời tự động của POS (Pancake không có API đọc luật — admin khai lại). page_id NULL = mọi page.
CREATE TABLE IF NOT EXISTS ai_bot_pos_rules (
    id          bigserial PRIMARY KEY,
    page_id     text,
    kind        text NOT NULL CHECK (kind IN ('first_message', 'keyword', 'regex', 'intent')),
    pattern     text NOT NULL DEFAULT '',
    note        text,
    enabled     boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  text,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  text
);
-- Hai luật mặc định đúng ví dụ nghiệp vụ: POS có lời chào tin đầu + POS trả lời câu hỏi giá. Tắt / sửa ở AI Settings.
INSERT INTO ai_bot_pos_rules (kind, pattern, note, created_by)
SELECT 'first_message', '', 'POS có luật trả lời tin nhắn đầu tiên', 'migration 0009'
WHERE NOT EXISTS (SELECT 1 FROM ai_bot_pos_rules WHERE kind = 'first_message' AND page_id IS NULL);
INSERT INTO ai_bot_pos_rules (kind, pattern, note, created_by)
SELECT 'intent', 'price', 'POS có luật trả lời câu hỏi giá', 'migration 0009'
WHERE NOT EXISTS (SELECT 1 FROM ai_bot_pos_rules WHERE kind = 'intent' AND pattern = 'price' AND page_id IS NULL);

-- ─── Hàng đợi + khoá ───
-- Một job CHỜ cho mỗi hội thoại (UNIQUE một phần): tin mới tới chỉ dời giờ chạy, không đẻ job trùng.
CREATE TABLE IF NOT EXISTS ai_bot_jobs (
    id               bigserial PRIMARY KEY,
    page_id          text NOT NULL,
    conversation_id  text NOT NULL,
    status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed', 'cancelled')),
    source           text,                  -- webhook / poll / manual
    run_after        timestamptz NOT NULL DEFAULT now(),
    attempts         int NOT NULL DEFAULT 0,
    locked_by        text,
    locked_until     timestamptz,
    last_error       text,
    result           text,                  -- quyết định / lý do
    run_id           bigint,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    finished_at      timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_bot_jobs_one_pending_idx ON ai_bot_jobs (page_id, conversation_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS ai_bot_jobs_due_idx ON ai_bot_jobs (run_after) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS ai_bot_jobs_running_idx ON ai_bot_jobs (locked_until) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS ai_bot_jobs_finished_idx ON ai_bot_jobs (finished_at) WHERE status IN ('done', 'failed', 'cancelled');

-- Khoá thuê theo hội thoại: tiến trình chết thì khoá tự hết hạn. KHÔNG giữ transaction khi chờ AI.
CREATE TABLE IF NOT EXISTS ai_bot_locks (
    page_id          text NOT NULL,
    conversation_id  text NOT NULL,
    locked_by        text NOT NULL,
    locked_until     timestamptz NOT NULL,
    PRIMARY KEY (page_id, conversation_id)
);

-- Trạng thái AI theo hội thoại: tạm dừng (Sale tiếp nhận / sau khi chuyển Sale), ngôn ngữ, sản phẩm đang bàn.
CREATE TABLE IF NOT EXISTS ai_bot_conversation_state (
    page_id           text NOT NULL,
    conversation_id   text NOT NULL,
    paused_until      timestamptz,
    paused_reason     text,
    paused_by         text,
    language          text,
    last_products     jsonb NOT NULL DEFAULT '[]'::jsonb,
    last_intent       text,
    last_ai_reply_at  timestamptz,
    updated_at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (page_id, conversation_id)
);

-- ─── Nhật ký ───
-- Mỗi lượt khách MỘT quyết định cuối (UNIQUE = idempotency theo message id).
CREATE TABLE IF NOT EXISTS ai_bot_runs (
    id                bigserial PRIMARY KEY,
    job_id            bigint,
    page_id           text NOT NULL,
    conversation_id   text NOT NULL,
    turn_message_id   text NOT NULL,
    market            text,
    customer_text     text,                 -- đã che SĐT / email
    language          text,
    intent            text,
    classification    jsonb,
    retrieved         jsonb NOT NULL DEFAULT '[]'::jsonb,
    answer            text,
    decision          text NOT NULL CHECK (decision IN ('answered', 'shadow', 'escalated', 'skipped', 'error')),
    reason            text NOT NULL,
    provider          text,
    model             text,
    input_tokens      int NOT NULL DEFAULT 0,
    output_tokens     int NOT NULL DEFAULT 0,
    cost_usd          numeric(12, 6) NOT NULL DEFAULT 0,
    confidence        numeric(5, 3),
    duration_ms       int,
    sent_message_id   text,
    tag_status        text,
    mode              text,
    trace             jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_bot_runs_turn_idx ON ai_bot_runs (page_id, conversation_id, turn_message_id);
CREATE INDEX IF NOT EXISTS ai_bot_runs_created_idx ON ai_bot_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_bot_runs_page_idx ON ai_bot_runs (page_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_bot_runs_conv_idx ON ai_bot_runs (page_id, conversation_id, created_at DESC);

-- Mỗi lượt gọi model (cả lượt thử / chạy thử) — nguồn cho token + chi phí + trần chi phí.
CREATE TABLE IF NOT EXISTS ai_bot_provider_calls (
    id             bigserial PRIMARY KEY,
    purpose        text NOT NULL,           -- classify / generate / test / sandbox
    provider       text NOT NULL,
    model          text NOT NULL,
    input_tokens   int NOT NULL DEFAULT 0,
    output_tokens  int NOT NULL DEFAULT 0,
    cost_usd       numeric(12, 6) NOT NULL DEFAULT 0,
    latency_ms     int,
    ok             boolean NOT NULL,
    error          text,
    page_id        text,
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_bot_provider_calls_created_idx ON ai_bot_provider_calls (created_at DESC);

-- Giữ chỗ gửi TRƯỚC khi gọi Pancake: mỗi lượt khách gửi tối đa một lần. 'unknown' = hết giờ, không rõ đã gửi → không gửi lại.
CREATE TABLE IF NOT EXISTS ai_bot_outbox (
    page_id             text NOT NULL,
    conversation_id     text NOT NULL,
    turn_message_id     text NOT NULL,
    text                text NOT NULL,
    status              text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'failed', 'unknown')),
    pancake_message_id  text,
    error               text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (page_id, conversation_id, turn_message_id)
);
CREATE INDEX IF NOT EXISTS ai_bot_outbox_page_sent_idx ON ai_bot_outbox (page_id, updated_at DESC) WHERE status = 'sent';

-- Thông báo Telegram — chống báo trùng (dedup_key = lượt khách).
CREATE TABLE IF NOT EXISTS ai_bot_notifications (
    id          bigserial PRIMARY KEY,
    dedup_key   text NOT NULL UNIQUE,
    channel     text NOT NULL DEFAULT 'telegram',
    status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
    attempts    int NOT NULL DEFAULT 0,
    payload     jsonb,
    error       text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    sent_at     timestamptz
);

-- Webhook Pancake nhận được (rút gọn, giữ 7 ngày) — để soát định dạng thật + điều tra.
CREATE TABLE IF NOT EXISTS ai_bot_webhook_log (
    id               bigserial PRIMARY KEY,
    received_at      timestamptz NOT NULL DEFAULT now(),
    remote_ip        text,
    ok               boolean NOT NULL,
    error            text,
    event_type       text,
    page_id          text,
    conversation_id  text,
    payload          jsonb
);
CREATE INDEX IF NOT EXISTS ai_bot_webhook_log_received_idx ON ai_bot_webhook_log (received_at DESC);

-- ─── AI Learning ───
CREATE TABLE IF NOT EXISTS ai_learning_questions (
    id             bigserial PRIMARY KEY,
    market         text,
    page_id        text,
    sample_text    text NOT NULL,
    normalized     text NOT NULL,
    tokens         text[] NOT NULL DEFAULT '{}',
    intent         text,
    language       text,
    reason         text,
    occurrences    int NOT NULL DEFAULT 1,
    status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'approved', 'ignored')),
    answer         text,
    kb_entry_id    bigint,
    handled_by     text,
    handled_at     timestamptz,
    first_seen_at  timestamptz NOT NULL DEFAULT now(),
    last_seen_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_learning_questions_status_idx ON ai_learning_questions (status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS ai_learning_questions_market_idx ON ai_learning_questions (market, status);

CREATE TABLE IF NOT EXISTS ai_learning_occurrences (
    id               bigserial PRIMARY KEY,
    question_id      bigint NOT NULL REFERENCES ai_learning_questions (id) ON DELETE CASCADE,
    page_id          text NOT NULL,
    conversation_id  text NOT NULL,
    message_id       text NOT NULL,
    text             text NOT NULL,
    reason           text,
    at               timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_learning_occurrences_uniq_idx ON ai_learning_occurrences (question_id, page_id, conversation_id, message_id);

CREATE TABLE IF NOT EXISTS ai_learning_history (
    id           bigserial PRIMARY KEY,
    question_id  bigint NOT NULL,
    action       text NOT NULL,             -- status:<mới> / answer / approve / merge
    detail       jsonb,
    actor        text,
    at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_learning_history_q_idx ON ai_learning_history (question_id, at DESC);

REVOKE ALL ON ai_bot_settings, ai_bot_pages, ai_kb_entries, ai_kb_revisions, ai_bot_pos_rules, ai_bot_jobs, ai_bot_locks,
    ai_bot_conversation_state, ai_bot_runs, ai_bot_provider_calls, ai_bot_outbox, ai_bot_notifications, ai_bot_webhook_log,
    ai_learning_questions, ai_learning_occurrences, ai_learning_history
    FROM talpha_readonly, talpha_readonly_market;
