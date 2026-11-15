"use client";

import { useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";

// Nút con mắt xem khoá đang dùng (15/11/2026) — dùng ở Khoá kết nối và Thị trường. Khoá thật chỉ lấy
// khi người bấm (POST /api/talpha/khoa/reveal, ghi log), giữ trong bộ nhớ trang, tải lại trang là mất.

/** Khoá đang dùng của một tên biến (TALPHA_POSCAKE_TH_KEY…). Rỗng = chưa có khoá. */
export async function layKhoa(ten: string): Promise<string> {
    const r = await fetch("/api/talpha/khoa/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ten }),
        cache: "no-store",
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return String(j.gia_tri || "");
}

/** Bản che (••••b699) + con mắt: bấm là hiện khoá thật, bấm lại là che. */
export function KhoaCoMat({ ten, che, className }: { ten: string; che: string; className?: string }) {
    const [that, setThat] = useState<string | null>(null);
    const [dang, setDang] = useState(false);
    const [loi, setLoi] = useState("");

    const bam = async () => {
        if (that !== null) { setThat(null); return; }
        setDang(true);
        setLoi("");
        try { setThat(await layKhoa(ten)); }
        catch (e) { setLoi(e instanceof Error ? e.message : "Không xem được khoá"); }
        finally { setDang(false); }
    };

    return (
        <span className={className}>
            <span className="inline-flex max-w-full items-center gap-1">
                <span className="break-all font-mono text-slate-300">{that ?? che}</span>
                <button type="button" onClick={bam} disabled={dang}
                    aria-label={that !== null ? "Che khoá" : "Xem khoá"} title={that !== null ? "Che khoá" : "Xem khoá"}
                    className="shrink-0 rounded p-0.5 text-slate-400 hover:text-foreground disabled:opacity-50">
                    {dang ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : that !== null ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
            </span>
            {loi && <span className="block text-rose-400">{loi}</span>}
        </span>
    );
}
