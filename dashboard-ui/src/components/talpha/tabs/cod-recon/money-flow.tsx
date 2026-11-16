import { ArrowDown, ArrowRight, ReceiptText } from "lucide-react";
import { formatNumber, cn } from "../../utils";
import { TWD, VND } from "../ledger-shared";
import type { MarketData, MarketMoneyFlow, MarketPeriod, MoneyFlow } from "./types";
import { dmy, RMB2 } from "./format";

/** Ba chặng tiền, mỗi chặng một màu — khớp đúng ba đồng tiền trong sheet TỔNG. */
const STAGES = {
    twd: {
        ky: "NT$", chip: "bg-sky-600 text-white", ten: "text-sky-800 dark:text-sky-200",
        khung: "border-sky-200 bg-sky-50/60 dark:border-sky-500/25 dark:bg-sky-500/[0.06]",
        vach: "border-sky-200/80 dark:border-sky-500/20", so: "text-sky-700 dark:text-sky-300",
    },
    rmb: {
        ky: "¥", chip: "bg-violet-600 text-white", ten: "text-violet-800 dark:text-violet-200",
        khung: "border-violet-200 bg-violet-50/60 dark:border-violet-500/25 dark:bg-violet-500/[0.06]",
        vach: "border-violet-200/80 dark:border-violet-500/20", so: "text-violet-700 dark:text-violet-300",
    },
    vnd: {
        ky: "đ", chip: "bg-emerald-600 text-white", ten: "text-emerald-800 dark:text-emerald-200",
        khung: "border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/25 dark:bg-emerald-500/[0.06]",
        vach: "border-emerald-200/80 dark:border-emerald-500/20", so: "text-emerald-700 dark:text-emerald-400",
    },
} as const;

function MoneyStage({ te: currency, ten: title, mo: description, ky: symbol, children }: {
    te: keyof typeof STAGES; ten: string; mo: string;
    /** Ký hiệu thay cho chặng đầu — Sing là S$ (08/10/2026). */
    ky?: string;
    children: React.ReactNode;
}) {
    const c = STAGES[currency];
    return (
        <div className={cn("flex min-w-0 flex-col overflow-hidden rounded-xl border", c.khung)}>
            <div className={cn("flex items-center gap-2.5 border-b px-3.5 py-2", c.vach)}>
                <span className={cn("min-w-[2.25rem] flex-none rounded-md px-1.5 py-0.5 text-center text-[11.5px] font-bold", c.chip)}>{symbol ?? c.ky}</span>
                <div className="min-w-0 leading-tight">
                    <div className={cn("text-[13px] font-bold", c.ten)}>{title}</div>
                    <div className="truncate text-[11.5px] text-muted-foreground">{description}</div>
                </div>
            </div>
            <div className="flex flex-1 flex-col gap-2 px-3.5 py-3">{children}</div>
        </div>
    );
}

function MoneyLine({ nhan: caption, so: figure, ghi: note, tru: isDeduction, tong: isTotal, mau: color, lon: large }: {
    nhan: string; so: string; ghi?: string; tru?: boolean; tong?: boolean; mau?: string; lon?: boolean;
}) {
    return (
        <div className={cn("flex items-start justify-between gap-3", isTotal && "mt-auto border-t border-border/80 pt-2.5")}>
            <div className="min-w-0">
                <div className={cn("text-[13px]", isTotal ? "font-bold text-foreground" : "text-foreground/75")}>{caption}</div>
                {note && <div className="text-[11.5px] leading-snug text-muted-foreground">{note}</div>}
            </div>
            <div className={cn("whitespace-nowrap text-right tabular-nums",
                isTotal ? cn("font-extrabold tracking-tight", large ? "text-[18px]" : "text-[15px]", color) : "text-[13.5px] font-semibold text-foreground/90",
                isDeduction && "text-rose-600 dark:text-rose-400")}>
                {figure}
            </div>
        </div>
    );
}

function RateArrow({ chu: rateLabel }: { chu: string }) {
    return (
        <div className="flex items-center justify-center gap-2 xl:flex-col xl:gap-1 xl:px-0.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">tỷ giá</span>
            <span className="whitespace-nowrap rounded-full border border-border bg-card px-2.5 py-1 text-[12px] font-bold tabular-nums text-foreground/85 shadow-sm">
                {rateLabel}
            </span>
            <ArrowDown className="h-4 w-4 text-muted-foreground xl:hidden" />
            <ArrowRight className="hidden h-4 w-4 text-muted-foreground xl:block" />
        </div>
    );
}

/**
 * Luồng tiền — chép đúng thứ tự sheet TỔNG của NAZA, để người đọc đặt cạnh file
 * NAZA gửi mà dò từng dòng. Chia ba chặng theo ba đồng tiền, đúng như tiền thật
 * đi: COD Đài → đổi sang tệ, NAZA trừ phí → đổi sang tiền Việt, trừ tiền hàng.
 */
export function MoneyFlowPanel({ l }: { l: MoneyFlow }) {
    const goods = l.tien_hang;
    const noConversion = l.vnd == null && (l.rmb_rong ?? 0) < 0;
    // Kỳ gộp Sing (24/09/2026): tiền hàng Sing là một dòng riêng, trừ theo số NAZA —
    // file tiền hàng Đài không có khoản này. Trong trong_luong_vnd đã gồm nó.
    const sgGoodsVnd = goods.sing_vnd ?? 0;
    const twGoodsInFlow = goods.dai_vnd ?? (goods.trong_luong_vnd - sgGoodsVnd);
    const carryOverAdjustment = l.vnd != null && l.phai_nhan_vnd != null
        ? l.phai_nhan_vnd - (l.vnd - (goods.cach_tra === "naza_tru" ? goods.trong_luong_vnd : sgGoodsVnd)) : 0;
    const batchLabel = goods.file ? `${goods.file.ngay.slice(8, 10)}/${goods.file.ngay.slice(5, 7)}` : "";
    return (
        <div className="px-5 py-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h4 className="text-[12px] font-bold uppercase tracking-wider text-foreground/70">Luồng tiền kỳ này</h4>
                <span className="text-[12px] text-muted-foreground">theo đúng thứ tự sheet TỔNG của NAZA — đặt cạnh file mà dò từng dòng</span>
            </div>
            <div className="grid items-stretch gap-2 xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
                <MoneyStage te="twd" ten="Đài Loan" mo="khách trả tại cửa hàng">
                    <MoneyLine nhan="Số đơn NAZA thu được" so={formatNumber(l.so_dong_sao_ke)} />
                    <MoneyLine nhan="Tổng COD thu về" so={l.cod_twd != null ? TWD(l.cod_twd) : "—"} tong lon mau={STAGES.twd.so} />
                </MoneyStage>
                <RateArrow chu={`× ${l.ty_gia_twd_rmb ?? "—"}`} />
                <MoneyStage te="rmb" ten="Trung Quốc" mo="NAZA trừ phí">
                    <MoneyLine nhan="Quy ra nhân dân tệ" so={l.rmb != null ? RMB2(l.rmb) : "—"} />
                    <MoneyLine nhan="− Phí thao tác" so={l.phi_gop ? "(gộp vào phí ship)" : RMB2(-l.phi_thao_tac_rmb)} tru={!l.phi_gop} />
                    <MoneyLine nhan="− Phí vận chuyển" so={RMB2(-l.phi_ship_rmb)} tru
                        ghi={l.sg_gop?.don ? `gồm ${l.sg_gop.don} đơn Sing ${RMB2(l.sg_gop.phi_rmb)} (kỳ gộp)` : undefined} />
                    <MoneyLine nhan="= COD còn lại" so={l.rmb_rong != null ? RMB2(l.rmb_rong) : "—"} tong
                        mau={(l.rmb_rong ?? 0) < 0 ? "text-rose-600 dark:text-rose-400" : STAGES.rmb.so} />
                </MoneyStage>
                <RateArrow chu={noConversion ? "không quy đổi" : `× ${l.ty_gia_rmb_vnd != null ? l.ty_gia_rmb_vnd.toLocaleString("vi-VN") : "—"}`} />
                <MoneyStage te="vnd" ten="Việt Nam" mo="về tài khoản">
                    <MoneyLine nhan="Quy ra tiền Việt" so={noConversion ? "không quy đổi" : l.vnd != null ? VND(l.vnd) : "—"}
                        ghi={noConversion ? "số âm — NAZA mang sang trừ kỳ sau" : undefined} />
                    {goods.cach_tra === "naza_tru" ? (
                        <MoneyLine nhan={sgGoodsVnd ? "− Tiền hàng Đài" : "− Phí mua hàng"} so={VND(-twGoodsInFlow)} tru
                            ghi={goods.lech_naza_vnd && Math.abs(goods.lech_naza_vnd) >= 1
                                ? `theo file tiền hàng · NAZA ghi ${VND(goods.naza_tru_vnd!)}`
                                : goods.file ? `đợt ${batchLabel}` : "theo sao kê NAZA"} />
                    ) : (
                        <MoneyLine nhan="− Phí mua hàng" so="không trừ"
                            ghi={goods.file ? `tự chuyển khoản riêng ${VND(goods.file.tong_vnd)}` : "kỳ này NAZA không trừ"} />
                    )}
                    {sgGoodsVnd > 0 && (
                        <MoneyLine nhan="− Tiền hàng Sing" so={VND(-sgGoodsVnd)} tru
                            ghi="kỳ gộp Singapore · theo sao kê NAZA" />
                    )}
                    {Math.abs(carryOverAdjustment) >= 1 && (
                        <MoneyLine nhan="± Điều chỉnh kỳ trước" so={VND(carryOverAdjustment)} tru={carryOverAdjustment < 0}
                            ghi="NAZA mang số âm kỳ trước sang" />
                    )}
                    <MoneyLine nhan="= Phải nhận" tong lon
                        so={l.phai_nhan_vnd != null ? VND(l.phai_nhan_vnd) : (l.rmb_rong ?? 0) < 0 ? "0đ — trừ kỳ sau" : "—"}
                        mau={l.phai_nhan_vnd != null ? STAGES.vnd.so : "text-rose-600 dark:text-rose-400"} />
                </MoneyStage>
            </div>
            {goods.file && goods.cach_tra === "tu_chuyen" && (
                <div className={cn("mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border px-3.5 py-2.5 text-[13px]",
                    (goods.con_no_vnd ?? 0) > 0
                        ? "border-rose-200 bg-rose-50/70 dark:border-rose-500/30 dark:bg-rose-500/10"
                        : "border-border bg-muted/30")}>
                    <ReceiptText className="h-4 w-4 flex-none text-muted-foreground" />
                    <span className="font-semibold text-foreground">Tiền hàng đợt {batchLabel}:</span>
                    <span className="font-semibold tabular-nums text-orange-600 dark:text-orange-400">{VND(goods.file.tong_vnd)}</span>
                    <span className="text-muted-foreground">· đã trả</span>
                    <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{VND(goods.da_tra_vnd ?? 0)}</span>
                    {(goods.con_no_vnd ?? 0) > 0 && (
                        <>
                            <span className="text-muted-foreground">· còn nợ</span>
                            <span className="font-bold tabular-nums text-rose-600 dark:text-rose-400">{VND(goods.con_no_vnd!)}</span>
                        </>
                    )}
                    {goods.file.no_ky_truoc_vnd > 0 && (
                        <span className="text-muted-foreground">· gồm {VND(goods.file.no_ky_truoc_vnd)} nợ kỳ trước</span>
                    )}
                </div>
            )}
        </div>
    );
}

/**
 * Luồng tiền một kỳ nước ngoài Đài — ba chặng như LuongTien của Đài, nhưng các dòng trừ đọc
 * thẳng từ sheet TỔNG (mẫu Sing: phí thu hộ, phí ship, phí hàng hoàn lên kệ, tiền hàng).
 */
export function MarketMoneyFlowPanel({ l, ky: statementPeriod, m, tien: formatAmount }: { l: MarketMoneyFlow; ky: MarketPeriod; m: MarketData["market"]; tien: (n: number) => string }) {
    const isNegative = (l.phai_nhan_vnd ?? 0) < 0;
    return (
        <div className="px-5 py-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h4 className="text-[12px] font-bold uppercase tracking-wider text-foreground/70">Luồng tiền kỳ này</h4>
                <span className="text-[12px] text-muted-foreground">theo đúng thứ tự sheet TỔNG của NAZA — đặt cạnh file mà dò từng dòng</span>
            </div>
            <div className="grid items-stretch gap-2 xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
                <MoneyStage te="twd" ky={m.symbol} ten={m.display} mo="khách trả khi nhận hàng">
                    <MoneyLine nhan="Số đơn NAZA thu được" so={formatNumber(l.so_don)} ghi={!l.so_don ? `kỳ này chưa thu COD — chỉ có phí ${statementPeriod.don_phi ?? 0} đơn` : undefined} />
                    <MoneyLine nhan="Tổng COD thu về" so={formatAmount(l.cod_local)} tong lon mau={STAGES.twd.so} />
                </MoneyStage>
                <RateArrow chu={l.ty_gia_rmb != null ? `× ${l.ty_gia_rmb}` : "—"} />
                <MoneyStage te="rmb" ten="Trung Quốc" mo="NAZA trừ phí">
                    <MoneyLine nhan="Quy ra nhân dân tệ" so={l.rmb != null ? RMB2(l.rmb) : "—"} />
                    {l.tru_rmb.map((x) => <MoneyLine key={x.nhan} nhan={`− ${x.nhan}`} so={RMB2(-x.so)} tru ghi={x.ghi} />)}
                    <MoneyLine nhan="= COD còn lại" so={l.rmb_rong != null ? RMB2(l.rmb_rong) : "—"} tong
                        mau={(l.rmb_rong ?? 0) < 0 ? "text-rose-600 dark:text-rose-400" : STAGES.rmb.so} />
                </MoneyStage>
                <RateArrow chu={`× ${l.ty_gia_vnd != null ? l.ty_gia_vnd.toLocaleString("vi-VN") : "—"}`} />
                <MoneyStage te="vnd" ten="Việt Nam" mo="về tài khoản">
                    <MoneyLine nhan="Quy ra tiền Việt" so={l.vnd != null ? VND(l.vnd) : "—"} />
                    {l.tru_vnd.map((x) => <MoneyLine key={x.nhan} nhan={`− ${x.nhan}`} so={VND(-x.so)} tru ghi={x.ghi ?? "theo sao kê NAZA"} />)}
                    {l.chenh_vnd !== 0 && <MoneyLine nhan="± Điều chỉnh" so={VND(l.chenh_vnd)} tru={l.chenh_vnd < 0} ghi="NAZA ghi thêm, sheet TỔNG không tách dòng" />}
                    <MoneyLine nhan="= Phải nhận" tong lon
                        so={l.phai_nhan_vnd == null ? "—" : isNegative ? `âm ${VND(-l.phai_nhan_vnd)}` : VND(l.phai_nhan_vnd)}
                        ghi={isNegative ? (statementPeriod.tru_vao_dai ? `đã trừ vào tiền COD Đài kỳ ${dmy(statementPeriod.tru_vao_dai)} (bản gộp) — không có tiền về` : "NAZA trừ vào kỳ sau") : undefined}
                        mau={isNegative || l.phai_nhan_vnd == null ? "text-rose-600 dark:text-rose-400" : STAGES.vnd.so} />
                </MoneyStage>
            </div>
        </div>
    );
}
