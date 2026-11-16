"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import axios from "axios";
import {
    RotateCw, Satellite, Layers, AlertTriangle, ChevronDown, Check, Zap,
    Target, TrendingUp, Wallet, ShoppingCart, Package, Coins, MessageSquare,
    ArrowUpRight, ArrowDownRight, Megaphone, FileSpreadsheet,
} from "lucide-react";
import { formatVNDCompact, cn } from "@/components/talpha/utils";
import { useAccess } from "@/components/talpha/access-context";
import { ROAS_GOOD, todayStr, DATE_PRESETS } from "./_components/constants";
import { KpiCard } from "./_components/ui";
import type { RealtimeCampaign, RealtimeData } from "./_components/types";
import { AccountCampaigns } from "./_components/account-campaigns";
import { UnmatchedOrders } from "./_components/unmatched-orders";

// Tên TKQC KHÔNG hard-code ở đây — đọc từ response /api/talpha/realtime
// (route đọc talpha.yaml → ad_account_names, nguồn duy nhất).

export default function TALPHAAdsCommandCenterPage() {
    const [data, setData] = useState<RealtimeData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [syncedAt, setSyncedAt] = useState<Date | null>(null);
    const [selectedAccount, setSelectedAccount] = useState("all");
    const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState(false);
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);
    const [fromDate, setFromDate] = useState(todayStr());
    const [toDate, setToDate] = useState(todayStr());
    const [activePreset, setActivePreset] = useState("Hôm nay");
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [exportState, setExportState] = useState<any | null>(null);
    // Xuất Sheet chạy format_all.py cho cả công ty — chỉ giám đốc (route cũng chặn). Mở trang
    // đứng riêng (ngoài shell) thì không có thông tin người xem: để nút, route tự từ chối.
    const me = useAccess();
    const canExportSheet = !me || me.full;
    const dropdownRef = useRef<HTMLDivElement>(null);
    const dateRef = useRef<HTMLDivElement>(null);
    const exportPollRef = useRef<any>(null);

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setIsAccountDropdownOpen(false);
            }
            if (dateRef.current && !dateRef.current.contains(e.target as Node)) {
                setShowDatePicker(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const fetchData = async (fd?: string, td?: string) => {
        const f = fd || fromDate;
        const t = td || toDate;
        setLoading(true); setError(null);
        try {
            const res = await axios.get(`/api/talpha/realtime`, {
                params: { from_date: f, to_date: t },
                timeout: 60000, // longer timeout for bigger date ranges
            });
            setData(res.data); setSyncedAt(new Date());
        } catch (err: any) {
            setError(err.response?.data?.error || err.message || "Failed to fetch");
        } finally { setLoading(false); }
    };

    const applyPreset = (preset: typeof DATE_PRESETS[0]) => {
        const f = preset.from();
        const t = preset.to();
        setFromDate(f); setToDate(t);
        setActivePreset(preset.label);
        setShowDatePicker(false);
        fetchData(f, t);
    };

    const applyCustom = () => {
        setActivePreset(`${fromDate} → ${toDate}`);
        setShowDatePicker(false);
        fetchData();
    };

    useEffect(() => { fetchData(); }, []);
    useEffect(() => {
        if (!autoRefresh) return;
        const interval = setInterval(() => fetchData(), 60000);
        return () => clearInterval(interval);
    }, [autoRefresh, fromDate, toDate]);

    const campaigns = useMemo(() => {
        if (!data) return [];
        if (selectedAccount === "all") return data.campaigns;
        return data.campaigns.filter(c => c.account_id === selectedAccount);
    }, [data, selectedAccount]);

    const grouped = useMemo(() => {
        const groups: Record<string, RealtimeCampaign[]> = {};
        campaigns.forEach(c => {
            if (!groups[c.account_id]) groups[c.account_id] = [];
            groups[c.account_id].push(c);
        });
        return groups;
    }, [campaigns]);

    const summary = data?.summary;
    // Tên + danh sách TKQC lấy từ API (talpha.yaml). Fallback: account_name trong
    // campaigns (response cũ chưa có field accounts) → cuối cùng là raw id.
    const accountNames = useMemo(() => {
        const m: Record<string, string> = {};
        data?.campaigns?.forEach(c => { m[c.account_id] = c.account_name; });
        data?.accounts?.forEach(a => { m[a.id] = a.name; });
        return m;
    }, [data]);
    const getAccountName = (id: string) => accountNames[id] || id;
    const accountIds = data?.accounts?.map(a => a.id) ?? Object.keys(accountNames);

    // ── GTC thật (giao thành công) — cùng rule báo cáo Sheet (status GIAO_THANH_CONG) ──
    const deliveredRev = summary?.delivered_revenue_vnd || 0;
    const deliveredRoas = summary?.delivered_roas || 0;
    const deliveredProfit = deliveredRev - (summary?.total_spend_vnd || 0);
    const profit100 = (summary?.total_revenue_vnd || 0) - (summary?.total_spend_vnd || 0);
    const cpaMsg = summary && summary.total_messages > 0 ? summary.total_spend_vnd / summary.total_messages : 0;

    const toggleCampaign = (id: string) => {
        setExpandedCampaign(prev => prev === id ? null : id);
    };

    // ── Xuất báo cáo ra Google Sheet (chạy format_all.py qua route, poll tiến độ) ──
    const pollExport = async () => {
        try {
            const res = await axios.get("/api/talpha/export-report");
            setExportState(res.data);
            if (!res.data.running && exportPollRef.current) {
                clearInterval(exportPollRef.current);
                exportPollRef.current = null;
            }
        } catch { /* giữ trạng thái cũ, thử lại lần poll sau */ }
    };
    const startExport = async () => {
        if (exportState?.running) return;
        try {
            const res = await axios.post("/api/talpha/export-report");
            setExportState(res.data);
            if (exportPollRef.current) clearInterval(exportPollRef.current);
            if (res.data.running || res.data.started) {
                exportPollRef.current = setInterval(pollExport, 3000);
            }
        } catch (e: any) {
            setExportState({ running: false, ok: false, error: e?.response?.data?.error || e.message });
        }
    };
    useEffect(() => () => { if (exportPollRef.current) clearInterval(exportPollRef.current); }, []);

    return (
        // Điện thoại (05/10/2026): không khoá cao một màn — trang chảy tự nhiên trong khung cuộn
        // của dashboard, khỏi cuộn lồng hai tầng. Máy tính giữ nguyên bố cục cũ.
        <div className="flex flex-col bg-gradient-to-b from-[#0F0E0B] via-[#28261F] to-[#0F0E0B] font-sans text-slate-100 md:h-screen md:overflow-hidden">

            {/* ═══ HEADER ═══
                z-[5] (không phải z-50): là flex item nên z-index có hiệu lực — z-50 đè cả thanh tiêu
                đề dính của dashboard (z-10) khi cuộn. Điện thoại: xuống dòng thay vì ép một hàng. */}
            <header className="z-[5] flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/5 bg-[#16140F]/90 px-3 py-2 backdrop-blur-xl sm:px-5 md:h-14 md:flex-nowrap md:py-0">
                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <h1 className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
                        <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-amber-500/30">
                            <Satellite className="h-4 w-4 text-white" />
                        </span>
                        <span className="hidden bg-gradient-to-r from-orange-400 to-red-500 bg-clip-text text-transparent sm:inline">ANTALO ADS COMMAND</span>
                    </h1>

                    {/* Account dropdown */}
                    <div className="relative" ref={dropdownRef}>
                        <button onClick={() => setIsAccountDropdownOpen(!isAccountDropdownOpen)}
                            className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 transition hover:border-white/25 hover:bg-white/10">
                            <Layers className="h-3 w-3" />
                            {selectedAccount === "all" ? `All (${Object.keys(grouped).length})` : getAccountName(selectedAccount)}
                            <ChevronDown className={`h-3 w-3 transition ${isAccountDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {isAccountDropdownOpen && (
                            <div className="absolute left-0 top-full z-50 mt-1 max-h-96 w-64 max-w-[calc(100vw-1.5rem)] overflow-y-auto overflow-hidden rounded-xl border border-white/10 bg-[#16140F] shadow-2xl">
                                <button onClick={() => { setSelectedAccount("all"); setIsAccountDropdownOpen(false); }}
                                    className={`flex w-full items-center justify-between px-4 py-2.5 text-sm hover:bg-white/5 ${selectedAccount === "all" ? "bg-amber-600/20 text-amber-300" : "text-slate-300"}`}>
                                    <span>🌐 All ({accountIds.length} TKQC)</span>
                                    {selectedAccount === "all" && <Check className="h-4 w-4 text-amber-400" />}
                                </button>
                                {accountIds.map(accId => (
                                    <button key={accId} onClick={() => { setSelectedAccount(accId); setIsAccountDropdownOpen(false); }}
                                        className={`flex w-full items-center justify-between px-4 py-2 text-sm hover:bg-white/5 ${selectedAccount === accId ? "bg-amber-600/20 text-amber-300" : "text-slate-300"}`}>
                                        <div>
                                            <div className="text-xs font-medium">{getAccountName(accId)}</div>
                                            <div className="font-mono text-[9px] text-slate-500">{accId}</div>
                                        </div>
                                        {selectedAccount === accId && <Check className="h-3 w-3 text-amber-400" />}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Date Range Picker */}
                    <div className="relative" ref={dateRef}>
                        <button onClick={() => setShowDatePicker(!showDatePicker)}
                            className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 transition hover:border-white/25 hover:bg-white/10">
                            📅 {activePreset}
                            <ChevronDown className={`h-3 w-3 transition ${showDatePicker ? 'rotate-180' : ''}`} />
                        </button>
                        {showDatePicker && (
                            <div className="absolute left-0 top-full z-50 mt-1 w-72 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-white/10 bg-[#16140F] shadow-2xl">
                                <div className="border-b border-white/5 p-2">
                                    <div className="mb-1.5 px-1 text-[10px] font-bold uppercase text-slate-500">Khoảng thời gian</div>
                                    <div className="grid grid-cols-3 gap-1">
                                        {DATE_PRESETS.map(p => (
                                            <button key={p.label} onClick={() => applyPreset(p)}
                                                className={cn("rounded-lg px-2 py-1.5 text-center text-xs transition",
                                                    activePreset === p.label
                                                        ? "border border-amber-500/50 bg-amber-600/30 text-amber-300"
                                                        : "bg-white/5 text-slate-300 hover:bg-white/10")}>
                                                {p.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="p-2">
                                    <div className="mb-1.5 px-1 text-[10px] font-bold uppercase text-slate-500">Tuỳ chỉnh</div>
                                    <div className="flex items-center gap-2">
                                        <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                                            className="w-full rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300" />
                                        <span className="text-xs text-slate-500">→</span>
                                        <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                                            className="w-full rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300" />
                                    </div>
                                    <button onClick={applyCustom}
                                        className="mt-2 w-full rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-amber-500">
                                        Áp dụng
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    <span className="flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                        <span className="relative flex h-1.5 w-1.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        </span>
                        LIVE • Direct API
                    </span>
                    <label className="flex cursor-pointer items-center gap-1 text-[10px] text-slate-400">
                        <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} className="h-3 w-3 accent-emerald-500" />
                        Auto 60s
                    </label>
                </div>

                <div className="ml-auto flex items-center gap-3">
                    <div className="hidden text-right text-[10px] text-slate-400 sm:block">
                        <div>Synced: <span className="font-mono text-emerald-400">{syncedAt?.toLocaleTimeString() || '--'}</span></div>
                        {data && <div className="text-slate-500">{data.source} • {data.duration_ms}ms • {summary?.accounts_fetched}TK • {summary?.shops_fetched}shops</div>}
                    </div>
                    {/* Xuất báo cáo ra Google Sheet (format_all.py) */}
                    {canExportSheet && <div className="flex items-center gap-2">
                        <button onClick={startExport} disabled={exportState?.running} title="Sinh lại các file báo cáo Google Sheet (marketer + TỔNG) từ dữ liệu hiện tại"
                            className="flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-600/15 px-3 py-1.5 text-xs font-bold text-emerald-300 transition hover:bg-emerald-600/25 disabled:opacity-60">
                            <FileSpreadsheet className={`h-3 w-3 ${exportState?.running ? 'animate-pulse' : ''}`} />
                            {exportState?.running ? `Đang xuất… ${exportState.filesDone}/${exportState.totalFiles}` : 'Xuất Sheet'}
                        </button>
                        {exportState && !exportState.running && (
                            exportState.ok
                                ? <span className="text-[10px] font-semibold text-emerald-400">✓ Đã xuất {exportState.totalFiles} file</span>
                                : <span className="text-[10px] font-semibold text-rose-400" title={exportState.error || (exportState.log || []).slice(-1)[0] || ''}>✗ Lỗi xuất</span>
                        )}
                    </div>}
                    <button onClick={() => fetchData()} disabled={loading}
                        className="flex items-center gap-1 rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-lg shadow-amber-500/25 transition hover:brightness-110 disabled:opacity-50">
                        <RotateCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> SYNC
                    </button>
                </div>
            </header>

            {/* ═══ SUMMARY CARDS ═══ */}
            {summary && (
                <div className="shrink-0 space-y-3 border-b border-white/5 px-3 pb-3 pt-3">
                    {/* Row 1: Thực tế */}
                    <div>
                        <div className="mb-1.5 flex items-center gap-2 px-0.5">
                            <span className="h-3 w-1 rounded-full bg-amber-400" />
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400" title="Doanh số ĐẶT: mọi đơn (cod hoặc total_price), khác DS Giao TC của các tab đọc kho số">DS đặt (100% đơn)</span>
                        </div>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                            <KpiCard icon={Wallet} accent="slate" label="Chi phí Ads" value={formatVNDCompact(summary.total_spend_vnd)} />
                            <KpiCard icon={ShoppingCart} accent="purple" label="Đơn Meta" value={String(summary.total_meta_purchases)} sub="Purchases từ Meta API" />
                            <KpiCard icon={Package} accent="blue" label="Đơn POS" value={String(summary.total_pos_orders)}
                                sub={<>Match <b className="text-emerald-400">{summary.matched_orders}</b>{summary.matched_via_fallback ? <span className="text-slate-500"> (fallback {summary.matched_via_fallback})</span> : null} · Chưa <b className="text-amber-400">{summary.unmatched_orders}</b></>} />
                            <KpiCard icon={Coins} accent="emerald" label={`DS đặt (${summary.total_pos_orders} đơn)`} value={formatVNDCompact(summary.total_revenue_vnd)}
                                sub={<>{summary.matched_orders} match + {summary.unmatched_orders} chưa match</>} />
                            <KpiCard icon={TrendingUp} accent="amber" label="ROAS blended (DS đặt)" value={`${summary.blended_roas.toFixed(2)}x`}
                                sub={<>DS đặt ÷ spend — không phải GTC</>}
                                valueClass={summary.blended_roas >= ROAS_GOOD ? "text-emerald-400" : "text-amber-300"} />
                        </div>
                    </div>

                    {/* Row 2: Messages + Giao thành công (GTC thật) */}
                    <div>
                        <div className="mb-1.5 flex items-center gap-2 px-0.5">
                            <span className="h-3 w-1 rounded-full bg-cyan-400" />
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Giao thành công (thật · GIAO_THANH_CONG)</span>
                        </div>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                            <KpiCard icon={MessageSquare} accent="indigo" label="Messages" value={String(summary.total_messages)}
                                sub={<>CPA: {cpaMsg > 0 ? formatVNDCompact(cpaMsg) : '-'}
                                    {summary.mess_pancake?.ok ? <> · gồm {summary.mess_pancake.tong} tin Nhật đếm từ Pancake</> : null}</>} />
                            <KpiCard icon={Target} accent="cyan" label="DT Giao TC" value={formatVNDCompact(deliveredRev)}
                                sub={<>{summary.delivered_orders || 0} đơn đã giao</>} />
                            <KpiCard icon={TrendingUp} accent="cyan" label="ROAS Giao TC" value={`${deliveredRoas.toFixed(2)}x`}
                                valueClass={deliveredRoas >= ROAS_GOOD ? "text-emerald-400" : deliveredRoas > 1 ? "text-cyan-300" : "text-rose-400"} />
                            <KpiCard icon={deliveredProfit >= 0 ? ArrowUpRight : ArrowDownRight} accent={deliveredProfit >= 0 ? "cyan" : "rose"}
                                label="Lãi/Lỗ Giao TC" value={formatVNDCompact(deliveredProfit)}
                                valueClass={deliveredProfit >= 0 ? "text-cyan-300" : "text-rose-400"} />
                            <KpiCard icon={profit100 >= 0 ? ArrowUpRight : ArrowDownRight} accent={profit100 >= 0 ? "emerald" : "rose"}
                                label="Lãi/Lỗ (100%)" value={formatVNDCompact(profit100)}
                                valueClass={profit100 >= 0 ? "text-emerald-400" : "text-rose-400"} />
                        </div>
                    </div>
                </div>
            )}

            {/* ═══ MAIN CONTENT ═══ */}
            <main className="flex-1 space-y-3 overflow-auto p-3">
                {error && (
                    <div className="flex items-center gap-3 rounded-xl border border-rose-800 bg-rose-950/50 p-3 text-rose-300">
                        <AlertTriangle className="h-5 w-5 shrink-0" />
                        <div className="flex-1">
                            <div className="text-sm font-semibold">Failed to load</div>
                            <div className="text-xs text-rose-400/80">{error}</div>
                        </div>
                        <button onClick={() => fetchData()} className="rounded bg-rose-800 px-3 py-1 text-xs text-white hover:bg-rose-700">Retry</button>
                    </div>
                )}

                {/* Cảnh báo cap phân trang từ route — số đang hiển thị có thể THIẾU */}
                {data?.warnings && data.warnings.length > 0 && (
                    <div className="flex items-start gap-3 rounded-xl border border-amber-800 bg-amber-950/40 p-3 text-amber-300">
                        <AlertTriangle className="h-5 w-5 shrink-0" />
                        <div className="flex-1">
                            <div className="text-sm font-semibold">Dữ liệu có thể thiếu — chạm giới hạn phân trang</div>
                            {data.warnings.map((w, i) => <div key={i} className="text-xs text-amber-400/80">{w}</div>)}
                        </div>
                    </div>
                )}

                {loading && !data ? (
                    <div className="flex h-64 animate-pulse items-center justify-center text-lg text-slate-500">
                        <Zap className="mr-2 h-6 w-6 animate-bounce text-amber-500" />
                        Đang tải realtime từ Meta + POS...
                    </div>
                ) : Object.keys(grouped).length === 0 ? (
                    <div className="flex h-64 flex-col items-center justify-center gap-2 text-slate-500">
                        <Megaphone className="h-8 w-8 text-slate-600" />
                        <div className="text-sm">Không có campaign nào trong khoảng thời gian này</div>
                    </div>
                ) : (
                    Object.entries(grouped).map(([accId, accCampaigns]) => (
                        <AccountCampaigns key={accId} accId={accId} accCampaigns={accCampaigns} getAccountName={getAccountName}
                            expandedCampaign={expandedCampaign} toggleCampaign={toggleCampaign} />
                    ))
                )}

                {/* Unmatched Orders */}
                {data && data.unmatched_by_shop && Object.keys(data.unmatched_by_shop).length > 0 && (
                    <UnmatchedOrders data={data} />
                )}
            </main>
        </div>
    );
}
