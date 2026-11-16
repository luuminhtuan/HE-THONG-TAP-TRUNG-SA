"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { QrCode, X } from "lucide-react";

/*
 * Băng cảnh báo bot Zalo trên đầu dashboard (12/11/2026, Sỹ Anh: 03/11 Zalo đá phiên web của nick bot,
 * cookie chết, bot câm 9 ngày không ai biết — mất đăng nhập thì chính bot không nhắn vào Zalo được).
 * Chỉ giám đốc thấy (shell chỉ gắn khi me.full; /api/talpha/zalo cũng chỉ giám đốc).
 *
 * Đọc GET /api/talpha/zalo — bảng zalo_bot_status do bot ghi mỗi 30 giây (ops/zalo-alerts/bot_control.js):
 *   - chưa có dòng nào (máy chưa từng chạy bot) → không hiện gì;
 *   - quá 90 giây không thấy nhịp tim → "Bot Zalo không chạy";
 *   - bot chạy mà logged_in = false (chưa ghép nick, cookie chết, Zalo đóng kết nối) → băng đỏ, nút sang
 *     /admin → Khoá kết nối → Zalo để ghép lại nick bằng mã QR. Quét QR làm ở trang đó, không làm ở đây.
 * Bot chạy bình thường thì không hiện gì.
 */
type Overview = {
    online: boolean;
    status: { logged_in: boolean; account_name: string | null; last_error: string | null; heartbeat_at: string | null } | null;
};

const vnTime = (s?: string | null) => (s ? new Date(s).toLocaleString("vi-VN", {
    hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", timeZone: "Asia/Ho_Chi_Minh",
}) : "?");
const PAIR_HREF = "/admin/credentials?tab=zalo";

export default function ZaloBotBanner() {
    const [data, setData] = useState<Overview | null>(null);
    const [justRecovered, setJustRecovered] = useState(false);
    const wasDown = useRef(false);

    const load = useCallback(async () => {
        try {
            const r = await fetch("/api/talpha/zalo", { cache: "no-store" });
            if (!r.ok) return;
            const d = (await r.json()) as Overview;
            const down = !!d.status && (!d.online || !d.status.logged_in);
            if (wasDown.current && !down && d.status) setJustRecovered(true);
            wasDown.current = down;
            setData(d);
        } catch { /* mạng chập chờn — lần sau */ }
    }, []);

    useEffect(() => {
        const first = setTimeout(load, 0);
        const id = setInterval(load, 60_000);
        return () => { clearTimeout(first); clearInterval(id); };
    }, [load]);

    const status = data?.status;
    if (!data || !status) return null;

    if (justRecovered && data.online && status.logged_in) {
        return (
            <div className="flex items-start justify-between gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                <span>✅ Bot Zalo đã đăng nhập lại{status.account_name ? ` (nick ${status.account_name})` : ""}. Các nhóm ADS + VẬN ĐƠN nhận tin lại từ mốc kế tiếp.</span>
                <button onClick={() => setJustRecovered(false)} className="shrink-0 rounded p-1 hover:bg-emerald-100 dark:hover:bg-emerald-900" aria-label="Đóng"><X className="h-4 w-4" /></button>
            </div>
        );
    }

    if (!data.online) {
        return (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                ⚠️ <b>Bot Zalo không chạy</b> — lần cuối báo về lúc {vnTime(status.heartbeat_at)}. Các nhóm ADS + VẬN ĐƠN không nhận tin.
                Kiểm tra máy chủ: Docker <code>docker compose --profile zalo up -d zalo</code>, pm2 <code>talpha-zalo-alerts</code>.
            </div>
        );
    }

    if (status.logged_in) return null;

    const neverPaired = !status.account_name;
    return (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
            <div className="min-w-0">
                <b>🔴 {neverPaired ? "Bot Zalo chưa ghép nick" : `Bot Zalo mất đăng nhập (nick ${status.account_name})`}</b> — các nhóm ADS + VẬN ĐƠN đang không nhận tin.
                {status.last_error && <span className="block text-xs opacity-80">{status.last_error}</span>}
                <span className="block text-xs opacity-70">Đừng mở Zalo PC / Zalo Web bằng nick bot — Zalo chỉ cho một phiên web, mở là bot bị đá ra.</span>
            </div>
            <Link href={PAIR_HREF} className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-red-600 px-3 py-2 font-medium text-white hover:bg-red-700">
                <QrCode className="h-4 w-4" /> {neverPaired ? "Ghép nick bằng mã QR" : "Ghép lại nick (quét QR)"}
            </Link>
        </div>
    );
}
