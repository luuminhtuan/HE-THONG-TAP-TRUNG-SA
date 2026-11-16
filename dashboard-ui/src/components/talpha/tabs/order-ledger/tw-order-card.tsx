import type { ReactNode } from "react";
import { cn } from "../../utils";
import { TWD, VND, RMB, d6, statusCls, mkCls, type LedgerRowUI } from "../ledger-shared";
import { OrderCard } from "../order-ledger-shared-ui";

/** Thẻ một đơn Đài cho điện thoại — cùng dữ liệu với một dòng bảng, xếp dọc. */
export function TwOrderCard({ r }: { r: LedgerRowUI }) {
    // "Kỳ chờ" chỉ có nghĩa với đơn ĐÃ GIAO mà TIỀN CHƯA VỀ — cùng luật với cột trong bảng.
    const awaitingPayment = r.paid_twd === null && /thành công/i.test(r.status_raw || "");
    const badges: ReactNode[] = [];
    if (awaitingPayment) badges.push(
        <span key="ky" className={cn("rounded px-1.5 font-mono text-[10.5px] font-bold",
            r.ky_da_qua >= 2 ? "bg-rose-600 text-white" : "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300")}>
            chờ tiền {r.ky_da_qua} kỳ
        </span>);
    if (r.cogs_missing.length) badges.push(
        <span key="gv" className="rounded bg-amber-100 px-1.5 text-[10.5px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
            chưa khai giá {r.cogs_missing.join(",")}
        </span>);
    if (r.marketer) badges.push(
        <span key="mk" className={cn("rounded-full px-1.5 py-px text-[10.5px] font-semibold", mkCls(r.marketer))}>{r.marketer}</span>);
    const ticks = [r.tick.doi_soat && "đã đối soát", r.tick.tru_van_chuyen && "đã trừ ship", r.tick.tru_tien_hang && "đã trừ giá vốn"]
        .filter(Boolean).join(" · ");
    return (
        <OrderCard
            light={r.light} ma={r.order_no} trangThai={r.status_raw} trangThaiCls={statusCls(r.status_raw)}
            tien={TWD(r.cod_twd)}
            dong={<>{r.contact_name || "(chưa có tên)"} · lên đơn {d6(r.order_date)}</>}
            ghiChu={r.light_note}
            nhan={badges.length ? <>{badges}</> : undefined}
            chiTiet={[
                ["Còn lại", r.net_vnd === null ? null : (
                    <span className={cn("font-semibold", r.net_vnd < 0 ? "text-rose-600 dark:text-rose-400"
                        : r.net_before_cogs ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400")}>
                        {VND(r.net_vnd)}{r.net_before_cogs ? " · chưa trừ giá vốn" : ""}
                    </span>)],
                ["3PL trả", r.paid_twd === null ? null : TWD(r.paid_twd)],
                ["Lệch", r.diff_twd === null || Math.abs(r.diff_twd) <= 1 ? null
                    : <span className="font-semibold text-rose-600 dark:text-rose-400">{r.diff_twd > 0 ? "+" : ""}{TWD(r.diff_twd)}</span>],
                ["Kỳ trả", r.paid_period], ["Ngày về", d6(r.paid_date)],
                ["Điện thoại", r.phone ? <a href={`tel:${r.phone}`} className="font-mono text-violet-600 dark:text-violet-300">{r.phone}</a> : null],
                ["Vận đơn", r.tracking ? <span className="font-mono">{r.tracking}</span> : null],
                ["17TRACK", r.track17_code ? <span className="font-mono">{r.track17_code}</span> : null],
                ["Mã hoàn", r.return_order_no], ["PTVC", r.ship_method], ["Xuất kho", d6(r.ship_date)],
                ["Hàng", r.sku ? `${r.sku} × ${r.quantity}` : null],
                ["Phí ship", r.ship_fee_rmb === null ? null : `${RMB(r.ship_fee_rmb)}${r.fee_wrong ? " — sai bảng giá" : ""}`],
                ["Phí thao tác", r.op_fee_rmb === null ? null : RMB(r.op_fee_rmb)],
                ["Giá vốn", r.cogs_vnd === null ? null : VND(r.cogs_vnd)],
                ["Đã làm", ticks || null],
            ]}
        />
    );
}
