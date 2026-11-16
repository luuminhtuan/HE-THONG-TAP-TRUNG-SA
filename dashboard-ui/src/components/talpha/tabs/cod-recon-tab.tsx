"use client";

import { useEffect, useState } from "react";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { useUrlParam } from "../url-state";
import { cn } from "../utils";
import type { CodReconTabProps } from "./cod-recon/types";
import { TwCodRecon } from "./cod-recon/tw-cod-recon";
import { MarketCodRecon } from "./cod-recon/market-cod-recon";

/* ═══════════════════════════════════════════════════════════════════
   TIỀN COD VỀ (mục Kế toán) — MỘT QUY TRÌNH, KHÔNG PHẢI MỘT ĐỐNG KẾT QUẢ KIỂM TRA

   07/10/2026 Sỹ Anh chốt tách mục KẾ TOÁN: tab này (tên cũ "Đối soát COD") + Thanh toán
   quảng cáo. Leader nước đó và giám đốc kiểm soát chung — leader xem, tải sao kê, nhập tiền
   về. Phần đòi NAZA tiền đơn quá hạn (khối ④ cũ) chuyển sang Sổ đơn hàng: đó là việc
   theo từng đơn, cần tên khách + số điện thoại ngay cạnh, và sale cũng phải làm được.

   Bản trước xếp tám mục soát cạnh nhau rồi để người dùng tự hiểu. Sỹ Anh chỉ
   ra bốn chỗ khó chịu, và cả bốn cùng một gốc: màn hình không mang hình dạng
   của công việc thật.

     "không biết số nào của kỳ nào"      → mỗi khối đóng dấu PHẠM VI
     "việc làm xong rồi vẫn hiện"        → mỗi việc có nút đóng, máy nhớ ngày
     "báo lỗi không biết làm gì tiếp"    → mỗi lỗi kèm đúng nút cần bấm
     "không biết tiền thật về đủ chưa"   → thêm hẳn khâu tiền-về-tài-khoản

   Nên bố cục nay chạy đúng thứ tự việc xảy ra ngoài đời:

     Σ  tiền về             — tổng cả vụ: NAZA đã gửi bao nhiêu, còn phải gửi bao nhiêu
     ①  việc hôm nay        — mở lên là biết phải làm gì
     ②  bảng các kỳ         — xương sống: kỳ nào đang ở đâu trong quy trình
     ③  kỳ đang mở          — tám mục soát, CHỈ của kỳ này
     ④  tỷ giá              — nó đã lấy của mình bao nhiêu tiền
     (đơn quá hạn phải đòi  — khung "Đòi tiền NAZA" ở Sổ đơn hàng)

   Thứ tự trong ③ (A trước B) không đảo được: file sai thì mọi so sánh về sau
   đều vô nghĩa. Và một kỳ chưa biết tiền về hay chưa thì chưa xong, dù tám
   mục xanh hết — đó là lý do ② đứng trước ③.
   ═══════════════════════════════════════════════════════════════════ */

/* Các mảnh của tab nằm ở ./cod-recon/: tw-cod-recon (màn Đài) · market-cod-recon (nước khác) ·
   money-summary (Σ tiền về) · tasks-section (①) · money-flow (luồng tiền ③) · checks-panel (máy soát) ·
   fx-section (④ tỷ giá) · ui (khối, nút, ô số dùng chung) · format (định dạng, soạn tin) · types. */

/**
 * Nút chọn nước (Sỹ Anh chốt 26/09/2026): Đài Loan giữ nguyên toàn bộ quy trình sao kê NAZA;
 * Singapore, UAE cùng bố cục Đài từ 08/10/2026 (CodNuocKhac): tải sao kê, việc hôm nay, các kỳ + ngân hàng,
 * luồng tiền + máy soát, tỷ giá. Danh sách nước
 * lấy từ /api/talpha/markets — không gõ cứng ở giao diện.
 *
 * Phân quyền theo team (05/10/2026): danh sách chỉ còn nước của team, nên chờ có danh sách rồi
 * mới dựng màn và mở ở nước đầu tiên được xem (xem cùng chỗ ở order-ledger-tab.tsx).
 */
export default function TALPHACodReconTab(props: CodReconTabProps) {
    const [marketParam, setMarketParam] = useUrlParam("market");
    const [ds, setDs] = useState<{ code: string; display: string }[] | null>(null);
    useEffect(() => {
        fetch("/api/talpha/markets").then((r) => r.json())
            .then((d: { markets?: { code: string; display: string; status?: string }[] }) => {
                // Nước đã tắt VẪN có ở đây (04/11/2026): tắt rồi đối tác còn chuyển tiền đơn cũ về vài tuần.
                const list = (d.markets || []).filter((m) => m.status !== "upcoming").map((m) => ({ code: m.code, display: m.display }));
                setDs(list);
            })
            .catch(() => setDs([]));   // không lấy được danh sách nước thì vẫn hiện màn Đài như cũ
    }, []);
    if (ds === null) return <TabSkeleton />;
    // Nước đang xem nằm trên địa chỉ (?market=SG, 15/11/2026) — tải lại / gửi link là mở đúng nước.
    // Mã lạ hoặc nước ngoài team → nước đầu tiên được xem.
    const market = marketParam && ds.some((m) => m.code === marketParam.toUpperCase()) ? marketParam.toUpperCase() : (ds[0]?.code ?? "TW");
    // Nút chọn nước nằm CÙNG hàng với thanh công cụ (07/10/2026, cùng kiểu Sổ đơn hàng).
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
        ? <TwCodRecon {...props} nutNuoc={marketSwitcher} />
        : <MarketCodRecon key={market} code={market} nutNuoc={marketSwitcher} dateRange={props.dateRange} />;
}
