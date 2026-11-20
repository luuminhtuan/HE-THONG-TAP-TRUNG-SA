"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    AlertCircle, CheckCircle2, Clock, Crosshair, Loader2, LocateFixed, MapPin, Plus, RefreshCw, Save, ShieldCheck,
    Trash2, Wifi, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
    describeRule, distanceMeters, evaluatePunch, fmtDistance, ipInCidr, parseSettings,
    type AttendanceDefaults, type AttendanceSettings, type PunchCheck,
} from "@/lib/talpha/attendance-rules";
import MiniMap from "@/components/ui/mini-map";
import { getCurrentPosition, type GeoFix } from "@/components/talpha/tabs/attendance/geolocation";

// /admin → Chấm công (20/11/2026): giám đốc khai nơi được chấm công — mạng văn phòng (IP) và điểm văn phòng (toạ độ +
// bán kính) — cùng giờ làm. Nút "IP hiện tại" / "Vị trí hiện tại" lấy thẳng IP máy chủ thấy và toạ độ GPS của máy đang
// mở trang — đứng ở văn phòng bấm là xong, khỏi tra ở trang ngoài. "Kiểm tra ngay" soát cấu hình ĐANG SỬA (chưa lưu)
// với IP + vị trí lúc này. Lưu ở bảng attendance_settings (migration 0008); route /api/talpha/attendance/settings.

type NetworkForm = { name: string; cidr: string };
type LocationForm = { name: string; lat: string; lng: string; radius_m: string };
type Form = {
    check_ip: boolean; check_location: boolean; match: "any" | "all";
    networks: NetworkForm[]; locations: LocationForm[];
    max_accuracy_m: string; shift_start: string; shift_end: string; grace_minutes: string; workdays: number[];
};
type SettingsData = {
    settings: AttendanceSettings; defaults: AttendanceDefaults; saved: boolean;
    updated_by: string | null; updated_at: string | null; ip: string | null; rule_text: string;
};

const DAYS = [1, 2, 3, 4, 5, 6, 7];
const dayLabel = (d: number) => (d === 7 ? "CN" : `T${d + 1}`);
const toForm = (s: AttendanceSettings): Form => ({
    check_ip: s.check_ip, check_location: s.check_location, match: s.match,
    networks: s.networks.map((n) => ({ ...n })),
    locations: s.locations.map((l) => ({ name: l.name, lat: String(l.lat), lng: String(l.lng), radius_m: String(l.radius_m) })),
    max_accuracy_m: String(s.max_accuracy_m), shift_start: s.shift_start, shift_end: s.shift_end,
    grace_minutes: String(s.grace_minutes), workdays: [...s.workdays],
});
const INPUT = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-indigo-500 focus:outline-none";
const BTN = "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50";

export default function AttendanceSettingsTab() {
    const [data, setData] = useState<SettingsData | null>(null);
    const [form, setForm] = useState<Form | null>(null);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [saveErrors, setSaveErrors] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);
    const [ip, setIp] = useState<string | null>(null);
    const [ipLoading, setIpLoading] = useState(false);
    const [geo, setGeo] = useState<GeoFix | null>(null);
    const [geoLoading, setGeoLoading] = useState(false);
    const [geoError, setGeoError] = useState("");
    const [active, setActive] = useState(0);              // điểm văn phòng đang chỉnh trên bản đồ
    const [fitKey, setFitKey] = useState(0);
    const [test, setTest] = useState<{ check: PunchCheck; errors: string[] } | null>(null);
    const [testing, setTesting] = useState(false);

    const load = useCallback(async () => {
        try {
            const r = await fetch("/api/talpha/attendance/settings", { cache: "no-store" });
            const j = await r.json();
            if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
            setData(j);
            setForm(toForm(j.settings));
            setIp(j.ip);
            setError("");
        } catch (e) {
            setError(e instanceof Error ? e.message : "Không tải được cấu hình chấm công");
        }
    }, []);
    useEffect(() => { load(); }, [load]);

    const parsed = useMemo(() => (form && data ? parseSettings(form, data.defaults) : null), [form, data]);
    const set = (patch: Partial<Form>) => { setForm((f) => (f ? { ...f, ...patch } : f)); setTest(null); setNotice(""); };

    const refreshIp = async (): Promise<string | null> => {
        setIpLoading(true);
        try {
            const r = await fetch("/api/talpha/attendance", {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "check" }),
            });
            const j = await r.json();
            if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
            setIp(j.check.ip);
            return j.check.ip;
        } catch (e) {
            setError(e instanceof Error ? e.message : "Không lấy được IP");
            return null;
        } finally {
            setIpLoading(false);
        }
    };

    const locate = async (): Promise<GeoFix | null> => {
        setGeoLoading(true);
        setGeoError("");
        try {
            const g = await getCurrentPosition();
            setGeo(g);
            setFitKey((k) => k + 1);
            return g;
        } catch (e) {
            setGeoError(e instanceof Error ? e.message : String(e));
            return null;
        } finally {
            setGeoLoading(false);
        }
    };

    const addCurrentIp = async () => {
        if (!form) return;
        const cur = (await refreshIp()) || ip;
        if (!cur) return;
        if (form.networks.some((n) => ipInCidr(cur, n.cidr))) { setNotice(`IP ${cur} đã nằm trong danh sách.`); return; }
        set({ networks: [...form.networks, { name: form.networks.length ? `Mạng ${form.networks.length + 1}` : "Wi-Fi văn phòng", cidr: cur }] });
    };

    const addLocationHere = async () => {
        if (!form) return;
        const g = (await locate()) || geo;
        if (!g) return;
        const radius = String(data?.defaults.default_radius_m ?? 150);
        set({ locations: [...form.locations, { name: form.locations.length ? `Điểm ${form.locations.length + 1}` : "Văn phòng", lat: g.lat.toFixed(6), lng: g.lng.toFixed(6), radius_m: radius }] });
        setActive(form.locations.length);
    };

    const setLocation = (i: number, patch: Partial<LocationForm>) => {
        if (!form) return;
        set({ locations: form.locations.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
    };

    // Điểm đang chỉnh so với chỗ đang đứng — "Lấy vị trí của tôi" chỉ ĐỌC vị trí, không tự dời điểm văn phòng (đứng ở
    // nhà bấm thử là dời mất điểm đúng); nên báo rõ khoảng cách + nút dời ngay cạnh.
    const activeLoc = form?.locations[active];
    const activeLat = Number(activeLoc?.lat), activeLng = Number(activeLoc?.lng), activeRadius = Number(activeLoc?.radius_m);
    const activeDistance = geo && activeLoc && Number.isFinite(activeLat) && Number.isFinite(activeLng) && activeLoc.lat !== "" && activeLoc.lng !== ""
        ? distanceMeters(geo, { lat: activeLat, lng: activeLng }) : null;
    const activeName = activeLoc?.name || `điểm ${active + 1}`;
    const moveActiveHere = () => {
        if (!geo || !activeLoc) return;
        setLocation(active, { lat: geo.lat.toFixed(6), lng: geo.lng.toFixed(6) });
        setFitKey((k) => k + 1);
        setNotice(`Đã dời "${activeName}" về chỗ bạn đứng — bấm Kiểm tra ngay rồi Lưu cấu hình.`);
    };

    const runTest = async () => {
        if (!form || !data) return;
        setTesting(true);
        try {
            const [curIp, g] = await Promise.all([refreshIp(), form.check_location || form.locations.length ? locate() : Promise.resolve(geo)]);
            const p = parseSettings(form, data.defaults);
            setTest({ check: evaluatePunch(p.settings, curIp, g), errors: p.errors });
        } finally {
            setTesting(false);
        }
    };

    const save = async () => {
        if (!form) return;
        setSaving(true);
        setSaveErrors([]);
        setNotice("");
        try {
            const r = await fetch("/api/talpha/attendance/settings", {
                method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings: form }),
            });
            const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
            if (!r.ok) { setSaveErrors(j.errors || [j.error || `HTTP ${r.status}`]); return; }
            setData(j);
            setForm(toForm(j.settings));
            setNotice("Đã lưu — áp dụng ngay cho lần chấm kế tiếp.");
        } catch {
            setSaveErrors(["Không gửi được — kiểm mạng rồi thử lại"]);
        } finally {
            setSaving(false);
        }
    };

    if (!form || !data) {
        return error
            ? <Banner tone="error">{error}</Banner>
            : <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-indigo-500" /></div>;
    }

    const mapCircles = (parsed?.settings.locations || []).map((l, i) => ({
        lat: l.lat, lng: l.lng, radius_m: l.radius_m, color: i === active ? "#6366f1" : "#94a3b8",
    }));
    const dirty = JSON.stringify(parsed?.settings) !== JSON.stringify(data.settings);

    return (
        <div className="max-w-4xl space-y-5">
            <div>
                <h2 className="text-lg font-bold text-foreground">Chấm công</h2>
                <p className="text-sm text-muted-foreground">
                    Mỗi người đăng nhập tự chấm vào / chấm ra ở mục 🕒 Chấm công. Khai ở đây nơi được chấm: mạng văn phòng (IP) và / hoặc
                    điểm văn phòng (vị trí GPS). Đứng ở văn phòng mở trang này: bấm &ldquo;Thêm IP hiện tại&rdquo;, &ldquo;Lấy vị trí của tôi&rdquo; rồi &ldquo;Dời … về chỗ tôi đứng&rdquo; — máy tự điền IP và toạ độ.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                    Đang áp dụng: <strong className="text-foreground">{data.rule_text}</strong>
                    {data.saved && data.updated_at
                        ? ` · lưu ${new Date(data.updated_at).toLocaleString("vi-VN", { timeZone: data.settings.timezone })}${data.updated_by ? ` bởi ${data.updated_by}` : ""}`
                        : " · chưa lưu cấu hình (đang dùng mặc định)"}
                </p>
            </div>

            {error && <Banner tone="error">{error}</Banner>}

            {/* Cách soát */}
            <Card title="Cách soát" icon={<ShieldCheck className="h-4 w-4 text-indigo-500" />}>
                <div className="grid gap-2 sm:grid-cols-2">
                    <Toggle on={form.check_ip} onChange={(v) => set({ check_ip: v })} title="Soát IP mạng văn phòng"
                        hint="Máy chủ tự thấy IP — khó giả. Cần nối Wi-Fi / mạng dây văn phòng." />
                    <Toggle on={form.check_location} onChange={(v) => set({ check_location: v })} title="Soát vị trí GPS"
                        hint="Trình duyệt gửi toạ độ, phải ở trong bán kính một điểm văn phòng. Người chấm phải cho phép Vị trí." />
                </div>
                {form.check_ip && form.check_location && (
                    <div className="mt-3 flex flex-wrap gap-2 text-sm">
                        {([["any", "Đạt MỘT trong hai là được"], ["all", "Phải đạt CẢ HAI"]] as const).map(([v, label]) => (
                            <button key={v} type="button" onClick={() => set({ match: v })}
                                className={cn("rounded-lg border px-3 py-1.5", form.match === v
                                    ? "border-indigo-500 bg-indigo-50 font-semibold text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
                                    : "border-border text-muted-foreground hover:bg-muted")}>
                                {label}
                            </button>
                        ))}
                    </div>
                )}
                <p className="mt-2 text-xs text-muted-foreground">Sau khi lưu: <strong className="text-foreground">{describeRule(form)}</strong></p>
            </Card>

            {/* Mạng văn phòng */}
            <Card title="Mạng văn phòng (IP)" icon={<Wifi className="h-4 w-4 text-indigo-500" />}>
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">IP của bạn lúc này:</span>
                    <strong className="font-mono text-foreground">{ip || "không đọc được"}</strong>
                    <button type="button" className={BTN} onClick={refreshIp} disabled={ipLoading}>
                        <RefreshCw className={cn("h-3 w-3", ipLoading && "animate-spin")} /> Kiểm tra lại
                    </button>
                    <button type="button" className={cn(BTN, "border-indigo-300 text-indigo-700 dark:border-indigo-500/40 dark:text-indigo-300")} onClick={addCurrentIp} disabled={ipLoading}>
                        <Plus className="h-3 w-3" /> Thêm IP hiện tại
                    </button>
                </div>
                <div className="mt-3 space-y-2">
                    {form.networks.map((n, i) => {
                        const matches = !!ip && ipInCidr(ip, n.cidr);
                        return (
                            <div key={i} className="flex flex-wrap items-center gap-2">
                                <input className={cn(INPUT, "w-44 flex-none")} value={n.name} placeholder="Tên (vd Wi-Fi tầng 3)"
                                    onChange={(e) => set({ networks: form.networks.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                                <input className={cn(INPUT, "min-w-[180px] flex-1 font-mono")} value={n.cidr} placeholder="113.161.1.20 hoặc 113.161.1.0/24"
                                    onChange={(e) => set({ networks: form.networks.map((x, j) => (j === i ? { ...x, cidr: e.target.value } : x)) })} />
                                {matches && <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> IP bạn khớp</span>}
                                <button type="button" onClick={() => set({ networks: form.networks.filter((_, j) => j !== i) })}
                                    className="rounded-md p-2 text-muted-foreground hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10" aria-label="Xoá mạng">
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            </div>
                        );
                    })}
                    <button type="button" className={BTN} onClick={() => set({ networks: [...form.networks, { name: "", cidr: "" }] })}>
                        <Plus className="h-3 w-3" /> Thêm dòng trống
                    </button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                    Đây là IP CÔNG CỘNG của mạng (mọi máy nối cùng Wi-Fi văn phòng ra ngoài bằng một IP). Nhà mạng đổi IP thì thêm lại;
                    IP hay đổi trong một dải thì khai cả dải (vd 113.161.1.0/24). Điện thoại dùng 4G không đi qua mạng văn phòng.
                </p>
            </Card>

            {/* Điểm văn phòng */}
            <Card title="Điểm văn phòng (vị trí)" icon={<MapPin className="h-4 w-4 text-indigo-500" />}>
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">Vị trí của bạn:</span>
                    {geo
                        ? <strong className="font-mono text-foreground">{geo.lat.toFixed(6)}, {geo.lng.toFixed(6)} <span className="font-sans font-normal text-muted-foreground">(sai số ±{geo.accuracy_m} m)</span></strong>
                        : <span className="text-muted-foreground">{geoLoading ? "đang lấy…" : "chưa lấy"}</span>}
                    <button type="button" className={BTN} onClick={locate} disabled={geoLoading}>
                        {geoLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <LocateFixed className="h-3 w-3" />} Lấy vị trí của tôi
                    </button>
                    <button type="button" className={cn(BTN, "border-indigo-300 text-indigo-700 dark:border-indigo-500/40 dark:text-indigo-300")} onClick={addLocationHere} disabled={geoLoading}>
                        <Plus className="h-3 w-3" /> Thêm điểm mới ở chỗ tôi đứng
                    </button>
                </div>
                {geoError && <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{geoError}</p>}
                {activeDistance !== null && Number.isFinite(activeRadius) && (activeDistance > activeRadius ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        <span>Bạn đang cách <strong>{activeName}</strong> {fmtDistance(activeDistance)} — điểm này chưa phải chỗ bạn đứng (lấy vị trí KHÔNG tự dời điểm).</span>
                        <button type="button" onClick={moveActiveHere}
                            className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-700">
                            <Crosshair className="h-3 w-3" /> Dời &ldquo;{activeName}&rdquo; về chỗ tôi đứng
                        </button>
                    </div>
                ) : (
                    <p className="mt-2 flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 className="h-4 w-4" /> Bạn đang trong bán kính <strong>{activeName}</strong> (cách {fmtDistance(activeDistance)}).
                    </p>
                ))}
                {geo && geo.accuracy_m > 100 && (
                    <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                        Sai số lớn (±{geo.accuracy_m} m) — máy tính không có GPS đoán vị trí theo Wi-Fi. Lấy bằng điện thoại, hoặc chấm lại
                        điểm trên bản đồ cho đúng toà nhà.
                    </p>
                )}

                <div className="mt-3 space-y-2">
                    {form.locations.map((l, i) => (
                        <div key={i} className={cn("rounded-lg border p-2.5", i === active ? "border-indigo-400 bg-indigo-50/50 dark:border-indigo-500/40 dark:bg-indigo-500/5" : "border-border")}>
                            <div className="flex flex-wrap items-center gap-2">
                                <button type="button" onClick={() => { setActive(i); setFitKey((k) => k + 1); }}
                                    className={cn("rounded-md px-2 py-1 text-xs font-medium", i === active ? "bg-indigo-600 text-white" : "border border-border text-muted-foreground hover:bg-muted")}>
                                    {i === active ? "Đang chỉnh" : "Chỉnh"}
                                </button>
                                <input className={cn(INPUT, "w-40 flex-none")} value={l.name} placeholder="Tên điểm" onChange={(e) => setLocation(i, { name: e.target.value })} />
                                <input className={cn(INPUT, "w-32 flex-none font-mono")} value={l.lat} placeholder="Vĩ độ" inputMode="decimal" onChange={(e) => setLocation(i, { lat: e.target.value })} />
                                <input className={cn(INPUT, "w-32 flex-none font-mono")} value={l.lng} placeholder="Kinh độ" inputMode="decimal" onChange={(e) => setLocation(i, { lng: e.target.value })} />
                                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                    Bán kính
                                    <input className={cn(INPUT, "w-20 flex-none")} value={l.radius_m} inputMode="numeric" onChange={(e) => setLocation(i, { radius_m: e.target.value })} />
                                    m
                                </label>
                                <button type="button" className={BTN} disabled={geoLoading || !geo} title={geo ? "" : "Bấm Lấy vị trí của tôi trước"}
                                    onClick={() => geo && setLocation(i, { lat: geo.lat.toFixed(6), lng: geo.lng.toFixed(6) })}>
                                    <Crosshair className="h-3 w-3" /> Dời về chỗ tôi đứng
                                </button>
                                <button type="button" onClick={() => { set({ locations: form.locations.filter((_, j) => j !== i) }); setActive(0); }}
                                    className="ml-auto rounded-md p-2 text-muted-foreground hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10" aria-label="Xoá điểm">
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="mt-3">
                    <MiniMap
                        height={300}
                        circles={mapCircles}
                        points={geo ? [{ lat: geo.lat, lng: geo.lng, accuracy_m: geo.accuracy_m, color: "#0ea5e9" }] : []}
                        fitKey={fitKey}
                        onPick={form.locations[active] ? (lat, lng) => setLocation(active, { lat: String(lat), lng: String(lng) }) : undefined}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                        {form.locations[active]
                            ? <>Bấm lên bản đồ để dời <strong className="text-foreground">{form.locations[active].name || `điểm ${active + 1}`}</strong> tới chỗ bấm; kéo để xem chỗ khác. </>
                            : "Chưa có điểm nào — bấm “Thêm điểm mới ở chỗ tôi đứng”. "}
                        Chấm xanh: bạn đang ở đây.
                    </p>
                </div>
                <label className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    Không tính vị trí khi GPS báo sai số quá
                    <input className={cn(INPUT, "w-24")} value={form.max_accuracy_m} inputMode="numeric" onChange={(e) => set({ max_accuracy_m: e.target.value })} />
                    m
                </label>
            </Card>

            {/* Giờ làm — TẠM TẮT (20/11/2026): talpha_rules.json → attendance.schedule_enabled = false thì không tính đi muộn /
                về sớm / vắng và ẩn khung này. Giờ đã lưu vẫn nằm trong form (gửi lại nguyên khi Lưu) để bật lại không mất. */}
            {data.settings.schedule_enabled && <Card title="Giờ làm" icon={<Clock className="h-4 w-4 text-indigo-500" />}>
                <div className="flex flex-wrap items-end gap-3">
                    <label className="space-y-1 text-xs text-muted-foreground">
                        <span className="block">Giờ vào</span>
                        <input type="time" className={cn(INPUT, "w-32")} value={form.shift_start} onChange={(e) => set({ shift_start: e.target.value })} />
                    </label>
                    <label className="space-y-1 text-xs text-muted-foreground">
                        <span className="block">Giờ ra</span>
                        <input type="time" className={cn(INPUT, "w-32")} value={form.shift_end} onChange={(e) => set({ shift_end: e.target.value })} />
                    </label>
                    <label className="space-y-1 text-xs text-muted-foreground">
                        <span className="block">Trễ bao nhiêu phút chưa tính muộn</span>
                        <input className={cn(INPUT, "w-24")} value={form.grace_minutes} inputMode="numeric" onChange={(e) => set({ grace_minutes: e.target.value })} />
                    </label>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-sm">
                    <span className="mr-1 text-xs text-muted-foreground">Ngày làm việc:</span>
                    {DAYS.map((d) => {
                        const on = form.workdays.includes(d);
                        return (
                            <button key={d} type="button"
                                onClick={() => set({ workdays: on ? form.workdays.filter((x) => x !== d) : [...form.workdays, d].sort((a, b) => a - b) })}
                                className={cn("h-8 w-10 rounded-lg border text-xs font-semibold", on
                                    ? "border-indigo-500 bg-indigo-600 text-white"
                                    : "border-border text-muted-foreground hover:bg-muted")}>
                                {dayLabel(d)}
                            </button>
                        );
                    })}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Múi giờ tính ngày công: {data.settings.timezone} (talpha_rules.json → attendance).</p>
            </Card>}

            {/* Kiểm tra + lưu */}
            <Card title="Kiểm tra ngay" icon={<CheckCircle2 className="h-4 w-4 text-indigo-500" />}>
                <p className="text-sm text-muted-foreground">
                    Soát cấu hình ĐANG SỬA (chưa cần lưu) với IP và vị trí của máy bạn lúc này — đứng ở văn phòng bấm thử, phải ra &ldquo;Chấm được&rdquo;.
                </p>
                <button type="button" onClick={runTest} disabled={testing}
                    className="mt-3 inline-flex items-center gap-2 rounded-lg border border-indigo-300 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-60 dark:border-indigo-500/40 dark:text-indigo-300 dark:hover:bg-indigo-500/10">
                    {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Kiểm tra với IP + vị trí hiện tại
                </button>
                {test && (
                    <div className="mt-3 space-y-1 rounded-lg border border-border p-3 text-sm">
                        {test.errors.length > 0 && <p className="text-amber-600 dark:text-amber-400">Cấu hình còn lỗi (xem dưới) — kết quả tính theo phần hợp lệ.</p>}
                        <TestLine label="IP" on={form.check_ip} ok={test.check.ip_ok}
                            text={`${test.check.ip ?? "không đọc được"}${test.check.network_name ? ` · khớp ${test.check.network_name}` : form.networks.length ? " · không khớp mạng nào" : ""}`} />
                        <TestLine label="Vị trí" on={form.check_location} ok={test.check.location_ok}
                            text={geoError && !geo ? geoError
                                : test.check.location_name ? `cách ${test.check.location_name} ${fmtDistance(test.check.distance_m ?? 0)}${test.check.accuracy_m ? ` (±${test.check.accuracy_m} m)` : ""}`
                                : geo ? "chưa có điểm văn phòng" : "chưa có vị trí"} />
                        <p className={cn("flex items-center gap-1.5 pt-1 font-semibold", test.check.allowed ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                            {test.check.allowed ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                            {test.check.allowed ? "Chấm được ở chỗ bạn đang đứng" : `Không chấm được: ${test.check.problems.join(" · ")}`}
                        </p>
                        {test.check.location_ok === false && geo && activeLoc && activeDistance !== null && activeDistance > activeRadius && (
                            <p className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
                                Đang đứng ở văn phòng mà vẫn báo xa? Điểm văn phòng chưa đặt đúng chỗ.
                                <button type="button" onClick={moveActiveHere}
                                    className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-700">
                                    <Crosshair className="h-3 w-3" /> Dời &ldquo;{activeName}&rdquo; về chỗ tôi đứng
                                </button>
                            </p>
                        )}
                    </div>
                )}
            </Card>

            {saveErrors.length > 0 && (
                <Banner tone="error">
                    <ul className="list-disc space-y-0.5 pl-4">{saveErrors.map((e) => <li key={e}>{e}</li>)}</ul>
                </Banner>
            )}
            {!saveErrors.length && parsed && parsed.errors.length > 0 && (
                <Banner tone="warn">
                    <ul className="list-disc space-y-0.5 pl-4">{parsed.errors.map((e) => <li key={e}>{e}</li>)}</ul>
                </Banner>
            )}
            {notice && <Banner tone="ok">{notice}</Banner>}

            <div className="sticky bottom-0 flex items-center gap-3 border-t border-border bg-background/90 py-3 backdrop-blur">
                <button type="button" onClick={save} disabled={saving || !dirty}
                    className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 hover:bg-indigo-700 disabled:opacity-50">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Lưu cấu hình
                </button>
                {dirty
                    ? <button type="button" onClick={() => { setForm(toForm(data.settings)); setSaveErrors([]); setTest(null); }} className="text-sm text-muted-foreground hover:text-foreground">Bỏ thay đổi</button>
                    : <span className="text-xs text-muted-foreground">Chưa có thay đổi</span>}
            </div>
        </div>
    );
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
    return (
        <section className="rounded-xl border border-border bg-card p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">{icon}{title}</h3>
            {children}
        </section>
    );
}

function Toggle({ on, onChange, title, hint }: { on: boolean; onChange: (v: boolean) => void; title: string; hint: string }) {
    return (
        <button type="button" onClick={() => onChange(!on)}
            className={cn("flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                on ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10" : "border-border hover:bg-muted")}>
            <span className={cn("mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors", on ? "bg-indigo-600" : "bg-slate-300 dark:bg-slate-600")}>
                <span className={cn("h-4 w-4 rounded-full bg-white shadow transition-transform", on && "translate-x-4")} />
            </span>
            <span>
                <span className="block text-sm font-semibold text-foreground">{title}</span>
                <span className="block text-xs text-muted-foreground">{hint}</span>
            </span>
        </button>
    );
}

function TestLine({ label, on, ok, text }: { label: string; on: boolean; ok: boolean | null; text: string }) {
    return (
        <p className="flex flex-wrap items-center gap-1.5">
            <span className="w-14 text-muted-foreground">{label}</span>
            <span className="font-mono text-foreground">{text}</span>
            {!on ? <span className="text-xs text-muted-foreground">(không soát)</span>
                : ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    : <XCircle className="h-4 w-4 text-rose-600 dark:text-rose-400" />}
        </p>
    );
}

function Banner({ tone, children }: { tone: "ok" | "warn" | "error"; children: React.ReactNode }) {
    return (
        <div className={cn("flex items-start gap-2 rounded-xl border px-4 py-3 text-sm",
            tone === "ok" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
            tone === "warn" && "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
            tone === "error" && "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300")}>
            {tone === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
            <div className="min-w-0">{children}</div>
        </div>
    );
}
