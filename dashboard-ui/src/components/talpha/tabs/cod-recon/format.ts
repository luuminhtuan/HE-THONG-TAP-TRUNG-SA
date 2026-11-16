/** Hàm định dạng + soạn tin thuần (không hook) của tab Tiền COD về. */
import { TWD } from "../ledger-shared";
import type { Currency, MarketPeriod, Period } from "./types";

export const shortFile = (f: string) => f.replace(/ĐỐI SOÁT COD|TAIWAN|\.xlsx?$/gi, "").trim() || f;
export const dmy = (s: string) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "—");

export function discrepancyMessage(p: Period, lang: "vi" | "zh"): string {
    if (lang === "zh") {
        const lines = p.lech_tien.map((l) =>
            `${l.order_no} · ${l.tracking} · 訂單 ${Math.round(l.cod_twd).toLocaleString("vi-VN")} NT$ / ` +
            `實付 ${Math.round(l.paid_twd ?? 0).toLocaleString("vi-VN")} NT$`).join("\n");
        return `您好，${shortFile(p.filename)} 這期對帳單中，以下訂單的撥款金額與我方訂單金額不符：\n\n` +
            `${lines}\n\n麻煩協助核對，謝謝！`;
    }
    const lines = p.lech_tien.map((l) =>
        `${l.order_no} · ${l.tracking} · đơn ${Math.round(l.cod_twd).toLocaleString("vi-VN")} NT$ / ` +
        `trả ${Math.round(l.paid_twd ?? 0).toLocaleString("vi-VN")} NT$`).join("\n");
    return `Chào bạn, kỳ sao kê ${shortFile(p.filename)} có mấy đơn số tiền trả về không khớp ` +
        `với số trên đơn của mình:\n\n${lines}\n\nNhờ bạn kiểm tra lại giúp mình nhé. Cảm ơn bạn!`;
}

export const COLUMN_LABELS: Record<string, string> = { tracking: "mã vận đơn", order_id: "mã đơn", amount: "tiền", paid_date: "ngày" };
export const periodName = (f: string) => f.replace(/\.(xlsx|csv|tsv|txt)$/i, "").trim() || f;

/** Tin hỏi khoản trả lệch — như tinLech của Đài, đúng đồng tiền của nước. */
export function marketDiscrepancyMessage(k: MarketPeriod, lang: "vi" | "zh", sym: string): string {
    const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString("vi-VN");
    if (lang === "zh") {
        const lines = k.lech_tien.map((l) => `${l.order_no} · ${l.tracking} · 訂單 ${fmt(l.cod)} ${sym} / 實付 ${fmt(l.tra)} ${sym}`).join("\n");
        return `您好，${periodName(k.filename)} 這期對帳單中，以下訂單的撥款金額與我方訂單金額不符：\n\n${lines}\n\n麻煩協助核對，謝謝！`;
    }
    const lines = k.lech_tien.map((l) => `${l.order_no} · ${l.tracking} · đơn ${fmt(l.cod)} ${sym} / trả ${fmt(l.tra)} ${sym}`).join("\n");
    return `Chào bạn, kỳ sao kê ${periodName(k.filename)} có mấy đơn số tiền trả về không khớp với số trên đơn của mình:\n\n${lines}\n\nNhờ bạn kiểm tra lại giúp mình nhé. Cảm ơn bạn!`;
}

export const TW_CURRENCY: Currency = { ky: "NT$", ma: "TWD", fmt: TWD };

export const RMB2 = (n: number) => `${n.toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}¥`;
