import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { loadUsers } from "@/lib/users";

// ─── Project mà deployment này phục vụ (TALPHA-only) ───
// Map route mode → project ID; mặc định TALPHA cho repo single-project.
const ROUTE_TO_PROJECT: Record<string, string> = { talpha: "TALPHA" };
const DEPLOYMENT_PROJECT =
    ROUTE_TO_PROJECT[(process.env.NEXT_PUBLIC_DEPLOYMENT_MODE || "talpha").toLowerCase()] ||
    "TALPHA";

// User truy cập được khi có wildcard "*" hoặc thuộc đúng project của deployment.
function canAccessDeployment(projects: string[]): boolean {
    return projects.includes("*") || projects.includes(DEPLOYMENT_PROJECT);
}

// ─── Chặn dò mật khẩu (16/11/2026) ───
// Route nằm dưới /api/auth/* nên ai cũng gọi thẳng được (proxy.ts mở cho đăng nhập). Gọi qua NextAuth thì IP luôn là
// máy chủ, nên đếm theo TÊN ĐĂNG NHẬP: sai quá MAX_FAILURES lần trong FAILURE_WINDOW_MS thì từ chối tới hết cửa sổ.
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60_000;
const failures = new Map<string, { count: number; firstAt: number }>();

function isLocked(username: string): boolean {
    const f = failures.get(username);
    if (!f) return false;
    if (Date.now() - f.firstAt > FAILURE_WINDOW_MS) {
        failures.delete(username);
        return false;
    }
    return f.count >= MAX_FAILURES;
}

function recordFailure(username: string): void {
    const f = failures.get(username);
    if (!f || Date.now() - f.firstAt > FAILURE_WINDOW_MS) failures.set(username, { count: 1, firstAt: Date.now() });
    else f.count++;
}

// Tên không tồn tại vẫn so bcrypt với một băm giả — trả lời cùng thời gian, không lộ tên nào có thật.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= bcrypt.hash("talpha-khong-co-tai-khoan-nay", 10));

// ─── Validate credentials (called from NextAuth authorize callback) ───
export async function POST(req: Request) {
    try {
        const { email, password } = await req.json();

        if (!email || !password) {
            return NextResponse.json(null, { status: 400 });
        }

        // Nguồn danh sách: lib/users.ts (bảng Postgres `users`).
        const users = await loadUsers();
        if (!users.length) {
            console.error("Không đọc được danh sách người dùng — bảng users trống hoặc kho lỗi");
            return NextResponse.json(null, { status: 500 });
        }

        const username = String(email).toLowerCase();
        if (isLocked(username)) {
            return NextResponse.json({ error: "Thử sai quá nhiều lần — đợi 15 phút rồi thử lại" }, { status: 429 });
        }
        const user = users.find((u) => u.email.toLowerCase() === username);
        // Kiểm mật khẩu TRƯỚC mọi thông báo riêng (chờ duyệt, không có quyền): chưa đúng mật khẩu thì câu trả lời
        // như nhau cho tên có thật lẫn tên bịa.
        const passwordMatch = await bcrypt.compare(String(password), user ? user.password : await getDummyHash());
        if (!user || !passwordMatch) {
            recordFailure(username);
            return NextResponse.json(null, { status: 401 });
        }
        failures.delete(username);

        // Kiểm tra tài khoản đang chờ duyệt
        if (user.status === "pending") {
            return NextResponse.json(
                { error: "Tài khoản đang chờ duyệt" },
                { status: 403 }
            );
        }

        // TALPHA-only: chặn tài khoản hợp lệ nhưng không có quyền vào deployment này
        // (vd account dự án cũ stramark@levelup projects=['STRAMARK']).
        if (!canAccessDeployment(user.projects)) {
            return NextResponse.json(
                { error: "Tài khoản không có quyền truy cập dashboard này" },
                { status: 403 }
            );
        }

        // Return user without password
        return NextResponse.json({
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            projects: user.projects,
        });
    } catch {
        return NextResponse.json(null, { status: 500 });
    }
}
