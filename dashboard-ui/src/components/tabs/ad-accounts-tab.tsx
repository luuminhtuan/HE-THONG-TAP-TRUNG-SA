"use client";

import { useState, useEffect, useCallback } from "react";
import { Megaphone, Loader2, AlertCircle, RefreshCw, Sparkles, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

// TKQC (04/11/2026) — danh bạ TỰ ĐỘNG: mọi TKQC token Meta đọc được, sync kéo chi tiêu của tất cả.
// Không còn thêm / xoá TKQC bằng tay. Mỗi TK một LOẠI; chỉ loại "vào báo cáo" mới cộng vào số các tab,
// báo cáo tháng và bot. Đổi loại có tác dụng ngay. Luật: talpha_rules.json → ad_account_categories, lib/talpha/ad-accounts.ts.

type AccountType = { code: string; name: string; include_in_report: boolean };
type AccountRow = {
    account_id: string; name: string | null; account_status: number | null; currency: string | null; timezone_name: string | null;
    token_env_var: string | null; category: string; is_confirmed: boolean; first_seen_at: string; last_seen_at: string; note: string | null;
    spend_7d: number; spend_30d: number; last_spend_date: string | null;
};

// account_status của Meta.
const ACCOUNT_STATUS: Record<number, { chu: string; mau: string }> = {
    1: { chu: "Đang chạy", mau: "bg-emerald-500/15 text-emerald-500" },
    2: { chu: "Vô hiệu hoá", mau: "bg-rose-500/15 text-rose-500" },
    3: { chu: "Nợ tiền", mau: "bg-amber-500/15 text-amber-500" },
    7: { chu: "Chờ xét", mau: "bg-amber-500/15 text-amber-500" },
    9: { chu: "Ân hạn", mau: "bg-amber-500/15 text-amber-500" },
    101: { chu: "Đã đóng", mau: "bg-white/[0.06] text-slate-400" },
};

const vnd = (n: number) => `${Math.round(n).toLocaleString("vi-VN")}đ`;
// TALPHA_META_ACCESS_TOKEN → "token 1", …_2 → "token 2" (Khoá kết nối).
const tokenLabel = (varName: string | null) => (varName ? `token ${varName.match(/_(\d)$/)?.[1] || "1"}` : "");
const formatDate = (iso: string) => new Date(iso).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });

export default function AdAccountsTab() {
    const [accountTypes, setAccountTypes] = useState<AccountType[]>([]);
    const [accounts, setAccounts] = useState<AccountRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [scanning, setScanning] = useState(false);
    const [notice, setNotice] = useState("");
    const [savingId, setSavingId] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const r = await fetch("/api/talpha/ad-accounts", { cache: "no-store" });
            const j = await r.json();
            if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
            setAccountTypes(j.categories);
            setAccounts(j.accounts);
            setError("");
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const scan = async () => {
        setScanning(true);
        setNotice("");
        try {
            const r = await fetch("/api/talpha/ad-accounts", {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "scan" }),
            });
            const j = await r.json();
            if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
            const byToken = Object.entries(j.per_token || {}).map(([b, v]) => `${tokenLabel(b)}: ${typeof v === "number" ? `${v} TK` : `lỗi — ${v}`}`).join(" · ");
            setNotice(`Đọc được ${j.seen} TKQC (${byToken})${j.added.length ? ` — ${j.added.length} TK mới: ${j.added.map((m: { name: string }) => m.name).join(", ")}` : ", không có TK mới"}.`);
            await load();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setScanning(false);
        }
    };

    const changeType = async (d: AccountRow, typeCode: string) => {
        setSavingId(d.account_id);
        try {
            const r = await fetch("/api/talpha/ad-accounts", {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account_id: d.account_id, category: typeCode }),
            });
            const j = await r.json();
            if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
            await load();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setSavingId(null);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
            </div>
        );
    }

    const findType = (typeCode: string) => accountTypes.find((l) => l.code === typeCode);
    const typeTotals = accountTypes.map((l) => ({
        ...l,
        so_tk: accounts.filter((d) => d.category === l.code).length,
        chi_30: accounts.filter((d) => d.category === l.code).reduce((s, d) => s + Number(d.spend_30d || 0), 0),
    }));
    const unreviewedCount = accounts.filter((d) => !d.is_confirmed).length;

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="max-w-2xl">
                    <h2 className="text-lg font-bold text-foreground">Tài khoản quảng cáo</h2>
                    <p className="text-sm text-slate-400">
                        Tự động: mọi TKQC các token Meta (Khoá kết nối, tối đa 3 token cho nhiều BM / app) đọc được —
                        gán thêm TK cho người dùng hệ thống trong Business Manager là vòng sync sau có số, không phải
                        khai ở đâu. Chi tiêu của tất cả đều được kéo về;
                        chỉ TK thuộc loại <strong className="text-slate-300">vào báo cáo</strong> mới cộng vào số các tab,
                        báo cáo tháng và bot. Đổi loại có tác dụng ngay.
                    </p>
                </div>
                <button
                    onClick={scan}
                    disabled={scanning}
                    className="flex items-center gap-2 rounded-xl bg-indigo-500 hover:bg-indigo-600 disabled:opacity-60 px-4 py-2.5 text-sm font-semibold text-white transition-colors shadow-lg shadow-indigo-500/25"
                >
                    {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    {scanning ? "Đang hỏi Meta…" : "Quét TKQC ngay"}
                </button>
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {error}
                </div>
            )}
            {notice && (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    {notice}
                </div>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
                {typeTotals.map((l) => (
                    <div key={l.code} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
                        <p className="text-xs text-slate-500">{l.include_in_report ? "Vào báo cáo" : "Không tính vào báo cáo"}</p>
                        <p className="mt-0.5 font-semibold text-foreground">{l.name}</p>
                        <p className="mt-2 text-sm text-slate-300">{l.so_tk} TK · 30 ngày {vnd(l.chi_30)}</p>
                    </div>
                ))}
            </div>

            {unreviewedCount > 0 && (
                <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-500">
                    <Sparkles className="h-4 w-4 shrink-0" />
                    {unreviewedCount} TKQC chưa ai xem loại — máy tự gán theo luật (TK tiền khác VND không vào báo cáo). Chọn loại
                    đúng cho từng TK là xong.
                </div>
            )}

            {accounts.length === 0 ? (
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-8 text-center text-sm text-slate-400">
                    Chưa có TKQC nào. Nhập token Meta ở Khoá kết nối rồi bấm “Quét TKQC ngay”.
                </div>
            ) : (
                <div className="overflow-x-auto rounded-xl border border-white/[0.08]">
                    <table className="w-full text-sm">
                        <thead className="bg-white/[0.03] text-xs text-slate-400">
                            <tr>
                                <th className="px-3 py-2.5 text-left">TKQC</th>
                                <th className="px-3 py-2.5 text-left">Trạng thái</th>
                                <th className="px-3 py-2.5 text-right">7 ngày</th>
                                <th className="px-3 py-2.5 text-right">30 ngày</th>
                                <th className="px-3 py-2.5 text-left">Chi lần cuối</th>
                                <th className="px-3 py-2.5 text-left">Loại</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.05]">
                            {accounts.map((d) => {
                                const st = d.account_status != null ? ACCOUNT_STATUS[d.account_status] : undefined;
                                const l = findType(d.category);
                                const stale = Date.now() - Date.parse(d.last_seen_at) > 2 * 86_400_000;
                                return (
                                    <tr key={d.account_id} className={cn(!l?.include_in_report && "opacity-70")}>
                                        <td className="px-3 py-2.5">
                                            <p className="flex items-center gap-2 font-medium text-foreground">
                                                <Megaphone className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
                                                {d.name || d.account_id}
                                                {!d.is_confirmed && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-500">MỚI</span>}
                                            </p>
                                            <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                                                act_{d.account_id}{d.token_env_var ? ` · ${tokenLabel(d.token_env_var)}` : ""}{d.currency && d.currency !== "VND" ? ` · ${d.currency}` : ""}{d.timezone_name && d.timezone_name !== "Asia/Ho_Chi_Minh" ? ` · ${d.timezone_name}` : ""}
                                            </p>
                                        </td>
                                        <td className="px-3 py-2.5">
                                            <span className={cn("rounded px-2 py-0.5 text-[11px] font-semibold", st?.mau || "bg-white/[0.06] text-slate-400")}>
                                                {st?.chu || `Mã ${d.account_status ?? "?"}`}
                                            </span>
                                            {stale && <p className="mt-1 text-[11px] text-rose-400">Token không còn thấy từ {formatDate(d.last_seen_at)}</p>}
                                        </td>
                                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-300">{vnd(Number(d.spend_7d))}</td>
                                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-300">{vnd(Number(d.spend_30d))}</td>
                                        <td className="px-3 py-2.5 text-slate-400">{d.last_spend_date ? formatDate(d.last_spend_date) : "—"}</td>
                                        <td className="px-3 py-2.5">
                                            <select
                                                value={d.category}
                                                disabled={savingId === d.account_id}
                                                onChange={(e) => changeType(d, e.target.value)}
                                                className="rounded-lg border border-white/[0.1] bg-white/[0.04] px-2 py-1.5 text-xs text-foreground"
                                            >
                                                {accountTypes.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
                                            </select>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
