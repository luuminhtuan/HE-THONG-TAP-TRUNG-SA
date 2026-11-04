"use client";

import { useState, useEffect, useCallback } from "react";
import { KeyRound, Loader2, AlertCircle, CheckCircle2, XCircle, RefreshCw, Eye, EyeOff, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

// Khoá kết nối (04/11/2026) — giám đốc dán khoá mới khi token Meta, Pancake, key POS chết.
// Máy chủ gọi thử khoá với dịch vụ thật rồi mới lưu; khoá thật không bao giờ về trình duyệt.
// Lưu ở đâu, có hiệu lực lúc nào: lib/talpha/khoa.ts.

type Kiem = { ok: boolean; chi_tiet: string; canh_bao?: string; het_han?: string | null };
type Khoa = {
    ten: string;
    nhan: string;
    dung_cho: string;
    loai: string;
    shop_id: string | null;
    nguon: "trang" | "env" | "thieu";
    che: string;
    do_dai: number;
    cap_nhat: string | null;
    env_khac: boolean;
    kiem?: Kiem;
};

const NGUON: Record<Khoa["nguon"], string> = {
    trang: "nhập trên trang",
    env: "từ .env.local",
    thieu: "chưa có",
};

function hanDung(iso: string): { chu: string; gap: boolean } {
    const ngay = Math.floor((Date.parse(iso) - Date.now()) / 86_400_000);
    const d = new Date(iso).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
    return { chu: ngay < 0 ? `hết hạn ${d}` : `hết hạn ${d} · còn ${ngay} ngày`, gap: ngay <= 14 };
}

export default function KhoaTab() {
    const [ds, setDs] = useState<Khoa[]>([]);
    const [kiem, setKiem] = useState<Record<string, Kiem>>({});
    const [loading, setLoading] = useState(true);
    const [dangKiem, setDangKiem] = useState(false);
    const [error, setError] = useState("");

    const [dangSua, setDangSua] = useState<string | null>(null);
    const [giaTri, setGiaTri] = useState("");
    const [hien, setHien] = useState(false);
    const [dangLuu, setDangLuu] = useState(false);
    const [loiLuu, setLoiLuu] = useState("");

    const tai = useCallback(async (goiThu = false) => {
        if (goiThu) setDangKiem(true);
        try {
            const r = await fetch(`/api/talpha/khoa${goiThu ? "?kiem=1" : ""}`, { cache: "no-store" });
            const j = await r.json();
            if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
            setDs(j.khoa);
            if (goiThu) setKiem(Object.fromEntries(j.khoa.map((k: Khoa) => [k.ten, k.kiem])));
            setError("");
        } catch (e) {
            setError(e instanceof Error ? e.message : "Không tải được danh sách khoá");
        } finally {
            setLoading(false);
            setDangKiem(false);
        }
    }, []);

    useEffect(() => { tai(); }, [tai]);

    const moSua = (ten: string) => {
        setDangSua(ten);
        setGiaTri("");
        setHien(false);
        setLoiLuu("");
    };

    const luu = async (ten: string) => {
        setDangLuu(true);
        setLoiLuu("");
        try {
            const r = await fetch("/api/talpha/khoa", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ten, gia_tri: giaTri }),
            });
            const j = await r.json();
            if (!r.ok) {
                setLoiLuu(j.error || `HTTP ${r.status}`);
                return;
            }
            setDs(j.khoa);
            setKiem((k) => ({ ...k, [ten]: j.kiem }));
            setDangSua(null);
            setGiaTri("");
        } catch {
            setLoiLuu("Không gửi được — kiểm mạng rồi thử lại");
        } finally {
            setDangLuu(false);
        }
    };

    const boTrenTrang = async (k: Khoa) => {
        if (!confirm(`Bỏ ${k.nhan} nhập trên trang? Dashboard sẽ quay về khoá trong .env.local, nếu có.`)) return;
        const r = await fetch(`/api/talpha/khoa?ten=${encodeURIComponent(k.ten)}`, { method: "DELETE" });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
            setError(j.error || `HTTP ${r.status}`);
            return;
        }
        setDs(j.khoa);
        setKiem((cu) => {
            const con = { ...cu };
            delete con[k.ten];
            return con;
        });
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="max-w-2xl">
                    <h2 className="text-lg font-bold text-foreground">Khoá kết nối</h2>
                    <p className="text-sm text-slate-400">
                        Khoá chết thì dán khoá mới vào đây. Máy gọi thử khoá với Meta, POS, Pancake, 17TRACK
                        trước, gọi được mới lưu. Dashboard dùng khoá mới ngay; sync và Sheet dùng từ vòng chạy
                        đầu giờ kế tiếp. Deploy không đè khoá nhập ở đây.
                    </p>
                </div>
                <button
                    onClick={() => tai(true)}
                    disabled={dangKiem}
                    className="flex items-center gap-2 rounded-xl bg-indigo-500 hover:bg-indigo-600 disabled:opacity-60 px-4 py-2.5 text-sm font-semibold text-white transition-colors shadow-lg shadow-indigo-500/25"
                >
                    {dangKiem ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    {dangKiem ? "Đang gọi thử…" : "Kiểm tất cả"}
                </button>
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {error}
                </div>
            )}

            <div className="grid gap-3 lg:grid-cols-2">
                {ds.map((k) => {
                    const kq = kiem[k.ten];
                    const han = kq?.het_han ? hanDung(kq.het_han) : null;
                    const sua = dangSua === k.ten;
                    return (
                        <div key={k.ten} className="space-y-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="flex items-center gap-2 font-semibold text-foreground">
                                        <KeyRound className="h-4 w-4 shrink-0 text-indigo-400" />
                                        {k.nhan}
                                    </p>
                                    <p className="mt-0.5 text-xs text-slate-500">{k.dung_cho}</p>
                                </div>
                                {k.nguon === "thieu" ? (
                                    <span className="shrink-0 rounded bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-500">CHƯA CÓ</span>
                                ) : kq ? (
                                    <span className={cn(
                                        "flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold",
                                        kq.ok ? "bg-emerald-500/15 text-emerald-500" : "bg-rose-500/15 text-rose-500",
                                    )}>
                                        {kq.ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                                        {kq.ok ? "SỐNG" : "CHẾT"}
                                    </span>
                                ) : (
                                    <span className="shrink-0 rounded bg-white/[0.06] px-2 py-0.5 text-[11px] font-semibold text-slate-400">CHƯA KIỂM</span>
                                )}
                            </div>

                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                                {k.che && <span className="font-mono text-slate-300">{k.che}</span>}
                                {k.do_dai > 0 && <span>{k.do_dai} ký tự</span>}
                                <span>{NGUON[k.nguon]}</span>
                                {k.cap_nhat && <span className="text-slate-500">{k.cap_nhat}</span>}
                            </div>

                            {kq && (
                                <div className="space-y-1 text-xs">
                                    <p className={kq.ok ? "text-slate-300" : "text-rose-400"}>{kq.chi_tiet}</p>
                                    {kq.canh_bao && <p className="text-amber-500">{kq.canh_bao}</p>}
                                    {han && <p className={han.gap ? "text-rose-400" : "text-slate-500"}>{han.chu}</p>}
                                </div>
                            )}

                            {k.env_khac && (
                                <p className="flex items-start gap-1.5 text-xs text-slate-500">
                                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                                    .env.local đang giữ một khoá khác; khoá nhập trên trang được dùng.
                                </p>
                            )}

                            {sua ? (
                                <div className="space-y-2">
                                    <div className="relative">
                                        <input
                                            id={`khoa-${k.ten}`}
                                            type={hien ? "text" : "password"}
                                            value={giaTri}
                                            onChange={(e) => setGiaTri(e.target.value)}
                                            placeholder="Dán khoá mới"
                                            autoComplete="off"
                                            spellCheck={false}
                                            className="w-full rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 py-2 pr-10 font-mono text-sm text-foreground placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setHien((h) => !h)}
                                            aria-label={hien ? "Ẩn khoá" : "Hiện khoá"}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-foreground"
                                        >
                                            {hien ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </button>
                                    </div>
                                    {loiLuu && <p className="text-xs text-rose-400">{loiLuu}</p>}
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => luu(k.ten)}
                                            disabled={dangLuu || !giaTri.trim()}
                                            className="flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-600 disabled:opacity-50"
                                        >
                                            {dangLuu && <Loader2 className="h-3 w-3 animate-spin" />}
                                            {dangLuu ? "Đang gọi thử…" : "Kiểm rồi lưu"}
                                        </button>
                                        <button
                                            onClick={() => setDangSua(null)}
                                            disabled={dangLuu}
                                            className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-white/[0.06] hover:text-foreground"
                                        >
                                            Huỷ
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        onClick={() => moSua(k.ten)}
                                        className="rounded-lg border border-white/[0.1] px-3 py-1.5 text-xs font-medium text-foreground hover:bg-white/[0.06]"
                                    >
                                        {k.nguon === "thieu" ? "Nhập khoá" : "Thay khoá"}
                                    </button>
                                    {k.nguon === "trang" && (
                                        <button
                                            onClick={() => boTrenTrang(k)}
                                            className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-white/[0.06] hover:text-foreground"
                                        >
                                            Bỏ khoá trên trang
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
