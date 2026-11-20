"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, LogIn, LogOut, MapPin, RefreshCw, Wifi, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDistance, localParts } from "@/lib/talpha/attendance-rules";
import MiniMap from "@/components/ui/mini-map";
import { getCurrentPosition, type GeoFix } from "./geolocation";
import { STATUS, fmtDateLong, fmtDuration, hhmm, postAttendance, type AttendanceData, type PunchCheck, type PunchRow } from "./types";

// Khung chấm vào / chấm ra của CHÍNH người đang đăng nhập (tab Chấm công). Mở tab là soát ngay IP + vị trí (vị trí chỉ
// hỏi khi cấu hình có soát vị trí — đỡ bắt mọi người cấp quyền vô ích); bấm chấm thì lấy vị trí MỚI rồi máy chủ soát lại.
// Vào / ra XEN KẼ (20/11/2026): đang trong ca thì nút là "Chấm ra", không thì "Chấm vào" — một ngày bao nhiêu ca cũng được.
export default function PunchCard({ data, onPunched }: { data: AttendanceData; onPunched: () => void }) {
    const tz = data.timezone;
    const s = data.settings;
    const today = data.my_today?.summary;
    const [now, setNow] = useState(() => Date.now());
    const clock = localParts(now, tz).hhmm;
    const [geo, setGeo] = useState<GeoFix | null>(null);
    const [geoError, setGeoError] = useState("");
    const [check, setCheck] = useState<PunchCheck | null>(null);
    const [checking, setChecking] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
    const needGeo = s.check_location;

    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 10_000);
        return () => clearInterval(t);
    }, []);

    const locate = useCallback(async (): Promise<GeoFix | null> => {
        if (!needGeo) return null;
        try {
            const g = await getCurrentPosition();
            setGeo(g);
            setGeoError("");
            return g;
        } catch (e) {
            setGeo(null);
            setGeoError(e instanceof Error ? e.message : String(e));
            return null;
        }
    }, [needGeo]);

    const runCheck = useCallback(async () => {
        setChecking(true);
        try {
            const g = await locate();
            const r = await postAttendance<{ check: PunchCheck }>({ action: "check", geo: g });
            if (r.error) setMessage({ ok: false, text: r.error });
            else setCheck(r.check);
        } catch {
            setMessage({ ok: false, text: "Không gửi được — kiểm mạng rồi thử lại" });
        } finally {
            setChecking(false);
        }
    }, [locate]);

    useEffect(() => { if (data.me) runCheck(); }, [data.me, runCheck]);

    const punch = async (kind: "in" | "out") => {
        setBusy(true);
        setMessage(null);
        try {
            const g = await locate();
            const r = await postAttendance<{ punch: PunchRow; check: PunchCheck }>({ action: "punch", kind, geo: g });
            if (r.check) setCheck(r.check);
            if (r.error) { setMessage({ ok: false, text: r.error }); return; }
            setMessage({ ok: true, text: `Đã chấm ${kind === "in" ? "vào" : "ra"} lúc ${hhmm(r.punch.at, tz)}` });
            onPunched();
        } catch {
            setMessage({ ok: false, text: "Không gửi được — kiểm mạng rồi thử lại" });
        } finally {
            setBusy(false);
        }
    };

    if (!data.me) {
        return (
            <section className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
                Đăng nhập bằng tài khoản của bạn để chấm công.
            </section>
        );
    }

    const open = !!today?.open;
    const sessions = today?.sessions || [];
    // Giờ đã làm hôm nay: các ca đã đóng + ca đang mở tính tới bây giờ.
    const workedNow = (today?.worked_minutes || 0)
        + (open && today?.open_since ? Math.max(0, Math.round((now - Date.parse(today.open_since)) / 60000)) : 0);
    const st = today ? STATUS[today.status] : null;
    const showMap = s.locations.length > 0 && (needGeo || !!geo);

    return (
        <section className="rounded-xl border border-border bg-card p-4 shadow-sm md:p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <p className="text-xs text-muted-foreground">{fmtDateLong(data.today)}</p>
                    <p className="text-4xl font-bold tabular-nums text-foreground">{clock}</p>
                    {s.schedule_enabled && (
                        <p className="mt-1 text-xs text-muted-foreground">
                            Ca làm {s.shift_start} – {s.shift_end}
                            {s.grace_minutes > 0 && <> · trễ dưới {s.grace_minutes} phút chưa tính muộn</>}
                        </p>
                    )}
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                    <div className="rounded-lg bg-muted/50 px-4 py-2">
                        <p className="text-[11px] text-muted-foreground">Giờ vào</p>
                        <p className="text-xl font-semibold tabular-nums text-foreground">{today?.in_hhmm || "—"}</p>
                        {!!today?.late_minutes && <p className="text-[11px] text-amber-600 dark:text-amber-400">muộn {today.late_minutes} phút</p>}
                    </div>
                    <div className="rounded-lg bg-muted/50 px-4 py-2">
                        <p className="text-[11px] text-muted-foreground">Giờ ra</p>
                        <p className="text-xl font-semibold tabular-nums text-foreground">{today?.out_hhmm || "—"}</p>
                        {!!today?.early_minutes && <p className="text-[11px] text-amber-600 dark:text-amber-400">sớm {today.early_minutes} phút</p>}
                    </div>
                    <div className="rounded-lg bg-muted/50 px-4 py-2">
                        <p className="text-[11px] text-muted-foreground">Đã làm</p>
                        <p className="text-xl font-semibold tabular-nums text-foreground">{workedNow ? fmtDuration(workedNow) : "—"}</p>
                        {open && <p className="text-[11px] text-sky-600 dark:text-sky-400">đang trong ca</p>}
                    </div>
                </div>
            </div>

            {/* Soát nơi chấm */}
            <div className="mt-4 space-y-1.5 rounded-lg border border-border bg-background/60 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-muted-foreground">{data.rule_text}</p>
                    <button type="button" onClick={runCheck} disabled={checking || busy}
                        className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50">
                        <RefreshCw className={cn("h-3 w-3", checking && "animate-spin")} /> Kiểm tra lại
                    </button>
                </div>
                {checking && !check && (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Đang kiểm tra mạng{needGeo ? " và vị trí" : ""}…</p>
                )}
                {check && (
                    <>
                        <CheckLine
                            icon={<Wifi className="h-4 w-4" />}
                            state={s.check_ip ? check.ip_ok : null}
                            text={s.check_ip
                                ? check.ip_ok ? `Đang nối mạng văn phòng${check.network_name ? ` (${check.network_name})` : ""} · IP ${check.ip}` : `IP ${check.ip ?? "?"} — không phải mạng văn phòng`
                                : `IP ${check.ip ?? "?"}${check.network_name ? ` · ${check.network_name}` : ""}`}
                        />
                        {(needGeo || geo) && (
                            <CheckLine
                                icon={<MapPin className="h-4 w-4" />}
                                state={needGeo ? check.location_ok : null}
                                text={geoError
                                    ? geoError
                                    : check.location_ok
                                        ? `Trong bán kính ${check.location_name} — cách ${fmtDistance(check.distance_m ?? 0)}${check.accuracy_m ? ` (sai số ±${check.accuracy_m} m)` : ""}`
                                        : check.location_name && check.distance_m !== null
                                            ? `Cách ${check.location_name} ${fmtDistance(check.distance_m)}${check.accuracy_m ? ` (sai số ±${check.accuracy_m} m)` : ""}`
                                            : check.problems.find((p) => /vị trí|văn phòng nào/i.test(p)) || "Chưa có vị trí"}
                            />
                        )}
                        <p className={cn("flex items-center gap-1.5 pt-1 text-xs font-semibold",
                            check.allowed ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                            {check.allowed ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                            {check.allowed ? "Đủ điều kiện chấm công" : "Chưa đủ điều kiện chấm công"}
                        </p>
                    </>
                )}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
                {!open ? (
                    <button type="button" onClick={() => punch("in")} disabled={busy}
                        className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-base font-semibold text-white shadow-lg shadow-emerald-600/20 transition-colors hover:bg-emerald-700 disabled:opacity-60">
                        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogIn className="h-5 w-5" />} Chấm vào{sessions.length ? ` (ca ${sessions.length + 1})` : ""}
                    </button>
                ) : (
                    <button type="button" onClick={() => punch("out")} disabled={busy}
                        className="inline-flex items-center gap-2 rounded-xl bg-orange-600 px-6 py-3 text-base font-semibold text-white shadow-lg shadow-orange-600/20 transition-colors hover:bg-orange-700 disabled:opacity-60">
                        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogOut className="h-5 w-5" />} Chấm ra
                    </button>
                )}
                {st?.label && <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", st.badge)}>{st.label}</span>}
                {sessions.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                        Ca hôm nay: {sessions.map((x) => `${x.in_hhmm || "?"}–${x.out_hhmm || "đang làm"}`).join(" · ")}
                    </span>
                )}
            </div>

            {message && (
                <div className={cn("mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-sm",
                    message.ok
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                        : "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300")}>
                    {message.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
                    {message.text}
                </div>
            )}

            {showMap && (
                <div className="mt-4">
                    <MiniMap
                        height={200}
                        circles={s.locations.map((l) => ({ lat: l.lat, lng: l.lng, radius_m: l.radius_m }))}
                        points={geo ? [{ lat: geo.lat, lng: geo.lng, accuracy_m: geo.accuracy_m, color: check?.location_ok ? "#10b981" : "#f43f5e" }] : []}
                        fitKey={geo ? `${geo.lat.toFixed(4)},${geo.lng.toFixed(4)}` : "none"}
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground">
                        Vòng tím: {s.locations.map((l) => `${l.name} (${l.radius_m} m)`).join(" · ")}{geo ? " · Chấm tròn: bạn đang ở đây" : ""}
                    </p>
                </div>
            )}
        </section>
    );
}

function CheckLine({ icon, state, text }: { icon: React.ReactNode; state: boolean | null; text: string }) {
    return (
        <p className={cn("flex items-start gap-2 text-sm",
            state === true ? "text-emerald-700 dark:text-emerald-300"
                : state === false ? "text-rose-700 dark:text-rose-300" : "text-muted-foreground")}>
            <span className="mt-0.5 shrink-0">{icon}</span>
            <span className="min-w-0 break-words">{text}</span>
            {state === true && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
            {state === false && <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
        </p>
    );
}
