import { VND as baseVND } from "../ledger-shared";
import type { Sev } from "./types";

/**
 * In tiền, nhưng CHẶN số vô lý.
 * Đọc dính hai cột số trong PDF là ra 2,9 × 10^48 đồng; in nguyên dãy đó ra
 * thì vỡ layout mà người đọc vẫn tưởng là tiền. Nói thẳng nó là số đọc sai.
 */
const ABSURD_AMOUNT_THRESHOLD = 1e12;
export const VND = (n: number | null | undefined) =>
    n != null && Math.abs(n) >= ABSURD_AMOUNT_THRESHOLD ? "số đọc sai" : baseVND(Number(n || 0));

export const API = "/api/talpha/ads-recon";

/** Thêm file vào ô, bỏ bản trùng ngay tại chỗ — chọn lại lần hai không nhân đôi. */
export function mergeFiles(cur: File[], incoming: File[]): File[] {
    const existing = new Set(cur.map((f) => f.name + ":" + f.size));
    return [...cur, ...incoming.filter((f) => !existing.has(f.name + ":" + f.size))];
}

export const SEV_BOX: Record<Sev, string> = {
    critical: "border-l-rose-500 bg-rose-50/70 dark:bg-rose-500/[0.07]",
    warn: "border-l-amber-400 bg-amber-50/60 dark:bg-amber-500/[0.06]",
    info: "border-l-slate-300 bg-slate-50/70 dark:border-l-slate-600 dark:bg-white/[0.03]",
};
export const CONF: Record<string, string> = {
    cao: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
    vua: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
    thap: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300",
};

export const TH = "whitespace-nowrap px-3 py-2 text-left text-[11px] uppercase tracking-wide text-muted-foreground";
export const TD = "whitespace-nowrap px-3 py-2";
