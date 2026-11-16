"use client";

import { cn } from "../../utils";
import { TWD, VND } from "../ledger-shared";
import type { AgeBucket, CodComposition, MoneyAge } from "./types";

type Segment = { label: string; bucket: AgeBucket; bar: string; text: string };

function AgeBar({ title, total, oldestDays, since, segments, format }: {
    title: string; total: number; oldestDays: number | null; since: string; segments: Segment[]; format: (n: number) => string;
}) {
    return (
        <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-baseline gap-2 text-[12px]">
                <b className="font-semibold text-foreground">{title}</b>
                {oldestDays != null && <span className="text-muted-foreground">· lâu nhất {oldestDays} ngày từ lúc {since}</span>}
            </div>
            <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-muted">
                {total > 0 && segments.filter((s) => s.bucket.cod > 0).map((s) => (
                    <div key={s.label} className={s.bar} style={{ width: `${(s.bucket.cod / total) * 100}%` }}
                        title={`${s.label}: ${s.bucket.so_don} đơn · ${format(s.bucket.cod)}`} />
                ))}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-muted-foreground">
                {segments.map((s) => (
                    <span key={s.label} className={s.bucket.so_don ? undefined : "opacity-50"}>
                        <span className={cn("mr-1 inline-block h-2 w-2 rounded-full", s.bar)} />
                        {s.label} <b className={cn("font-semibold tabular-nums", s.bucket.so_don ? s.text : "")}>{s.bucket.so_don} đơn</b>
                        {s.bucket.vnd_uoc != null && s.bucket.so_don > 0 && <span className="tabular-nums"> ≈{VND(s.bucket.vnd_uoc)}</span>}
                    </span>
                ))}
            </div>
        </div>
    );
}

/**
 * Tiền đang chờ bao lâu (13/11/2026). Hai ô "Còn phải gửi" / "Chưa giao xong" chỉ nói BAO NHIÊU;
 * thanh này nói BAO LÂU — tiền NAZA giữ quá 2 kỳ là phải đòi, đơn nằm đường quá 30 ngày gần như hoàn.
 * Đơn đã giao chia theo kỳ sao kê (cùng thước đèn Sổ đơn hàng); chưa giao chia theo ngày từ lúc gửi.
 * Số liệu: lib/talpha/cod-money-age.ts.
 */
export function MoneyAgeBars({ age, format = TWD, partner = "NAZA", since = "gửi" }: {
    age: MoneyAge; format?: (n: number) => string; partner?: string; since?: string;
}) {
    const d = age.da_giao, u = age.chua_giao;
    const byDay = d.theo === "ngay";
    return (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm md:flex-row md:gap-6">
            <AgeBar title={`Tiền ${partner} đang giữ chờ bao lâu`} since={since} format={format}
                total={d.dung_nhip.cod + d.qua_1_ky.cod + d.qua_han.cod} oldestDays={d.lau_nhat_ngay} segments={[
                    { label: byDay ? "≤14 ngày" : "đúng nhịp", bucket: d.dung_nhip, bar: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400" },
                    { label: byDay ? "15–30 ngày" : "qua 1 kỳ", bucket: d.qua_1_ky, bar: "bg-amber-400", text: "text-amber-700 dark:text-amber-400" },
                    { label: byDay ? ">30 ngày" : "quá hạn ≥2 kỳ", bucket: d.qua_han, bar: "bg-rose-500", text: "text-rose-700 dark:text-rose-400" },
                ]} />
            <AgeBar title="Đơn chưa giao xong nằm đường bao lâu" since={since} format={format}
                total={u.duoi_15.cod + u.tu_15_30.cod + u.tren_30.cod} oldestDays={u.lau_nhat_ngay} segments={[
                    { label: "≤14 ngày", bucket: u.duoi_15, bar: "bg-sky-500", text: "text-sky-700 dark:text-sky-400" },
                    { label: "15–30 ngày", bucket: u.tu_15_30, bar: "bg-amber-400", text: "text-amber-700 dark:text-amber-400" },
                    { label: ">30 ngày, dễ hoàn", bucket: u.tren_30, bar: "bg-rose-500", text: "text-rose-700 dark:text-rose-400" },
                ]} />
        </div>
    );
}

/** COD các kỳ đã có sao kê đi đâu (13/11/2026): phí giao hàng · tiền hàng bị trừ · về tay. */
export function CodCompositionBar({ c, periods, partner = "NAZA" }: { c: CodComposition; periods: number; partner?: string }) {
    const received = c.ve_tay_vnd;
    // "Khác" = điều chỉnh kỳ trước, làm tròn, phần Sing gộp… — phần còn lại để các khúc cộng đúng 100%.
    const other = c.cod_quy_vnd - c.phi_vnd - c.tien_hang_vnd - received;
    const pct = (x: number) => `${((x / c.cod_quy_vnd) * 100).toFixed(1)}%`;
    const segments = [
        { label: "về tay", amount: received, bar: "bg-emerald-500" },
        { label: `tiền hàng ${partner} trừ`, amount: c.tien_hang_vnd, bar: "bg-orange-400" },
        { label: "phí giao hàng (ship, thao tác, thu hộ)", amount: c.phi_vnd, bar: "bg-violet-400" },
        ...(Math.abs(other) >= Math.max(1000, c.cod_quy_vnd * 0.001)
            ? [{ label: other > 0 ? "điều chỉnh / khác" : "điều chỉnh cộng thêm", amount: other, bar: "bg-slate-300 dark:bg-slate-600" }] : []),
    ];
    return (
        <div className="space-y-1.5 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
            <div className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
                <b className="font-semibold text-foreground">COD {periods} kỳ đã sao kê đi đâu</b>
                <span className="text-muted-foreground">· {VND(c.cod_quy_vnd)} quy đổi theo tỷ giá từng kỳ ·</span>
                <span className="font-semibold text-emerald-700 dark:text-emerald-400">về tay {pct(received)}</span>
            </div>
            <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-muted">
                {segments.filter((s) => s.amount > 0).map((s) => (
                    <div key={s.label} className={s.bar} style={{ width: pct(s.amount) }} title={`${s.label}: ${VND(s.amount)}`} />
                ))}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-muted-foreground">
                {segments.map((s) => (
                    <span key={s.label}>
                        <span className={cn("mr-1 inline-block h-2 w-2 rounded-full", s.bar)} />
                        {s.label} <b className="font-semibold tabular-nums text-foreground">{VND(Math.abs(s.amount))}</b> ({pct(Math.abs(s.amount))})
                    </span>
                ))}
            </div>
        </div>
    );
}
