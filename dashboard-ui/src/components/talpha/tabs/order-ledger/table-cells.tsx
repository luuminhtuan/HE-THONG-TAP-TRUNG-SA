import { cn } from "../../utils";
import { PIN_TINT, type Light } from "../ledger-shared";

/* Màu chữ theo LOẠI dữ liệu, không tô cho vui: mã định danh một tông, ngày một
   tông, tiền một tông — mắt phân vùng được ngay mà không phải đọc tiêu đề. */
export const C = {
    id: "font-mono text-[10.5px] text-indigo-700 dark:text-indigo-300",
    id2: "font-mono text-[10px] text-indigo-500/70 dark:text-indigo-400/60",
    dt: "font-mono text-[10.5px] tabular-nums text-teal-700 dark:text-teal-300",
    dt2: "font-mono text-[10.5px] tabular-nums text-teal-700/60 dark:text-teal-300/55",
    tel: "font-mono text-[10.5px] text-violet-600/85 dark:text-violet-300/80",
    fee: "tabular-nums text-amber-700/90 dark:text-amber-400/90",
    cogs: "tabular-nums text-purple-600/85 dark:text-purple-300/80",
    faint: "text-muted-foreground/50",
};

export function Tick({ on, title }: { on: boolean; title: string }) {
    return (
        <span title={title} role="img" aria-label={`${title} — ${on ? "đã xong" : "chưa"}`}
            className={cn("inline-flex h-[15px] w-[15px] items-center justify-center rounded-[3px] text-[9px] font-bold",
                on ? "bg-emerald-500 text-white" : "border border-dashed border-muted-foreground/40")}>
            {on ? "✓" : ""}
        </span>
    );
}

/** `stt` là cột số thứ tự ghim sát mép trái; `pinAfter` là cột mã đơn ghim ngay
 *  sau nó. Hai cột cùng ghim nên phải khai bề rộng cố định cho cột STT, nếu
 *  không cột thứ hai không biết dịch sang bao nhiêu. */
const STT_W = 34;

export function Th({ children, grp, num, pin, pinAfter, stt, title }: {
    children?: React.ReactNode; grp?: boolean; num?: boolean;
    pin?: boolean; pinAfter?: boolean; stt?: boolean; title?: string;
}) {
    return (
        <th title={title}
            style={stt ? { width: STT_W, minWidth: STT_W } : pinAfter ? { left: STT_W } : undefined}
            className={cn("sticky top-[23px] z-30 bg-muted/95 px-1.5 py-[5px] backdrop-blur",
                num || stt ? "text-right" : "text-left", grp && "border-l border-border",
                (pin || pinAfter) && "z-40 bg-muted", pin && "left-0")}>{children}</th>
    );
}

export function Td({ children, grp, num, pin, pinAfter, stt, light, className }: {
    children?: React.ReactNode; grp?: boolean; num?: boolean;
    pin?: boolean; pinAfter?: boolean; stt?: boolean; light?: Light; className?: string;
}) {
    const pinned = pin || pinAfter || stt;
    return (
        <td style={stt ? { width: STT_W, minWidth: STT_W } : pinAfter ? { left: STT_W } : undefined}
            className={cn("border-b border-border px-1.5 py-[3px]",
                num && "text-right tabular-nums", grp && "border-l border-border",
                pinned && cn("sticky z-20 bg-card", light && PIN_TINT[light]),
                stt && "left-0",
                pinAfter && "border-r border-border",
                className)}>{children}</td>
    );
}
