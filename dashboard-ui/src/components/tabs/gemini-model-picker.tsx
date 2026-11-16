"use client";

// Chọn model Gemini cho ô "Hỏi dashboard" (15/11/2026) — nằm trong tab Gemini của Khoá kết nối.
// Danh sách lấy thẳng từ Google theo khoá đang dùng (/api/talpha/credentials/gemini-models), nên không bao giờ
// hiện model đã bị khai tử. "Tự chọn" = model "flash" mới nhất khoá đó gọi được.
import { useEffect, useState } from "react";
import { Bot, Check, Loader2 } from "lucide-react";
import type { ModelGemini } from "@/lib/talpha/gemini-models";

type ModelsResponse = {
    co_khoa: boolean;
    chon: { gemini_model?: string | null; updated_by?: string | null; updated_at?: string | null };
    tu_dong: string | null;
    models: ModelGemini[];
};

export default function GeminiModelPicker({ phienKhoa: keyVersion }: { phienKhoa: string }) {
    const [data, setData] = useState<ModelsResponse | null>(null);
    const [error, setError] = useState("");
    const [pendingModel, setPendingModel] = useState("");
    const [saving, setSaving] = useState(false);
    const [notice, setNotice] = useState("");

    // Tải lại mỗi khi khoá Gemini đổi (vừa nhập / thay / bỏ) — danh sách model đi theo khoá.
    useEffect(() => {
        let cancelled = false;
        setError("");
        fetch("/api/talpha/credentials/gemini-models", { cache: "no-store" })
            .then(async (r) => {
                const j = await r.json();
                if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
                return j as ModelsResponse;
            })
            .then((j) => { if (!cancelled) { setData(j); setPendingModel(j.chon.gemini_model || ""); } })
            .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
        return () => { cancelled = true; };
    }, [keyVersion]);

    const save = async () => {
        setSaving(true);
        setNotice("");
        setError("");
        try {
            const r = await fetch("/api/talpha/credentials/gemini-models", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ model: pendingModel || null }),
            });
            const j = await r.json();
            if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
            setData(j);
            setNotice("Đã lưu — ô “Hỏi dashboard” dùng model này từ câu hỏi kế tiếp.");
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setSaving(false);
        }
    };

    const activeModel = data?.chon.gemini_model || data?.tu_dong || null;
    const shownModel = data?.models.find((m) => m.id === (pendingModel || data?.tu_dong));

    return (
        <div className="space-y-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 lg:max-w-[calc(50%-0.375rem)]">
            <div>
                <p className="flex items-center gap-2 font-semibold text-foreground">
                    <Bot className="h-4 w-4 shrink-0 text-indigo-400" /> Model trả lời
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                    Ô “Hỏi dashboard” dùng model này. Model bị Google gỡ hoặc hết hạn mức thì máy tự thử model kế tiếp.
                </p>
            </div>

            {!data && !error && <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />}
            {data && !data.co_khoa && (
                <p className="text-xs text-amber-500">Nhập khoá Gemini ở trên trước — danh sách model lấy theo khoá.</p>
            )}
            {data?.co_khoa && (
                <>
                    <select
                        value={pendingModel}
                        onChange={(e) => { setPendingModel(e.target.value); setNotice(""); }}
                        className="w-full rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 py-2 font-mono text-sm text-foreground focus:border-indigo-500 focus:outline-none"
                    >
                        <option value="">Tự chọn{data.tu_dong ? ` (hiện là ${data.tu_dong})` : ""}</option>
                        {data.models.map((m) => (
                            <option key={m.id} value={m.id}>{m.id}{m.ten && m.ten !== m.id ? ` — ${m.ten}` : ""}</option>
                        ))}
                    </select>
                    {shownModel && (
                        <p className="text-xs text-slate-400">
                            {shownModel.mo_ta || shownModel.ten}
                            {shownModel.gioi_han_vao ? ` · nhận tối đa ${shownModel.gioi_han_vao.toLocaleString("vi-VN")} token` : ""}
                        </p>
                    )}
                    <div className="flex flex-wrap items-center gap-3">
                        <button
                            type="button"
                            onClick={save}
                            disabled={saving || pendingModel === (data.chon.gemini_model || "")}
                            className="flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-600 disabled:opacity-50"
                        >
                            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Lưu model
                        </button>
                        <span className="text-xs text-slate-500">
                            Đang dùng: <span className="font-mono text-slate-300">{activeModel || "—"}</span>
                            {data.chon.gemini_model ? "" : " (tự chọn)"}
                            {data.chon.updated_at && data.chon.gemini_model
                                ? ` · ${data.chon.updated_by || "?"} chọn lúc ${new Date(data.chon.updated_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" })}`
                                : ""}
                        </span>
                    </div>
                </>
            )}
            {notice && <p className="text-xs text-emerald-500">{notice}</p>}
            {error && <p className="text-xs text-rose-400">{error}</p>}
        </div>
    );
}
