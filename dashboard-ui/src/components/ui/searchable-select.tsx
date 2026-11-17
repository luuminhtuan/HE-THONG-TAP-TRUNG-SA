"use client";

// Ô chọn GÕ ĐỂ TÌM (17/11/2026, tab Tin nhắn — page, tag, người phụ trách): gõ không dấu vẫn ra ("thuong" → Thương),
// ↑ ↓ Enter để chọn, Esc / bấm ra ngoài để đóng. `multiple`: bấm một mục là bật / tắt mục đó (gắn tag), danh sách không
// đóng. `onCreate`: gõ tên chưa có thì hiện "Tạo …" (tạo tag mới). Không thư viện ngoài.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export type SelectOption = { value: string; label: string; hint?: string };

/** Bỏ dấu + hoa thường để so: "Thương" ~ "thuong", "Đài" ~ "dai". */
export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

type Props = {
    options: SelectOption[];
    value?: string;
    values?: string[];
    multiple?: boolean;
    onChange: (value: string) => void;
    /** Chữ trên nút khi chưa chọn gì (chọn nhiều: luôn hiện chữ này). */
    placeholder: string;
    ariaLabel: string;
    searchPlaceholder?: string;
    onCreate?: (text: string) => void;
    renderOption?: (o: SelectOption) => ReactNode;
    className?: string;
    buttonClassName?: string;
    align?: "left" | "right";
    disabled?: boolean;
};

export default function SearchableSelect({
    options, value, values = [], multiple = false, onChange, placeholder, ariaLabel, searchPlaceholder = "Gõ để tìm…",
    onCreate, renderOption, className, buttonClassName, align = "left", disabled = false,
}: Props) {
    const [open, setOpen] = useState(false);
    const [text, setText] = useState("");
    const [cursor, setCursor] = useState(0);
    const box = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, [open]);

    const shown = useMemo(() => {
        const f = fold(text.trim());
        return f ? options.filter((o) => fold(`${o.label} ${o.hint || ""}`).includes(f)) : options;
    }, [options, text]);
    const canCreate = !!onCreate && !!text.trim() && !options.some((o) => fold(o.label) === fold(text.trim()));
    const selected = options.find((o) => o.value === value);
    const isOn = (o: SelectOption) => (multiple ? values.includes(o.value) : o.value === value);

    const pick = (o: SelectOption) => {
        onChange(o.value);
        if (!multiple) { setOpen(false); setText(""); }
    };
    const create = () => { onCreate?.(text.trim()); setText(""); };

    const onKey = (e: React.KeyboardEvent) => {
        const total = shown.length + (canCreate ? 1 : 0);
        if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, total - 1)); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
        else if (e.key === "Enter") {
            e.preventDefault();
            if (cursor < shown.length && shown[cursor]) pick(shown[cursor]);
            else if (canCreate) create();
        } else if (e.key === "Escape") setOpen(false);
    };

    return (
        <div ref={box} className={cn("relative", className)}>
            <button type="button" disabled={disabled} aria-label={ariaLabel} aria-expanded={open}
                onClick={() => { setOpen((o) => !o); setCursor(0); }}
                className={cn("inline-flex w-full items-center justify-between gap-1 rounded-lg border border-border bg-background px-2 py-1.5 text-left text-sm text-foreground disabled:opacity-50",
                    buttonClassName)}>
                <span className="truncate">{!multiple && selected ? selected.label : placeholder}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>
            {open && (
                <div className={cn("absolute z-30 mt-1 w-64 max-w-[85vw] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg",
                    align === "right" ? "right-0" : "left-0")}>
                    <label className="relative mb-1 block">
                        <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
                        <input autoFocus value={text} onChange={(e) => { setText(e.target.value); setCursor(0); }} onKeyDown={onKey}
                            placeholder={searchPlaceholder} aria-label={`Tìm — ${ariaLabel}`}
                            className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-sm outline-none focus:ring-1 focus:ring-primary" />
                    </label>
                    <div role="listbox" className="max-h-64 overflow-y-auto">
                        {shown.map((o, i) => (
                            <button key={o.value} type="button" role="option" aria-selected={isOn(o)} onMouseEnter={() => setCursor(i)} onClick={() => pick(o)}
                                className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm", i === cursor && "bg-muted")}>
                                <Check className={cn("h-3.5 w-3.5 shrink-0", isOn(o) ? "opacity-100" : "opacity-0")} />
                                <span className="min-w-0 flex-1 truncate">{renderOption ? renderOption(o) : o.label}</span>
                                {o.hint && <span className="shrink-0 text-[11px] text-muted-foreground">{o.hint}</span>}
                            </button>
                        ))}
                        {canCreate && (
                            <button type="button" onMouseEnter={() => setCursor(shown.length)} onClick={create}
                                className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-primary", cursor === shown.length && "bg-muted")}>
                                <Plus className="h-3.5 w-3.5" />Tạo “{text.trim()}”
                            </button>
                        )}
                        {!shown.length && !canCreate && <div className="px-2 py-2 text-xs text-muted-foreground">Không có mục nào khớp.</div>}
                    </div>
                </div>
            )}
        </div>
    );
}
