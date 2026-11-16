"use client";

import { useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";

// Nút con mắt xem khoá đang dùng (15/11/2026) — dùng ở Khoá kết nối và Thị trường. Khoá thật chỉ lấy
// khi người bấm (POST /api/talpha/credentials/reveal, ghi log), giữ trong bộ nhớ trang, tải lại trang là mất.

/** Khoá đang dùng của một tên biến (TALPHA_POSCAKE_TH_KEY…). Rỗng = chưa có khoá. */
export async function revealCredential(keyName: string): Promise<string> {
    const r = await fetch("/api/talpha/credentials/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ten: keyName }),
        cache: "no-store",
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return String(j.gia_tri || "");
}

/** Bản che (••••b699) + con mắt: bấm là hiện khoá thật, bấm lại là che. */
export function MaskedCredential({ ten: keyName, che: masked, className }: { ten: string; che: string; className?: string }) {
    const [revealed, setRevealed] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const toggle = async () => {
        if (revealed !== null) { setRevealed(null); return; }
        setLoading(true);
        setError("");
        try { setRevealed(await revealCredential(keyName)); }
        catch (e) { setError(e instanceof Error ? e.message : "Không xem được khoá"); }
        finally { setLoading(false); }
    };

    return (
        <span className={className}>
            <span className="inline-flex max-w-full items-center gap-1">
                <span className="break-all font-mono text-slate-300">{revealed ?? masked}</span>
                <button type="button" onClick={toggle} disabled={loading}
                    aria-label={revealed !== null ? "Che khoá" : "Xem khoá"} title={revealed !== null ? "Che khoá" : "Xem khoá"}
                    className="shrink-0 rounded p-0.5 text-slate-400 hover:text-foreground disabled:opacity-50">
                    {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : revealed !== null ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
            </span>
            {error && <span className="block text-rose-400">{error}</span>}
        </span>
    );
}
