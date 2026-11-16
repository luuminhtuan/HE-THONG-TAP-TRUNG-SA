"use client";

import { useState, useEffect, useCallback } from "react";
import { Globe2, Plus, Pencil, Power, RotateCcw, Loader2, AlertCircle, CheckCircle2, X, KeyRound, Eye, EyeOff, Trash2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { MaskedCredential, revealCredential } from "./key-reveal";

// Thị trường (04/11/2026) — giám đốc thêm nước, sửa tỷ giá, tắt / bật nước ngay trên dashboard.
// Lưu ở bảng market_overrides (deploy không đè), phủ lên talpha_rules.json ở cả dashboard, sync,
// Sheet, bot — xem lib/talpha/market-config.ts. Tắt nước = ngừng kéo số mới, GIỮ lịch sử.
// Key POS của shop nhập ngay trong form (15/11/2026): máy gọi thử shop rồi lưu key MÃ HOÁ vào bảng
// api_credentials — cùng chỗ với Khoá kết nối, khỏi sang trang đó rồi quay lại.

type MarketStatus = "active" | "upcoming" | "disabled";
type Market = {
    key: string; display: string; shop_label: string; currency: string; currency_symbol: string;
    rate_vnd: number | null; pos_money_divisor: number | null; shop_id: string; status: MarketStatus;
    orders_from: string | null; flag: string; tokens: string[]; team: string | null;
    nguon: "config" | "sua_tren_trang" | "them_tren_trang"; bien_key: string | null; co_key: boolean;
    /** Key đang dùng, đã che (••••b699) — không bao giờ có key thật. */
    che_key: string;
};
type MarketsData = {
    markets: Market[]; teams: { key: string; name: string }[];
    cho_khoi_dong_lai: boolean; updated_at: string | null; updated_by: string | null;
};
type Form = Record<"key" | "display" | "shop_label" | "currency" | "currency_symbol" | "rate_vnd" | "pos_money_divisor"
    | "shop_id" | "status" | "orders_from" | "flag" | "tokens" | "team" | "key_pos", string>;
type RestartMode = "tu_dong" | "tay" | "khong_can";

const STATUS_INFO: Record<MarketStatus, { nhan: string; mau: string; giai: string }> = {
    active: { nhan: "ĐANG BÁN", mau: "bg-emerald-500/15 text-emerald-500", giai: "Kéo đơn mỗi giờ, tính tiền, hiện ở mọi màn." },
    upcoming: { nhan: "SẮP CHẠY", mau: "bg-amber-500/15 text-amber-500", giai: "Chi tiêu tách đúng nước theo mã campaign, chưa kéo đơn, chưa tính tiền." },
    disabled: { nhan: "ĐÃ TẮT", mau: "bg-white/[0.06] text-slate-400", giai: "Ngừng kéo đơn mới, ẩn khỏi Sổ đơn, vận đơn, Kho, bot. Giữ lịch sử và Tiền COD về." },
};
const SOURCE_LABEL: Record<Market["nguon"], string> = {
    config: "theo config",
    sua_tren_trang: "đã sửa trên trang",
    them_tren_trang: "thêm trên trang",
};

const EMPTY_FORM: Form = {
    key: "", display: "", shop_label: "", currency: "", currency_symbol: "", rate_vnd: "", pos_money_divisor: "",
    shop_id: "", status: "upcoming", orders_from: "", flag: "", tokens: "", team: "", key_pos: "",
};
const formFromMarket = (n: Market): Form => ({
    key: n.key, display: n.display, shop_label: n.shop_label, currency: n.currency, currency_symbol: n.currency_symbol,
    rate_vnd: n.rate_vnd === null ? "" : String(n.rate_vnd),
    pos_money_divisor: n.pos_money_divisor === null ? "" : String(n.pos_money_divisor),
    shop_id: n.shop_id, status: n.status, orders_from: n.orders_from || "", flag: n.flag, tokens: n.tokens.join(", "), team: n.team || "",
    key_pos: "",   // key thật không bao giờ về trình duyệt — trống = giữ key đang có
});
const fmt = (n: number) => n.toLocaleString("vi-VN");

export default function MarketsTab() {
    const [data, setData] = useState<MarketsData | null>(null);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [form, setForm] = useState<{ laMoi: boolean; f: Form; cheKey: string; bienKey: string } | null>(null);
    const [saving, setSaving] = useState(false);
    const [formErrors, setFormErrors] = useState<string[]>([]);

    const load = useCallback(async () => {
        try {
            const r = await fetch("/api/talpha/market-config", { cache: "no-store" });
            const j = await r.json();
            if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
            setData(j);
            setError("");
        } catch (e) {
            setError(e instanceof Error ? e.message : "Không tải được danh sách thị trường");
        }
    }, []);
    useEffect(() => { load(); }, [load]);

    const onSaved = (j: MarketsData & { khoi_dong_lai: RestartMode; luu_key?: boolean; da_xoa?: string }) => {
        setData(j);
        const headline = j.da_xoa ? `Đã xoá ${j.da_xoa} (kèm key POS).`
            : j.luu_key ? "Đã lưu (key POS gọi thử được shop, đã cất mã hoá)." : "Đã lưu.";
        setNotice(j.khoi_dong_lai === "tu_dong"
            ? `${headline} Dashboard đang khởi động lại để áp dụng — tải lại trang sau khoảng 15 giây.`
            : j.khoi_dong_lai === "khong_can"
                ? `${headline} Sync dùng key mới từ vòng kế tiếp.`
                : `${headline} Khởi động lại dashboard (dừng rồi chạy lại npm run dev) để áp dụng.`);
    };

    const submit = async (f: Form, isNew: boolean): Promise<string[] | null> => {
        const { key_pos, ...market } = f;
        const r = await fetch("/api/talpha/market-config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nuoc: market, la_moi: isNew, key_pos: key_pos.trim() || undefined }),
        });
        const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        if (!r.ok) return j.loi || [j.error || `HTTP ${r.status}`];
        onSaved(j);
        return null;
    };

    const saveForm = async () => {
        if (!form) return;
        setSaving(true);
        setFormErrors([]);
        try {
            const errors = await submit(form.f, form.laMoi);
            if (errors) setFormErrors(errors);
            else setForm(null);
        } catch {
            setFormErrors(["Không gửi được — kiểm mạng rồi thử lại"]);
        } finally {
            setSaving(false);
        }
    };

    const changeStatus = async (n: Market, status: MarketStatus) => {
        const confirmText = status === "disabled"
            ? `Tắt ${n.display}? Ngừng kéo đơn mới, ẩn khỏi Sổ đơn, vận đơn, Kho, Ads Command Center, bot Zalo. Báo cáo những ngày đã chạy và Tiền COD về vẫn giữ. Bật lại được.`
            : `Bật lại ${n.display}? Máy sẽ gọi thử shop POS ${n.shop_id} trước khi lưu.`;
        if (!confirm(confirmText)) return;
        setError("");
        const errors = await submit({ ...formFromMarket(n), status }, false).catch(() => ["Không gửi được — kiểm mạng rồi thử lại"]);
        if (errors) setError(errors.join(" · "));
    };

    const revertOrDelete = async (n: Market) => {
        const confirmText = n.nguon === "them_tren_trang"
            ? `Xoá hẳn ${n.display}? Chỉ xoá được nước chưa có đơn, chưa có chi tiêu quảng cáo — máy soát trước khi xoá. Key POS của nước này cũng bị xoá. Không hoàn tác được.`
            : `Bỏ mọi chỗ đã sửa trên trang của ${n.display}, quay về đúng config?`;
        if (!confirm(confirmText)) return;
        setError("");
        const r = await fetch(`/api/talpha/market-config?key=${encodeURIComponent(n.key)}`, { method: "DELETE" });
        const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        if (!r.ok) setError(j.error || `HTTP ${r.status}`);
        else onSaved(j);
    };

    if (!data && !error) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
            </div>
        );
    }

    const teamName = (k: string | null) => (k ? data?.teams.find((t) => t.key === k)?.name || k : "— chưa giao team —");

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="max-w-2xl">
                    <h2 className="text-lg font-bold text-foreground">Thị trường</h2>
                    <p className="text-sm text-slate-400">
                        Thêm nước, sửa tỷ giá, tắt hoặc bật lại nước ngay ở đây — không phải sửa file hay deploy.
                        Dashboard áp dụng sau khi tự khởi động lại; sync, Sheet, bot từ vòng chạy kế tiếp; các tab đọc
                        view của kho số sau khi vòng sync kế tiếp (đầu giờ) dựng lại view.
                    </p>
                </div>
                <button
                    onClick={() => { setForm({ laMoi: true, f: { ...EMPTY_FORM }, cheKey: "", bienKey: "" }); setFormErrors([]); }}
                    className="flex items-center gap-2 rounded-xl bg-indigo-500 hover:bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors shadow-lg shadow-indigo-500/25"
                >
                    <Plus className="h-4 w-4" />
                    Thêm thị trường
                </button>
            </div>

            {notice && (
                <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    {notice}
                </div>
            )}
            {!notice && data?.cho_khoi_dong_lai && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-500">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    Có thay đổi đã lưu nhưng dashboard chưa khởi động lại — các tab đang tính theo danh sách nước cũ.
                </div>
            )}
            {error && (
                <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    {error}
                </div>
            )}

            {form && (
                <MarketForm
                    form={form} teams={data?.teams || []} dangLuu={saving} loi={formErrors}
                    doi={(f) => setForm({ ...form, f })} luu={saveForm} huy={() => setForm(null)}
                />
            )}

            <div className="grid gap-3 lg:grid-cols-2">
                {(data?.markets || []).map((n) => (
                    <div key={n.key} className={cn("space-y-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4", n.status === "disabled" && "opacity-70")}>
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="flex items-center gap-2 font-semibold text-foreground">
                                    {n.flag ? <span>{n.flag}</span> : <Globe2 className="h-4 w-4 text-indigo-400" />}
                                    {n.display}
                                    <span className="font-mono text-xs text-slate-500">{n.shop_label}</span>
                                </p>
                                <p className="mt-0.5 text-xs text-slate-500">{teamName(n.team)} · {SOURCE_LABEL[n.nguon]}</p>
                            </div>
                            <span className={cn("shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold", STATUS_INFO[n.status].mau)}>
                                {STATUS_INFO[n.status].nhan}
                            </span>
                        </div>

                        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                            <dt className="text-slate-500">Tỷ giá</dt>
                            <dd className="text-right tabular-nums text-slate-300">
                                {n.rate_vnd ? `1 ${n.currency_symbol || n.currency} = ${fmt(n.rate_vnd)}đ` : "chưa có"}
                            </dd>
                            <dt className="text-slate-500">Số chia tiền POS</dt>
                            <dd className="text-right tabular-nums text-slate-300">{n.pos_money_divisor ?? "chưa đo"}</dd>
                            <dt className="text-slate-500">Shop POS</dt>
                            <dd className="text-right font-mono text-slate-300">{n.shop_id || "chưa có"}</dd>
                            <dt className="text-slate-500">Key POS</dt>
                            <dd className={cn("min-w-0 text-right font-mono", n.co_key ? "text-slate-300" : "text-slate-500")}>
                                {n.co_key && n.bien_key ? <MaskedCredential ten={n.bien_key} che={n.che_key} /> : "chưa có"}
                            </dd>
                            <dt className="text-slate-500">Mã campaign</dt>
                            <dd className="truncate text-right font-mono text-slate-300">{n.tokens.join(" · ") || "—"}</dd>
                        </dl>

                        {n.shop_id && n.status !== "disabled" && !n.co_key && (
                            <p className="flex items-center gap-1.5 text-xs text-amber-500">
                                <KeyRound className="h-3 w-3 shrink-0" />
                                Chưa có key POS — bấm Sửa rồi dán key vào ô &ldquo;Key POS&rdquo;.
                            </p>
                        )}

                        <div className="flex flex-wrap gap-2">
                            <button
                                onClick={() => { setForm({ laMoi: false, f: formFromMarket(n), cheKey: n.co_key ? n.che_key : "", bienKey: n.bien_key || "" }); setFormErrors([]); }}
                                className="flex items-center gap-1.5 rounded-lg border border-white/[0.1] px-3 py-1.5 text-xs font-medium text-foreground hover:bg-white/[0.06]"
                            >
                                <Pencil className="h-3 w-3" /> Sửa
                            </button>
                            {n.status === "active" && (
                                <button onClick={() => changeStatus(n, "disabled")}
                                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-white/[0.06] hover:text-foreground">
                                    <Power className="h-3 w-3" /> Tắt
                                </button>
                            )}
                            {n.status === "disabled" && (
                                <button onClick={() => changeStatus(n, "active")}
                                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-emerald-500 hover:bg-white/[0.06]">
                                    <Power className="h-3 w-3" /> Bật lại
                                </button>
                            )}
                            {n.nguon === "sua_tren_trang" && (
                                <button onClick={() => revertOrDelete(n)}
                                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-white/[0.06] hover:text-foreground">
                                    <RotateCcw className="h-3 w-3" /> Bỏ sửa trên trang
                                </button>
                            )}
                            {n.nguon === "them_tren_trang" && (
                                <button onClick={() => revertOrDelete(n)} title="Chỉ xoá được nước chưa có đơn, chưa có chi tiêu"
                                    className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-rose-500 hover:bg-rose-500/10">
                                    <Trash2 className="h-3 w-3" /> Xoá
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
            {data?.updated_at && (
                <p className="text-xs text-slate-500">
                    Sửa trên trang lần cuối: {new Date(data.updated_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}
                    {data.updated_by ? ` · ${data.updated_by}` : ""}
                </p>
            )}
        </div>
    );
}

function Field({ nhan: label, giai: hint, children }: { nhan: string; giai?: string; children: React.ReactNode }) {
    return (
        <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-300">{label}</span>
            {children}
            {hint && <span className="block text-[11px] leading-snug text-slate-500">{hint}</span>}
        </label>
    );
}

const INPUT_CLASS = "w-full rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 py-2 text-sm text-foreground placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none disabled:opacity-60";

function MarketForm({ form, teams, dangLuu: saving, loi: errors, doi: onFormChange, luu: onSave, huy: onCancel }: {
    form: { laMoi: boolean; f: Form; cheKey: string; bienKey: string }; teams: { key: string; name: string }[]; dangLuu: boolean; loi: string[];
    doi: (f: Form) => void; luu: () => void; huy: () => void;
}) {
    const { laMoi: isNew, f, cheKey: maskedKey, bienKey: posKeyName } = form;
    const [showKey, setShowKey] = useState(false);
    const [fetchingKey, setFetchingKey] = useState(false);
    const [keyError, setKeyError] = useState("");
    // Con mắt: ô trống mà nước đã có key → lấy key đang dùng điền vào ô (lưu lại y nguyên = không đổi gì).
    const toggleReveal = async () => {
        if (showKey) { setShowKey(false); return; }
        setKeyError("");
        if (!f.key_pos && maskedKey && posKeyName) {
            setFetchingKey(true);
            try { onFormChange({ ...f, key_pos: await revealCredential(posKeyName) }); }
            catch (e) { setKeyError(e instanceof Error ? e.message : "Không xem được key"); return; }
            finally { setFetchingKey(false); }
        }
        setShowKey(true);
    };
    const o = (k: keyof Form) => ({
        id: `tt-${k}`,
        value: f[k],
        onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onFormChange({ ...f, [k]: e.target.value }),
    });
    // Esc là đóng (trừ lúc đang lưu — đóng giữa chừng không biết đã lưu hay chưa).
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape" && !saving) onCancel(); };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [saving, onCancel]);
    // Popup cùng kiểu form Thêm User (15/11/2026): khung tối, tiêu đề đứng yên, chỉ phần ô nhập cuộn,
    // nút Huỷ / Lưu dính đáy. Class `dark` đổi màu chữ / ô nhập bên trong sang bảng màu tối kể cả khi
    // trang đang sáng; [color-scheme:dark] cho thanh cuộn và danh sách chọn tối theo.
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div role="dialog" aria-modal="true" aria-labelledby="tt-tieu-de"
                className="dark mx-3 flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#24211C] text-foreground shadow-2xl [color-scheme:dark]">
            <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-6 py-4">
                <h3 id="tt-tieu-de" className="text-lg font-bold text-white">{isNew ? "Thêm thị trường" : `Sửa ${f.display || f.key}`}</h3>
                <button onClick={onCancel} disabled={saving} aria-label="Đóng"
                    className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50">
                    <X className="h-5 w-5" />
                </button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
                <Field nhan="Tên khoá" giai="Chữ không dấu, viết hoa chữ đầu (vd Thailand). Không đổi được sau khi lưu.">
                    <input {...o("key")} disabled={!isNew} placeholder="Thailand" className={INPUT_CLASS} />
                </Field>
                <Field nhan="Tên hiển thị">
                    <input {...o("display")} placeholder="Thái Lan" className={INPUT_CLASS} />
                </Field>
                <Field nhan="Cờ">
                    <input {...o("flag")} placeholder="🇹🇭" className={INPUT_CLASS} />
                </Field>
                <Field nhan="Mã shop" giai="2–3 chữ in hoa, gắn vào mọi đơn của nước. Không đổi được sau khi lưu.">
                    <input {...o("shop_label")} disabled={!isNew} placeholder="TH" className={cn(INPUT_CLASS, "font-mono uppercase")} />
                </Field>
                <Field nhan="Mã trên tên campaign" giai="Ô đầu tên campaign, cách nhau bằng dấu phẩy (vd TH, THAI). Mã của nước khác bị từ chối.">
                    <input {...o("tokens")} placeholder="TH, THAI" className={cn(INPUT_CLASS, "font-mono uppercase")} />
                </Field>
                <Field nhan="Team phụ trách" giai="Leader của team thấy số nước này. Giám đốc thấy mọi nước.">
                    <select {...o("team")} className={INPUT_CLASS}>
                        <option value="">— chưa giao team —</option>
                        {teams.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
                    </select>
                </Field>
                <Field nhan="Tiền tệ (mã ISO)">
                    <input {...o("currency")} placeholder="THB" className={cn(INPUT_CLASS, "font-mono uppercase")} />
                </Field>
                <Field nhan="Ký hiệu tiền">
                    <input {...o("currency_symbol")} placeholder="฿" className={INPUT_CLASS} />
                </Field>
                <Field nhan="Tỷ giá (VND cho 1 đơn vị)" giai="Đổi tỷ giá là đổi doanh thu mọi ngày của nước này trên các tab.">
                    <input {...o("rate_vnd")} inputMode="decimal" placeholder="700" className={cn(INPUT_CLASS, "tabular-nums")} />
                </Field>
                <Field nhan="Số chia tiền POS" giai="Đo trên đơn thật, đừng đoán: shop lưu nguyên đơn vị tiền (Đài, Nhật) → 1; lưu xu (Singapore, UAE) → 100.">
                    <select {...o("pos_money_divisor")} className={INPUT_CLASS}>
                        <option value="">— chưa đo —</option>
                        <option value="1">1 — lưu nguyên đơn vị</option>
                        <option value="100">100 — lưu xu</option>
                    </select>
                </Field>
                <Field nhan="Shop POS (mã số)" giai="Mã số shop trên Poscake. Key của shop dán ở ô Key POS ngay bên cạnh.">
                    <input {...o("shop_id")} inputMode="numeric" placeholder="1022091930" className={cn(INPUT_CLASS, "font-mono")} />
                </Field>
                <Field nhan="Key POS"
                    giai={maskedKey
                        ? `Đang dùng key ${maskedKey}. Để trống là giữ nguyên; dán key mới là thay.`
                        : "Lấy ở POS → Cài đặt → Nâng cao → Kết nối bên thứ ba → Webhook/API. Lưu là máy gọi thử shop bằng key này; key được mã hoá, không hiện lại."}>
                    <span className="relative block">
                        <input {...o("key_pos")} type={showKey ? "text" : "password"} autoComplete="off" spellCheck={false}
                            placeholder={maskedKey ? `Giữ ${maskedKey}` : "Dán key API của shop"} className={cn(INPUT_CLASS, "pr-10 font-mono")} />
                        <button type="button" onClick={toggleReveal} disabled={fetchingKey}
                            aria-label={showKey ? "Che key" : maskedKey && !f.key_pos ? "Xem key đang dùng" : "Hiện key"}
                            title={showKey ? "Che key" : maskedKey && !f.key_pos ? "Xem key đang dùng" : "Hiện key"}
                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-foreground disabled:opacity-50">
                            {fetchingKey ? <Loader2 className="h-4 w-4 animate-spin" /> : showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                    </span>
                    {keyError && <span className="block text-[11px] text-rose-400">{keyError}</span>}
                </Field>
                <Field nhan="Tính đơn từ ngày" giai="Đơn tạo trước ngày này (giờ VN) không kéo về. Bỏ trống = không chặn.">
                    <input {...o("orders_from")} type="date" className={INPUT_CLASS} />
                </Field>
                <Field nhan="Trạng thái" giai={STATUS_INFO[(f.status as MarketStatus) || "upcoming"]?.giai}>
                    <select {...o("status")} className={INPUT_CLASS}>
                        <option value="upcoming">Sắp chạy</option>
                        <option value="active">Đang bán</option>
                        <option value="disabled">Đã tắt</option>
                    </select>
                </Field>
            </div>
            {errors.length > 0 && (
                <ul className="space-y-1 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-xs text-red-400">
                    {errors.map((x) => <li key={x}>{x}</li>)}
                </ul>
            )}
            </div>
            <div className="flex shrink-0 items-center justify-end gap-3 border-t border-white/[0.06] px-6 py-4">
                <button onClick={onCancel} disabled={saving}
                    className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white">
                    Huỷ
                </button>
                <button onClick={onSave} disabled={saving}
                    className="flex items-center gap-2 rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-colors hover:bg-indigo-600 disabled:opacity-50">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    {saving ? "Đang soát…" : isNew ? "Thêm thị trường" : "Lưu"}
                </button>
            </div>
            </div>
        </div>
    );
}
