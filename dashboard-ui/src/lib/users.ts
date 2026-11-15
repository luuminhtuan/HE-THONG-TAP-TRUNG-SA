/**
 * TALPHA — MỘT chỗ duy nhất đọc/ghi danh sách người dùng.
 *
 * Bảng Postgres `users` (15/11/2026, migration 0006 — trước đó file config/users.json, hoặc biến
 * USERS_JSON chỉ đọc trên máy chủ). Hai nguồn cũ được chép vào bảng một lần ở bước migrate
 * (sync/core/nhap_file.py). Thêm / sửa / xoá người dùng ở /admin → Quản lý User, có hiệu lực ngay.
 *
 * Cột `username` là tên đăng nhập; phía code vẫn gọi là `email` (tên ô cũ của users.json) để các
 * route, phiên đăng nhập, phân quyền không phải đổi.
 */
import { giaoDich, query } from "@/lib/db";

/** Vai trò và tab mỗi vai thấy: config/talpha_rules.json → access.roles. */
export type UserRole = "admin" | "director" | "leader" | "marketer" | "sale";

export interface UserRecord {
    id: string;
    email: string;
    name: string;
    password: string;
    role: UserRole;
    projects: string[];
    /**
     * Team được xem (khoá ở access.teams: trung_dong · dong_nam_a · dong_a), ["*"] = mọi
     * team. Giám đốc/admin bỏ qua ô này. Thiếu ô hoặc rỗng = không thấy nước nào.
     */
    teams?: string[];
    status?: "active" | "pending";
}

type Dong = {
    id: string; username: string; name: string; password_hash: string; role: UserRole;
    teams: string[] | null; projects: string[] | null; status: "active" | "pending";
};

const COT = "id, username, name, password_hash, role, teams, projects, status";

function tuDong(d: Dong): UserRecord {
    return {
        id: d.id, email: d.username, name: d.name, password: d.password_hash, role: d.role,
        projects: d.projects || [], teams: d.teams || [], status: d.status,
    };
}

/** Đọc danh sách người dùng. Kho lỗi → mảng rỗng (login trả 401 / 500, không sập). */
export async function loadUsers(): Promise<UserRecord[]> {
    try {
        return (await query<Dong>(`SELECT ${COT} FROM users ORDER BY created_at, id`)).map(tuDong);
    } catch (e) {
        console.error("Không đọc được bảng users:", e);
        return [];
    }
}

/**
 * Sửa danh sách người dùng trong MỘT transaction có khoá bảng — đọc, gọi callback, ghi lại phần
 * khác đi (thêm / sửa / xoá). Hai người sửa cùng lúc thì người sau chờ người trước xong.
 */
export async function withUsersLock(
    callback: (users: UserRecord[]) => UserRecord[] | Promise<UserRecord[]>,
): Promise<UserRecord[]> {
    return giaoDich(async (q) => {
        await q("LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE");
        const cu = ((await q(`SELECT ${COT} FROM users ORDER BY created_at, id`)) as Dong[]).map(tuDong);
        // Callback được phép sửa thẳng phần tử (users[idx].name = …) — giữ bản chụp để so.
        const chup = new Map(cu.map((u) => [u.id, JSON.stringify(u)]));
        const moi = await callback(cu.map((u) => ({ ...u })));
        const conLai = new Set(moi.map((u) => u.id));
        for (const id of chup.keys()) {
            if (!conLai.has(id)) await q("DELETE FROM users WHERE id = @id", { id });
        }
        for (const u of moi) {
            if (chup.get(u.id) === JSON.stringify(u)) continue;
            await q(
                `INSERT INTO users (id, username, name, password_hash, role, teams, projects, status)
                 VALUES (@id, @username, @name, @password, @role, @teams::jsonb, @projects::jsonb, @status)
                 ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, name = EXCLUDED.name,
                   password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, teams = EXCLUDED.teams,
                   projects = EXCLUDED.projects, status = EXCLUDED.status, updated_at = now()`,
                {
                    id: u.id, username: u.email, name: u.name, password: u.password, role: u.role,
                    teams: JSON.stringify(u.teams || []), projects: JSON.stringify(u.projects || []),
                    status: u.status === "pending" ? "pending" : "active",
                });
        }
        return moi;
    });
}
