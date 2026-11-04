"use client";

import { useState, useEffect, useCallback } from "react";
import { Globe2, Plus, Pencil, Power, RotateCcw, Loader2, AlertCircle, CheckCircle2, X, KeyRound } from "lucide-react";
import { cn } from "@/lib/utils";

// Thị trường (04/11/2026) — giám đốc thêm nước, sửa tỷ giá, tắt / bật nước ngay trên dashboard.
// Lưu ở data/thi_truong.json (ngoài git, deploy không đè), phủ lên talpha_rules.json ở cả dashboard,
// sync, Sheet, bot — xem lib/talpha/thi-truong.ts. Tắt nước = ngừng kéo số mới, GIỮ lịch sử.

type TrangThai = "dang_ban" | "sap_chay" | "da_tat";
type Nuoc = {
    key: string; display: string; shop_label: string; currency: string; currency_symbol: string;
    rate_vnd: number | null; pos_money_divisor: number | null; shop_id: string; status: TrangThai;
    orders_from: string | null; flag: string; tokens: string[]; team: string | null;
    nguon: "config" | "sua_tren_trang" | "them_tren_trang"; bien_key: string | null; co_key: boolean;
};
type DuLieu = {
    markets: Nuoc[]; teams: { key: string; name: string }[];
    cho_khoi_dong_lai: boolean; updated_at: string | null; updated_by: string | null;
};
type Form = Record<"key" | "display" | "shop_label" | "currency" | "currency_symbol" | "rate_vnd" | "pos_money_divisor"
    | "shop_id" | "status" | "orders_from" | "flag" | "tokens" | "team", string>;

const TRANG_THAI: Record<TrangThai, { nhan: string; mau: string; giai: string }> = {
    dang_ban: { nhan: "ĐANG BÁN", mau: "bg-emerald-500/15 text-emerald-500", giai: "Kéo đơn mỗi giờ, tính tiền, hiện ở mọi màn." },
    sap_chay: { nhan: "SẮP CHẠY", mau: "bg-amber-500/15 text-amber-500", giai: "Chi tiêu tách đúng nước theo mã campaign, chưa kéo đơn, chưa tính tiền." },
    da_tat: { nhan: "ĐÃ TẮT", mau: "bg-white/[0.06] text-slate-400", giai: "Ngừng kéo đơn mới, ẩn khỏi Sổ đơn, vận đơn, Kho, bot. Giữ lịch sử và Tiền COD về." },
};
const NGUON: Record<Nuoc["nguon"], string> = {
    config: "theo config",
    sua_tren_trang: "đã sửa trên trang",
    them_tren_trang: "thêm trên trang",
};

const FORM_TRONG: Form = {
    key: "", display: "", shop_label: "", currency: "", currency_symbol: "", rate_vnd: "", pos_money_divisor: "",
    shop_id: "", status: "sap_chay", orders_from: "", flag: "", tokens: "", team: "",
};
const formTu = (n: Nuoc): Form => ({
    key: n.key, display: n.display, shop_label: n.shop_label, currency: n.currency, currency_symbol: n.currency_symbol,
    rate_vnd: n.rate_vnd === null ? "" : String(n.rate_vnd),
    pos_money_divisor: n.pos_money_divisor === null ? "" : String(n.pos_money_divisor),
    shop_id: n.shop_id, status: n.status, orders_from: n.orders_from || "", flag: n.flag, tokens: n.tokens.join(", "), team: n.team || "",
});
const fmt = (n: number) => n.toLocaleString("vi-VN");

export default function ThiTruongTab() {
    const [dl, setDl] = useState<DuLieu | null>(null);
    const [error, setError] = useState("");
    const [thongBao, setThongBao] = useState("");
    const [form, setForm] = useState<{ laMoi: boolean; f: Form } | null>(null);
    const [dangLuu, setDangLuu] = useState(false);
    const [loiForm, setLoiForm] = useState<string[]>([]);

    const tai = useCallback(async () => {
        try {
            const r = await fetch("/api/talpha/thi-truong", { cache: "no-store" });
            const j = await r.json();
            if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
            setDl(j);
            setError("");
        } catch (e) {
            setError(e instanceof Error ? e.message : "Không tải được danh sách thị trường");
        }
    }, []);
    useEffect(() => { tai(); }, [tai]);

    const daLuu = (j: DuLieu & { khoi_dong_lai: "tu_dong" | "tay" }) => {
        setDl(j);
        setThongBao(j.khoi_dong_lai === "tu_dong"
            ? "Đã lưu. Dashboard đang khởi động lại để áp dụng — tải lại trang sau khoảng 15 giây."
            : "Đã lưu. Khởi động lại dashboard (dừng rồi chạy lại npm run dev) để áp dụng.");
    };

    const gui = async (f: Form, laMoi: boolean): Promise<string[] | null> => {
        const r = await fetch("/api/talpha/thi-truong", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nuoc: f, la_moi: laMoi }),
        });
        const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        if (!r.ok) return j.loi || [j.error || `HTTP ${r.status}`];
        daLuu(j);
        return null;
    };

    const luuForm = async () => {
        if (!form) return;
        setDangLuu(true);
        setLoiForm([]);
        try {
            const loi = await gui(form.f, form.laMoi);
            if (loi) setLoiForm(loi);
            else setForm(null);
        } catch {
            setLoiForm(["Không gửi được — kiểm mạng rồi thử lại"]);
        } finally {
            setDangLuu(false);
        }
    };

    const doiTrangThai = async (n: Nuoc, status: TrangThai) => {
        const hoi = status === "da_tat"
            ? `Tắt ${n.display}? Ngừng kéo đơn mới, ẩn khỏi Sổ đơn, vận đơn, Kho, Ads Command Center, bot Zalo. Báo cáo những ngày đã chạy và Tiền COD về vẫn giữ. Bật lại được.`
            : `Bật lại ${n.display}? Máy sẽ gọi thử shop POS ${n.shop_id} trước khi lưu.`;
        if (!confirm(hoi)) return;
        setError("");
        const loi = await gui({ ...formTu(n), status }, false).catch(() => ["Không gửi được — kiểm mạng rồi thử lại"]);
        if (loi) setError(loi.join(" · "));
    };

    const boSua = async (n: Nuoc) => {
        if (!confirm(`Bỏ mọi chỗ đã sửa trên trang của ${n.display}, quay về đúng config?`)) return;
        const r = await fetch(`/api/talpha/thi-truong?key=${encodeURIComponent(n.key)}`, { method: "DELETE" });
        const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        if (!r.ok) setError(j.error || `HTTP ${r.status}`);
        else daLuu(j);
    };

    if (!dl && !error) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
            </div>
        );
    }

    const tenTeam = (k: string | null) => (k ? dl?.teams.find((t) => t.key === k)?.name || k : "— chưa giao team —");

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
                    onClick={() => { setForm({ laMoi: true, f: { ...FORM_TRONG } }); setLoiForm([]); }}
                    className="flex items-center gap-2 rounded-xl bg-indigo-500 hover:bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors shadow-lg shadow-indigo-500/25"
                >
                    <Plus className="h-4 w-4" />
                    Thêm thị trường
                </button>
            </div>

            {thongBao && (
                <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    {thongBao}
                </div>
            )}
            {!thongBao && dl?.cho_khoi_dong_lai && (
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
                <FormNuoc
                    form={form} teams={dl?.teams || []} dangLuu={dangLuu} loi={loiForm}
                    doi={(f) => setForm({ ...form, f })} luu={luuForm} huy={() => setForm(null)}
                />
            )}

            <div className="grid gap-3 lg:grid-cols-2">
                {(dl?.markets || []).map((n) => (
                    <div key={n.key} className={cn("space-y-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4", n.status === "da_tat" && "opacity-70")}>
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="flex items-center gap-2 font-semibold text-foreground">
                                    {n.flag ? <span>{n.flag}</span> : <Globe2 className="h-4 w-4 text-indigo-400" />}
                                    {n.display}
                                    <span className="font-mono text-xs text-slate-500">{n.shop_label}</span>
                                </p>
                                <p className="mt-0.5 text-xs text-slate-500">{tenTeam(n.team)} · {NGUON[n.nguon]}</p>
                            </div>
                            <span className={cn("shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold", TRANG_THAI[n.status].mau)}>
                                {TRANG_THAI[n.status].nhan}
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
                            <dt className="text-slate-500">Mã campaign</dt>
                            <dd className="truncate text-right font-mono text-slate-300">{n.tokens.join(" · ") || "—"}</dd>
                        </dl>

                        {n.shop_id && n.status !== "da_tat" && !n.co_key && (
                            <p className="flex items-center gap-1.5 text-xs text-amber-500">
                                <KeyRound className="h-3 w-3 shrink-0" />
                                Chưa có key POS — nhập ở Khoá kết nối (ô &ldquo;Key POS {n.display}&rdquo;).
                            </p>
                        )}

                        <div className="flex flex-wrap gap-2">
                            <button
                                onClick={() => { setForm({ laMoi: false, f: formTu(n) }); setLoiForm([]); }}
                                className="flex items-center gap-1.5 rounded-lg border border-white/[0.1] px-3 py-1.5 text-xs font-medium text-foreground hover:bg-white/[0.06]"
                            >
                                <Pencil className="h-3 w-3" /> Sửa
                            </button>
                            {n.status === "dang_ban" && (
                                <button onClick={() => doiTrangThai(n, "da_tat")}
                                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-white/[0.06] hover:text-foreground">
                                    <Power className="h-3 w-3" /> Tắt
                                </button>
                            )}
                            {n.status === "da_tat" && (
                                <button onClick={() => doiTrangThai(n, "dang_ban")}
                                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-emerald-500 hover:bg-white/[0.06]">
                                    <Power className="h-3 w-3" /> Bật lại
                                </button>
                            )}
                            {n.nguon === "sua_tren_trang" && (
                                <button onClick={() => boSua(n)}
                                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-white/[0.06] hover:text-foreground">
                                    <RotateCcw className="h-3 w-3" /> Bỏ sửa trên trang
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
            {dl?.updated_at && (
                <p className="text-xs text-slate-500">
                    Sửa trên trang lần cuối: {new Date(dl.updated_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}
                    {dl.updated_by ? ` · ${dl.updated_by}` : ""}
                </p>
            )}
        </div>
    );
}

function O({ nhan, giai, children }: { nhan: string; giai?: string; children: React.ReactNode }) {
    return (
        <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-300">{nhan}</span>
            {children}
            {giai && <span className="block text-[11px] leading-snug text-slate-500">{giai}</span>}
        </label>
    );
}

const O_NHAP = "w-full rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 py-2 text-sm text-foreground placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none disabled:opacity-60";

function FormNuoc({ form, teams, dangLuu, loi, doi, luu, huy }: {
    form: { laMoi: boolean; f: Form }; teams: { key: string; name: string }[]; dangLuu: boolean; loi: string[];
    doi: (f: Form) => void; luu: () => void; huy: () => void;
}) {
    const { laMoi, f } = form;
    const o = (k: keyof Form) => ({
        id: `tt-${k}`,
        value: f[k],
        onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => doi({ ...f, [k]: e.target.value }),
    });
    return (
        <div className="space-y-4 rounded-xl border border-indigo-500/30 bg-indigo-500/[0.04] p-4">
            <div className="flex items-center justify-between">
                <h3 className="font-semibold text-foreground">{laMoi ? "Thêm thị trường" : `Sửa ${f.display || f.key}`}</h3>
                <button onClick={huy} aria-label="Đóng" className="rounded p-1 text-slate-400 hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <O nhan="Tên khoá" giai="Chữ không dấu, viết hoa chữ đầu (vd Thailand). Không đổi được sau khi lưu.">
                    <input {...o("key")} disabled={!laMoi} placeholder="Thailand" className={O_NHAP} />
                </O>
                <O nhan="Tên hiển thị">
                    <input {...o("display")} placeholder="Thái Lan" className={O_NHAP} />
                </O>
                <O nhan="Cờ">
                    <input {...o("flag")} placeholder="🇹🇭" className={O_NHAP} />
                </O>
                <O nhan="Mã shop" giai="2–3 chữ in hoa, gắn vào mọi đơn của nước. Không đổi được sau khi lưu.">
                    <input {...o("shop_label")} disabled={!laMoi} placeholder="TH" className={cn(O_NHAP, "font-mono uppercase")} />
                </O>
                <O nhan="Mã trên tên campaign" giai="Ô đầu tên campaign, cách nhau bằng dấu phẩy (vd TH, THAI). Mã của nước khác bị từ chối.">
                    <input {...o("tokens")} placeholder="TH, THAI" className={cn(O_NHAP, "font-mono uppercase")} />
                </O>
                <O nhan="Team phụ trách" giai="Leader của team thấy số nước này. Giám đốc thấy mọi nước.">
                    <select {...o("team")} className={O_NHAP}>
                        <option value="">— chưa giao team —</option>
                        {teams.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
                    </select>
                </O>
                <O nhan="Tiền tệ (mã ISO)">
                    <input {...o("currency")} placeholder="THB" className={cn(O_NHAP, "font-mono uppercase")} />
                </O>
                <O nhan="Ký hiệu tiền">
                    <input {...o("currency_symbol")} placeholder="฿" className={O_NHAP} />
                </O>
                <O nhan="Tỷ giá (VND cho 1 đơn vị)" giai="Đổi tỷ giá là đổi doanh thu mọi ngày của nước này trên các tab.">
                    <input {...o("rate_vnd")} inputMode="decimal" placeholder="700" className={cn(O_NHAP, "tabular-nums")} />
                </O>
                <O nhan="Số chia tiền POS" giai="Đo trên đơn thật, đừng đoán: shop lưu nguyên đơn vị tiền (Đài, Nhật) → 1; lưu xu (Singapore, UAE) → 100.">
                    <select {...o("pos_money_divisor")} className={O_NHAP}>
                        <option value="">— chưa đo —</option>
                        <option value="1">1 — lưu nguyên đơn vị</option>
                        <option value="100">100 — lưu xu</option>
                    </select>
                </O>
                <O nhan="Shop POS (mã số)" giai="Key của shop nhập ở Khoá kết nối — ô Key POS hiện ra sau khi lưu.">
                    <input {...o("shop_id")} inputMode="numeric" placeholder="1022091930" className={cn(O_NHAP, "font-mono")} />
                </O>
                <O nhan="Tính đơn từ ngày" giai="Đơn tạo trước ngày này (giờ VN) không kéo về. Bỏ trống = không chặn.">
                    <input {...o("orders_from")} type="date" className={O_NHAP} />
                </O>
                <O nhan="Trạng thái" giai={TRANG_THAI[(f.status as TrangThai) || "sap_chay"]?.giai}>
                    <select {...o("status")} className={O_NHAP}>
                        <option value="sap_chay">Sắp chạy</option>
                        <option value="dang_ban">Đang bán</option>
                        <option value="da_tat">Đã tắt</option>
                    </select>
                </O>
            </div>
            {loi.length > 0 && (
                <ul className="space-y-1 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-400">
                    {loi.map((x) => <li key={x}>{x}</li>)}
                </ul>
            )}
            <div className="flex gap-2">
                <button onClick={luu} disabled={dangLuu}
                    className="flex items-center gap-1.5 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-600 disabled:opacity-50">
                    {dangLuu && <Loader2 className="h-4 w-4 animate-spin" />}
                    {dangLuu ? "Đang soát…" : "Lưu"}
                </button>
                <button onClick={huy} disabled={dangLuu}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-slate-400 hover:bg-white/[0.06] hover:text-foreground">
                    Huỷ
                </button>
            </div>
        </div>
    );
}
