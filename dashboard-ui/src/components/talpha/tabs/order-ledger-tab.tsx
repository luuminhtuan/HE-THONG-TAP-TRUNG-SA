"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { format } from "date-fns";
import TabSkeleton, { ErrorState } from "@/components/ui/tab-skeleton";
import { useUrlParam } from "../url-state";
import { formatNumber, cn } from "../utils";
import {
    TWD, VND, RMB, d6, STRIPE, rowCls, statusCls, mkCls, countDeliveryOutcomes,
    type Light, type LedgerRowUI, type UnpaidOrder,
} from "./ledger-shared";
import PartnerSheetImporter, { isSheetStale, shortImportLabel, type PartnerSheetImport } from "@/components/talpha/partner-sheet-importer";
import MarketOrderLedger from "./order-ledger-market";
import { CardList, FixTasksPanel, LightFilterBar, LedgerToolbar, useNarrowScreen, type FixTask } from "./order-ledger-shared-ui";
import { C, Tick, Th, Td } from "./order-ledger/table-cells";
import { NazaChasePanel } from "./order-ledger/naza-chase-panel";
import { TwOrderCard } from "./order-ledger/tw-order-card";

interface Props { dateRange?: { from: Date; to: Date }; projectId?: string }

/** Cảnh báo mang theo BẢNG chi tiết — nói "thiếu 6 mã" rồi bảo đi mở file JSON
 *  thì người đọc vẫn phải tự tra mã nào là hàng gì, dính bao nhiêu đơn. Hiện trong khung
 *  "việc cần sửa dữ liệu" (order-ledger-shared-ui.tsx), mặc định gập. */
type Note = FixTask;

/**
 * Nút chọn nước (Sỹ Anh yêu cầu 29/09/2026): Đài Loan giữ nguyên sổ NAZA + sao kê; Singapore,
 * UAE dùng sổ theo vận đơn (SoDonNuoc) vì chưa có sao kê. Danh sách nước lấy từ
 * /api/talpha/markets — không gõ cứng ở giao diện.
 *
 * Phân quyền theo team (05/10/2026): danh sách chỉ còn nước của team người xem, nên CHỜ có
 * danh sách rồi mới dựng sổ và mở ở nước đầu tiên được xem — mặc định cứng "TW" thì leader
 * UAE mở tab là đụng ngay sổ Đài, máy chủ từ chối, màn lỗi che mất nút đổi nước.
 */
export default function TALPHAOrderLedgerTab(props: Props) {
    const [marketParam, setMarketParam] = useUrlParam("market");
    const [ds, setDs] = useState<{ code: string; display: string }[] | null>(null);
    // Nước của team đang bán nhưng chưa có sổ (chưa khai hãng vận chuyển — Nhật 09/10/2026).
    const [marketsWithoutLedger, setMarketsWithoutLedger] = useState<string[]>([]);
    useEffect(() => {
        fetch("/api/talpha/markets").then((r) => r.json())
            .then((d: { markets?: { code: string; display: string; status?: string; co_van_don?: boolean }[] }) => {
                // Chỉ nước đang bán: nước sắp chạy chưa có đơn, nước đã tắt (04/11/2026) không còn sổ
                // để làm việc — đơn cũ chờ thu tiền xem ở Kế toán → Tiền COD về.
                const activeMarkets = (d.markets || []).filter((m) => (m.status || "active") === "active");
                // Sổ đơn đọc đơn + trạng thái giao qua hãng vận chuyển: nước chưa khai tracking.markets
                // (Nhật Bản lúc mới mở) gọi sổ là máy chủ trả 400 — ẩn nút thay vì hiện màn lỗi.
                const list = activeMarkets.filter((m) => m.co_van_don !== false).map((m) => ({ code: m.code, display: m.display }));
                setMarketsWithoutLedger(activeMarkets.filter((m) => m.co_van_don === false).map((m) => m.display));
                setDs(list);
            })
            .catch(() => setDs([]));   // không lấy được danh sách nước thì vẫn hiện sổ Đài như cũ
    }, []);
    if (ds === null) return <TabSkeleton />;
    // Nước đang xem nằm trên địa chỉ (?market=SG, 15/11/2026) — tải lại / gửi link là mở đúng nước.
    // Mã lạ hoặc nước ngoài team → nước đầu tiên được xem.
    const market = marketParam && ds.some((m) => m.code === marketParam.toUpperCase()) ? marketParam.toUpperCase() : (ds[0]?.code ?? "TW");
    // Team chỉ có nước chưa có sổ: nói thẳng, đừng mở sổ Đài (máy chủ sẽ từ chối, màn lỗi khó hiểu).
    if (!ds.length && marketsWithoutLedger.length) {
        return (
            <div className="rounded-xl border border-border bg-card px-5 py-6 text-sm text-muted-foreground">
                Sổ đơn {marketsWithoutLedger.join(", ")} chưa mở được: chưa khai hãng vận chuyển (chưa có mã vận đơn để theo dõi giao hàng).
                Đơn của nước này xem tạm ở Kế toán → Tiền COD về.
            </div>
        );
    }
    // Nút chọn nước nằm CÙNG hàng với thanh công cụ của sổ (07/10/2026) — truyền xuống để sổ tự xếp.
    const marketSwitcher = ds.length > 1 ? (
        <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1">
            {ds.map((m) => (
                <button key={m.code} onClick={() => setMarketParam(m.code)}
                    className={cn("rounded-md px-3.5 py-1 text-sm font-medium transition-colors",
                        market === m.code ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                    {m.display}
                </button>
            ))}
        </div>
    ) : null;
    return market === "TW"
        ? <TwOrderLedger {...props} nutNuoc={marketSwitcher} />
        : <MarketOrderLedger key={market} code={market} nutNuoc={marketSwitcher} dateRange={props.dateRange} />;
}

function TwOrderLedger({ dateRange, nutNuoc: marketSwitcher }: Props & { nutNuoc?: ReactNode }) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [rows, setRows] = useState<LedgerRowUI[]>([]);
    const [notes, setNotes] = useState<Note[]>([]);
    const [partnerImport, setPartnerImport] = useState<PartnerSheetImport | null>(null);
    const [unpaidOrders, setUnpaidOrders] = useState<UnpaidOrder[]>([]);
    const [chaseTask, setChaseTask] = useState<{ chi_tiet: string } | null>(null);
    const [filter, setFilter] = useState<Light | "all">("all");
    const narrow = useNarrowScreen();
    const [q, setQ] = useState("");

    // Sổ chỉ giữ đơn LÊN ĐƠN trong khoảng đang chọn (27/10/2026). Không có `from` thì máy chủ
    // trả mọi đơn — đường của màn Tiền COD về.
    const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "";
    const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

    const load = useCallback(async () => {
        setLoading(true); setError("");
        try {
            const res = await fetch(`/api/talpha/order-ledger?${from ? `from=${from}&` : ""}to=${to}`);
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || "Không dựng được sổ");
            setRows(d.rows || []);
            setNotes(d.warnings || []);
            setPartnerImport(d.nhap_bang_don || null);
            setUnpaidOrders(d.chua_ve_tien || []);
            setChaseTask((d.viec || []).find((v: { id: string }) => v.id === "doi-naza") || null);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Lỗi không rõ");
        } finally { setLoading(false); }
    }, [from, to]);

    useEffect(() => { load(); }, [load]);

    const shown = useMemo(() => {
        const nd = q.trim().toLowerCase();
        return rows.filter((r) =>
            (filter === "all" || r.light === filter) &&
            (!nd || [r.order_no, r.tracking, r.track17_code, r.contact_name, r.phone, r.sku, r.marketer]
                .some((v) => String(v || "").toLowerCase().includes(nd))));
    }, [rows, filter, q]);

    const exportCsv = () => {
        const head = ["Đèn", "Mã đơn", "Trạng thái", "Đối soát (tay)", "Ngày lên đơn", "Ngày xuất kho",
            "Kỳ chờ", "PTVC", "Vận đơn", "Mã đơn hoàn", "Mã 17TRACK", "SKU", "SL", "Tên khách",
            "Điện thoại", "Marketer", "COD (NT$)", "3PL trả (NT$)", "Lệch (NT$)", "Kỳ sao kê",
            "Ngày về tiền", "Phí ship (¥)", "Phí thao tác (¥)", "Giá vốn (đ)", "Còn lại (đ)", "Ghi chú"];
        const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const body = shown.map((r) => [r.light, r.order_no, r.status_raw, r.recon_manual,
            r.order_date, r.ship_date, r.ky_da_qua, r.ship_method, r.tracking, r.return_order_no,
            r.track17_code, r.sku, r.quantity, r.contact_name, r.phone, r.marketer,
            r.cod_twd, r.paid_twd ?? "", r.diff_twd ?? "", r.paid_period, r.paid_date,
            r.ship_fee_rmb ?? "", r.op_fee_rmb ?? "", r.cogs_vnd ?? "",
            r.net_vnd === null ? "" : Math.round(r.net_vnd),
            r.net_before_cogs ? "chưa trừ giá vốn" : r.light_note].map(esc).join(","));
        const blob = new Blob(["﻿" + [head.map(esc).join(","), ...body].join("\n")],
            { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = `so-don-hang_TW_${from ? `${from}_` : ""}${to}.csv`; a.click();
        URL.revokeObjectURL(a.href);
    };

    if (loading && !rows.length) return <div className="space-y-4">{marketSwitcher}<TabSkeleton cards={0} rows={12} showChart={false} /></div>;
    if (error) return <div className="space-y-4">{marketSwitcher}<ErrorState message={error} onRetry={load} /></div>;

    const count = (l: Light) => rows.filter((r) => r.light === l).length;
    const sheetStale = isSheetStale(partnerImport);

    return (
        <div className="space-y-3 md:space-y-4">
            <LedgerToolbar
                nutNuoc={marketSwitcher}
                nguon={sheetStale ? null : shortImportLabel(partnerImport)}
                nguonGiaiThich={"Sổ đơn = mọi đơn, mọi cột của bảng đơn đối tác ghép với sao kê NAZA. Máy tự nạp lúc 6h sáng; "
                    + "cần ngay thì bấm “Đọc bảng đối tác” ở tab Theo dõi vận đơn. Đơn quá hạn thì đòi ở khung “Đòi tiền NAZA”; "
                    + "tiền về từng kỳ sao kê xem ở Kế toán → Tiền COD về."}
                q={q} setQ={setQ} placeholder="Tìm mã đơn, vận đơn, tên, SĐT, SKU…"
                onTaiLai={load} dangTai={loading} onCsv={exportCsv}
            />
            {/* Bảng đối tác đã cũ → vẫn khung đỏ to như trước: số trên màn KHÔNG phải của hôm nay. */}
            {sheetStale && <PartnerSheetImporter n={partnerImport} anMaTrung />}

            <LightFilterBar
                muc={[
                    { id: "do", label: "Phải xử", n: count("do") },
                    { id: "vang", label: "Đang chờ", n: count("vang") },
                    { id: "xanh", label: "Xong sạch", n: count("xanh") },
                    { id: "xam", label: "Không đòi", n: count("xam") },
                ]}
                tong={rows.length} chon={filter} onChon={setFilter}
                tyLe={countDeliveryOutcomes(rows, (r) => [r.status, r.status_raw])}
            />

            <NazaChasePanel ds={unpaidOrders.filter((p) => p.qua_han)} canNhan={!!chaseTask} chiTiet={chaseTask?.chi_tiet || ""} onXong={load} />

            <FixTasksPanel viec={notes} hep={narrow} />

            {narrow ? (
                <CardList key={`${filter}|${q}`} ds={shown} tong={rows.length}
                    khoa={(r) => r.tracking + r.order_no} ve={(r) => <TwOrderCard r={r} />} />
            ) : (<>
            {/* Cuộn CẢ HAI chiều, dựng HẾT mọi dòng — không phân trang.
                Tiêu đề ghim trên, cột mã đơn ghim trái: cuộn kiểu gì cũng biết
                đang ở đơn nào và cột nào. */}
            <div className="overflow-auto rounded-xl border border-border bg-card shadow-sm"
                style={{ maxHeight: "min(70vh, 760px)" }}>
                <table className="border-separate border-spacing-0 whitespace-nowrap text-[11.5px]">
                    <thead>
                        <tr className="text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground/70">
                            <th className="sticky left-0 top-0 z-40 bg-muted px-1.5 py-[5px] text-left" colSpan={2}></th>
                            <th className="sticky top-0 z-30 border-l border-border bg-muted px-1.5 py-[5px] text-left" colSpan={3}>Thời gian</th>
                            <th className="sticky top-0 z-30 border-l border-border bg-muted px-1.5 py-[5px] text-left" colSpan={4}>Vận chuyển</th>
                            <th className="sticky top-0 z-30 border-l border-border bg-muted px-1.5 py-[5px] text-left" colSpan={2}>Hàng</th>
                            <th className="sticky top-0 z-30 border-l border-border bg-muted px-1.5 py-[5px] text-left" colSpan={3}>Khách &amp; người chạy</th>
                            <th className="sticky top-0 z-30 border-l border-border bg-muted px-1.5 py-[5px] text-left" colSpan={5}>Tiền về</th>
                            <th className="sticky top-0 z-30 border-l border-border bg-muted px-1.5 py-[5px] text-left" colSpan={5}>Tiền ra &amp; kết quả</th>
                        </tr>
                        <tr className="text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">
                            <Th pin stt>#</Th>
                            <Th pinAfter>Mã đơn · trạng thái</Th>
                            <Th grp>Lên đơn</Th><Th>Xuất kho</Th>
                            <Th num title="Đã qua bao nhiêu KỲ SAO KÊ kể từ khi giao mà tiền chưa về. Từ 2 kỳ là phải đòi. Đơn đã nhận tiền thì để trống.">Kỳ chờ</Th>
                            <Th grp>PTVC</Th><Th>Vận đơn</Th><Th>Mã hoàn</Th><Th>17TRACK</Th>
                            <Th grp>SKU</Th><Th num>SL</Th>
                            <Th grp>Tên khách</Th><Th>Điện thoại</Th><Th>MKT</Th>
                            <Th grp num>COD</Th><Th num>3PL trả</Th><Th num>Lệch</Th><Th>Kỳ trả</Th><Th>Ngày về</Th>
                            <Th grp num>Ship</Th><Th num>Thao tác</Th><Th num>Giá vốn</Th>
                            <Th title="Đã đối soát · Đã trừ vận chuyển · Đã trừ tiền hàng">Đã trừ</Th>
                            <Th num>Còn lại</Th>
                        </tr>
                    </thead>
                    <tbody>
                        {shown.map((r, i) => {
                            /* "Kỳ chờ" chỉ có nghĩa với đơn ĐÃ GIAO mà TIỀN CHƯA VỀ. Đơn đã
                               nhận tiền thì con số này là nhiễu — để trống. */
                            const awaitingPayment = r.paid_twd === null && /thành công/i.test(r.status_raw || "");
                            const skuM = (r.sku || "").match(/^(\d{3})(.*)$/);
                            return (
                                <tr key={r.tracking + r.order_no} className={cn("group", rowCls(r.light))}>
                                    {/* Số thứ tự theo danh sách ĐANG HIỆN, không phải id đơn —
                                        lọc hay tìm thì đánh số lại từ 1, để đếm được còn bao
                                        nhiêu dòng trong nhóm mình đang xem. */}
                                    <Td pin stt light={r.light} className="text-right tabular-nums text-muted-foreground/60">
                                        {i + 1}
                                    </Td>
                                    <Td pinAfter light={r.light}>
                                        <span className="flex items-center">
                                            <i title={r.light_note} className={cn("mr-1.5 inline-block h-[14px] w-[3px] flex-none rounded-sm", STRIPE[r.light])} />
                                            <b>{r.order_no}</b>
                                            <span className={cn("ml-1.5 rounded-[3px] px-1.5 text-[9.5px] font-semibold", statusCls(r.status_raw))}>
                                                {r.status_raw || "—"}
                                            </span>
                                            {r.recon_manual && <span className={cn("ml-1 text-[9.5px]", C.faint)}>{r.recon_manual}</span>}
                                        </span>
                                    </Td>
                                    <Td grp className={C.dt}>{d6(r.order_date)}</Td>
                                    <Td className={C.dt2}>{d6(r.ship_date)}</Td>
                                    <Td num>
                                        {!awaitingPayment ? <span className={C.faint}>·</span> : (
                                            <span title={`Đã qua ${r.ky_da_qua} kỳ sao kê kể từ khi giao mà tiền chưa về${r.ky_da_qua >= 2 ? " — phải đòi" : ""}`}
                                                className={cn("rounded-[3px] px-1.5 font-mono text-[10px] font-bold",
                                                    r.ky_da_qua >= 2 ? "bg-rose-600 text-white"
                                                        : "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300")}>
                                                {r.ky_da_qua} kỳ
                                            </span>
                                        )}
                                    </Td>
                                    <Td grp className="text-[10.5px]">{r.ship_method || "·"}</Td>
                                    <Td className={C.id}>{r.tracking}</Td>
                                    <Td className={C.id2}>{r.return_order_no || "·"}</Td>
                                    <Td className={C.id2}>{r.track17_code || "·"}</Td>
                                    <Td grp>
                                        <span className="inline-block max-w-[200px] truncate align-middle" title={r.sku}>
                                            {skuM ? <><b className="text-amber-700 dark:text-amber-400">{skuM[1]}</b>{skuM[2]}</> : (r.sku || "·")}
                                        </span>
                                        {r.cogs_missing.length > 0 && (
                                            <span className="ml-1 rounded-[3px] bg-amber-100 px-1.5 text-[9.5px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                                                chưa khai giá {r.cogs_missing.join(",")}
                                            </span>
                                        )}
                                    </Td>
                                    <Td num>{r.quantity}</Td>
                                    <Td grp>{r.contact_name || "·"}</Td>
                                    <Td className={C.tel}>{r.phone || "·"}</Td>
                                    <Td>{r.marketer
                                        ? <span className={cn("rounded-full px-1.5 py-px text-[10px] font-semibold", mkCls(r.marketer))}>{r.marketer}</span>
                                        : <span className={C.faint}>·</span>}</Td>
                                    <Td grp num className="font-bold">{TWD(r.cod_twd)}</Td>
                                    <Td num>{r.paid_twd === null ? <span className={C.faint}>·</span>
                                        : <span className="font-semibold text-emerald-600 dark:text-emerald-400">{TWD(r.paid_twd)}</span>}</Td>
                                    <Td num>{r.diff_twd === null || Math.abs(r.diff_twd) <= 1 ? <span className={C.faint}>·</span>
                                        : <span className="font-bold text-rose-600 dark:text-rose-400">{r.diff_twd > 0 ? "+" : ""}{TWD(r.diff_twd)}</span>}</Td>
                                    <Td className={cn("text-[10px]", C.faint)}>
                                        <span className="inline-block max-w-[150px] truncate align-middle" title={r.paid_period}>{r.paid_period || "·"}</span>
                                    </Td>
                                    <Td className={C.dt2}>{d6(r.paid_date)}</Td>
                                    <Td grp num className={C.fee}>{r.ship_fee_rmb === null ? <span className={C.faint}>·</span>
                                        : r.fee_wrong ? <span className="font-bold text-rose-600 dark:text-rose-400">{RMB(r.ship_fee_rmb)} !</span>
                                            : RMB(r.ship_fee_rmb)}</Td>
                                    <Td num className={C.fee}>{r.op_fee_rmb === null ? "·" : RMB(r.op_fee_rmb)}</Td>
                                    <Td num className={C.cogs}>{r.cogs_vnd === null ? "·" : VND(r.cogs_vnd)}</Td>
                                    <Td>
                                        <Tick on={r.tick.doi_soat} title={r.tick.doi_soat
                                            ? `Đã có trên sao kê ${r.paid_period}${r.matched_by === "order_id_giao_lai" ? " (đơn giao lại)" : ""}`
                                            : "Sao kê chưa nhắc tới đơn này"} />
                                        <Tick on={r.tick.tru_van_chuyen} title={r.ship_fee_rmb === null ? "Chưa thấy trên bảng phí" : "Đã có dòng phí"} />
                                        <Tick on={r.tick.tru_tien_hang} title={r.cogs_vnd === null
                                            ? `Chưa khai giá vốn cho mã ${r.cogs_missing.join(", ") || "(không rõ)"}` : `Giá vốn ${VND(r.cogs_vnd)}`} />
                                    </Td>
                                    <Td num>{r.net_vnd === null ? <span className={C.faint}>·</span>
                                        : <span className={cn("font-bold", r.net_vnd < 0 ? "text-rose-600 dark:text-rose-400"
                                            : r.net_before_cogs ? "text-amber-600 dark:text-amber-400"
                                                : "text-emerald-600 dark:text-emerald-400")}>{VND(r.net_vnd)}</span>}</Td>
                                </tr>
                            );
                        })}
                        {!shown.length && (
                            <tr><td colSpan={24} className="px-3 py-12 text-center text-muted-foreground">Không có đơn nào trong nhóm này.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-border bg-muted/30 px-4 py-2.5 text-[11.5px] text-muted-foreground">
                <span className="font-semibold text-foreground">Vạch màu:</span>
                <span><i className="mr-1.5 inline-block h-3 w-[3px] rounded-sm bg-rose-500 align-[-2px]" />phải xử</span>
                <span><i className="mr-1.5 inline-block h-3 w-[3px] rounded-sm bg-amber-400 align-[-2px]" />đang chờ</span>
                <span><i className="mr-1.5 inline-block h-3 w-[3px] rounded-sm bg-emerald-500 align-[-2px]" />xong</span>
                <span><i className="mr-1.5 inline-block h-3 w-[3px] rounded-sm bg-slate-300 align-[-2px] dark:bg-slate-600" />không đòi</span>
                <span><b className="text-foreground">Kỳ chờ</b> = đã qua mấy kỳ sao kê mà tiền chưa về; từ 2 kỳ là phải đòi</span>
                <span><b className="text-foreground">Còn lại</b> vàng = chưa trừ giá vốn, số đang cao hơn thật</span>
                <span className="ml-auto font-mono">{formatNumber(shown.length)} / {formatNumber(rows.length)} đơn — không phân trang</span>
            </div>
            </>)}
        </div>
    );
}
