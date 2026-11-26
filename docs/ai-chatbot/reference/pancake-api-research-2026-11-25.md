# Pancake / Pancake POS / Meta Messenger: what the official API docs say

Researched 2026-11-25. Every claim cites an official source. Anything not in those sources is marked
**NOT FOUND in official docs**.

## Official sources (current)

| Product | Rendered docs | Machine-readable spec (single source of truth) |
|---|---|---|
| Pancake chat (pages.fm) REST | https://developer.pancake.biz/ | https://developer.pancake.biz/openapi/openapi.yaml (OpenAPI 3.0, "Pancake API Library" 1.0.0) |
| Pancake chat webhooks | https://developer.pancake.biz/webhook | https://developer.pancake.biz/openapi/webhook.yaml |
| Pancake POS Open API | https://docs.pancake.biz/pos/api/en (`https://api-docs.pancake.vn/en` 301-redirects here) | https://docs.pancake.biz/pos/api/openapi.json ("Pancake POS Open API" 1.0.0, server `https://pos.pages.fm/api/v1`) |
| Meta Send API | https://developers.facebook.com/docs/messenger-platform/send-messages | n/a |
| Meta webhooks | https://developers.facebook.com/docs/messenger-platform/webhooks | n/a |

The old GitBook pages (`docs.pancake.vn/{english,vi}/developers/api-reference`, `docs.pages.fm/...`) now serve
the generic product landing page, and their TLS certificate has expired. `developer.pancake.vn` returns 404.
Use only the developer.pancake.biz / docs.pancake.biz specs above.

---

## 1. Are the endpoints the production code uses in the official docs?

Base servers in the spec: `https://pages.fm/api/v1` (user token), `https://pages.fm/api/public_api/v1` and
`https://pages.fm/api/public_api/v2` (page token). Auth is always a **query parameter**, never an
`Authorization` header. Source: openapi.yaml `info.description` + `servers`.

| Endpoint the code uses | Documented? | Notes from the spec |
|---|---|---|
| `GET public_api/v2/pages/{page_id}/conversations?page_access_token&since&until&order_by=updated_at` | **YES** (server v2) | Params: `page_access_token` (required), `last_conversation_id` (pagination: next 60 older), `tags` (comma-separated tag IDs), `type[]` (INBOX, COMMENT, COMMENT_LIVESTREAM, POST), `post_ids[]`, `since` / `until` (Unix **seconds**, UTC), `unread_first` (bool), `order_by` enum `inserted_at` / `updated_at`, `fields` (projection, max 2000 chars and 5 nesting levels). Returns at most **60** conversations per call. |
| `GET public_api/v1/pages/{page_id}/conversations/{conversation_id}/messages?page_access_token` | **YES** (server v1) | Documented params: `page_access_token` (required), `current_count` ("Returns 30 messages prior to this index"), plus the two path IDs. **A `customer_id` query param is NOT FOUND in official docs.** Production found it is required in practice; the spec does not list it. Messages are "ordered from newest to oldest". |
| `POST public_api/v1/.../conversations/{id}/messages` body `{"action":"reply_inbox","message":"..."}` | **YES** | The body is `oneOf` InboxMessage / ReplyComment / PrivateReply / WhatsappTemplateMessage. InboxMessage: `action` = `reply_inbox` (required), `message` (required for text), `content_ids[]` (media, **mutually exclusive** with `message`, "DO NOT send both → API returns 500 error"), `filename`, `sender_id` (staff user from GET /users, "User must have the required subscription plan and page permissions"), `reply_message_id`. **HTTP 200 does not mean the message was sent; check `success`.** On failure the body carries `message_code`, for example `invalid_upload_fb_attachments_result`. PrivateReply window: 7 days from the comment. |
| `GET public_api/v1/pages/{page_id}/tags` | **YES** | Response `tags[]`: `id` (integer), `text`, `color`, `lighten_color`. |
| `POST public_api/v1/.../conversations/{id}/tags` body `{"action":"add"\|"remove","tag_id"}` | **YES** | Both fields required. Response: `data` (int[] of tag IDs after the update), `success`, `timestamp`. |
| `POST api/v1/pages/{page_id}/generate_page_access_token?access_token=<user token>` | **YES** (server `pages.fm/api/v1`) | Needs the user token of a page **admin**. The spec quirk: `page_id` is declared `in: query` although it is also in the path. |
| `GET pos.pages.fm/api/v1/shops/{shop_id}/products?api_key&page_number&page_size` | **NOT FOUND in official docs as a GET.** | The POS spec defines only **POST** `/shops/{SHOP_ID}/products` (create). The documented list endpoint is **`GET /shops/{SHOP_ID}/products/variations`** ("Product list": products + variations + per-warehouse stock), with `page_size` (default 30) and `page_number` (default 1). There is also `GET /shops/{SHOP_ID}/products/{PRODUCT_SKU}` ("Get product information"). |

Other documented page-level endpoints that are relevant: `POST .../conversations/{id}/assign` (body
`assignee_ids[]`), `.../read`, `.../unread`, `GET /pages/{page_id}/users` (staff, availability, round robin),
`POST /pages/{page_id}/round_robin_users`, `GET /pages/{page_id}/page_customers`, customer notes CRUD,
`POST /pages/{page_id}/upload_contents`, statistics (`users`, `tags`, `customer_engagements`,
`customer_feedbacks`, `pages`, `ads`, `pages_campaigns`), `export_data`, `sip_call_logs`, `posts`, and
`GET/POST /pke_chat_plugin/messages`.

### Conversation fields (schema `Conversation`, openapi.yaml)

Allowed `fields` values: `id, type, page_id, post_id, snippet, seen, message_count, has_phone, inserted_at,
updated_at, from, last_sent_by, tags, tag_histories, assignee_ids, assignee_group_id, current_assign_users,
assignee_histories, customer_id, customers, recent_phone_numbers, ad_ids, ads, page_customer`.

- `last_sent_by`: **documented**. Sub-fields `id`, `name`, `email`, `uid` ("Pancake user UUID of the last
  sender when the message was sent by a staff member"), `admin_id`, `admin_name`, `platform`, `ai_generated`
  (bool), `is_automated` (bool, "sent automatically (e.g. by an automation/bot rule)").
- `assignee_ids`: **documented**, "List of Pancake user UUIDs currently assigned".
- `current_assign_users`: **documented**, `[{id, name, email, fb_id}]`.
- `assignee_histories`: `[{inserted_at, conversation_id, payload:{added_users[], deleted_users[]}}]`.
- `tags`: **documented**, `[{id:int, text, color, is_deactive, is_lead_event}]`. "Entries may be `null` for
  tags that have been removed/deactivated."
- `tag_histories`: `[{inserted_at, conversation_id, payload:{action (add/remove/clone), editor_id ("empty when
  performed by the system"), editor_name, tag:{id,text}}}]`.
- `customer_id` is the "Global customer ID". `customers[]` = `{id (page-customer ID), fb_id (PSID), name}`.
  `page_customer` = `{id, name, customer_id, psid, gender, inserted_at, birthday, notes, recent_orders}`.
- `ad_ids` / `ads`: present for conversations that came from an ad, otherwise `null`.
- `type` enum: `INBOX`, `COMMENT`, `LIVESTREAM`. For inbox threads, `id` "is the customer's PSID" (per the spec).

### Message fields (schema `Message`, openapi.yaml)

`id, conversation_id, page_id, type, message` ("Rendered content ... may contain HTML"),
`original_message` ("Raw original text of the message, before rendering"), `from`, `inserted_at, seen,
has_phone, is_hidden, is_parent_hidden, is_removed, removed_by, is_parent, parent_id, comment_count,
like_count, user_likes, is_livestream_order, show_info, can_*, private_reply_conversation, rich_message,
edit_history, message_tags, phone_info, attachments[]` (type `photo` / `video` / `sticker` / `template` /
`system_message`).

`from` sub-fields:
- `from.admin_name`: **documented**, "Name of the admin/staff account that sent the message".
- `from.admin_id` and `from.uid` (Pancake user UUID when a staff member sent it): documented.
- `from.is_automated`: **documented**, "Whether the message was sent automatically (e.g. by POS or an
  automation rule)".
- `from.ai_generated`: documented, "Whether the message was generated by AI".
- **`app_id`: NOT FOUND in official docs** (not on Message, `from`, or anywhere in either spec).
- **`flow_id`: NOT FOUND in official docs.**
- The chat-plugin messages example shows `from.admin_name: "BotcakeAI"`. This suggests Botcake replies set
  `admin_name`, but it is only an example value, not a stated rule.

### Tokens and dates

- User Access Token: lifespan "Up to **90 days**, or until the user logs out". On `401`, fetch a new one from
  the UI.
- Page Access Token: "**Does not expire** unless manually deleted or regenerated". It is scoped to one page.
- `GET https://pages.fm/api/v1/pages?access_token=...&fields=activated{id,username,settings{page_access_token}}`
  returns the **existing** page token. It is admin-only: non-admins get `settings: {}`.
- All response datetimes are **UTC+0 ISO strings without an offset**. `since` / `until` are Unix seconds
  (UTC). The exception is `date_range` on some statistics endpoints, which uses the page's local timezone.

---

## 2. Webhooks for Pancake pages (chat)

**Pancake does offer webhooks.** Source: https://developer.pancake.biz/openapi/webhook.yaml

- **Event types:** `messaging` (new or updated message, inbox or comment), `conversation` (assignment, tags,
  read/seen, snippet), `subscription`, `post`, `connect_status` (`connected` / `disconnected`).
- **How to register:** there is no API for it. An admin sets the webhook URL in the page's **Tools settings**
  in the Pancake UI. The UI has a "Verify your endpoint URL" step, shown in a screenshot; its mechanism is
  not described in text. Each page with webhooks enabled **uses 1 extra connection slot** in the
  subscription. You need a free slot or must buy more.
- **Delivery:** HTTP POST with a JSON body. Your endpoint must return **HTTP 200**.
- **Source IP:** all requests come from fixed IP **`203.171.22.6`**, which you can allowlist.
- **Payload, `messaging`:** `{ page_id, event_type: "messaging", data: { conversation, message, post|null } }`.
  - `data.conversation` = `{id, assignee_ids, from{id,name}, is_combined, is_removed, is_replied,
    read_watermarks, seen, snippet, tags:int[], type}`.
  - `data.message` = `{id, conversation_id, page_id, message, original_message, rich_message, type,
    inserted_at, from{id, name, page_customer_id}, attachments, has_phone, phone_info, is_hidden, ...}`.
  - The webhook `Message.from` schema lists only `id`, `name`, and `page_customer_id`. **`admin_name`,
    `is_automated`, `app_id` and `flow_id` in webhook payloads: NOT FOUND in official docs.**
  - Media in a webhook arrives as a link only, not a `content_id`.
- **Payload, `conversation`:** `{event_type, page_id, request_id, timestamp (Unix s), data:{conversation:{id,
  assignee_ids, customer_id, from, is_combined, is_removed, is_replied, read_watermarks[], seen, snippet,
  tags:int[], type, version}}}`.
  - Apply an update only if its `version` is greater than the last one you processed (it is monotonic).
  - Use `request_id` for idempotency.
- **Signature or verification (HMAC, secret, signature header): NOT FOUND in official docs.** The only
  documented authenticity control is the fixed source IP.
- **Suspension:** a webhook is auto-suspended when, **within 30 minutes**, the error rate is above 80% **and**
  failed requests are at least 300 (non-2xx, timeout, or network error). It stays off until re-enabled in
  Webhook Settings.
- **Best practice:** return 200 quickly (preferably under 5 s), process asynchronously, and make processing
  idempotent because events can be delivered more than once.

## 3. API to read auto-reply rules, quick replies, or Botcake flows

**NOT FOUND in official docs.** The Pancake openapi.yaml has no path for auto-reply rules, quick replies
(saved replies), or Botcake flows. Botcake appears only in these places:
- the `statistics/customer_feedbacks` response: `botcake_count`, and `sent_by_user: false` meaning
  "collected automatically by Botcake";
- the `admin_name: "BotcakeAI"` example.

## 4. Rate limits (Pancake public API)

Documented in openapi.yaml under "Rate Limits": "Public API requests are rate limited to **5 calls per page
per second**. The limit is applied per `page_id`." Exceeding it returns HTTP **429 Too Many Requests**. The
advice is to back off and queue requests.

## 5. Does generating a page access token invalidate the previous one?

**YES, stated officially.** openapi.yaml says:
- "The response returns a new `page_access_token` (and invalidates the previous one if it existed)."
- "It remains valid until you manually delete it or regenerate a new one (regenerating invalidates the old
  token)."

To read the current token without breaking other integrations, use
`GET /pages?fields=activated{id,settings{page_access_token}}` with an admin's user token.

## 6. Pancake POS (pos.pages.fm/api/v1)

Source: https://docs.pancake.biz/pos/api/openapi.json

**Auth.** Query param `api_key`, applied globally. Create it under Settings → Application, or Setting → Advance
→ Third-party connection → Webhook/API, then the `API KEY` frame → Create.

**Money.** Amounts are integers in the storage unit of the currency, with no conversion.
- `VND`, `TWD`, `LAK`, `PHP`, `MMK`, `JPY`, `INR`, `COP`, `IDR`, `CLP`, `PYG` are whole units.
- Every other currency (USD, CAD, EUR, THB, KRW...) and the internal codes `VND100` / `PHP100` are ×100.
- Product and variation prices use the **shop** currency.
- This agrees with the project's divisor 1 for TWD and 100 for SGD / AED.

**Product list.** `GET /shops/{SHOP_ID}/products/variations`. Each item is a variation with its product
embedded.

Query params:
- `page_size` (default 30), `page_number` (default 1), `search`
- `selling_status` (`none` / `bad` / `normal` / `star`), `product_status` (`locked` / `not_locked`)
- `category_id[]`, `is_filter_categories_by_or`, `filter_exclude_categories`
- `warehouse_until` (stock at a point in time), `promotion_advance[]`, `manipulationWarehouse[]`
- `startDate` / `endDate` (product created), `start_time_update` / `end_time_update` (product updated)
- `included_composite`, and others

Response envelope: `data[]`, `page_number`, `page_size`, `total_entries`, `total_pages`, `success`.

**Description and notes.** The product has **`note`** ("Internal note" / "Ghi chú nội bộ") and
**`note_product`** ("Product note" / "Ghi chú sản phẩm").
- A field named `description` on Product: **NOT FOUND in official docs**.
- Other product fields: `name`, `einvoice_name`, `type`, `category_ids` / `categories`, `tags[{id,note}]`,
  `product_attributes[{name, values[]}]`, `weight`, `custom_id`, `display_id`, `image`, `is_published`,
  `brand_id`, `keyword`, `variations[]`.

**Variation price fields.**
- `retail_price` (selling price, shop currency), `price_at_counter`
- `retail_price_by_currency[]` (multi-currency shops)
- `wholesale_price[]` / `wholesale_price2[]`, `price_table[{id,name,price}]`
- `last_imported_price`, `average_imported_price`, `total_purchase_price`

**Variation stock fields.**
- On the variation: `remain_quantity`, plus `variations_warehouses[]` (one per warehouse).
- Per warehouse:
  - `remain_quantity`: "Sellable quantity. May include incoming/waiting stock depending on shop settings".
  - `available_quantity`: `max(0, remain_quantity)`.
  - `actual_remain_quantity`: physically on hand.
  - Other quantities: `total_quantity`, `waitting_quantity` (spelled this way in the spec),
    `pending_quantity`, `shipping_quantity`, `returning_quantity`, `defect_quantity`.
  - `selling_avg`, `nearly_out`, `avg_price`.
- Flags: `is_sell_negative_variation`, `is_hidden`, `is_locked`. Other fields: `fields[{id,name,value}]`,
  `barcode`, `images[]`.

**Rate limits.**
- **No numeric limit is documented (NOT FOUND in official docs).**
- A `429` response, "The Open API request rate limit was reached", is documented with body
  `{"success":false,"message":"You have reached the limit of requests","error_code":106}`. It appears only on
  `GET /orders/{ORDER_ID}/messages` and `GET /orders/{ORDER_ID}/print`.

**POS webhooks: yes.**
- Configure them in the UI (Setting → Advance → Third-party connection → Webhook/API) or with
  **`PUT /shops/{SHOP_ID}`**.
- Request body `shop.{webhook_enable, webhook_url, webhook_email (error emails), webhook_types[],
  webhook_partner, webhook_headers (object)}`.
- `webhook_types`: `orders`, `customers`, `products`, `variations_warehouses`, `einvoices`, `auto_call`.
  Their payload schemas are `WebhookOrderResponse`, `WebhookCustomerResponse`, `WebhookProductResponse`,
  `WebhookInventoryResponse`, `WebhookEinvoiceResponse` and `WebhookAutoCallResponse`.
- **Signature, HMAC or secret: NOT FOUND in official docs.**
- Our inference, not a documented rule: custom `webhook_headers` are the only documented way to carry a
  shared secret.

Also documented and possibly relevant: `GET /shops/{SHOP_ID}/orders/{ORDER_ID}/messages`.
- It returns the Pancake conversation tied to an order, oldest to newest.
- Pagination uses `current_count`: 0 → newest 25; 25, 55, ... → 30 older each time.

## 7. Meta Messenger essentials (official developers.facebook.com)

### Send API

Source: https://developers.facebook.com/docs/messenger-platform/send-messages

- Request: `POST https://graph.facebook.com/v27.0/{PAGE-ID}/messages`.
- Body: `recipient.id` = PSID, `messaging_type`, `message` (for example `{text}`).
- `messaging_type` values:
  - `RESPONSE`: "a response to a received message". The doc's examples use the literal `RESPONSE`.
  - Updates: "sent proactively".
  - Tagged message (`MESSAGE_TAG` + `tag`): "sent outside the standard messaging window".
- Standard messaging window:
  - "For most user actions, it lasts 24 hours."
  - After a Click-to-Messenger ad, the window "may last up to 7 days from that message".
  - Outside the window, the message must carry a message tag that matches an allowed use case and is
    non-promotional.
  - The `HUMAN_AGENT` tag lets a person reply manually "within a 7-day period".
  - From 2026-04-27, the tags `CONFIRMED_EVENT_UPDATE`, `ACCOUNT_UPDATE` and `POST_PURCHASE_UPDATE` return
    error 100.
- Rate limits: no number is given. Error `613` means "Rate limit exceeded".

### Webhooks

Source: https://developers.facebook.com/docs/messenger-platform/webhooks

- **Verification:** Meta sends a GET with `hub.mode=subscribe`, `hub.verify_token` and `hub.challenge`.
  Check the token, then "Respond with the `hub.challenge` value".
- **Signature:** header **`X-Hub-Signature-256: sha256=<hex>`**. It is a **SHA256 HMAC of the payload keyed
  with the App Secret**.
  - The doc notes the signature is computed over the escaped-unicode form of the payload: "If you just
    calculate against the decoded bytes, you will end up with a different signature."
  - In practice, HMAC the raw request body bytes exactly as received, before JSON parsing.
  - Validation is "strongly recommend[ed]".
- **Delivery:**
  - Respond `200 OK` "within 5 or less seconds".
  - Failures are retried "immediately ... a few more times".
  - After 15 minutes of failures you get an alert.
  - After 1 hour of failures you get a "Webhooks Disabled" alert and the app is unsubscribed.
  - Deduplicate on your side.
- **Fields:** `messages` (a customer sent a message) and `message_echoes` (the business sent a message;
  Messenger only — on Instagram, echoes come with `messages`).

---

## Discrepancies and risks for the codebase

1. The POS product list in code (`GET /shops/{id}/products`) is **not in the official spec**. The documented
   equivalent is `GET /shops/{id}/products/variations`. The undocumented route may change without notice.
2. The messages GET `customer_id` param that production needs is **not in the official spec**.
3. Calling `generate_page_access_token` **kills the token** that the Pancake UI and other tools use. Prefer
   reading `settings{page_access_token}` through `GET /pages?fields=...`.
4. Pancake webhooks have **no documented signature**. Authenticate them by source IP `203.171.22.6`, plus a
   secret path or query token in the URL. That second measure is our suggestion, not documented.
   - Enabling webhooks costs one subscription connection slot per page.
5. `app_id` and `flow_id` do not exist in the official schemas. Use `from.is_automated`, `from.ai_generated`,
   and `from.admin_name` / `admin_id` / `uid` to tell bot messages from staff messages.
