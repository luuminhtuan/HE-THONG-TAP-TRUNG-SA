import { Package } from "lucide-react";
import type { SortKey } from "./types";

// Thumbnail ảnh SP (từ POS) — placeholder khi chưa có ảnh
export function Thumb({ src, name }: { src?: string; name: string }) {
    if (!src) {
        return (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground/40">
                <Package className="h-4 w-4" />
            </div>
        );
    }
    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            src={src}
            alt={name}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-9 w-9 shrink-0 rounded-md border border-border object-cover"
            onError={e => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
        />
    );
}

export const CHART_COLORS = ["#00E27A", "#09AE82", "#FF7312", "#958F83", "#FF6161", "#12DEA7", "#FF3131", "#09AE82", "#FF9042", "#6E695E"];

// Màu badge theo trạng thái
export const STATUS_STYLE: Record<string, string> = {
    "CẦN NHẬP GẤP": "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
    "Hết hàng toàn hệ thống": "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400",
    "Sắp thiếu (<30 ngày)": "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
    "Bán chạy": "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
    "Ổn định": "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400",
    "Tồn đọng": "bg-slate-200 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300",
    "Lỗi số liệu (tồn âm)": "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400",
};

// Ô tiêu đề bấm được để đổi cột sắp xếp.
// Định nghĩa Ở NGOÀI component: khai bên trong thì mỗi lần render React thấy một
// kiểu component MỚI và tháo rồi dựng lại toàn bộ hàng tiêu đề.
export function SortTh({ label, sk, sortKey, sortDir, onSort }: {
    label: string; sk: SortKey; sortKey: SortKey; sortDir: "asc" | "desc";
    onSort: (k: SortKey) => void;
}) {
    return (
        <th className="text-right py-2 px-2 cursor-pointer select-none hover:text-foreground whitespace-nowrap"
            onClick={() => onSort(sk)}>
            {label} {sortKey === sk ? (sortDir === "desc" ? "↓" : "↑") : ""}
        </th>
    );
}

export function daysColor(d: number | null) {
    if (d === null) return "text-muted-foreground/50";
    if (d <= 7) return "text-rose-500 font-semibold";
    if (d < 30) return "text-amber-500 font-medium";
    return "text-emerald-500";
}
