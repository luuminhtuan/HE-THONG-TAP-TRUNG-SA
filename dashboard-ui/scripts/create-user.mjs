#!/usr/bin/env node
/**
 * Tạo tài khoản GIÁM ĐỐC từ terminal (16/11/2026) — cho DB còn trắng: bật đăng nhập (DASHBOARD_PUBLIC=false) mà
 * bảng users trống thì không ai vào được /admin → Quản lý User để tạo người đầu tiên.
 *
 *   docker compose exec dashboard node scripts/create-user.mjs
 *   (ngoài Docker:  cd dashboard-ui && DATABASE_URL=postgresql://… node scripts/create-user.mjs)
 *
 * Hỏi tên đăng nhập, tên hiển thị, mật khẩu (gõ ẩn, gõ lại để khớp). Người khác (leader, marketer, sale) tạo trên
 * trang sau khi đăng nhập. Băm mật khẩu như /api/users (bcrypt, 10 vòng); quyền như tài khoản giám đốc tạo trên trang.
 */
import { createInterface } from "node:readline";
import bcrypt from "bcryptjs";
import pg from "pg";

function ask(question, hidden = false) {
    return new Promise((resolve) => {
        const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        if (hidden) {
            // Không in ký tự gõ vào — chỉ in câu hỏi.
            rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(question); };
        }
        rl.question(question, (answer) => {
            rl.close();
            if (hidden) process.stdout.write("\n");
            resolve(answer);
        });
    });
}

async function main() {
    if (!process.env.DATABASE_URL) throw new Error("chưa đặt DATABASE_URL — chạy trong container dashboard của compose");
    if (!process.stdin.isTTY) throw new Error("cần terminal để gõ mật khẩu (docker compose exec, không dùng -T)");

    const username = (await ask("Tên đăng nhập: ")).trim().toLowerCase();
    if (!/^[a-z0-9._-]{2,40}$/.test(username)) throw new Error("tên đăng nhập 2–40 ký tự: chữ thường, số, . _ -");
    const name = (await ask("Tên hiển thị: ")).trim() || username;
    const password = await ask("Mật khẩu (ít nhất 8 ký tự): ", true);
    if (password.length < 8) throw new Error("mật khẩu ngắn hơn 8 ký tự");
    if ((await ask("Gõ lại mật khẩu: ", true)) !== password) throw new Error("hai lần gõ không khớp");

    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
        const taken = await client.query("SELECT 1 FROM users WHERE lower(username) = $1", [username]);
        if (taken.rowCount) throw new Error(`đã có tài khoản "${username}" — đổi mật khẩu trên trang /admin/users`);
        await client.query(
            `INSERT INTO users (id, username, name, password_hash, role, teams, projects, status)
             VALUES ($1, $2, $3, $4, 'director', '[]'::jsonb, '["TALPHA"]'::jsonb, 'active')`,
            [String(Date.now()), username, name, await bcrypt.hash(password, 10)]);
    } finally {
        await client.end();
    }
    console.log(`Đã tạo tài khoản giám đốc "${username}". Đăng nhập rồi tạo người khác ở /admin/users.`);
}

main().catch((e) => {
    console.error(`Không tạo được: ${e.message}`);
    process.exit(1);
});
