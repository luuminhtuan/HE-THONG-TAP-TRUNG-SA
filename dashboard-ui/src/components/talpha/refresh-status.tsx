"use client";

// ═══════════════════════════════════════════════════════════════════
// Đèn "Cập nhật lúc …" + nút "Cập nhật ngay" trên thanh đầu dashboard (15/11/2026).
//
// Trước đây người dùng không có cách nào biết số đang kéo về, kéo về lúc nào, hay đang hỏng (token Meta
// chết 02/09 — Sheet "đẹp giả" 46 tiếng không ai hay). Đèn đọc /api/talpha/refresh: xanh = số mới,
// vàng = số cũ hơn 75 phút, đỏ = lượt kéo / báo cáo gần nhất hỏng hoặc có TKQC / shop đọc lỗi. Bấm vào
// xem chi tiết; "Cập nhật ngay" ghi yêu cầu, lịch việc nền nhặt trong ~15 giây, chạy 1–3 phút.
// ═══════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RefreshStatus } from "@/lib/talpha/refresh-status";

const TZ = "Asia/Ho_Chi_Minh";
const formatTime = (s: string) => new Date(s).toLocaleTimeString("vi-VN", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const formatDateTime = (s: string) => new Date(s).toLocaleString("vi-VN", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit",
});
const JOB_LABELS: Record<string, string> = {
    sync: "Kéo đơn POS + chi tiêu Meta",
    bao_cao: "Dựng báo cáo tháng",
    ton_kho: "Chụp tồn kho",
    danh_muc: "Làm tươi danh mục sản phẩm",
    van_don_sang: "Nạp bảng đối tác + vận đơn",
    van_don_toi: "Nạp bảng đối tác + vận đơn",
};
/** Quá chừng này mà chưa có lượt kéo số thành công → đèn vàng (lịch chạy mỗi giờ, phút :00). */
const STALE_MINUTES = 75;

export default function RefreshStatusButton() {
    const [status, setStatus] = useState<RefreshStatus | null>(null);
    const [open, setOpen] = useState(false);
    const [sending, setSending] = useState(false);
    const [notice, setNotice] = useState<{ loai: "ok" | "loi"; chu: string } | null>(null);
    const [hasNewData, setHasNewData] = useState(false);
    // Yêu cầu người này vừa bấm — xong thì báo "Đã có số mới".
    const watchedRequestId = useRef<number | null>(null);

    const applyStatus = useCallback((j: RefreshStatus) => {
        setStatus(j);
        const id = watchedRequestId.current;
        if (id != null && j.yeu_cau && j.yeu_cau.id >= id && (j.yeu_cau.status === "ok" || j.yeu_cau.status === "failed")) {
            watchedRequestId.current = null;
            if (j.yeu_cau.status === "ok") {
                setHasNewData(true);
                setNotice({ loai: "ok", chu: "Đã cập nhật xong — tải lại trang để xem số mới." });
            } else {
                setNotice({ loai: "loi", chu: "Lượt cập nhật vừa rồi bị lỗi — xem lý do bên dưới." });
            }
        }
    }, []);

    const load = useCallback(async () => {
        try {
            const r = await fetch("/api/talpha/refresh", { cache: "no-store" });
            if (r.ok) applyStatus(await r.json());
        } catch { /* mất mạng một lượt — lượt sau đọc lại */ }
    }, [applyStatus]);

    const isRefreshing = !!status && (status.dang_chay.length > 0 || status.yeu_cau?.status === "pending" || status.yeu_cau?.status === "running");

    // Đang cập nhật thì hỏi 5 giây một lần để thấy xong ngay; bình thường 1 phút một lần.
    useEffect(() => {
        load();
        const t = setInterval(load, isRefreshing ? 5_000 : 60_000);
        return () => clearInterval(t);
    }, [load, isRefreshing]);

    const requestRefresh = async () => {
        setSending(true);
        setNotice(null);
        try {
            const r = await fetch("/api/talpha/refresh", {
                method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
            });
            const j = await r.json().catch(() => ({}));
            if (j?.dang_chay) setStatus(j);
            if (!r.ok) {
                setNotice({ loai: "loi", chu: j.error || `Không gửi được (HTTP ${r.status})` });
                return;
            }
            watchedRequestId.current = j.yeu_cau?.id ?? null;
            setHasNewData(false);
            setNotice({ loai: "ok", chu: j.da_co ? "Đang có lượt cập nhật — chờ lượt đó xong." : "Đã gửi — máy bắt đầu trong vài giây, mất khoảng 1–3 phút." });
        } catch {
            setNotice({ loai: "loi", chu: "Không gửi được — kiểm mạng rồi thử lại." });
        } finally {
            setSending(false);
        }
    };

    if (!status) return null;

    const failedSources = [...status.bao_cao?.loi.tkqc || [], ...status.bao_cao?.loi.shops || []];
    const hasError = (status.lan_keo_cuoi && !status.lan_keo_cuoi.ok) || (status.bao_cao && !status.bao_cao.ok) || failedSources.length > 0;
    const ageMinutes = status.lan_keo_ok ? (Date.now() - Date.parse(status.lan_keo_ok)) / 60_000 : Infinity;
    const tone = hasNewData ? "xanh" : isRefreshing ? "chay" : hasError ? "do" : ageMinutes > STALE_MINUTES ? "vang" : "xanh";

    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => setOpen((m) => !m)}
                title="Số trên trang cập nhật lúc nào — bấm để xem chi tiết hoặc cập nhật ngay"
                className={cn(
                    "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                    tone === "xanh" && "border-emerald-300/70 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400",
                    tone === "vang" && "border-amber-300/70 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400",
                    tone === "do" && "border-rose-300/70 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400",
                    tone === "chay" && "border-indigo-300/70 bg-indigo-50 text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300",
                )}
            >
                {tone === "chay" ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : tone === "do" ? <XCircle className="h-3.5 w-3.5" />
                    : tone === "vang" ? <AlertTriangle className="h-3.5 w-3.5" />
                    : <CheckCircle2 className="h-3.5 w-3.5" />}
                {hasNewData ? "Có số mới" : tone === "chay" ? "Đang cập nhật…"
                    : status.lan_keo_ok ? <><span className="hidden sm:inline">Cập nhật</span> {formatTime(status.lan_keo_ok)}</> : "Chưa có số"}
            </button>

            {open && (
                <>
                    <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
                    <div className="absolute right-0 top-full z-40 mt-2 w-[min(22rem,calc(100vw-1.5rem))] space-y-3 rounded-xl border border-border bg-card p-4 text-sm shadow-xl">
                        <p className="font-semibold text-foreground">Cập nhật số</p>

                        <dl className="space-y-1.5 text-xs">
                            <div className="flex justify-between gap-3">
                                <dt className="text-muted-foreground">Kéo đơn + chi tiêu lần cuối</dt>
                                <dd className={cn("text-right", status.lan_keo_cuoi && !status.lan_keo_cuoi.ok ? "text-rose-500" : "text-foreground")}>
                                    {status.lan_keo_cuoi ? `${formatDateTime(status.lan_keo_cuoi.luc)} · ${status.lan_keo_cuoi.ok ? "xong" : "HỎNG"}`
                                        : status.lan_keo_ok ? formatDateTime(status.lan_keo_ok) : "chưa có"}
                                </dd>
                            </div>
                            {status.lan_keo_cuoi?.ai && (
                                <div className="flex justify-between gap-3">
                                    <dt className="text-muted-foreground">Ai chạy</dt>
                                    <dd className="text-right text-foreground">{status.lan_keo_cuoi.ai === "lịch" ? "tự động (mỗi giờ)" : status.lan_keo_cuoi.ai}</dd>
                                </div>
                            )}
                            <div className="flex justify-between gap-3">
                                <dt className="text-muted-foreground">Dựng báo cáo lần cuối</dt>
                                <dd className={cn("text-right", status.bao_cao && !status.bao_cao.ok ? "text-rose-500" : "text-foreground")}>
                                    {status.bao_cao ? `${formatDateTime(status.bao_cao.luc)} · ${status.bao_cao.ok ? "xong" : "HỎNG"}` : "chưa có"}
                                </dd>
                            </div>
                        </dl>

                        {status.lan_keo_cuoi && !status.lan_keo_cuoi.ok && status.lan_keo_cuoi.loi && (
                            <pre className="max-h-28 overflow-auto whitespace-pre-wrap rounded-lg bg-rose-50 p-2 text-[11px] text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{status.lan_keo_cuoi.loi}</pre>
                        )}
                        {(failedSources.length > 0 || (status.bao_cao?.loi.bo_qua.length ?? 0) > 0) && (
                            <div className="space-y-1 rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                                {status.bao_cao!.loi.tkqc.length > 0 && <p><b>TKQC đọc lỗi:</b> {status.bao_cao!.loi.tkqc.join(", ")} — chi tiêu các TK này đang thiếu.</p>}
                                {status.bao_cao!.loi.shops.length > 0 && <p><b>Shop POS đọc lỗi:</b> {status.bao_cao!.loi.shops.join(", ")} — đơn các shop này đang thiếu.</p>}
                                {status.bao_cao!.loi.bo_qua.length > 0 && <p><b>TKQC bị bỏ qua:</b> {status.bao_cao!.loi.bo_qua.join(", ")}.</p>}
                            </div>
                        )}

                        {status.dang_chay.length > 0 && (
                            <ul className="space-y-1 text-xs">
                                {status.dang_chay.map((v) => (
                                    <li key={`${v.job}-${v.started_at}`} className="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-300">
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                        {JOB_LABELS[v.job] || v.job} — từ {formatTime(v.started_at)}
                                    </li>
                                ))}
                            </ul>
                        )}

                        <p className="text-[11px] leading-snug text-muted-foreground">
                            Tự cập nhật mỗi giờ: kéo đơn + chi tiêu phút :00, dựng báo cáo (Tổng quan, P&amp;L, Marketing) phút :20.
                            Ads Command Center và Kho thì luôn hỏi thẳng Meta / POS.
                        </p>

                        {notice && (
                            <p className={cn("text-xs", notice.loai === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500")}>{notice.chu}</p>
                        )}

                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={requestRefresh}
                                disabled={sending || isRefreshing || !status.co_lich}
                                title={status.co_lich ? undefined : "Máy này chưa có lịch việc nền nhận lệnh (chỉ bản Docker có)"}
                                className="flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-600 disabled:opacity-50"
                            >
                                {sending || isRefreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                                {isRefreshing ? "Đang cập nhật…" : "Cập nhật ngay"}
                            </button>
                            {hasNewData && (
                                <button type="button" onClick={() => window.location.reload()}
                                    className="rounded-lg border border-emerald-400/60 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10">
                                    Tải lại trang
                                </button>
                            )}
                        </div>
                        <p className="text-[11px] text-muted-foreground">Kéo đơn POS + chi tiêu Meta rồi dựng lại báo cáo — mất khoảng 1–3 phút.</p>
                    </div>
                </>
            )}
        </div>
    );
}
