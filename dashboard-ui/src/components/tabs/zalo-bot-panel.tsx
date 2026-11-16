"use client";

// Bot Zalo (16/11/2026) — tab "Zalo" của Khoá kết nối: ghép nick phụ bằng mã QR, chọn nhóm nhận tin từng nước,
// gửi tin thử, bỏ ghép. Trang chỉ GHI YÊU CẦU (/api/talpha/zalo); bot trên máy chủ (ops/zalo-alerts/bot_control.js)
// làm rồi ghi lại trạng thái — vài giây sau trang thấy. Phiên đăng nhập Zalo nằm ở máy chạy bot, không về đây.
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, MessageCircle, QrCode, RefreshCw, Send, Unplug, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type ZaloGroup = { id: string; name: string; members?: number | null };
type ZaloRequest = {
    id: number; action: string; payload: Record<string, string>; requested_by: string | null;
    requested_at: string; status: "pending" | "running" | "ok" | "failed"; result: string | null;
};
type Overview = {
    online: boolean;
    status: {
        logged_in: boolean; account_name: string | null; markets: string[]; groups: ZaloGroup[];
        market_groups: Record<string, { id: string; name: string }>;
        pairing: { stage: "qr" | "scanned" | "done" | "failed"; qr_png?: string | null; message?: string | null } | null;
        last_error: string | null; heartbeat_at: string | null;
    } | null;
    requests: ZaloRequest[];
};
type MarketInfo = { code: string; display: string; flag?: string };

const ACTION_LABEL: Record<string, string> = {
    pair: "Ghép nick", refresh_groups: "Tải danh sách nhóm", set_group: "Chọn nhóm", send_test: "Gửi tin thử", unpair: "Bỏ ghép",
};
const timeVN = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";

export default function ZaloBotPanel() {
    const [data, setData] = useState<Overview | null>(null);
    const [markets, setMarkets] = useState<MarketInfo[]>([]);
    const [error, setError] = useState("");
    const [sending, setSending] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const r = await fetch("/api/talpha/zalo", { cache: "no-store" });
            const j = await r.json();
            if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
            setData(j);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    }, []);

    useEffect(() => {
        load();
        fetch("/api/talpha/markets", { cache: "no-store" }).then((r) => r.json())
            .then((j) => setMarkets(j.markets || [])).catch(() => {});
    }, [load]);

    // Đang ghép / còn yêu cầu đang chờ → hỏi mỗi 2 giây (mã QR, kết quả gửi thử); không thì 10 giây.
    const busy = !!data && (data.requests.some((x) => x.status === "pending" || x.status === "running")
        || data.status?.pairing?.stage === "qr" || data.status?.pairing?.stage === "scanned");
    useEffect(() => {
        const timer = setInterval(load, busy ? 2000 : 10_000);
        return () => clearInterval(timer);
    }, [busy, load]);

    const request = async (action: string, payload: Record<string, string> = {}) => {
        const key = `${action}:${payload.market || ""}`;
        setSending(key);
        setError("");
        try {
            const r = await fetch("/api/talpha/zalo", {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, payload }),
            });
            const j = await r.json();
            if (j.requests) setData(j);
            if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setSending(null);
        }
    };

    if (!data) {
        return error
            ? <p className="text-sm text-red-400">{error}</p>
            : <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />;
    }
    const s = data.status;
    const pairing = s?.pairing;
    const codes = s?.markets?.length ? s.markets : markets.map((m) => m.code);
    const marketName = (code: string) => {
        const m = markets.find((x) => x.code === code);
        return m ? `${m.flag ? m.flag + " " : ""}${m.display}` : code;
    };
    const isSending = (action: string, market = "") => sending === `${action}:${market}`;

    return (
        <div className="space-y-4">
            {/* Trạng thái */}
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
                <div className="space-y-1">
                    <p className="flex items-center gap-2 font-semibold text-foreground">
                        <span className={cn("h-2 w-2 rounded-full", data.online ? "bg-emerald-500" : "bg-rose-500")} />
                        {data.online ? "Bot Zalo đang chạy" : "Bot Zalo chưa chạy"}
                        <span className="text-xs font-normal text-slate-500">· nhịp tim {timeVN(s?.heartbeat_at)}</span>
                    </p>
                    {!data.online && (
                        <p className="text-xs text-slate-400">
                            Bật bot trên máy chủ: <code className="rounded bg-white/[0.06] px-1">docker compose --profile zalo up -d zalo</code>
                            {" "}(máy chủ pm2: <code className="rounded bg-white/[0.06] px-1">pm2 start talpha-zalo-alerts</code>).
                        </p>
                    )}
                    <p className="text-sm text-slate-300">
                        {s?.logged_in ? <>Đã ghép nick <b className="text-foreground">{s.account_name || "(không rõ tên)"}</b></> : "Chưa ghép nick Zalo"}
                    </p>
                    {s?.last_error && <p className="text-xs text-amber-500">Lỗi gần nhất: {s.last_error}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => request("pair")} disabled={!data.online || !!sending || busy}
                        className="flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-600 disabled:opacity-50">
                        {isSending("pair") ? <Loader2 className="h-3 w-3 animate-spin" /> : <QrCode className="h-3 w-3" />}
                        {s?.logged_in ? "Ghép nick khác" : "Ghép nick Zalo"}
                    </button>
                    {s?.logged_in && (
                        <button type="button" disabled={!data.online || !!sending || busy}
                            onClick={() => { if (confirm("Bỏ ghép nick? Bot ngừng gửi tin tới khi ghép lại.")) request("unpair"); }}
                            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-white/[0.06] hover:text-foreground disabled:opacity-50">
                            <Unplug className="h-3 w-3" /> Bỏ ghép
                        </button>
                    )}
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                    <AlertCircle className="h-4 w-4 shrink-0" /> {error}
                </div>
            )}

            {/* Ghép nick bằng QR */}
            {pairing && (pairing.stage === "qr" || pairing.stage === "scanned") && (
                <div className="flex flex-wrap items-center gap-4 rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-4">
                    {pairing.stage === "qr" && pairing.qr_png && (
                        // eslint-disable-next-line @next/next/no-img-element -- ảnh QR base64 bot vừa xin, không qua next/image
                        <img src={`data:image/png;base64,${pairing.qr_png}`} alt="Mã QR đăng nhập Zalo"
                            className="h-48 w-48 rounded-lg bg-white p-2" />
                    )}
                    <div className="max-w-md space-y-1 text-sm text-slate-300">
                        {pairing.stage === "qr" ? (
                            <>
                                <p className="font-semibold text-foreground">Quét mã bằng app Zalo của NICK PHỤ</p>
                                <p>Mở Zalo trên điện thoại của nick phụ → biểu tượng quét QR → quét mã này → bấm xác nhận đăng nhập.</p>
                                <p className="text-xs text-slate-500">Mã hết hạn sau khoảng 100 giây, bot tự làm mã mới (tối đa 5 lần). Đừng dùng nick chính của ai.</p>
                            </>
                        ) : (
                            <p className="font-semibold text-foreground">{pairing.message || "Đã quét — bấm XÁC NHẬN đăng nhập trên điện thoại."}</p>
                        )}
                    </div>
                </div>
            )}
            {pairing && (pairing.stage === "done" || pairing.stage === "failed") && pairing.message && (
                <p className={cn("text-sm", pairing.stage === "done" ? "text-emerald-400" : "text-rose-400")}>{pairing.message}</p>
            )}

            {/* Nhóm nhận tin từng nước */}
            {s?.logged_in && (
                <div className="space-y-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <p className="flex items-center gap-2 font-semibold text-foreground">
                                <MessageCircle className="h-4 w-4 text-indigo-400" /> Nhóm nhận tin từng nước
                            </p>
                            <p className="mt-0.5 text-xs text-slate-500">
                                Nick phụ phải ở sẵn trong nhóm. Nhóm tên “ADS + VẬN ĐƠN &lt;nước&gt;” bot tự nhận; chọn ở đây để đổi sang nhóm khác (vd nhóm thử).
                            </p>
                        </div>
                        <button type="button" onClick={() => request("refresh_groups")} disabled={!data.online || !!sending}
                            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-white/[0.06] hover:text-foreground disabled:opacity-50">
                            {isSending("refresh_groups") ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                            Tải lại danh sách nhóm ({s.groups.length})
                        </button>
                    </div>
                    <div className="space-y-2">
                        {codes.map((code) => {
                            const current = s.market_groups?.[code];
                            return (
                                <div key={code} className="flex flex-wrap items-center gap-2">
                                    <span className="w-32 shrink-0 text-sm text-slate-300">{marketName(code)}</span>
                                    <select value={current?.id || ""} disabled={!data.online || !!sending}
                                        onChange={(e) => e.target.value && request("set_group", { market: code, group_id: e.target.value })}
                                        className="min-w-0 flex-1 rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 py-1.5 text-sm text-foreground focus:border-indigo-500 focus:outline-none">
                                        <option value="">— chưa có nhóm (không gửi gì) —</option>
                                        {current && !s.groups.some((g) => g.id === current.id) && <option value={current.id}>{current.name}</option>}
                                        {s.groups.map((g) => (
                                            <option key={g.id} value={g.id}>{g.name}{g.members ? ` · ${g.members} người` : ""}</option>
                                        ))}
                                    </select>
                                    <button type="button" onClick={() => request("send_test", { market: code })}
                                        disabled={!data.online || !current || !!sending}
                                        className="flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-foreground hover:bg-white/[0.1] disabled:opacity-40">
                                        {isSending("send_test", code) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Gửi thử
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Yêu cầu gần đây */}
            {data.requests.length > 0 && (
                <div className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Việc gần đây</p>
                    {data.requests.map((x) => (
                        <div key={x.id} className="flex items-start gap-2 text-xs text-slate-400">
                            {x.status === "ok" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                                : x.status === "failed" ? <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />
                                : <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-indigo-400" />}
                            <span>
                                <span className="text-slate-300">{ACTION_LABEL[x.action] || x.action}{x.payload?.market ? ` ${x.payload.market}` : ""}</span>
                                {" · "}{timeVN(x.requested_at)}{x.requested_by ? ` · ${x.requested_by}` : ""}
                                {x.status === "pending" ? " · chờ bot nhặt" : x.status === "running" ? " · bot đang làm" : ""}
                                {x.result ? <span className={x.status === "failed" ? "text-rose-400" : ""}> — {x.result}</span> : null}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
