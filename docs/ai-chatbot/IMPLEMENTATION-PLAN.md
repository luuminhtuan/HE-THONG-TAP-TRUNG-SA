# AI Chatbot — Kế hoạch triển khai (Phase 2)

| Phase | Việc | Đầu ra | Kiểm |
|:--|:--|:--|:--|
| 1 | Phân tích repo, luồng tin, bot AI Sale cũ, OpenAPI Pancake | ANALYSIS.md, API-INTEGRATION.md | đọc code + OpenAPI chính thức |
| 2 | Kiến trúc, CSDL, kế hoạch | ARCHITECTURE.md, DATABASE-DESIGN.md, file này | — |
| 3 | Lõi AI thuần: text, json, settings, classifier, generator, confidence, providers | `lib/ai-chatbot/*.ts` | `tests/ai-chatbot-core.test.cjs`, `-adapters` |
| 4 | KB + RAG: retrieval, kb-pos, kb-sync, admin-store (CRUD, lịch sử) | migration 0009 | `tests/ai-chatbot-pg.test.cjs` (Postgres thật) |
| 5 | Pancake: parse, client (public API + token page), webhook route, poller | `pancake-*.ts`, `worker.ts`, `/api/webhooks/pancake` | test bộ chuyển đổi (fetch giả) |
| 6 | Router + hàng đợi + khoá + outbox | `router.ts`, `store-pg.ts` | `tests/ai-chatbot-router.test.cjs` (18 tình huống) |
| 7 | Telegram + AI Learning | `telegram.ts`, `learning.ts`, route learning | core + pg test |
| 8 | Giao diện: 5 tab 🧠 AI Chatbot | `components/talpha/tabs/ai-chatbot/` | build production + xem trên trình duyệt |
| 9 | Kiểm thử | TEST-REPORT.md | `npm test`, `npm run test:ai-pg`, pytest, chạy thử AI thật |
| 10 | Soát bảo mật + review | FINAL-AUDIT.md | review độc lập |
| 11 | Hoàn thiện tài liệu | DEPLOYMENT.md, FINAL-REPORT.md, CHANGELOG.md | — |

Ràng buộc giữ suốt các phase: không commit / push / deploy, không gửi tin thật, không dùng dữ liệu khách thật cho AI,
không sửa module chat cũ (chỉ ĐỌC bảng `pancake_*`, `inbox_assignments`), không đổi quyền người dùng hiện có (tab AI mặc
định chỉ giám đốc).
