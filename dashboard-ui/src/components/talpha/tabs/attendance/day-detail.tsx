"use client";

import { useState } from "react";
import { Ban, CheckCircle2, Loader2, LogIn, LogOut, MapPin, PenLine, Plus, Wifi, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDistance } from "@/lib/talpha/attendance-rules";
import { STATUS, fmtDateLong, fmtDuration, hhmm, postAttendance, type DaySummary, type PunchRow } from "./types";

// Chi tiết một ngày: từng lần chấm kèm IP, mạng khớp, vị trí + khoảng cách — để soát lại. Giám đốc chấm bù (bắt buộc ghi
// lý do) và huỷ lần chấm sai (giữ dòng, ghi ai huỷ + lý do) ngay ở đây.
export default function DayDetail({ day, punches, tz, today, canManage, userId, onChanged }: {
    day: DaySummary; punches: PunchRow[]; tz: string; today: string; canManage: boolean; userId: string;
    onChanged: () => void;
}) {
    const st = STATUS[day.status];
    const [adding, setAdding] = useState(false);
    const [form, setForm] = useState({ kind: "in" as "in" | "out", time: "08:30", note: "" });
    const [voiding, setVoiding] = useState<number | null>(null);
    const [reason, setReason] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    const send = async (body: Record<string, unknown>, done: () => void) => {
        setBusy(true);
        setError("");
        try {
            const r = await postAttendance(body);
            if (r.error) { setError(r.error); return; }
            done();
            onChanged();
        } catch {
            setError("Không gửi được — kiểm mạng rồi thử lại");
        } finally {
            setBusy(false);
        }
    };

    const input = "rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground";
    return (
        <section className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-foreground">{fmtDateLong(day.date)}</h3>
                {st.label && <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", st.badge)}>{st.label}</span>}
                {!!day.late_minutes && <span className="text-xs text-amber-600 dark:text-amber-400">muộn {day.late_minutes} phút</span>}
                {!!day.early_minutes && <span className="text-xs text-amber-600 dark:text-amber-400">về sớm {day.early_minutes} phút</span>}
                {day.worked_minutes !== null && <span className="text-xs text-muted-foreground">· làm {fmtDuration(day.worked_minutes)}</span>}
                {day.sessions.length > 1 && (
                    <span className="text-xs text-muted-foreground">
                        · {day.sessions.length} ca: {day.sessions.map((x) => `${x.in_hhmm || "?"}–${x.out_hhmm || (day.open ? "đang làm" : "?")}`).join(", ")}
                    </span>
                )}
                {canManage && day.date <= today && !adding && (
                    <button type="button" onClick={() => { setAdding(true); setError(""); }}
                        className="ml-auto inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted">
                        <Plus className="h-3 w-3" /> Chấm bù
                    </button>
                )}
            </div>

            {adding && (
                <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-border p-3">
                    <label className="space-y-1 text-xs text-muted-foreground">
                        <span className="block">Loại</span>
                        <select className={input} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as "in" | "out" })}>
                            <option value="in">Giờ vào</option>
                            <option value="out">Giờ ra</option>
                        </select>
                    </label>
                    <label className="space-y-1 text-xs text-muted-foreground">
                        <span className="block">Giờ</span>
                        <input type="time" className={input} value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
                    </label>
                    <label className="min-w-[200px] flex-1 space-y-1 text-xs text-muted-foreground">
                        <span className="block">Lý do (bắt buộc)</span>
                        <input className={cn(input, "w-full")} placeholder="vd: quên chấm, điện thoại hết pin" value={form.note}
                            onChange={(e) => setForm({ ...form, note: e.target.value })} />
                    </label>
                    <button type="button" disabled={busy}
                        onClick={() => send({ action: "manual", user_id: userId, date: day.date, ...form }, () => { setAdding(false); setForm({ ...form, note: "" }); })}
                        className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PenLine className="h-3.5 w-3.5" />} Lưu
                    </button>
                    <button type="button" onClick={() => setAdding(false)} className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted">Thôi</button>
                </div>
            )}
            {error && <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}

            {punches.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">Không có lần chấm nào trong ngày.</p>
            ) : (
                <ul className="mt-3 divide-y divide-border">
                    {punches.map((p) => (
                        <li key={p.id} className={cn("flex flex-wrap items-start gap-x-3 gap-y-1 py-2.5 text-sm", p.voided && "opacity-60")}>
                            <span className={cn("inline-flex w-20 shrink-0 items-center gap-1.5 font-semibold",
                                p.kind === "in" ? "text-emerald-700 dark:text-emerald-400" : "text-orange-700 dark:text-orange-400",
                                p.voided && "line-through")}>
                                {p.kind === "in" ? <LogIn className="h-3.5 w-3.5" /> : <LogOut className="h-3.5 w-3.5" />}
                                {p.kind === "in" ? "Vào" : "Ra"}
                            </span>
                            <span className={cn("w-12 shrink-0 font-semibold tabular-nums text-foreground", p.voided && "line-through")}>{hhmm(p.at, tz)}</span>
                            <div className="min-w-0 flex-1 space-y-0.5 text-xs text-muted-foreground">
                                {p.source === "manual" ? (
                                    <p><span className="font-medium text-foreground">Chấm bù</span> bởi {p.created_by || "?"} — {p.note}</p>
                                ) : (
                                    <>
                                        <p className="flex flex-wrap items-center gap-x-1.5">
                                            <Wifi className="h-3 w-3" /> IP {p.ip || "?"}{p.network_name && <> · {p.network_name}</>}
                                            <OkMark v={p.ip_ok} />
                                        </p>
                                        {(p.lat !== null && p.lat !== undefined) ? (
                                            <p className="flex flex-wrap items-center gap-x-1.5">
                                                <MapPin className="h-3 w-3" />
                                                {p.location_name ? `${p.location_name} · cách ${fmtDistance(p.distance_m ?? 0)}` : `${p.lat?.toFixed(5)}, ${p.lng?.toFixed(5)}`}
                                                {p.accuracy_m ? ` (±${p.accuracy_m} m)` : ""}
                                                <OkMark v={p.location_ok} />
                                                <a className="text-indigo-600 hover:underline dark:text-indigo-400" target="_blank" rel="noreferrer"
                                                    href={`https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=18/${p.lat}/${p.lng}`}>
                                                    xem bản đồ
                                                </a>
                                            </p>
                                        ) : <p className="flex items-center gap-1.5"><MapPin className="h-3 w-3" /> không gửi vị trí</p>}
                                    </>
                                )}
                                {p.voided && <p className="text-rose-600 dark:text-rose-400">Đã huỷ bởi {p.voided_by || "?"}: {p.void_reason}</p>}
                            </div>
                            {canManage && !p.voided && (voiding === p.id ? (
                                <div className="flex w-full flex-wrap items-center gap-2 pl-[8.25rem]">
                                    <input className={cn(input, "min-w-[180px] flex-1")} placeholder="Lý do huỷ (bắt buộc)" value={reason}
                                        onChange={(e) => setReason(e.target.value)} autoFocus />
                                    <button type="button" disabled={busy}
                                        onClick={() => send({ action: "void", punch_id: p.id, reason }, () => { setVoiding(null); setReason(""); })}
                                        className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-60">
                                        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Ban className="h-3 w-3" />} Huỷ lần chấm
                                    </button>
                                    <button type="button" onClick={() => setVoiding(null)} className="rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted">Thôi</button>
                                </div>
                            ) : (
                                <button type="button" onClick={() => { setVoiding(p.id); setReason(""); setError(""); }}
                                    className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10">
                                    <Ban className="h-3 w-3" /> Huỷ
                                </button>
                            ))}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

function OkMark({ v }: { v: boolean | null | undefined }) {
    if (v === true) return <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />;
    if (v === false) return <XCircle className="h-3 w-3 text-rose-600 dark:text-rose-400" />;
    return null;
}
