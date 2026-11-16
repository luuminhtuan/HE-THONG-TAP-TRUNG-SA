import { Pencil, Trash2, Shield, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UserData } from "./shared";

/** Bảng danh sách user — vai trò, team được xem, nút sửa / xoá. */
export function UsersTable({ users, roleLabel, teamText, onEdit: openEditForm, onDelete: handleDelete }: {
    users: UserData[];
    roleLabel: (role: string) => { label: string; color: string } | undefined;
    teamText: (u: UserData) => string;
    onEdit: (user: UserData) => void;
    onDelete: (user: UserData) => void;
}) {
    // Điện thoại: bảng cuộn ngang trong khung, không đẩy cả trang.
    return (
        <div className="overflow-x-auto rounded-xl border border-white/[0.08] bg-white/[0.02]">
            <table className="w-full min-w-[640px] text-sm">
                <thead>
                    <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                        <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                            User
                        </th>
                        <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                            Vai trò
                        </th>
                        <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                            Team được xem
                        </th>
                        <th className="text-right px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                            Hành động
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {users.map((user) => {
                        const rLabel = roleLabel(user.role);
                        return (
                            <tr
                                key={user.id}
                                className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors"
                            >
                                <td className="px-5 py-4">
                                    <div className="flex items-center gap-3">
                                        <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center text-indigo-400 text-sm font-bold">
                                            {user.name
                                                .charAt(0)
                                                .toUpperCase()}
                                        </div>
                                        <div>
                                            <p className="font-semibold text-foreground">
                                                {user.name}
                                                {user.status === "pending" && (
                                                    <span className="ml-2 rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-rose-500">
                                                        ĐÃ KHOÁ
                                                    </span>
                                                )}
                                            </p>
                                            <p className="text-xs text-slate-500 flex items-center gap-1">
                                                <Mail className="h-3 w-3" />
                                                {user.email}
                                            </p>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-5 py-4">
                                    <span
                                        className={cn(
                                            "flex items-center gap-1.5 text-xs font-medium",
                                            rLabel?.color
                                        )}
                                    >
                                        <Shield className="h-3.5 w-3.5" />
                                        {rLabel?.label || user.role}
                                    </span>
                                </td>
                                <td className="px-5 py-4">
                                    <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground/80">
                                        {teamText(user)}
                                    </span>
                                </td>
                                <td className="px-5 py-4 text-right">
                                    <div className="flex items-center justify-end gap-1.5">
                                        <button
                                            onClick={() =>
                                                openEditForm(user)
                                            }
                                            className="p-2 rounded-lg hover:bg-white/[0.06] text-slate-400 hover:text-indigo-400 transition-colors"
                                            title="Sửa"
                                        >
                                            <Pencil className="h-4 w-4" />
                                        </button>
                                        <button
                                            onClick={() =>
                                                handleDelete(user)
                                            }
                                            className="p-2 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-colors"
                                            title="Xóa"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
