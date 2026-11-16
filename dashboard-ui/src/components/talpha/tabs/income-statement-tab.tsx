"use client";

import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { formatVNDCompact, formatMoney, formatNumber, cn } from "../utils";
import { scopeLabel, useAccess } from "../access-context";
import {
    ReportHero, KpiRow, KpiTile, ResultCard, WaterfallList, FootNotes, DASH,
    type WaterfallRow,
} from "../report";
import type { Data } from "./income-statement/types";
import { totalFees, formatDmy, pct, signed, fetchJson, salesBridge } from "./income-statement/helpers";
import { MarketTable, ParcelTable, FeeTable } from "./income-statement/market-tables";
import { OpexSection } from "./income-statement/opex-section";

/*
 * KẾ TOÁN → LÃI LỖ (Sỹ Anh chốt 04/11/2026): kết quả kinh doanh đủ mọi khoản, theo kỳ đang chọn.
 *
 *   Doanh số → Doanh thu → − Giá vốn → − Chi phí 3PL → = Lãi gộp → − Chi phí khai thác
 *   (ads + vận hành) → = Lợi nhuận sau cùng
 *
 * Số tính ở /api/talpha/income-statement (lib/talpha/income-statement.ts). Doanh thu theo KIỆN thật của 3PL — kiện
 * đang đi nhân tỉ lệ giao thật của nước đó. Luôn hiện hai mức lãi: dự kiến và tối thiểu (coi mọi
 * kiện đang đi là hoàn). Tab P&L ở mục Báo cáo vẫn là số "tạm tính nhanh" (coi mọi đơn giao hết).
 */

interface Props { dateRange?: { from: Date; to: Date } }

export default function IncomeStatementTab({ dateRange }: Props) {
    const [data, setData] = useState<Data | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [reloadKey, setReloadKey] = useState(0);
    const scope = scopeLabel(useAccess());

    const from = format(dateRange?.from ?? new Date(), "yyyy-MM-dd");
    const to = format(dateRange?.to ?? new Date(), "yyyy-MM-dd");
    useEffect(() => {
        let cancelled = false;
        setLoading(true); setError(null);
        fetchJson<Data>(`/api/talpha/income-statement?from=${from}&to=${to}`)
            .then((d) => { if (!cancelled) setData(d); })
            .catch((e) => { if (!cancelled) { setData(null); setError(String(e?.message || e)); } })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [from, to, reloadKey]);
    const reload = useCallback(() => setReloadKey((x) => x + 1), []);

    if (loading && !data) return <TabSkeleton cards={6} showChart={false} rows={6} />;
    if (error || !data) {
        return (
            <div className="rounded-xl border border-rose-300 bg-rose-50 p-5 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                <p className="font-semibold">Không tính được lãi lỗ.</p>
                <p className="mt-1">{error}</p>
            </div>
        );
    }

    const t = data.tong;
    const expected = t.du_kien;
    const fees3pl = totalFees(expected.phi);
    const grossProfit = expected.doanh_thu - expected.gia_von - fees3pl;
    const operatingCost = t.ads + t.van_hanh;
    const netProfit = t.loi_nhuan.du_kien, minNetProfit = t.loi_nhuan.toi_thieu;
    const okMarkets = data.nuoc.filter((n) => !n.loi && n.tk);
    const bridges = okMarkets.map(salesBridge).filter(Boolean) as NonNullable<ReturnType<typeof salesBridge>>[];
    const sumC = (f: (c: NonNullable<ReturnType<typeof salesBridge>>) => number) => bridges.reduce((s, c) => s + f(c), 0);
    const failedMarkets = data.nuoc.filter((n) => n.loi);
    // Doanh số của nước đọc kiện lỗi + phần ngoài các nước đang bán: không có kiện để soi.
    const salesWithoutParcels = failedMarkets.reduce((s, n) => s + n.doanh_so, 0) + (data.ngoai_nuoc?.doanh_so || 0);
    const salesNotShipped = sumC((c) => c.khong_thanh_kien) + salesWithoutParcels;
    const missingCogs = okMarkets.reduce((s, n) => s + (n.tk?.thieu_gia_von || 0), 0);
    const provisionalMarkets = okMarkets.filter((n) => n.ty_le?.tam || n.ty_le?.r == null);
    const openReturnMarkets = okMarkets.filter((n) => (n.tk?.hoan_con_han.n || 0) > 0);
    const period = `${formatDmy(data.from)} → ${formatDmy(data.to)}`;
    const totalInTransit = sumC((c) => c.dang_di);

    const waterfallRows: WaterfallRow[] = [
        { label: "Doanh số", hint: `${formatNumber(t.don)} đơn đã chốt · file TỔNG TEAM`, value: formatMoney(t.doanh_so), kind: "base" },
        salesNotShipped >= 0 ? {
            label: "Chốt nhưng không thành kiện 3PL",
            hint: "huỷ / bom trước khi gửi, sửa giá khi lên đơn" + (salesWithoutParcels > 0 ? " · gồm doanh số chưa soi được kiện" : ""),
            value: formatMoney(salesNotShipped), kind: "minus",
        } : {
            label: "Kiện 3PL nhiều hơn doanh số Sheet",
            hint: "kiện của đơn không nằm trong file TỔNG TEAM — người ngoài team, đơn lên tay ở 3PL, giao lại, tăng giá khi lên đơn",
            value: `+${formatMoney(-salesNotShipped)}`, kind: "plus",
        },
        { label: "Hoàn · huỷ", hint: "tiền COD không bao giờ về", value: formatMoney(sumC((c) => c.hoan_huy)), kind: "minus" },
        {
            label: "Đang đi — phần ước sẽ hoàn",
            hint: `${formatMoney(totalInTransit)} còn trên đường × (1 − tỉ lệ giao)`,
            value: formatMoney(sumC((c) => c.uoc_hoan)), kind: "minus",
        },
        { label: "Doanh thu dự kiến", hint: `đã chắc ${formatMoney(t.doanh_thu_chac)} — kiện giao xong`, value: formatMoney(expected.doanh_thu), kind: "total" },
        {
            label: "Giá vốn", hint: missingCogs ? `${formatNumber(missingCogs)} kiện thiếu giá vốn — đang tính 0` : "hàng đã bán + hàng hoàn không quay lại kho",
            value: formatMoney(expected.gia_von), kind: "minus", missing: false,
        },
        {
            label: "Chi phí 3PL",
            hint: `vận chuyển + thao tác ${formatVNDCompact(expected.phi.di)} · thu hộ ${formatVNDCompact(expected.phi.giao)} · hàng hoàn ${formatVNDCompact(expected.phi.hoan)} · tỷ giá ${formatVNDCompact(expected.phi.ty_gia)}`,
            value: formatMoney(fees3pl), kind: "minus",
        },
        { label: "Lãi gộp", hint: `biên ${pct(grossProfit, expected.doanh_thu)} doanh thu`, value: signed(grossProfit), kind: "total" },
        { label: "Tiền ads", hint: "chi phí khai thác · file TỔNG TEAM", value: formatMoney(t.ads), kind: "minus" },
        {
            label: "Chi phí vận hành", hint: t.van_hanh ? "chi phí khai thác · lương, mặt bằng, phần mềm…" : "chưa nhập khoản nào",
            value: t.van_hanh ? formatMoney(t.van_hanh) : DASH, kind: "minus", missing: !t.van_hanh,
        },
        { label: "Lợi nhuận sau cùng (dự kiến)", value: signed(netProfit), kind: "total" },
    ];

    return (
        <div className={cn("space-y-6", loading && "opacity-60 transition-opacity")}>
            <ReportHero
                emoji="📒"
                title={`Lãi lỗ${scope ? ` team ${scope}` : ""} — ${period}`}
                subtitle={
                    <>
                        Doanh số và tiền ads lấy từ file <strong>TỔNG TEAM</strong> (khớp tab Tổng quan). Doanh thu, giá vốn, phí 3PL
                        tính trên <strong>từng kiện thật</strong> đã lên 3PL — kiện giao xong là tiền chắc, kiện đang đi nhân tỉ lệ giao
                        thật của nước đó. Phí 3PL lấy từ sao kê, kiện chưa vào sao kê ước theo bảng giá và cơ chế của từng 3PL.
                        Kỳ tính theo ngày lên đơn{data.as_of < data.to ? <> · trạng thái tới <strong>{formatDmy(data.as_of)}</strong></> : null}.
                    </>
                }
            />

            {(data.missing_months.length > 0 || failedMarkets.length > 0) && (
                <div className="space-y-1 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                    {data.missing_months.length > 0 && <p>Thiếu số tháng {data.missing_months.join(", ")} — chưa có file TỔNG TEAM của tháng đó, doanh số và ads tháng đó đang là 0.</p>}
                    {failedMarkets.map((n) => (
                        <p key={n.code}><strong>{n.ten}</strong>: không đọc được kiện ({n.loi}) — doanh thu, giá vốn, phí 3PL của nước này CHƯA nằm trong tổng, nên lợi nhuận tổng đang thiếu nước này.</p>
                    ))}
                </div>
            )}

            <KpiRow>
                <KpiTile emoji="💵" label="Doanh số" value={formatVNDCompact(t.doanh_so)} sub={`${formatNumber(t.don)} đơn đã chốt`}
                    tooltip="Cột Doanh Số file TỔNG TEAM: mọi đơn đã chốt trên POS, trừ huỷ, nháp, đơn trống — chưa biết giao được hay không." />
                <KpiTile emoji="📥" label="Doanh thu dự kiến" value={formatVNDCompact(expected.doanh_thu)}
                    sub={`đã chắc ${formatVNDCompact(t.doanh_thu_chac)} · ${pct(expected.doanh_thu, t.doanh_so)} doanh số`}
                    tooltip="Tiền COD của kiện giao thành công, cộng kiện còn đang đi × tỉ lệ giao thật của nước đó. 'Đã chắc' = chỉ kiện giao xong." />
                <KpiTile emoji="📦" label="Giá vốn" value={formatVNDCompact(expected.gia_von)}
                    sub={missingCogs ? `${formatNumber(missingCogs)} kiện thiếu giá` : `${pct(expected.gia_von, expected.doanh_thu)} doanh thu`}
                    tone={missingCogs ? "warn" : "neutral"}
                    tooltip="Mã SP trên kiện × bảng giá vốn. Hàng hoàn ở Đài, Sing, Nhật tính mất (không gửi lại là bị huỷ); UAE hàng hoàn về kho D&T bán tiếp nên không mất." />
                <KpiTile emoji="🚚" label="Chi phí 3PL" value={formatVNDCompact(fees3pl)} sub={`${pct(fees3pl, expected.doanh_thu)} doanh thu`}
                    tooltip="Vận chuyển + thao tác (mất cả khi hoàn), thu hộ COD, phí hàng hoàn, chênh tỷ giá 3PL quy đổi. Phí thật từ sao kê; kiện chưa vào sao kê thì ước." />
                <KpiTile emoji="📣" label="Chi phí khai thác" value={formatVNDCompact(operatingCost)}
                    sub={`ads ${formatVNDCompact(t.ads)} · vận hành ${t.van_hanh ? formatVNDCompact(t.van_hanh) : "chưa nhập"}`}
                    tone={t.van_hanh ? "neutral" : "warn"}
                    tooltip="Tiền ads (file TỔNG TEAM) + chi phí vận hành nhập ở cuối tab (lương, mặt bằng, phần mềm…)." />
                <KpiTile emoji="🏁" label="Lợi nhuận sau cùng" value={formatVNDCompact(netProfit)}
                    sub={`tối thiểu ${formatVNDCompact(minNetProfit)} · biên ${pct(netProfit, expected.doanh_thu)}`}
                    tone={netProfit >= 0 ? "good" : "bad"}
                    tooltip="Dự kiến = theo tỉ lệ giao thật. Tối thiểu = coi mọi kiện đang đi đều hoàn — lãi thật nằm giữa hai số." />
            </KpiRow>

            <ResultCard
                emoji="🏁"
                title="Lợi nhuận sau cùng kỳ này"
                note={
                    <>
                        Đã trừ đủ: giá vốn, chi phí 3PL (cả kiện hoàn), tiền ads và chi phí vận hành đã nhập. Phần &ldquo;dự kiến&rdquo; dựa vào tỉ lệ
                        giao — kiện đang đi càng ít thì số càng chắc. <strong>Tối thiểu {signed(minNetProfit)}</strong> nếu từ giờ không kiện nào giao được thêm.
                    </>
                }
                value={signed(netProfit)}
                caption={`biên ${pct(netProfit, expected.doanh_thu)} doanh thu · ${pct(netProfit, t.doanh_so)} doanh số`}
                tone={netProfit >= 0 ? "good" : "bad"}
                segments={[
                    { color: "bg-sky-400", value: expected.gia_von, label: "Giá vốn" },
                    { color: "bg-amber-400", value: fees3pl, label: "Chi phí 3PL" },
                    { color: "bg-rose-400", value: t.ads, label: "Tiền ads" },
                    { color: "bg-violet-400", value: t.van_hanh, label: "Vận hành" },
                    { color: "bg-emerald-500", value: Math.max(0, netProfit), label: "Lợi nhuận" },
                ]}
                subStats={[
                    { label: "Lãi gộp", value: signed(grossProfit), hint: "doanh thu − giá vốn − chi phí 3PL" },
                    { label: "Lãi sau ads", value: signed(grossProfit - t.ads), hint: "chưa trừ vận hành" },
                    { label: "Lợi nhuận tối thiểu", value: signed(minNetProfit), hint: "nếu mọi kiện đang đi đều hoàn" },
                ]}
            >
                <WaterfallList rows={waterfallRows} />
            </ResultCard>

            <MarketTable data={data} />
            <ParcelTable data={data} />
            <FeeTable data={data} />

            {(openReturnMarkets.length > 0 || missingCogs > 0 || provisionalMarkets.length > 0) && (
                <section className="rounded-xl border border-amber-300 bg-amber-50/60 p-5 dark:border-amber-500/30 dark:bg-amber-500/5">
                    <h3 className="section-header mb-2">🧩 Việc làm số đúng hơn — và đỡ lỗ</h3>
                    <ul className="space-y-2 text-sm text-foreground">
                        {openReturnMarkets.map((n) => (
                            <li key={n.code}>
                                <strong>{n.ten}: {formatNumber(n.tk!.hoan_con_han.n)} kiện hoàn còn trong hạn lưu kho 3PL</strong> — giá vốn {formatMoney(n.tk!.hoan_con_han.gia_von)}đ
                                đang tính là mất. Gửi lại cho khách mới (chỉ tốn phí ship) trước khi 3PL tiêu huỷ thì gỡ lại được khoản này.
                            </li>
                        ))}
                        {missingCogs > 0 && (
                            <li><strong>{formatNumber(missingCogs)} kiện thiếu giá vốn</strong> ({okMarkets.filter((n) => n.tk?.thieu_gia_von).map((n) => `${n.ten} ${formatNumber(n.tk!.thieu_gia_von)}/${formatNumber(n.tk!.kien.tong.n - n.tk!.kien.huy.n)}`).join(" · ")})
                                {" "}— phần thiếu đang tính 0 nên <strong>lãi đang cao hơn thật</strong>. Mã 3 số chưa có giá tệ thì khai ở <code className="rounded bg-muted px-1">talpha_rules.json → products</code>;
                                UAE tra theo mã vạch / tên hàng trên POS (<code className="rounded bg-muted px-1">markets.UAE.product_costs_vnd</code>). Danh sách tên/mã thiếu ở tab P&L (mục Báo cáo).</li>
                        )}
                        {provisionalMarkets.map((n) => (
                            <li key={n.code}><strong>Tỉ lệ giao {n.ten} còn tạm</strong> — {n.ty_le?.r == null ? "chưa có kiện nào giao xong hay hoàn để đo" : `mới đo trên ${formatNumber((n.ty_le?.giao || 0) + (n.ty_le?.hoan || 0))} kiện (cần ${data.cfg.ty_le.mau_toi_thieu} kiện lên đơn từ ${data.cfg.ty_le.bo_gan_ngay} ngày trước)`}; doanh thu dự kiến nước này còn trôi.</li>
                        ))}
                    </ul>
                </section>
            )}

            <OpexSection data={data} taiLai={reload} />

            <FootNotes
                warning={
                    <>
                        <strong>Hai mức lãi.</strong> &ldquo;Dự kiến&rdquo; nhân kiện còn đang đi với tỉ lệ giao thật của nước đó (đo trên kiện lên đơn
                        {" "}{data.cfg.ty_le.cua_so_ngay} → {data.cfg.ty_le.bo_gan_ngay} ngày trước — bỏ kiện mới vì kiện giao xong trước, kiện hoàn về sau).
                        &ldquo;Tối thiểu&rdquo; coi mọi kiện đang đi đều hoàn. Tiền về tài khoản thật xem tab Tiền COD về.
                    </>
                }
                notes={[
                    <>Doanh số, số đơn, tiền ads: file TỔNG TEAM theo tab từng nước — cùng số tab Tổng quan và bot Zalo.</>,
                    <>Doanh thu: tiền COD trên kiện 3PL, quy theo tỷ giá niêm yết (như Doanh số). Phần 3PL quy đổi lệch tỷ giá nằm ở dòng &ldquo;tỷ giá&rdquo; của Chi phí 3PL.
                        {" "}{data.cfg.cho_len_3pl_ngay} ngày cuối kỳ, đơn đã chốt mà chưa lên 3PL được ước như kiện đang đi.</>,
                    <>Chi phí khai thác = tiền ads + chi phí vận hành. Khoản vận hành &ldquo;chung&rdquo; chia cho các nước theo phần doanh số của nước trên doanh số mọi nước.</>,
                    ...okMarkets.flatMap((n) => n.co_so.map((c, i) => <><strong>{n.ten}</strong>{i === 0 ? ` (${n.nguon})` : ""}: {c}</>)),
                ]}
            />
        </div>
    );
}
