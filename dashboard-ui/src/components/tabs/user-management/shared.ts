export interface UserData {
    id: string;
    email: string;
    name: string;
    role: string;
    projects: string[];
    /** Team được xem (khoá ở talpha_rules.json → access.teams), ["*"] = mọi team. */
    teams?: string[];
    /** "pending" = đã khoá, không đăng nhập được (vd tài khoản chung cũ talpha@levelup). */
    status?: string;
}

// Dashboard chỉ phục vụ một dự án — tài khoản mới mặc định TALPHA, không thì đăng nhập
// bị chặn "không có quyền truy cập dashboard này" (api/auth/validate).
export const DEFAULT_PROJECTS = ["TALPHA"];

// Vai trò + team đọc từ talpha_rules.json → access (qua /api/talpha/me), không gõ ở đây.
// Phân quyền theo team từ 05/10/2026: role quyết định THẤY TAB NÀO, team quyết định THẤY NƯỚC NÀO.
export type RoleOpt = { key: string; label: string; desc: string; full: boolean };
export type TeamOpt = { key: string; name: string; leader: string; markets: string[] };
export const ROLE_COLOR: Record<string, string> = {
    director: "text-orange-400", admin: "text-red-400", leader: "text-violet-400",
    marketer: "text-sky-400", sale: "text-emerald-400",
};
