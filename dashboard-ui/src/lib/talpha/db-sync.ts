// ═══════════════════════════════════════════════════════════════════
// Đọc kho số KHÔNG cần await (15/11/2026) — chỉ cho hai chỗ phải có số ngay lúc nạp code:
//   • rules.ts: RULES (luật gốc + thị trường nhập trên trang, bảng market_overrides) là hằng số
//     mà hàng chục hằng số khác sinh ra từ nó, tính một lần khi module được nạp;
//   • credentials.ts: docKhoa() được gọi đồng bộ ở khắp nơi — lần đọc đầu nạp bảng api_credentials.
// Node không có driver Postgres đồng bộ, nên chạy scripts/sync-query.cjs ở tiến trình con và
// chờ nó xong (≈ 100–300 ms, một lần mỗi tiến trình). Chỗ nào await được thì dùng lib/db.ts.
// ═══════════════════════════════════════════════════════════════════
import { execFileSync } from "child_process";
import path from "path";

export function querySync<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    if (!process.env.DATABASE_URL) throw new Error("chưa đặt DATABASE_URL");
    const script = path.join(process.cwd(), "scripts", "sync-query.cjs");
    try {
        const out = execFileSync(process.execPath, [script], {
            input: JSON.stringify({ sql, params }),
            env: process.env,
            timeout: 15_000,
            maxBuffer: 64 * 1024 * 1024,
            stdio: ["pipe", "pipe", "pipe"],
        });
        return JSON.parse(out.toString("utf8") || "[]") as T[];
    } catch (e) {
        const err = e as { stderr?: Buffer; message?: string };
        throw new Error(err.stderr?.toString("utf8").trim() || err.message || String(e));
    }
}
