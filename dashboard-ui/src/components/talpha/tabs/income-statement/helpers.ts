import { formatMoney } from "../../utils";
import { DASH } from "../../report";
import type { Fees, MarketResult } from "./types";

export const totalFees = (p: Fees) => p.di + p.giao + p.hoan + p.ty_gia;
export const formatDmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
export const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : DASH);
export const signed = (n: number) => `${n >= 0 ? "+" : "−"}${formatMoney(Math.abs(n))}`;
export const profitClass = (n: number | null) => (n == null ? "" : n >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400");
export const formatMonth = (ym: string | null) => (ym ? `${ym.slice(5, 7)}/${ym.slice(0, 4)}` : "nay");

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const r = await fetch(url, init);
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d?.error) throw new Error(d?.error || `HTTP ${r.status}`);
    return d as T;
}

/** Cầu từ Doanh số xuống Doanh thu dự kiến của một nước — các bậc cộng lại đúng bằng nhau. */
export function salesBridge(n: MarketResult) {
    if (!n.tk) return null;
    const k = n.tk.kien;
    const awaiting3pl = n.cho_len_3pl?.vnd || 0;
    const inTransit = k.dang_di.cod + k.cho_gui.cod + awaiting3pl;
    const dt = n.du_kien.doanh_thu;
    return {
        khong_thanh_kien: n.doanh_so - k.tong.cod - awaiting3pl,
        hoan_huy: k.hoan.cod + k.huy.cod,
        // Phần còn lại của tiền đang đi mà tỉ lệ giao nói sẽ không về.
        uoc_hoan: inTransit - (dt - k.giao.cod),
        dang_di: inTransit,
    };
}
