"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

/* ═══════════════════════════════════════════════════════════════════
   BẢNG ĐƠN ĐỐI TÁC NẠP LÚC NÀO

   Sổ đơn và toàn bộ màn Đối soát COD đọc từ kho `tracking` — kho đó CHỈ đổi khi
   việc nền 6h sáng chạy, hoặc khi có người bấm "Đọc bảng đối tác". Không nói ra
   thì số của tuần trước trông y hệt số hôm nay: ngày 16/09/2026 Sỹ Anh mở màn
   Đối soát COD và hỏi vì sao nó đứng yên — số khi đó nạp từ 09/09, đã bảy ngày.
   ═══════════════════════════════════════════════════════════════════ */

export type PartnerSheetImport = {
    luc: string | null;
    nguon?: string | null;
    so_don?: number;
    /** Số mã vận đơn bị nhiều dòng Sheet dùng chung. */
    ma_trung?: number;
};

const HOUR_MS = 3_600_000;
/** Tuổi của lần nạp, tính bằng giờ — gom một chỗ để component không gọi đồng hồ ngay trong lúc vẽ. */
const ageHours = (at: string) => (Date.now() - Date.parse(at)) / HOUR_MS;

function formatVnTime(iso: string) {
    const d = new Date(iso);
    const p = (o: Intl.DateTimeFormatOptions) => d.toLocaleString("en-GB", { timeZone: "Asia/Ho_Chi_Minh", ...o });
    return `${p({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" })} ngày `
        + `${p({ day: "2-digit" })}/${p({ month: "2-digit" })}`;
}

function ageText(hours: number) {
    if (hours < 1) return "vừa nạp xong";
    if (hours < 24) return `${Math.floor(hours)} giờ trước`;
    return `${Math.floor(hours / 24)} ngày trước`;
}

/** Bảng đã cũ (chưa nạp lần nào, hoặc quá `gioCanhBao` giờ) — lúc đó PHẢI hiện khung đỏ to. */
export function isSheetStale(n?: PartnerSheetImport | null, warnAfterHours = 24): boolean {
    if (!n) return false;
    return !n.luc || ageHours(n.luc) > warnAfterHours;
}

/** Một dòng gọn cho thanh công cụ Sổ đơn khi bảng còn mới (07/10/2026): "Bảng đối tác nạp 06:00
 *  ngày 07/10 (2 giờ trước) · 778 đơn". */
export function shortImportLabel(n?: PartnerSheetImport | null): string | null {
    if (!n?.luc) return null;
    const hours = ageHours(n.luc);
    return `Bảng đối tác nạp ${formatVnTime(n.luc)} (${ageText(hours)})`
        + (typeof n.so_don === "number" && n.so_don > 0 ? ` · ${n.so_don.toLocaleString("vi-VN")} đơn` : "");
}

/** `anMaTrung`: không nhắc mã vận đơn trùng ở đây — Sổ đơn đã có khung "việc cần sửa" nói rồi. */
export default function PartnerSheetImporter({ n, gioCanhBao: warnAfterHours = 24, anMaTrung: hideDuplicateCodes }: { n?: PartnerSheetImport | null; gioCanhBao?: number; anMaTrung?: boolean }) {
    if (!n) return null;
    const hours = n.luc ? ageHours(n.luc) : Infinity;
    const stale = !n.luc || hours > warnAfterHours;

    return (
        <div className={cn(
            "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-4 py-2.5 text-[13px]",
            stale
                ? "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200"
                : "border-border bg-muted/40 text-muted-foreground",
        )}>
            {stale ? <AlertTriangle className="h-4 w-4 flex-none" /> : <RefreshCw className="h-4 w-4 flex-none" />}
            <span>
                Bảng đơn đối tác:{" "}
                {n.luc
                    ? <><b className="font-semibold">nạp lúc {formatVnTime(n.luc)}</b> ({ageText(hours)})</>
                    : <b className="font-semibold">chưa nạp lần nào</b>}
                {typeof n.so_don === "number" && n.so_don > 0 && <> · {n.so_don.toLocaleString("vi-VN")} đơn</>}
            </span>
            <span className={cn("flex-1", stale ? "" : "text-muted-foreground/80")}>
                {stale
                    ? "Số dưới đây là của lần nạp đó, KHÔNG phải hôm nay. Máy tự nạp 6h sáng mỗi ngày — muốn có ngay thì sang tab Theo dõi vận đơn bấm “Đọc bảng đối tác”."
                    : "Máy tự nạp lúc 6h sáng mỗi ngày; cần ngay thì bấm “Đọc bảng đối tác” ở tab Theo dõi vận đơn."}
            </span>
            {/* Lỗi nằm trong chính Sheet — chỉ người giữ Sheet sửa được, nên phải nói ở
                mọi màn đọc từ Sheet, kể cả màn Đối soát COD vốn không có danh sách cảnh báo. */}
            {!!n.ma_trung && !hideDuplicateCodes && (
                <span className="flex basis-full items-start gap-1.5 font-medium text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
                    {n.ma_trung} mã vận đơn bị nhiều dòng trong Sheet dùng chung — danh sách cần sửa ở tab Sổ đơn hàng.
                </span>
            )}
        </div>
    );
}
