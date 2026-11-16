// Chạy MỘT câu SQL rồi in kết quả JSON ra stdout — cho lib/talpha/db-sync.ts gọi bằng
// execFileSync khi dashboard cần số trong kho NGAY lúc nạp code (luật thị trường, khoá kết nối),
// chỗ không await được. Đầu vào (stdin): {"sql": "...", "params": [...]}. Lỗi → exit 1, lý do ở stderr.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS chạy bằng node thuần
const { Client } = require("pg");

let vao = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => { vao += d; });
process.stdin.on("end", async () => {
    const { sql, params } = JSON.parse(vao || "{}");
    const c = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
    try {
        await c.connect();
        await c.query("SET TIME ZONE 'UTC'");
        const r = await c.query(sql, params || []);
        process.stdout.write(JSON.stringify(r.rows));
    } catch (e) {
        process.stderr.write(String((e && e.message) || e));
        process.exitCode = 1;
    } finally {
        await c.end().catch(() => {});
    }
});
