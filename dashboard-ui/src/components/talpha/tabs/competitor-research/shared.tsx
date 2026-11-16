// Phần dùng chung của tab Khách hàng → Soi đối thủ: định dạng số, lớp CSS, nhãn tỉ lệ hoàn, ảnh nhỏ.
import { cn } from "@/lib/utils";
import { returnLevel, type CompetitorProduct, type ProductGroup } from "@/lib/talpha/competitor-research";

export type Filter = ProductGroup | "all";

export const MARKET_NAMES: Record<string, string> = { TW: "Đài Loan", SG: "Singapore", AE: "UAE", JP: "Nhật Bản", VN: "Việt Nam" };
export const fmtNum = (n: number) => new Intl.NumberFormat("vi-VN").format(Math.round(n));
export const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits).replace(".", ",")}%`;
export const vnDate = (s: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? `${m[3]}/${m[2]}/${m[1]}` : s; };

export const CARD = "rounded-xl border border-border bg-card p-4 shadow-sm";
export const TITLE = "text-sm font-semibold text-foreground";
export const LINK_CLS = "text-blue-600 underline-offset-2 hover:underline dark:text-blue-400";
// "Đặt thêm hàng" dùng xanh dương cố định để không trùng màu xanh lá của nhãn hoàn thấp.
export const ON_ORDER_CLS = "bg-[#2a78d6]/10 text-[#1f5fb0] dark:bg-[#3987e5]/15 dark:text-[#8fbcf2]";

// Màu theo mức hoàn: dưới 8% tốt · 8–15% vừa · trên 15% xấu · hàng mới chưa xếp.
export const RETURN_TEXT = {
    good: "text-emerald-600 dark:text-emerald-400",
    fair: "text-amber-600 dark:text-amber-400",
    bad: "text-rose-600 dark:text-rose-400",
    new: "text-muted-foreground",
} as const;
export const RETURN_BG = {
    good: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
    fair: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
    bad: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
    new: "bg-muted text-muted-foreground",
} as const;

export function returnLabel(p: CompetitorProduct): string {
    return returnLevel(p) === "new" ? "mới" : pct(p.return_rate ?? 0);
}

/** Thẻ sản phẩm trong thư viện mang id này — bấm tên ở bảng trên thì cuộn tới thẻ. */
export const productCardId = (id: string) => `competitor-product-${id}`;

export function scrollToProduct(id: string) {
    document.getElementById(productCardId(id))?.scrollIntoView({ behavior: "smooth", block: "center" });
}

export function SamplePhraseView({ text, meaning }: { text: string; meaning: string }) {
    return (
        <div className="space-y-0.5">
            <p className="rounded-md border border-border bg-muted/40 px-2 py-1 font-mono text-xs text-foreground">{text}</p>
            <p className="text-xs text-muted-foreground">{meaning}</p>
        </div>
    );
}

export function ProductThumb({ p }: { p: CompetitorProduct }) {
    return p.image
        // eslint-disable-next-line @next/next/no-img-element -- ảnh tĩnh trong public/, không qua next/image
        ? <img src={p.image} alt="" loading="lazy" className="h-9 w-9 shrink-0 rounded-md border border-border bg-white object-contain" />
        : <span className={cn("h-9 w-9 shrink-0 rounded-md border border-dashed border-border bg-muted")} aria-hidden />;
}
