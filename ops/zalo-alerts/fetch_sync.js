// GET một route của dashboard (kèm chìa nội bộ) rồi in thân trả lời ra stdout — cho thi_truong.js gọi
// bằng execFileSync lúc bot nạp luật (rules.js đọc luật ĐỒNG BỘ khi được require, không await được).
// Dùng: node fetch_sync.js <url>. Lỗi / trả không phải 2xx → exit 1, lý do ở stderr.
require("./config");   // gói fetch: lượt gọi tới dashboard tự mang header x-talpha-token

const url = process.argv[2];
(async () => {
    try {
        const r = await fetch(url, { signal: AbortSignal.timeout(25_000) });
        const body = await r.text();
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${body.slice(0, 200)}`);
        process.stdout.write(body);
    } catch (e) {
        process.stderr.write(String((e && e.message) || e));
        process.exitCode = 1;
    }
})();
