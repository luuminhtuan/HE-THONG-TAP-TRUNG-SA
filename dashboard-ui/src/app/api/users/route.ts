import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import bcrypt from "bcryptjs";
import { loadUsers, withUsersLock, type UserRecord, type UserRole } from "@/lib/users";
import { getAccess } from "@/lib/talpha/access";
import { ROLES, TEAMS } from "@/lib/talpha/access-rules";

// Đọc/ghi người dùng đi qua lib/users.ts — bảng Postgres `users`, ghi trong transaction có khoá.
// Bản trước tự đọc tự ghi ở đây, không khoá, và ghi thụt lề 2 trong khi bản kia
// ghi thụt lề 4: hai người sửa cùng lúc là mất một bản ghi.

// Quản lý người dùng: admin kỹ thuật HOẶC giám đốc. Hỏi lại kho người dùng chứ không tin
// vai trò ghi trong cookie — người vừa bị hạ quyền không còn sửa được ai. Chế độ mở (DASHBOARD_PUBLIC,
// máy chưa bật đăng nhập) cũng được (15/11/2026): bảng users còn trống thì phải tạo được tài khoản đầu
// tiên TRƯỚC khi bật đăng nhập, không thì không ai vào được. Chìa nội bộ (bot) thì không.
async function checkManagePermission(req: Request) {
    const session = await auth();
    const a = await getAccess(req, session);
    return { session, ok: !!a?.full && a.kind !== "internal" };
}

/** Vai trò phải là vai khai ở access.roles; team phải là team khai ở access.teams (hoặc "*"). */
function validateRoleTeams(role: unknown, teams: unknown): { loi: string } | { role?: UserRole; teams?: string[] } {
    if (role !== undefined && role !== null && role !== "" && !ROLES[String(role)]) {
        return { loi: `Vai trò "${role}" chưa khai ở talpha_rules.json → access.roles` };
    }
    if (teams === undefined || teams === null) return { role: (role || undefined) as UserRole | undefined };
    if (!Array.isArray(teams)) return { loi: "teams phải là danh sách" };
    const uniqueTeams = [...new Set(teams.map(String))];
    const unknownTeams = uniqueTeams.filter((t) => t !== "*" && !TEAMS[t]);
    if (unknownTeams.length) return { loi: `Team không có: ${unknownTeams.join(", ")}` };
    return { role: (role || undefined) as UserRole | undefined, teams: uniqueTeams.includes("*") ? ["*"] : uniqueTeams };
}

/** Chặn chung cho mọi thao tác GHI: phải có quyền. */
async function guardWrite(req: Request) {
    const { session, ok } = await checkManagePermission(req);
    if (!ok) return { session: null, res: NextResponse.json({ error: "Unauthorized" }, { status: 403 }) };
    return { session, res: null };
}

// ─── GET: danh sách người dùng (ẩn mật khẩu) ───
export async function GET(req: Request) {
    if (!(await checkManagePermission(req)).ok) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    return NextResponse.json((await loadUsers()).map(({ password: _password, ...rest }) => rest));
}

// ─── POST: thêm người dùng ───
export async function POST(req: Request) {
    const { res } = await guardWrite(req);
    if (res) return res;

    const body = await req.json();
    const { name, password, role, projects, teams } = body;
    // Tên đăng nhập ("loc", "thai"…) — ô cũ tên `email`, đăng nhập so không phân biệt hoa thường.
    const email = String(body.email || "").trim().toLowerCase();
    if (!email || !name || !password || !role) {
        return NextResponse.json({ error: "Thiếu trường bắt buộc" }, { status: 400 });
    }
    const validated = validateRoleTeams(role, teams ?? []);
    if ("loi" in validated) return NextResponse.json({ error: validated.loi }, { status: 400 });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser: UserRecord = {
        id: String(Date.now()),
        email, name, password: hashedPassword, role,
        projects: projects || [],
        teams: validated.teams || [],
    };

    // Kiểm trùng email NẰM TRONG khoá — kiểm ngoài khoá thì hai lần thêm cùng lúc
    // đều thấy "chưa trùng" rồi cùng ghi.
    let duplicate = false;
    await withUsersLock((users) => {
        if (users.some((u) => u.email.toLowerCase() === email)) { duplicate = true; return users; }
        return [...users, newUser];
    });
    if (duplicate) return NextResponse.json({ error: "Email đã tồn tại" }, { status: 409 });

    const { password: _password, ...userWithoutPassword } = newUser;
    return NextResponse.json(userWithoutPassword, { status: 201 });
}

// ─── PUT: sửa người dùng ───
export async function PUT(req: Request) {
    const { session, res } = await guardWrite(req);
    if (res) return res;

    const body = await req.json();
    const { id, name, password, role, projects, teams } = body;
    const email = body.email ? String(body.email).trim().toLowerCase() : "";
    if (!id) return NextResponse.json({ error: "Thiếu ID người dùng" }, { status: 400 });
    const validated = validateRoleTeams(role, teams);
    if ("loi" in validated) return NextResponse.json({ error: validated.loi }, { status: 400 });
    // Tự hạ quyền mình là tự khoá cửa /admin — không còn ai sửa lại được.
    if ((session?.user as { id?: string } | undefined)?.id === id && role && !ROLES[String(role)]?.full) {
        return NextResponse.json({ error: "Không tự hạ quyền giám đốc của chính mình" }, { status: 400 });
    }

    const hashedPassword = password ? await bcrypt.hash(password, 10) : null;

    // Kết quả lấy ra khỏi callback qua một hộp — TypeScript không theo dõi được
    // biến bị gán bên trong closure nên gán thẳng vào `let` sẽ bị thu hẹp về never.
    const outcome: { loi?: { error: string; status: number }; daSua?: UserRecord } = {};
    await withUsersLock((users) => {
        const idx = users.findIndex((u) => u.id === id);
        if (idx === -1) { outcome.loi = { error: "Không tìm thấy người dùng", status: 404 }; return users; }
        if (email && email !== users[idx].email.toLowerCase() && users.some((u) => u.email.toLowerCase() === email)) {
            outcome.loi = { error: "Email đã tồn tại", status: 409 }; return users;
        }
        if (email) users[idx].email = email;
        if (name) users[idx].name = name;
        if (role) users[idx].role = role;
        if (projects) users[idx].projects = projects;
        if (validated.teams) users[idx].teams = validated.teams;
        if (hashedPassword) users[idx].password = hashedPassword;
        outcome.daSua = users[idx];
        return users;
    });
    if (outcome.loi) return NextResponse.json({ error: outcome.loi.error }, { status: outcome.loi.status });

    const { password: _password, ...userWithoutPassword } = outcome.daSua!;
    return NextResponse.json(userWithoutPassword);
}

// ─── DELETE: xoá người dùng ───
export async function DELETE(req: Request) {
    const { session, res } = await guardWrite(req);
    if (res) return res;

    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Thiếu ID người dùng" }, { status: 400 });
    if ((session?.user as { id?: string } | undefined)?.id === id) {
        return NextResponse.json({ error: "Không thể tự xoá chính mình" }, { status: 400 });
    }

    let removed = false;
    await withUsersLock((users) => {
        const remaining = users.filter((u) => u.id !== id);
        removed = remaining.length !== users.length;
        return removed ? remaining : users;
    });
    if (!removed) return NextResponse.json({ error: "Không tìm thấy người dùng" }, { status: 404 });

    return NextResponse.json({ success: true });
}
