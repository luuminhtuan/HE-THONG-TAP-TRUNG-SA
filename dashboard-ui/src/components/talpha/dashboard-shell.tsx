"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, LogOut, Menu, Settings, X } from "lucide-react";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { format, startOfMonth, subDays } from "date-fns";
import DateRangePicker from "@/components/ui/date-range-picker";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import Link from "next/link";
import { AccessProvider, type Me } from "./access-context";
import NutCaiApp from "./cai-app";
import { useDoiThamSo } from "./url-state";
import TrangThaiCapNhatNut from "./refresh-status";
import { NAV_GROUPS, TAB_INFO, TAB_THEO_SLUG, type NavGroup } from "./nav-config";

import TALPHACeoOverviewTab from "./tabs/ceo-overview-tab";
import TALPHAAdsCommandTab from "./tabs/ads-command-tab";
import TALPHAMarketingTab from "./tabs/marketing-tab";
import TALPHAProductsTab from "./tabs/products-tab";
import TALPHAPnLTab from "./tabs/pnl-tab";
import TALPHAProductPnLTab from "./tabs/product-pnl-tab";
import TALPHACustomerTab from "./tabs/customer-tab";
import TALPHAMarketIntelTab from "./tabs/market-intel-tab";
import TALPHAAdHealthTab from "./tabs/ad-health-tab";
import TALPHAAdSpendTab from "./tabs/ad-spend-tab";
import TALPHACodReconTab from "./tabs/cod-recon-tab";
import { MarketsProvider, useMarkets } from "./markets-context";
import TALPHAOrderLedgerTab from "./tabs/order-ledger-tab";
import TALPHATrackingTab from "./tabs/tracking-tab";
import TALPHAAdsReconTab from "./tabs/ads-recon-tab";
import TALPHALaiLoTab from "./tabs/lai-lo-tab";

/** Tham số mang theo khi chuyển tab: khoảng ngày đang chọn (from, to), nước đang chọn (market). */
const THAM_SO_GIU = ["from", "to", "market"];

/**
 * Tab VẬN HÀNH — mặc định 60 ngày gần nhất, không phải "tháng này": danh sách việc (kiện kẹt, đơn quá
 * hạn chờ đòi tiền) chỉ tính đơn trong khoảng ngày, mà đầu tháng thì đơn tháng trước vẫn đang đi /
 * chờ thu tiền. Mọi tab THỐNG KÊ còn lại mặc định tháng này (Sỹ Anh chốt 15/11/2026).
 */
const TAB_VAN_HANH = new Set(["order-ledger", "tracking", "cod-recon"]);

/** Hai tab này đọc cửa sổ thời gian cố định trong view — hiện bộ chọn ngày chỉ gây hiểu nhầm là lọc được. */
const IGNORES_DATE_RANGE = new Set(["ads-command", "ad-health", "ads-recon"]);

/**
 * Tab báo cáo số — không tính ngày trước mốc gốc `report_start_date` (talpha_rules.json,
 * Sỹ Anh chốt 25/09/2026: trước 15/09 dữ liệu chưa đủ). Tab vận hành (Sổ đơn, Tiền COD về,
 * Vận đơn, Kho, Khách hàng) KHÔNG chặn: đơn tháng trước vẫn còn đang chờ thu tiền.
 */
const FLOOR_TABS = new Set(["overview", "pnl", "product-pnl", "lai-lo", "marketing", "ad-spend"]);

/** Các mục menu còn lại sau khi bỏ tab người này không được xem (phân quyền theo team). */
function nhomDuocXem(me: Me): NavGroup[] {
    const thay = new Set(me.tabs);
    return NAV_GROUPS
        .map(g => ({ ...g, tabs: g.tabs.filter(t => thay.has(t.id)) }))
        .filter(g => g.tabs.length > 0);
}

/** "2026-09-15" → 0h ngày đó theo giờ máy (new Date("2026-09-15") là 0h UTC, lệch 7 tiếng). */
function ngayDiaPhuong(s: string): Date | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

export default function TALPHADashboardShell() {
    // Tab đang xem nằm ở ĐƯỜNG DẪN (/talpha/order-ledger), khoảng ngày ở tham số ?from=&to= (15/11/2026)
    // — tải lại trang hay gửi link là mở đúng chỗ đang xem. Xem components/talpha/url-state.ts.
    const pathname = usePathname();
    const sp = useSearchParams();
    const router = useRouter();
    const doiThamSo = useDoiThamSo();
    const tabUrl = TAB_THEO_SLUG[pathname.split("/")[2] || ""] || null;
    // Người đang xem — tab nào hiện, nút nước nào có (phân quyền theo team, 05/10/2026).
    const [me, setMe] = useState<Me | null>(null);
    const [meLoi, setMeLoi] = useState<string | null>(null);
    // Điện thoại (Sỹ Anh yêu cầu 05/10/2026): menu trái thành ngăn kéo, mở bằng nút ☰.
    const [menuMo, setMenuMo] = useState(false);
    // Mốc gốc báo cáo. Chờ nạp xong mới dựng tab, để tab không truy vấn hai lần (một lần
    // với 60 ngày mặc định, một lần sau khi kéo về mốc).
    const [reportStart, setReportStart] = useState<Date | null>(null);
    const [configLoaded, setConfigLoaded] = useState(false);

    useEffect(() => {
        let dung = false;
        fetch("/api/talpha/me")
            .then(async r => {
                if (r.status === 401) {
                    window.location.href = `/login?callbackUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`;
                    return null;
                }
                const d = await r.json();
                if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
                return d as Me;
            })
            .then(d => {
                if (dung || !d) return;
                setMe(d);
            })
            .catch(e => { if (!dung) setMeLoi(String(e?.message || e)); });
        return () => { dung = true; };
    }, []);

    // Menu chỉ còn mục có ít nhất một tab người này được xem.
    const groups = useMemo(() => (me ? nhomDuocXem(me) : []), [me]);

    // Tab trên đường dẫn mà người này không được xem (hoặc vào /talpha trần) → tab ĐẦU TIÊN họ thấy
    // (sale không có Tổng quan), và sửa luôn địa chỉ cho khớp.
    const tabDau = groups[0]?.tabs[0]?.id ?? "overview";
    const activeTab = tabUrl && (!me || me.tabs.includes(tabUrl)) ? tabUrl : tabDau;
    const activeGroup = TAB_INFO[activeTab]?.nhom ?? "bao-cao";

    /** Đường dẫn của một tab, mang theo khoảng ngày + nước đang chọn. */
    const hrefTab = useCallback((id: string) => {
        const q = new URLSearchParams();
        for (const k of THAM_SO_GIU) { const v = sp.get(k); if (v) q.set(k, v); }
        const s = q.toString();
        return `/talpha/${TAB_INFO[id]?.slug ?? ""}${s ? `?${s}` : ""}`;
    }, [sp]);

    useEffect(() => {
        if (me && groups.length && tabUrl !== activeTab) router.replace(hrefTab(activeTab));
    }, [me, groups.length, tabUrl, activeTab, hrefTab, router]);


    useEffect(() => {
        let dung = false;
        fetch("/api/talpha/report-config")
            .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
            .then((d: { report_start_date?: string | null }) => {
                if (dung) return;
                const moc = d.report_start_date ? ngayDiaPhuong(d.report_start_date) : null;
                setReportStart(moc);
            })
            .catch(() => {})
            .finally(() => { if (!dung) setConfigLoaded(true); });
        return () => { dung = true; };
    }, []);

    // Khoảng ngày: ?from=&to= trên địa chỉ nếu có (người chọn / link gửi kèm) — áp cho mọi tab. Không có
    // thì theo tab: thống kê = THÁNG NÀY (từ ngày 1 tới hôm nay), vận hành = 60 ngày gần nhất; cả hai
    // không trước mốc gốc báo cáo.
    const tuUrl = sp.get("from");
    const denUrl = sp.get("to");
    const vanHanh = TAB_VAN_HANH.has(activeTab);
    const dateRange = useMemo(() => {
        const tu = tuUrl ? ngayDiaPhuong(tuUrl) : null;
        const den = denUrl ? ngayDiaPhuong(denUrl) : null;
        if (tu && den && tu <= den) return { from: tu, to: den };
        const homNay = new Date();
        const tuMacDinh = vanHanh ? subDays(homNay, 59) : startOfMonth(homNay);
        return { from: reportStart && tuMacDinh < reportStart ? reportStart : tuMacDinh, to: homNay };
    }, [tuUrl, denUrl, reportStart, vanHanh]);
    const setDateRange = (r: { from: Date; to: Date }) =>
        doiThamSo({ from: format(r.from, "yyyy-MM-dd"), to: format(r.to, "yyyy-MM-dd") });

    const onFloorTab = FLOOR_TABS.has(activeTab);
    // Khoảng ngày thật đưa cho tab: tab báo cáo luôn bị kéo về mốc, kể cả khi người dùng
    // chọn 90 ngày ở tab vận hành rồi mới chuyển sang.
    const tabRange = useMemo(() => {
        if (!onFloorTab || !reportStart || dateRange.from >= reportStart) return dateRange;
        return { from: reportStart, to: dateRange.to < reportStart ? reportStart : dateRange.to };
    }, [onFloorTab, reportStart, dateRange]);

    const group = useMemo(
        () => groups.find(g => g.id === activeGroup) ?? groups[0] ?? NAV_GROUPS[0],
        [groups, activeGroup],
    );
    const duocXem = (tab: string) => !!me && me.tabs.includes(tab) && activeTab === tab;

    // Ruột thanh trái — dùng chung cho cột cố định (máy tính) và ngăn kéo (điện thoại).
    const noiDungMenu = (
        <>
                <div className="flex flex-col border-b border-border p-4">
                    <div className="mb-2 flex items-center justify-between">
                        <Link href="/" className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
                            <ArrowLeft className="h-3 w-3" /> Trang chủ
                        </Link>
                        <button
                            onClick={() => setMenuMo(false)}
                            className="rounded-md p-1 text-muted-foreground hover:bg-muted md:hidden"
                            aria-label="Đóng menu"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                    {/* Logo ANTALO nằm trên nền kem của chính nó (brand-logo-box): chữ "LO"
                        và dải "MINI MARKET" màu đen, để trên nền tối là mất chữ. */}
                    <div className="brand-logo-box p-2.5">
                        <img src="/antalo-logo.png" alt="ANTALO Mini Market" className="h-9 w-full object-contain" />
                    </div>
                    <NhanThiTruong me={me} />
                </div>

                <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-3">
                    {groups.map(g => (
                        <Link
                            key={g.id}
                            href={hrefTab(g.tabs[0].id)}
                            onClick={() => setMenuMo(false)}
                            className={cn(
                                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                                activeGroup === g.id
                                    ? "border border-orange-200/60 bg-gradient-to-r from-orange-50 to-red-50 text-orange-700 shadow-sm dark:border-orange-500/20 dark:from-orange-500/10 dark:to-red-500/10 dark:text-orange-400"
                                    : "text-muted-foreground hover:bg-gray-50 hover:text-foreground dark:hover:bg-white/[0.04]",
                            )}
                        >
                            <span aria-hidden>{g.emoji}</span>
                            {g.label}
                        </Link>
                    ))}
                </nav>

                <div className="space-y-2 border-t border-border p-3">
                    {/* Cài dashboard thành app trên điện thoại / máy tính (06/10/2026). */}
                    <NutCaiApp />
                    {me && me.kind === "user" && (
                        <div className="rounded-lg bg-muted/40 px-3 py-2">
                            <p className="truncate text-sm font-semibold text-foreground" title={me.email || undefined}>{me.name}</p>
                            <p className="truncate text-[11px] text-muted-foreground">
                                {me.role_label}
                                {!me.full && me.teams.length > 0 && <> · {me.teams.map(t => t.name).join(" · ")}</>}
                            </p>
                            <div className="mt-1.5 flex items-center gap-3 text-xs">
                                {me.full && (
                                    <Link href="/admin" className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground">
                                        <Settings className="h-3 w-3" /> Quản trị
                                    </Link>
                                )}
                                <button
                                    onClick={() => signOut({ callbackUrl: "/login" })}
                                    className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
                                >
                                    <LogOut className="h-3 w-3" /> Đăng xuất
                                </button>
                            </div>
                        </div>
                    )}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <img src="/antalo-mark.png" alt="" className="h-5 w-5 object-contain opacity-60" />
                        <span>ANTALO Mini Market</span>
                    </div>
                </div>
        </>
    );

    return (
        <AccessProvider value={me}>
        <MarketsProvider>
        {/* h-dvh: trên điện thoại h-screen tính cả phần bị thanh địa chỉ che, đáy trang bị cắt. */}
        <div className="flex h-dvh overflow-hidden bg-background">
            {/* ═══ Sidebar — máy tính: cột cố định ═══ */}
            <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-white shadow-sm backdrop-blur-xl dark:bg-[#131210] dark:shadow-none md:flex">
                {noiDungMenu}
            </aside>

            {/* ═══ Sidebar — điện thoại: ngăn kéo phủ lên nội dung ═══ */}
            {menuMo && (
                <div className="fixed inset-0 z-40 md:hidden">
                    <div className="absolute inset-0 bg-black/40" onClick={() => setMenuMo(false)} aria-hidden />
                    <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-2xl dark:bg-[#131210]">
                        {noiDungMenu}
                    </aside>
                </div>
            )}

            {/* ═══ Nội dung ═══ */}
            <main className="min-w-0 flex-1 overflow-y-auto bg-background">
                <header className="sticky top-0 z-10 flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border bg-white/80 px-3 py-2 shadow-sm backdrop-blur-xl dark:bg-[#131210]/80 dark:shadow-none md:h-16 md:flex-nowrap md:px-6 md:py-0">
                    <div className="flex min-w-0 items-center gap-2">
                        <button
                            onClick={() => setMenuMo(true)}
                            className="-ml-1 rounded-lg p-2 text-foreground hover:bg-muted md:hidden"
                            aria-label="Mở menu"
                        >
                            <Menu className="h-5 w-5" />
                        </button>
                        <h1 className="flex min-w-0 items-center gap-2 text-lg font-semibold text-foreground md:text-xl">
                            <span aria-hidden>{group.emoji}</span>
                            <span className="truncate">{group.label}</span>
                        </h1>
                    </div>
                    {/* ml-auto: hàng bị xuống dòng trên điện thoại thì vẫn nằm sát phải — bảng chọn
                        ngày mở neo mép phải, nằm bên trái là tràn ra ngoài màn hình. */}
                    <div className="ml-auto flex items-center gap-2 md:gap-3">
                        {onFloorTab && reportStart && (
                            <span className="hidden text-xs text-muted-foreground md:inline" title="Trước mốc này dữ liệu chưa đầy đủ nên không tính">
                                Tính từ {format(reportStart, "dd/MM/yyyy")}
                            </span>
                        )}
                        {/* Số cập nhật lúc nào / đang cập nhật / lỗi + nút "Cập nhật ngay" (15/11/2026). */}
                        {me && <TrangThaiCapNhatNut />}
                        {!IGNORES_DATE_RANGE.has(activeTab) && (
                            <DateRangePicker
                                value={onFloorTab ? tabRange : dateRange}
                                onChange={setDateRange}
                                minDate={onFloorTab ? reportStart : null}
                            />
                        )}
                        <ThemeToggle />
                    </div>
                </header>

                <div className="space-y-4 p-3 md:space-y-6 md:p-6">
                    {/* Hàng pill chọn tab con — chỉ hiện khi mục có nhiều hơn một tab.
                        Điện thoại: một hàng cuộn ngang, không gãy chữ "P&L theo SP" thành ba dòng. */}
                    {group.tabs.length > 1 && (
                        <div className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl border border-border bg-muted/40 p-1">
                            {group.tabs.map(t => (
                                <Link
                                    key={t.id}
                                    href={hrefTab(t.id)}
                                    className={cn(
                                        "shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-all",
                                        activeTab === t.id
                                            ? "bg-card text-foreground shadow-sm"
                                            : "text-muted-foreground hover:text-foreground",
                                    )}
                                >
                                    {t.label}
                                </Link>
                            ))}
                        </div>
                    )}

                    {meLoi && (
                        <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                            Không đọc được quyền của tài khoản: {meLoi}. Tải lại trang, hoặc đăng xuất rồi đăng nhập lại.
                        </div>
                    )}
                    {me && me.tabs.length === 0 && (
                        <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                            <p className="font-semibold">Tài khoản chưa được giao team nào.</p>
                            <p className="mt-1">Nhờ giám đốc vào <strong>Quản trị → Quản lý User</strong> chọn team (Trung Đông, Đông Nam Á, Đông Á) cho tài khoản này.</p>
                        </div>
                    )}

                    {!configLoaded || !me ? null : <>
                    {duocXem("overview") && <TALPHACeoOverviewTab dateRange={tabRange} projectId="TALPHA" />}
                    {duocXem("pnl") && <TALPHAPnLTab dateRange={tabRange} projectId="TALPHA" />}
                    {duocXem("product-pnl") && <TALPHAProductPnLTab dateRange={tabRange} projectId="TALPHA" />}
                    {duocXem("tracking") && <TALPHATrackingTab dateRange={dateRange} projectId="TALPHA" />}
                    {duocXem("order-ledger") && <TALPHAOrderLedgerTab dateRange={dateRange} projectId="TALPHA" />}
                    {duocXem("lai-lo") && <TALPHALaiLoTab dateRange={tabRange} />}
                    {duocXem("cod-recon") && <TALPHACodReconTab dateRange={dateRange} projectId="TALPHA" />}
                    {duocXem("products") && <TALPHAProductsTab dateRange={dateRange} projectId="TALPHA" />}
                    {duocXem("marketing") && <TALPHAMarketingTab dateRange={tabRange} projectId="TALPHA" />}
                    {duocXem("ad-spend") && <TALPHAAdSpendTab dateRange={tabRange} projectId="TALPHA" />}
                    {duocXem("ads-command") && <TALPHAAdsCommandTab />}
                    {duocXem("ad-health") && <TALPHAAdHealthTab />}
                    {duocXem("ads-recon") && <TALPHAAdsReconTab />}
                    {duocXem("customers") && <TALPHACustomerTab dateRange={dateRange} projectId="TALPHA" />}
                    {duocXem("market-intel") && <TALPHAMarketIntelTab dateRange={dateRange} projectId="TALPHA" />}
                    </>}
                </div>
            </main>
        </div>
        </MarketsProvider>
        </AccessProvider>
    );
}

/**
 * Nhãn dưới logo: nước đang bán, và nước sắp chạy nếu có — đọc từ config, không gõ tay.
 * Người xem theo team thì ghi tên team trước (danh sách nước đã chỉ còn nước của team).
 */
function NhanThiTruong({ me }: { me: Me | null }) {
    const { markets } = useMarkets();
    const dangBan = markets.filter((m) => m.status === "dang_ban").map((m) => m.display);
    const sapChay = markets.filter((m) => m.status === "sap_chay").map((m) => m.display);
    const daTat = markets.filter((m) => m.status === "da_tat").map((m) => m.display);
    const team = me && !me.full && me.teams.length ? me.teams.map((t) => t.name).join(" · ") : null;
    return (
        <>
            <span className="mt-2 text-xs text-muted-foreground">
                {team && <strong className="font-semibold text-foreground">Team {team}: </strong>}
                {dangBan.length ? dangBan.join(" · ") : "…"}
            </span>
            {sapChay.length > 0 && (
                <span className="mt-0.5 text-[10px] text-muted-foreground">Sắp chạy: {sapChay.join(" · ")}</span>
            )}
            {daTat.length > 0 && (
                <span className="mt-0.5 text-[10px] text-muted-foreground">Đã tắt: {daTat.join(" · ")}</span>
            )}
        </>
    );
}
