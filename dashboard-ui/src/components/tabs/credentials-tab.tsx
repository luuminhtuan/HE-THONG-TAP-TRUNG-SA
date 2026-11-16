"use client";

import { useState, useEffect, useCallback } from "react";
import { KeyRound, Loader2, AlertCircle, CheckCircle2, XCircle, RefreshCw, Eye, EyeOff, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { MaskedCredential } from "./key-reveal";
import { useUrlParam } from "@/components/talpha/url-state";
import GeminiModelPicker from "./gemini-model-picker";

// Khoá kết nối (04/11/2026) — giám đốc dán khoá mới khi token Meta, Pancake, key POS chết.
// Máy chủ gọi thử khoá với dịch vụ thật rồi mới lưu; khoá thật không bao giờ về trình duyệt.
// Lưu ở đâu, có hiệu lực lúc nào: lib/talpha/credentials.ts.

type KeyCheck = { ok: boolean; chi_tiet: string; canh_bao?: string; het_han?: string | null };
type Credential = {
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
    kiem?: KeyCheck;
};

/** Tab theo loại khoá (15/11/2026 — trước dồn chung một trang, khó tìm). Tab đang mở nằm trên địa chỉ
 *  (?tab=pos) để gửi link thẳng tới đúng chỗ. */
const CREDENTIAL_GROUPS: { id: string; nhan: string; giai: string }[] = [
    { id: "meta", nhan: "Meta Ads", giai: "Token đọc chi tiêu quảng cáo. Sync kéo mọi TKQC mà các token này thấy; TK nằm ở Business Manager / app khác thì thêm token 2, 3." },
    { id: "pos", nhan: "POS Poscake", giai: "Mỗi nước một shop, một key — lấy ở POS → Cài đặt → Nâng cao → Kết nối bên thứ ba → Webhook/API. Sửa được cả ở Quản trị → Thị trường." },
    { id: "pancake", nhan: "Pancake", giai: "Đếm tin nhắn ở nước Meta không báo số tin nhắn (Nhật). Token tài khoản Pancake sống khoảng 90 ngày." },
    { id: "track17", nhan: "17TRACK", giai: "Theo dõi hành trình vận đơn Đài, Singapore, Nhật. Nhiều tài khoản thì quota cộng dồn." },
    { id: "gemini", nhan: "Gemini (AI)", giai: "Ô “Hỏi dashboard” ở Báo cáo → Tổng quan, chỉ giám đốc thấy. Câu hỏi và kết quả truy vấn được gửi sang Google để trả lời." },
];

const SOURCE_LABEL: Record<Credential["nguon"], string> = {
    trang: "nhập trên trang",
    env: "từ .env.local",
    thieu: "chưa có",
};

function expiryInfo(iso: string): { chu: string; gap: boolean } {
    const daysLeft = Math.floor((Date.parse(iso) - Date.now()) / 86_400_000);
    const d = new Date(iso).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
    return { chu: daysLeft < 0 ? `hết hạn ${d}` : `hết hạn ${d} · còn ${daysLeft} ngày`, gap: daysLeft <= 14 };
}

export default function CredentialsTab() {
    const [tabUrl, setTab] = useUrlParam("tab");
    const tab = CREDENTIAL_GROUPS.some((n) => n.id === tabUrl) ? tabUrl! : CREDENTIAL_GROUPS[0].id;
    const [credentials, setCredentials] = useState<Credential[]>([]);
    const [checks, setChecks] = useState<Record<string, KeyCheck>>({});
    const [loading, setLoading] = useState(true);
    const [checking, setChecking] = useState(false);
    const [error, setError] = useState("");

    const [editing, setEditing] = useState<string | null>(null);
    const [value, setValue] = useState("");
    const [showValue, setShowValue] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState("");

    const load = useCallback(async (runCheck = false) => {
        if (runCheck) setChecking(true);
        try {
            const r = await fetch(`/api/talpha/credentials${runCheck ? "?kiem=1" : ""}`, { cache: "no-store" });
            const j = await r.json();
            if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
            setCredentials(j.khoa);
            if (runCheck) setChecks(Object.fromEntries(j.khoa.map((k: Credential) => [k.ten, k.kiem])));
            setError("");
        } catch (e) {
            setError(e instanceof Error ? e.message : "Không tải được danh sách khoá");
        } finally {
            setLoading(false);
            setChecking(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const startEdit = (keyName: string) => {
        setEditing(keyName);
        setValue("");
        setShowValue(false);
        setSaveError("");
    };

    const save = async (keyName: string) => {
        setSaving(true);
        setSaveError("");
        try {
            const r = await fetch("/api/talpha/credentials", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ten: keyName, gia_tri: value }),
            });
            const j = await r.json();
            if (!r.ok) {
                setSaveError(j.error || `HTTP ${r.status}`);
                return;
            }
            setCredentials(j.khoa);
            setChecks((k) => ({ ...k, [keyName]: j.kiem }));
            setEditing(null);
            setValue("");
        } catch {
            setSaveError("Không gửi được — kiểm mạng rồi thử lại");
        } finally {
            setSaving(false);
        }
    };

    const removePageKey = async (k: Credential) => {
        if (!confirm(`Bỏ ${k.nhan} nhập trên trang? Dashboard sẽ quay về khoá trong .env.local, nếu có.`)) return;
        const r = await fetch(`/api/talpha/credentials?ten=${encodeURIComponent(k.ten)}`, { method: "DELETE" });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
            setError(j.error || `HTTP ${r.status}`);
            return;
        }
        setCredentials(j.khoa);
        setChecks((prev) => {
            const next = { ...prev };
            delete next[k.ten];
            return next;
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
                        Khoá chết thì dán khoá mới vào đây. Máy gọi thử khoá với Meta, POS, Pancake, 17TRACK, Gemini
                        trước, gọi được mới lưu. Dashboard dùng khoá mới ngay; sync và Sheet dùng từ vòng chạy
                        đầu giờ kế tiếp. Deploy không đè khoá nhập ở đây.
                    </p>
                </div>
                <button
                    onClick={() => load(true)}
                    disabled={checking}
                    className="flex items-center gap-2 rounded-xl bg-indigo-500 hover:bg-indigo-600 disabled:opacity-60 px-4 py-2.5 text-sm font-semibold text-white transition-colors shadow-lg shadow-indigo-500/25"
                >
                    {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    {checking ? "Đang gọi thử…" : "Kiểm tất cả"}
                </button>
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {error}
                </div>
            )}

            {/* Tab theo loại khoá: đỏ = có khoá gọi thử bị từ chối, vàng = còn thiếu khoá. */}
            <div className="flex w-full max-w-full gap-1 overflow-x-auto rounded-xl border border-border bg-muted/40 p-1 sm:w-fit">
                {CREDENTIAL_GROUPS.map((n) => {
                    const groupKeys = credentials.filter((k) => k.loai === n.id);
                    const hasFailed = groupKeys.some((k) => checks[k.ten] && !checks[k.ten].ok && k.nguon !== "thieu");
                    // Meta: token 2, 3 là tuỳ chọn — chỉ báo thiếu khi không có token nào. POS: mỗi nước một key, thiếu là thiếu.
                    const missing = n.id === "pos" ? groupKeys.some((k) => k.nguon === "thieu") : groupKeys.length > 0 && groupKeys.every((k) => k.nguon === "thieu");
                    return (
                        <button key={n.id} type="button" onClick={() => setTab(n.id)}
                            className={cn(
                                "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-all",
                                tab === n.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                            )}>
                            {n.nhan}
                            <span className="text-xs text-muted-foreground">{groupKeys.length}</span>
                            {(hasFailed || missing) && (
                                <span className={cn("h-1.5 w-1.5 rounded-full", hasFailed ? "bg-rose-500" : "bg-amber-500")}
                                    title={hasFailed ? "Có khoá gọi thử bị từ chối" : "Còn thiếu khoá"} />
                            )}
                        </button>
                    );
                })}
            </div>
            <p className="max-w-3xl text-sm text-muted-foreground">{CREDENTIAL_GROUPS.find((n) => n.id === tab)?.giai}</p>

            <div className="grid gap-3 lg:grid-cols-2">
                {credentials.filter((k) => k.loai === tab).map((k) => {
                    const check = checks[k.ten];
                    const expiry = check?.het_han ? expiryInfo(check.het_han) : null;
                    const isEditing = editing === k.ten;
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
                                ) : check ? (
                                    <span className={cn(
                                        "flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold",
                                        check.ok ? "bg-emerald-500/15 text-emerald-500" : "bg-rose-500/15 text-rose-500",
                                    )}>
                                        {check.ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                                        {check.ok ? "SỐNG" : "CHẾT"}
                                    </span>
                                ) : (
                                    <span className="shrink-0 rounded bg-white/[0.06] px-2 py-0.5 text-[11px] font-semibold text-slate-400">CHƯA KIỂM</span>
                                )}
                            </div>

                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                                {k.che && <MaskedCredential ten={k.ten} che={k.che} />}
                                {k.do_dai > 0 && <span>{k.do_dai} ký tự</span>}
                                <span>{SOURCE_LABEL[k.nguon]}</span>
                                {k.cap_nhat && <span className="text-slate-500">{k.cap_nhat}</span>}
                            </div>

                            {check && (
                                <div className="space-y-1 text-xs">
                                    <p className={check.ok ? "text-slate-300" : "text-rose-400"}>{check.chi_tiet}</p>
                                    {check.canh_bao && <p className="text-amber-500">{check.canh_bao}</p>}
                                    {expiry && <p className={expiry.gap ? "text-rose-400" : "text-slate-500"}>{expiry.chu}</p>}
                                </div>
                            )}

                            {k.env_khac && (
                                <p className="flex items-start gap-1.5 text-xs text-slate-500">
                                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                                    .env.local đang giữ một khoá khác; khoá nhập trên trang được dùng.
                                </p>
                            )}

                            {isEditing ? (
                                <div className="space-y-2">
                                    <div className="relative">
                                        <input
                                            id={`khoa-${k.ten}`}
                                            type={showValue ? "text" : "password"}
                                            value={value}
                                            onChange={(e) => setValue(e.target.value)}
                                            placeholder="Dán khoá mới"
                                            autoComplete="off"
                                            spellCheck={false}
                                            className="w-full rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 py-2 pr-10 font-mono text-sm text-foreground placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowValue((h) => !h)}
                                            aria-label={showValue ? "Ẩn khoá" : "Hiện khoá"}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-foreground"
                                        >
                                            {showValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </button>
                                    </div>
                                    {saveError && <p className="text-xs text-rose-400">{saveError}</p>}
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => save(k.ten)}
                                            disabled={saving || !value.trim()}
                                            className="flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-600 disabled:opacity-50"
                                        >
                                            {saving && <Loader2 className="h-3 w-3 animate-spin" />}
                                            {saving ? "Đang gọi thử…" : "Kiểm rồi lưu"}
                                        </button>
                                        <button
                                            onClick={() => setEditing(null)}
                                            disabled={saving}
                                            className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-white/[0.06] hover:text-foreground"
                                        >
                                            Huỷ
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        onClick={() => startEdit(k.ten)}
                                        className="rounded-lg border border-white/[0.1] px-3 py-1.5 text-xs font-medium text-foreground hover:bg-white/[0.06]"
                                    >
                                        {k.nguon === "thieu" ? "Nhập khoá" : "Thay khoá"}
                                    </button>
                                    {k.nguon === "trang" && (
                                        <button
                                            onClick={() => removePageKey(k)}
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

            {/* Chọn model Gemini (15/11/2026) — danh sách đi theo khoá: thay / bỏ khoá thì tải lại. */}
            {tab === "gemini" && (() => {
                const g = credentials.find((k) => k.ten === "GEMINI_API_KEY");
                return <GeminiModelPicker phienKhoa={`${g?.nguon}|${g?.che}|${g?.cap_nhat}`} />;
            })()}
        </div>
    );
}
