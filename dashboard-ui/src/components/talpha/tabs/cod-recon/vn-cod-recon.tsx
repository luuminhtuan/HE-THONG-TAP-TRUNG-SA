"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { CheckCircle2 } from "lucide-react";
import TabSkeleton, { ErrorState } from "@/components/ui/tab-skeleton";
import type { JtLedger } from "@/lib/talpha/jt-vn";
import { formatNumber, cn } from "../../utils";
import { VND } from "../ledger-shared";
import { dmy } from "./format";
import { HeaderBar, MoneyTile, Section } from "./ui";

/* ═══════════════════════════════════════════════════════════════════
   VIỆT NAM — J&T (13/11/2026)

   Không có sao kê để tải, cũng không có chỗ nhập token (Sỹ Anh bảo bỏ 13/11/2026): Claude đọc
   số ở trang J&T VIP rồi nạp vào kho jt_vn (ops/jt_vn/), màn chỉ hiện (route
   /api/talpha/cod-recon/jt-vn, lib/talpha/jt-vn.ts). J&T chốt kỳ mỗi ngày và tự trừ
   cước, nên màn chỉ cần trả lời: J&T đã chuyển bao nhiêu, còn giữ bao nhiêu, đơn nào lệch.

     Σ  tiền về         — đã chuyển · chờ trả / số dư · đang luân chuyển · đã giao chưa vào kỳ
     ①  các kỳ J&T      — bấm một kỳ để xem từng vận đơn
     ②  đối chiếu POS   — lệch COD · đã giao mà chưa vào kỳ · vận đơn không có trên POS
     ③  đang luân chuyển (gập)
   ═══════════════════════════════════════════════════════════════════ */

/** Phản hồi GET /api/talpha/cod-recon/jt-vn?market=VN (khoá dữ liệu giữ như route trả). */
type VnCodData = {
    so: JtLedger | null;
    keo_luc: string | null; so_du_cap_nhat: string | null; tu_ngay: string;
    token: { co: boolean; het_han: string | null; con_han: boolean; luu_luc: string | null };
    loi: string | null;
};
type JtPeriodRow = JtLedger["ky"][number];

const timeDay = (s: string | null) => {
    if (!s) return "—";
    const d = new Date(s);
    return Number.isFinite(d.getTime()) ? format(d, "HH:mm dd/MM") : s;
};
/** "2026-11-12 15:37:47" (giờ VN của J&T) → "15:37 12/11". */
const jtTime = (s: string | null) => (s ? `${s.slice(11, 16)} ${s.slice(8, 10)}/${s.slice(5, 7)}` : "—");
const signedVnd = (n: number) => (n < 0 ? `âm ${VND(-n)}` : VND(n));
/** "12/11/2026" hoặc kỳ gộp "06–08/11/2026". */
const periodRange = (k: { ngay: string; den: string }) => (k.ngay === k.den || !k.den ? dmy(k.ngay)
    : `${k.ngay.slice(8, 10)}–${dmy(k.den)}`);
const shortPeriodCode = (code: string) => code.replace(/^[A-Z0-9]+-/, "");

export function VnCodRecon({ nutNuoc: marketSwitcher }: { nutNuoc?: ReactNode }) {
    const [data, setData] = useState<VnCodData | null>(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [openPeriod, setOpenPeriod] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true); setError("");
        try {
            const r = await fetch("/api/talpha/cod-recon/jt-vn?market=VN", { cache: "no-store" });
            const j = await r.json();
            if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
            setData(j);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { load(); }, [load]);

    if (loading && !data) return <TabSkeleton />;
    if (error && !data) return <ErrorState message={error} onRetry={() => load()} />;
    if (!data) return null;

    const ledger = data.so;
    if (!ledger) {
        return (
            <div className="space-y-4">
                <HeaderBar nutNuoc={marketSwitcher} nguon="J&T VIP" />
                <p className="rounded-xl border border-border bg-card p-4 text-[13px] text-muted-foreground">
                    Chưa có số đối soát J&T. Số do Claude đọc từ trang J&T VIP rồi nạp vào — nhắn Claude “cập nhật đối soát J&T”.
                </p>
            </div>
        );
    }

    const totals = ledger.tong, recon = ledger.doi_chieu;
    const notInPeriod = recon.da_giao_chua_doi_soat;
    const issueCount = recon.lech_cod.length + notInPeriod.length + recon.khong_co_tren_pos.length;
    const period = ledger.ky.find((k) => k.ma === openPeriod) || null;
    return (
        <div className="space-y-4">
            <HeaderBar nutNuoc={marketSwitcher} nguon={<>J&T VIP · số đọc lúc {timeDay(data.keo_luc)} · muốn số mới thì nhắn Claude “cập nhật đối soát J&T”</>} />
            {data.loi && <p className="text-[12.5px] font-semibold text-rose-600 dark:text-rose-400">{data.loi}</p>}

            {/* Σ tiền về */}
            <div className="grid grid-cols-2 gap-2.5 md:gap-3 xl:grid-cols-4">
                <MoneyTile mau="xanh" nhan="J&T đã chuyển về" so={VND(totals.da_ve)}
                    phu={`${totals.so_lan_chuyen} lần chuyển tiền${totals.lan_tra_cuoi ? ` · lần cuối ${jtTime(totals.lan_tra_cuoi)}` : ""}`} />
                {totals.so_du != null && totals.so_du < 0
                    ? <MoneyTile mau="do" nhan="Số dư tài khoản J&T" so={signedVnd(totals.so_du)}
                        phu={`mình đang nợ cước — trừ vào COD kỳ sau${data.so_du_cap_nhat ? ` · ${jtTime(data.so_du_cap_nhat)}` : ""}`} />
                    : <MoneyTile mau="vang" nhan="Chờ J&T trả" so={VND(totals.cho_tra)}
                        phu={`${totals.so_ky_cho_tra} kỳ chưa trả${totals.so_du != null ? ` · số dư ${signedVnd(totals.so_du)}` : ""}`} />}
                <MoneyTile mau="cam" nhan="Đang luân chuyển" so={VND(totals.dang_chay.cod)}
                    phu={`${formatNumber(totals.dang_chay.so_don)} đơn chưa ký nhận · cước ${VND(totals.dang_chay.cuoc)}`} />
                <MoneyTile mau={notInPeriod.length ? "do" : "xanhduong"} nhan="Đã giao, chưa vào kỳ nào"
                    so={notInPeriod.length ? VND(notInPeriod.reduce((a, x) => a + x.cod, 0)) : "0đ"}
                    phu={notInPeriod.length ? `${notInPeriod.length} đơn POS báo đã giao — xem khối ②` : "mọi đơn đã giao đều đã vào kỳ"} />
            </div>
            <p className="text-[12px] leading-relaxed text-muted-foreground">
                Từ {dmy(data.tu_ngay)}: J&T đã đối soát {formatNumber(totals.don_da_doi_soat)} vận đơn — COD {VND(totals.cod_da_doi_soat)}, đã trừ phí {VND(totals.phi_da_tru)}.
                {totals.cuoc_tb != null && <> Cước thật trung bình <b className="text-foreground">{VND(totals.cuoc_tb)}/đơn</b> ({totals.don_co_cuoc} đơn).</>}
            </p>

            {/* ① các kỳ */}
            <Section so="1" ten="Các kỳ đối soát J&T" phamVi="all" dem={`${ledger.ky.length} kỳ`}
                phu="J&T chốt kỳ mỗi ngày (~04h). Thực nhận = tiền đối soát + dư nợ kỳ trước; kỳ âm không trả, mang sang kỳ sau. Bấm một kỳ để xem từng vận đơn.">
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-[13px]">
                        <thead className="bg-muted/40 text-[11.5px] uppercase tracking-wide text-muted-foreground">
                            <tr>
                                <th className="px-3 py-2 text-left">Kỳ</th><th className="px-3 py-2 text-right">Đơn</th>
                                <th className="px-3 py-2 text-right">COD</th><th className="px-3 py-2 text-right">Phí</th>
                                <th className="px-3 py-2 text-right">Dư nợ trước</th><th className="px-3 py-2 text-right">Thực nhận</th>
                                <th className="px-3 py-2 text-left">Tình trạng</th>
                            </tr>
                        </thead>
                        <tbody>
                            {ledger.ky.map((k) => (
                                <tr key={k.ma} onClick={() => setOpenPeriod(openPeriod === k.ma ? null : k.ma)}
                                    className={cn("cursor-pointer border-t border-border/60 hover:bg-muted/30", openPeriod === k.ma && "bg-orange-50/60 dark:bg-orange-500/[0.06]")}>
                                    <td className="px-3 py-2"><div className="font-semibold">{periodRange(k)}</div><div className="text-[11px] text-muted-foreground">{shortPeriodCode(k.ma)}</div></td>
                                    <td className="px-3 py-2 text-right tabular-nums">{k.so_don ?? "—"}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">{VND(k.cod)}</td>
                                    <td className="px-3 py-2 text-right tabular-nums text-rose-600 dark:text-rose-400">−{VND(k.phi)}</td>
                                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{k.du_no_truoc ? signedVnd(k.du_no_truoc) : "—"}</td>
                                    <td className={cn("px-3 py-2 text-right font-bold tabular-nums", k.thuc_nhan < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400")}>{signedVnd(k.thuc_nhan)}</td>
                                    <td className="px-3 py-2">
                                        {k.da_tra
                                            ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11.5px] font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                                                {k.thuc_nhan > 0 ? `Đã trả ${jtTime(k.tra_luc)}` : "Âm — sang kỳ sau"}</span>
                                            : <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11.5px] font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">Chờ thanh toán</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {period && <PeriodOrders period={period} />}
            </Section>

            {/* ② đối chiếu POS */}
            <Section so="2" ten="Đối chiếu với đơn POS" phamVi="all" dem={issueCount ? `${issueCount} việc` : undefined}
                phu={`Nối theo mã đơn KH của J&T (= mã đơn POS) và mã vận đơn · ${formatNumber(recon.so_don_pos)} đơn POS Việt Nam.`}>
                <PosReconciliation recon={recon} />
            </Section>

            {/* ③ đang luân chuyển */}
            <Section so="3" ten="Đơn đang luân chuyển" phamVi="all" dem={`${ledger.dang_chay.length} đơn`} gap={{ mo: false }}
                phu="Đơn J&T đã nhận nhưng chưa ký nhận / chưa chốt — tiền COD chưa về kỳ nào.">
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-[12.5px]">
                        <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                            <tr><th className="px-3 py-2 text-left">Vận đơn</th><th className="px-3 py-2 text-left">Đơn POS</th>
                                <th className="px-3 py-2 text-left">Trạng thái J&T</th><th className="px-3 py-2 text-right">COD</th>
                                <th className="px-3 py-2 text-right">Cước</th><th className="px-3 py-2 text-left">Phát lúc</th></tr>
                        </thead>
                        <tbody>{ledger.dang_chay.map((x) => (
                            <tr key={x.van_don} className="border-t border-border/50">
                                <td className="px-3 py-1.5 font-mono">{x.van_don}</td>
                                <td className="px-3 py-1.5">{x.order_id ? `#${x.order_id}` : "—"}</td>
                                <td className="px-3 py-1.5">{x.trang_thai}</td>
                                <td className="px-3 py-1.5 text-right tabular-nums">{VND(x.cod)}</td>
                                <td className="px-3 py-1.5 text-right tabular-nums">{VND(x.cuoc)}</td>
                                <td className="px-3 py-1.5">{jtTime(x.giao_luc)}</td>
                            </tr>
                        ))}</tbody>
                    </table>
                </div>
            </Section>
        </div>
    );
}

/** Chi tiết một kỳ J&T: từng vận đơn, cước, phí, ròng. */
function PeriodOrders({ period }: { period: JtPeriodRow }) {
    return (
        <div className="border-t border-border bg-muted/20 p-3 md:p-4">
            <div className="mb-2 text-[13px] font-semibold">Kỳ {periodRange(period)} · {period.so_don ?? 0} vận đơn · tiền đối soát {signedVnd(period.doi_soat)}{period.dieu_chinh ? ` · điều chỉnh ${signedVnd(period.dieu_chinh)}` : ""}</div>
            {!period.don ? <p className="text-[13px] text-muted-foreground">Chưa kéo được chi tiết kỳ này.</p> : (
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[680px] text-[12.5px]">
                        <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            <tr>
                                <th className="px-2 py-1.5 text-left">Vận đơn</th><th className="px-2 py-1.5 text-left">Đơn POS</th>
                                <th className="px-2 py-1.5 text-left">Ký nhận</th><th className="px-2 py-1.5 text-right">COD</th>
                                <th className="px-2 py-1.5 text-right">Cước</th><th className="px-2 py-1.5 text-right">Phí hoàn / khác</th>
                                <th className="px-2 py-1.5 text-right">Ròng</th>
                            </tr>
                        </thead>
                        <tbody>
                            {period.don.map((x) => {
                                const otherFees = x.phi_hoan + x.phi_cod + x.phi_giao_1_phan;
                                return (
                                    <tr key={x.van_don} className="border-t border-border/50">
                                        <td className="px-2 py-1.5 font-mono">{x.van_don}</td>
                                        <td className="px-2 py-1.5">{x.order_id ? `#${x.order_id}` : x.ma_kh || "—"}<div className="text-[11px] text-muted-foreground">{x.tinh}</div></td>
                                        <td className="px-2 py-1.5">{x.ky_nhan_luc ? jtTime(x.ky_nhan_luc) : <span className="text-muted-foreground">chưa ký</span>}</td>
                                        <td className="px-2 py-1.5 text-right tabular-nums">{x.cod ? VND(x.cod) : "—"}</td>
                                        <td className="px-2 py-1.5 text-right tabular-nums">{x.cuoc ? `−${VND(x.cuoc)}` : "—"}</td>
                                        <td className="px-2 py-1.5 text-right tabular-nums">{otherFees ? `−${VND(otherFees)}` : "—"}</td>
                                        <td className={cn("px-2 py-1.5 text-right font-semibold tabular-nums", x.rong < 0 && "text-rose-600 dark:text-rose-400")}>{signedVnd(x.rong)}</td>
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

/** Khối ②: J&T trả COD khác đơn POS · POS báo đã giao mà chưa vào kỳ · vận đơn J&T không ra đơn POS. */
function PosReconciliation({ recon }: { recon: JtLedger["doi_chieu"] }) {
    const notInPeriod = recon.da_giao_chua_doi_soat;
    return (
        <div className="space-y-4 p-3.5 text-[13px] md:p-5">
            {!recon.lech_cod.length && !notInPeriod.length && !recon.khong_co_tren_pos.length && (
                <p className="flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-4 w-4" />Khớp hết: COD J&T trả đúng số trên đơn, đơn đã giao nào cũng đã vào kỳ.</p>
            )}
            {recon.lech_cod.length > 0 && (
                <div>
                    <div className="mb-1 font-semibold text-rose-600 dark:text-rose-400">J&T trả COD khác đơn POS ({recon.lech_cod.length})</div>
                    <ul className="space-y-0.5">{recon.lech_cod.map((x) => (
                        <li key={x.van_don} className="tabular-nums">#{x.order_id} · {x.van_don} · {x.khach} — đơn {VND(x.cod_pos)}, J&T trả {VND(x.cod_jt)} <span className="text-muted-foreground">(kỳ {shortPeriodCode(x.ky)})</span></li>
                    ))}</ul>
                </div>
            )}
            {notInPeriod.length > 0 && (
                <div>
                    <div className="mb-1 font-semibold text-rose-600 dark:text-rose-400">POS báo đã giao nhưng chưa vào kỳ J&T nào ({notInPeriod.length})</div>
                    <p className="mb-1 text-[12px] text-muted-foreground">Mới ký nhận hôm nay thì sáng mai J&T mới chốt kỳ — quá 2 ngày vẫn chưa thấy thì hỏi J&T.</p>
                    <ul className="space-y-0.5">{notInPeriod.map((x) => (
                        <li key={x.order_id} className="tabular-nums">#{x.order_id} · {x.tracking || "chưa có mã"} · {x.khach} · {VND(x.cod)} <span className="text-muted-foreground">({x.trang_thai}{x.order_date ? `, đơn ${dmy(x.order_date)}` : ""})</span></li>
                    ))}</ul>
                </div>
            )}
            {recon.khong_co_tren_pos.length > 0 && (
                <div>
                    <div className="mb-1 font-semibold text-amber-600 dark:text-amber-400">Vận đơn J&T không ra đơn POS ({recon.khong_co_tren_pos.length})</div>
                    <p className="mb-1 text-[12px] text-muted-foreground">Thường là đơn tạo trước mốc tính đơn Việt Nam, hoặc đơn tạo tay trên J&T.</p>
                    <ul className="space-y-0.5">{recon.khong_co_tren_pos.map((x) => (
                        <li key={x.van_don} className="tabular-nums">{x.van_don} · {x.ma_kh || "không mã đơn"} · {VND(x.cod)} <span className="text-muted-foreground">(kỳ {shortPeriodCode(x.ky)})</span></li>
                    ))}</ul>
                </div>
            )}
        </div>
    );
}
