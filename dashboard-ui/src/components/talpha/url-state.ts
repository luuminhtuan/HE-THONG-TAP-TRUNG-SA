"use client";

// ═══════════════════════════════════════════════════════════════════
// Địa chỉ trang = đúng cái đang xem (15/11/2026): mỗi tab một đường dẫn (/talpha/order-ledger),
// khoảng ngày và nước đang chọn nằm ở tham số (?from=2026-11-01&to=2026-11-15&market=SG). Tải lại
// trang hay gửi link cho người khác là mở đúng chỗ đó.
// ═══════════════════════════════════════════════════════════════════
import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/** Đổi vài tham số trên địa chỉ trang (null = bỏ), giữ nguyên đường dẫn và các tham số khác.
 *  replace (không thêm bước lịch sử): đổi nước / đổi ngày không làm nút Back phải bấm nhiều lần. */
export function useDoiThamSo(): (doi: Record<string, string | null>) => void {
    const router = useRouter();
    return useCallback((doi) => {
        const q = new URLSearchParams(window.location.search);
        for (const [k, v] of Object.entries(doi)) {
            if (v) q.set(k, v);
            else q.delete(k);
        }
        const s = q.toString();
        router.replace(`${window.location.pathname}${s ? `?${s}` : ""}`, { scroll: false });
    }, [router]);
}

/** Một tham số trên địa chỉ trang (vd "market"): [giá trị hiện tại, hàm đặt]. */
export function useThamSoUrl(ten: string): [string | null, (giaTri: string | null) => void] {
    const sp = useSearchParams();
    const doi = useDoiThamSo();
    const dat = useCallback((v: string | null) => doi({ [ten]: v }), [doi, ten]);
    return [sp.get(ten), dat];
}
