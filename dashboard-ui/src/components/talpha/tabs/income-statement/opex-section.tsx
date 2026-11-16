"use client";

import { useMemo, useState } from "react";
import { formatMoney } from "../../utils";
import { DASH } from "../../report";
import { fetchJson, formatMonth } from "./helpers";
import type { Data, OpexItem } from "./types";

// ═══ Chi phí vận hành ═══
type Form = { id?: string; nhom: string; ten: string; so_tien: string; tu_thang: string; den_thang: string; thuoc: string; ghi_chu: string };

export function OpexSection({ data, taiLai: reload }: { data: Data; taiLai: () => void }) {
    const opex = data.van_hanh;
    const thisMonth = data.hom_nay.slice(0, 7);
    const emptyForm = useMemo<Form>(() => ({ nhom: data.cfg.nhom_van_hanh[0] || "Lương", ten: "", so_tien: "", tu_thang: thisMonth, den_thang: "", thuoc: "CHUNG", ghi_chu: "" }), [data.cfg.nhom_van_hanh, thisMonth]);
    const [form, setForm] = useState<Form | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const periodAmounts = new Map(opex.trong_ky.map((k) => [k.id, k.trong_ky_vnd || 0]));
    const marketLabel = (c: string) => (c === "CHUNG" ? "Chung cả công ty" : data.nuoc_ban.find((n) => n.code === c)?.ten || c);

    const save = async () => {
        if (!form) return;
        setSaving(true); setError(null);
        try {
            await fetchJson("/api/talpha/income-statement/opex", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    id: form.id, nhom: form.nhom, ten: form.ten, thuoc: form.thuoc, ghi_chu: form.ghi_chu,
                    so_tien_thang_vnd: Number(form.so_tien.replace(/[^\d]/g, "")),
                    tu_thang: form.tu_thang, den_thang: form.den_thang || null,
                }),
            });
            setForm(null); reload();
        } catch (e: any) { setError(String(e?.message || e)); } finally { setSaving(false); }
    };
    const remove = async (k: OpexItem) => {
        if (!window.confirm(`Xoá khoản "${k.ten}" (${formatMoney(k.so_tien_thang_vnd)}đ/tháng)? Mọi kỳ đã tính sẽ không còn khoản này.`)) return;
        setSaving(true); setError(null);
        try { await fetchJson(`/api/talpha/income-statement/opex?id=${encodeURIComponent(k.id)}`, { method: "DELETE" }); reload(); }
        catch (e: any) { setError(String(e?.message || e)); } finally { setSaving(false); }
    };

    if (!opex.ghi_duoc) {
        return (
            <section className="rounded-xl border border-border bg-card p-5 text-sm shadow-sm">
                <h3 className="section-header mb-1">🏢 Chi phí vận hành</h3>
                <p className="text-muted-foreground">
                    Kỳ này: <strong className="text-foreground">{data.tong.van_hanh ? `${formatMoney(data.tong.van_hanh)}đ` : "chưa có khoản nào"}</strong> cho
                    {data.scoped ? " các nước của team" : " các nước"} — gồm khoản riêng của nước và phần chi phí chung chia theo doanh số.
                    Chi tiết từng khoản do giám đốc nhập và chỉ giám đốc xem.
                </p>
            </section>
        );
    }

    const o = "rounded-md border border-border bg-background px-2 py-1.5 text-sm";
    return (
        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h3 className="section-header mb-1">🏢 Chi phí vận hành <span className="text-xs font-normal text-muted-foreground">(chi phí khai thác ngoài ads)</span></h3>
                    <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
                        Nhập theo THÁNG: lương, mặt bằng, phần mềm (POS, Pancake…), sim, tool… Khoản trả đều thì để trống &ldquo;đến tháng&rdquo;.
                        Kỳ báo cáo lấy theo số ngày (chọn 10 ngày của tháng 31 ngày là 10/31 số tiền tháng). Khoản &ldquo;chung&rdquo; chia cho các nước theo doanh số;
                        khoản của riêng một team (lương leader) thì chọn đúng nước. Leader và sale chỉ thấy tổng, không thấy từng khoản.
                    </p>
                </div>
                {!form && <button onClick={() => { setForm(emptyForm); setError(null); }} className="rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-orange-600">+ Thêm khoản chi</button>}
            </div>

            {form && (
                <div className="mb-4 grid gap-2 rounded-lg border border-orange-300 bg-orange-50/50 p-3 sm:grid-cols-2 lg:grid-cols-4 dark:border-orange-500/30 dark:bg-orange-500/5">
                    <label className="flex flex-col gap-1 text-xs">Nhóm
                        <select className={o} value={form.nhom} onChange={(e) => setForm({ ...form, nhom: e.target.value })}>
                            {[...new Set([...data.cfg.nhom_van_hanh, form.nhom])].map((x) => <option key={x}>{x}</option>)}
                        </select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs">Tên khoản
                        <input className={o} value={form.ten} placeholder="vd: Lương Thương" onChange={(e) => setForm({ ...form, ten: e.target.value })} />
                    </label>
                    <label className="flex flex-col gap-1 text-xs">Số tiền mỗi tháng (đ)
                        <input className={o} inputMode="numeric" value={form.so_tien} placeholder="8.000.000"
                            onChange={(e) => { const s = e.target.value.replace(/[^\d]/g, ""); setForm({ ...form, so_tien: s ? Number(s).toLocaleString("vi-VN") : "" }); }} />
                    </label>
                    <label className="flex flex-col gap-1 text-xs">Thuộc
                        <select className={o} value={form.thuoc} onChange={(e) => setForm({ ...form, thuoc: e.target.value })}>
                            <option value="CHUNG">Chung cả công ty (chia theo doanh số)</option>
                            {data.nuoc_ban.map((n) => <option key={n.code} value={n.code}>{n.ten}</option>)}
                        </select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs">Từ tháng
                        <input type="month" className={o} value={form.tu_thang} onChange={(e) => setForm({ ...form, tu_thang: e.target.value })} />
                    </label>
                    <label className="flex flex-col gap-1 text-xs">Đến tháng (trống = vẫn đang trả)
                        <input type="month" className={o} value={form.den_thang} onChange={(e) => setForm({ ...form, den_thang: e.target.value })} />
                    </label>
                    <label className="flex flex-col gap-1 text-xs sm:col-span-2">Ghi chú
                        <input className={o} value={form.ghi_chu} onChange={(e) => setForm({ ...form, ghi_chu: e.target.value })} />
                    </label>
                    <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-4">
                        <button disabled={saving} onClick={save} className="rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50">{saving ? "Đang lưu…" : form.id ? "Lưu thay đổi" : "Thêm"}</button>
                        <button disabled={saving} onClick={() => { setForm(null); setError(null); }} className="rounded-lg border border-border px-3 py-1.5 text-sm">Huỷ</button>
                        {error && <span className="text-sm text-rose-600">{error}</span>}
                    </div>
                </div>
            )}
            {!form && error && <p className="mb-2 text-sm text-rose-600">{error}</p>}

            {opex.items.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                    Chưa có khoản nào — lợi nhuận đang <strong>chưa trừ</strong> lương, mặt bằng, phần mềm. Bấm &ldquo;Thêm khoản chi&rdquo; để nhập.
                </p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] border-collapse text-sm">
                        <thead>
                            <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                                <th className="px-3 py-2 text-left">Nhóm</th><th className="px-3 py-2 text-left">Khoản</th>
                                <th className="px-3 py-2 text-right">Mỗi tháng</th><th className="px-3 py-2 text-left">Thời gian</th>
                                <th className="px-3 py-2 text-left">Thuộc</th><th className="px-3 py-2 text-right">Trong kỳ này</th><th className="px-3 py-2" />
                            </tr>
                        </thead>
                        <tbody>
                            {[...opex.items].sort((a, b) => a.nhom.localeCompare(b.nhom) || a.ten.localeCompare(b.ten)).map((k) => (
                                <tr key={k.id} className="border-b border-border/40">
                                    <td className="px-3 py-2">{k.nhom}</td>
                                    <td className="px-3 py-2">{k.ten}{k.ghi_chu && <span className="block text-[11px] text-muted-foreground">{k.ghi_chu}</span>}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(k.so_tien_thang_vnd)}</td>
                                    <td className="px-3 py-2 text-xs">{formatMonth(k.tu_thang)} → {formatMonth(k.den_thang)}</td>
                                    <td className="px-3 py-2 text-xs">{marketLabel(k.thuoc)}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">{periodAmounts.get(k.id) ? formatMoney(periodAmounts.get(k.id)!) : DASH}</td>
                                    <td className="whitespace-nowrap px-3 py-2 text-right text-xs">
                                        <button disabled={saving} className="text-orange-600 hover:underline" onClick={() => { setError(null); setForm({ id: k.id, nhom: k.nhom, ten: k.ten, so_tien: k.so_tien_thang_vnd.toLocaleString("vi-VN"), tu_thang: k.tu_thang, den_thang: k.den_thang || "", thuoc: k.thuoc, ghi_chu: k.ghi_chu || "" }); }}>Sửa</button>
                                        <span className="mx-1 text-muted-foreground">·</span>
                                        <button disabled={saving} className="text-rose-600 hover:underline" onClick={() => remove(k)}>Xoá</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="border-t-2 border-border font-semibold">
                                <td className="px-3 py-2" colSpan={2}>Tổng</td>
                                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(opex.items.filter((k) => k.tu_thang <= thisMonth && (!k.den_thang || k.den_thang >= thisMonth)).reduce((s, k) => s + k.so_tien_thang_vnd, 0))}<span className="block text-[11px] font-normal text-muted-foreground">tháng này</span></td>
                                <td colSpan={2} />
                                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(data.tong.van_hanh)}</td>
                                <td />
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}
        </section>
    );
}
