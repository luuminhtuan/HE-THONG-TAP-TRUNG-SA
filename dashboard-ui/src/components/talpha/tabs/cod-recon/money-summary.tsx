"use client";

import { useState } from "react";
import { ChevronDown, Info } from "lucide-react";
import { formatNumber, cn } from "../../utils";
import { TWD, VND } from "../ledger-shared";
import type { MarketData, MarketLedger, Overview, ReceivedSummary } from "./types";
import { dmy } from "./format";
import { MoneyTile } from "./ui";

/**
 * Tiền về — con số Sỹ Anh xin 13/09/2026: NAZA đã gửi bao nhiêu, và còn phải gửi
 * bao nhiêu theo hai cách đếm đơn còn lại.
 *
 * 07/10/2026: ba thẻ to + banner "chưa đối chiếu ngân hàng" → bốn ô số một hàng; đoạn giải
 * thích cách tính cất sau nút "Cách tính" (vẫn đủ chữ). Cảnh báo lệch thì luôn hiện.
 */
export function MoneySummary({ t, tq: overview }: { t: ReceivedSummary; tq: Overview | null }) {
    const [showMethod, setShowMethod] = useState(false);
    const rateText = t.ty_gia.twd_rmb != null && t.ty_gia.rmb_vnd != null
        ? `tỷ giá kỳ ${t.ty_gia.ngay_sao_ke ? t.ty_gia.ngay_sao_ke.slice(8, 10) + "/" + t.ty_gia.ngay_sao_ke.slice(5, 7) : "mới nhất"}: ${t.ty_gia.twd_rmb} × ${t.ty_gia.rmb_vnd.toLocaleString("vi-VN")}`
        : "chưa có tỷ giá";
    const fileGap = t.phai_nhan_theo_file_vnd - t.da_gui_ve_vnd;
    const totalOrders = t.con_lai_da_giao.so_don + t.con_lai_chua_giao.so_don;
    const totalCod = t.con_lai_da_giao.cod_twd + t.con_lai_chua_giao.cod_twd;
    const remainingDelivered = t.con_lai_da_giao, remainingUndelivered = t.con_lai_chua_giao;
    return (
        <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                <MoneyTile mau="xanh" nhan="NAZA đã gửi về" so={VND(t.da_gui_ve_vnd)}
                    phu={`${formatNumber(t.so_ky)} kỳ sao kê`} />
                <MoneyTile mau="vang" uoc nhan="Còn phải gửi · đơn đã giao"
                    so={remainingDelivered.vnd_uoc != null ? VND(remainingDelivered.vnd_uoc) : "—"}
                    phu={`${formatNumber(remainingDelivered.so_don)} đơn · ${TWD(remainingDelivered.cod_twd)}`} />
                <MoneyTile mau="cam" uoc nhan="Chưa giao xong"
                    so={remainingUndelivered.vnd_uoc != null ? VND(remainingUndelivered.vnd_uoc) : "—"}
                    phu={`${formatNumber(remainingUndelivered.so_don)} đơn · ${TWD(remainingUndelivered.cod_twd)}`} />
                {overview && (overview.ky_lech > 0
                    ? <MoneyTile mau="do" nhan="Tiền về lệch ngân hàng" so={VND(overview.tien_lech_vnd)} phu={`${overview.ky_lech} kỳ không khớp`} />
                    : overview.ky_cho_nhap > 0
                        ? <MoneyTile mau="xanhduong" nhan="Chưa đối chiếu ngân hàng" so={VND(overview.tien_cho_nhap_vnd)}
                            phu={`${overview.ky_cho_nhap} kỳ chưa nhập tiền về`} />
                        : <MoneyTile mau="xanh" nhan="Đối chiếu ngân hàng" so={`${overview.ky_khop} kỳ khớp`} phu="không kỳ nào lệch" />)}
            </div>
            {Math.abs(fileGap) >= 1 && (
                <p className="text-[12.5px] font-semibold text-rose-600 dark:text-rose-400">
                    Theo file tiền hàng, NAZA lẽ ra gửi {VND(t.phai_nhan_theo_file_vnd)} — {fileGap > 0 ? "trừ dư" : "trừ thiếu"} {VND(Math.abs(fileGap))}.
                </p>
            )}
            {t.tien_hang.loi && <p className="text-[12.5px] font-semibold text-rose-600 dark:text-rose-400">{t.tien_hang.loi}</p>}
            <button onClick={() => setShowMethod(!showMethod)} aria-expanded={showMethod}
                className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground">
                <Info className="h-3.5 w-3.5" />Cách tính các số này
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showMethod && "rotate-180")} />
            </button>
            {showMethod && (
                <div className="space-y-1.5 rounded-xl border border-border bg-muted/30 px-4 py-3 text-[12.5px] leading-relaxed text-muted-foreground">
                    <p><b className="font-semibold text-foreground">Đã gửi về</b> = cộng số phải trả NAZA ghi trên từng sao kê
                        ({t.ky_da_doi_chieu_bank === 0 ? "chưa kỳ nào đối chiếu ngân hàng" : `${t.ky_da_doi_chieu_bank} kỳ đã đối chiếu ngân hàng`}).</p>
                    <p><b className="font-semibold text-foreground">Hai ô giữa không trùng nhau</b> — cộng lại là {formatNumber(totalOrders)} đơn
                        ({TWD(totalCod)}) chưa thấy tiền trên sao kê nào: đơn đã giao là tiền NAZA đang giữ ({remainingDelivered.don_chua_tru_phi} đơn chưa bị trừ phí ship),
                        đơn chưa giao là tiền còn ở ngoài đường. Đơn đã giao qua từ 2 kỳ mà chưa được trả thì đòi ở khung
                        “Đòi tiền NAZA” của Sổ đơn hàng. Đã bỏ {t.khong_tinh.hoan} đơn hoàn + {t.khong_tinh.huy} đơn huỷ
                        {t.khong_tinh.tieu_huy ? ` + ${t.khong_tinh.tieu_huy} đơn tiêu huỷ` : ""} ({TWD(t.khong_tinh.cod_twd)}) vì không bao giờ trả tiền.</p>
                    <p>Số dự tính đi đúng luồng NAZA: COD × {rateText} − phí. Đơn đã bị NAZA trừ phí ship ở kỳ trước thì không trừ lại;
                        đơn chưa bị trừ thì trừ phí ship theo bảng giá kênh giao (kg đầu) + phí thao tác.
                        <b className="font-semibold text-foreground"> Chưa trừ tiền hàng các kỳ tới</b> — chưa biết trước được.</p>
                    {overview && <p><b className="font-semibold text-foreground">Ngân hàng:</b> kỳ chỉ coi là xong khi tiền thật về khớp số sao kê tính ra.
                        Lệch trong {VND(overview.bank_tolerance_vnd)} thì bỏ qua (quy đổi NT$ → ¥ → đ có làm tròn, ngân hàng còn thu phí chuyển).
                        Nhập số tiền về của từng kỳ ở bảng ② bên dưới.</p>}
                </div>
            )}
        </div>
    );
}

/** Σ tiền về nước ngoài Đài — bốn ô như TomTatTien của Đài; cách tính cất sau một nút. */
export function MarketMoneySummary({ so: ledger, t, m, tien: formatAmount, ben: partnerName }: {
    so: MarketLedger; t: MarketData["tong"]; m: MarketData["market"]; tien: (n: number) => string; ben: string;
}) {
    const [showMethod, setShowMethod] = useState(false);
    const received = ledger.tien_ve, overview = ledger.tong_quan;
    const remainingDelivered = received.con_lai_da_giao, remainingUndelivered = received.con_lai_chua_giao;
    const g = received.ty_gia;
    const pct = (n: number | null) => n == null ? "—" : `${(n * 100).toFixed(1).replace(".", ",")}%`;
    return (
        <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                <MoneyTile mau="xanh" uoc={received.co_uoc} nhan={`${partnerName === "NAZA" ? "NAZA" : "Bên giao hàng"} đã gửi về`}
                    so={received.so_ky ? VND(received.da_gui_ve_vnd) : "—"}
                    phu={received.so_ky ? `${formatNumber(received.so_ky)} kỳ sao kê${received.ky_am ? ` · không cộng ${received.ky_am} kỳ âm` : ""}` : "chưa có sao kê nào"} />
                <MoneyTile mau="vang" uoc nhan="Còn phải gửi · đơn đã giao"
                    so={remainingDelivered.vnd_uoc != null ? VND(remainingDelivered.vnd_uoc) : "—"} phu={`${formatNumber(remainingDelivered.so_don)} đơn · ${formatAmount(remainingDelivered.cod_local)}`} />
                <MoneyTile mau="cam" uoc nhan="Chưa giao xong"
                    so={remainingUndelivered.vnd_uoc != null ? VND(remainingUndelivered.vnd_uoc) : "—"} phu={`${formatNumber(remainingUndelivered.so_don)} đơn · ${formatAmount(remainingUndelivered.cod_local)}`} />
                {overview.ky_lech > 0
                    ? <MoneyTile mau="do" nhan="Tiền về lệch ngân hàng" so={VND(overview.tien_lech_vnd)} phu={`${overview.ky_lech} kỳ không khớp`} />
                    : overview.ky_cho_nhap > 0
                        ? <MoneyTile mau="xanhduong" nhan="Chưa đối chiếu ngân hàng" so={VND(overview.tien_cho_nhap_vnd)} phu={`${overview.ky_cho_nhap} kỳ chưa nhập tiền về`} />
                        : <MoneyTile mau="xanh" nhan="Đối chiếu ngân hàng" so={overview.ky_khop ? `${overview.ky_khop} kỳ khớp` : "—"}
                            phu={overview.ky_khop ? "không kỳ nào lệch" : "chưa có kỳ nào có tiền về"} />}
            </div>
            <button onClick={() => setShowMethod(!showMethod)} aria-expanded={showMethod}
                className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground">
                <Info className="h-3.5 w-3.5" />Cách tính các số này
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showMethod && "rotate-180")} />
            </button>
            {showMethod && (
                <div className="space-y-1.5 rounded-xl border border-border bg-muted/30 px-4 py-3 text-[12.5px] leading-relaxed text-muted-foreground">
                    <p><b className="font-semibold text-foreground">Đã gửi về</b> = cộng số phải nhận {partnerName} ghi trên từng sao kê
                        ({received.ky_da_doi_chieu_bank === 0 ? "chưa kỳ nào đối chiếu ngân hàng" : `${received.ky_da_doi_chieu_bank} kỳ đã đối chiếu ngân hàng`}).
                        {received.ky_am ? ` Không cộng ${received.ky_am} kỳ âm (âm ${VND(-received.am_vnd)} — kỳ chỉ có phí + tiền hàng): NAZA trừ khoản đó vào tiền chuyển ở chỗ khác, xem cột Phải nhận ở bảng ②.` : ""}
                        {received.co_uoc ? ` Kỳ nào sao kê không ghi số phải nhận thì ước = tiền COD × ${m.rate_vnd.toLocaleString("vi-VN")}đ/${m.currency}, chưa trừ phí.` : ""}</p>
                    <p><b className="font-semibold text-foreground">Hai ô giữa không trùng nhau</b> — là đơn CHƯA thấy trên kỳ sao kê nào:
                        đơn đã giao là tiền {partnerName} đang giữ, đơn chưa giao là tiền còn ở ngoài đường.
                        Đã bỏ {t.khong_tinh.hoan} đơn hoàn + {t.khong_tinh.huy} đơn huỷ{t.khong_tinh.tieu_huy ? ` + ${t.khong_tinh.tieu_huy} đơn tiêu huỷ` : ""} ({formatAmount(t.khong_tinh.cod_local)}) vì không bao giờ trả tiền.</p>
                    {received.cach_uoc === "naza" ? (
                        <p>Số dự tính đi đúng luồng NAZA kỳ {g.ngay ? dmy(g.ngay).slice(0, 5) : "gần nhất"}: COD × {g.rmb} → tệ, trừ phí thu hộ {pct(g.thu_ho_pct)},
                            trừ phí giao hàng cho đơn chưa bị NAZA trừ phí ở kỳ nào ({remainingDelivered.don_chua_tru_phi + remainingUndelivered.don_chua_tru_phi} đơn — lấy mức trung bình NAZA đã tính),
                            rồi × {g.vnd?.toLocaleString("vi-VN")}. <b className="font-semibold text-foreground">Chưa trừ tiền hàng các kỳ tới</b> — chưa biết trước được.</p>
                    ) : (
                        <p>Chưa có kỳ sao kê NAZA nào có tỷ giá, nên số dự tính = tiền COD × tỷ giá khai {m.rate_vnd.toLocaleString("vi-VN")}đ/{m.currency},
                            <b className="font-semibold text-foreground"> chưa trừ phí ship và phí thu hộ</b>.</p>
                    )}
                    <p><b className="font-semibold text-foreground">Ngân hàng:</b> kỳ chỉ coi là xong khi tiền thật về khớp số sao kê tính ra.
                        Lệch trong {VND(overview.bank_tolerance_vnd)} thì bỏ qua (quy đổi {m.currency} → ¥ → đ có làm tròn, ngân hàng còn thu phí chuyển).
                        Nhập số tiền về của từng kỳ ở bảng ② bên dưới.</p>
                </div>
            )}
        </div>
    );
}
