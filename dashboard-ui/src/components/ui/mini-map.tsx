"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";

// Bản đồ nhỏ không cần thư viện (20/11/2026, chấm công): ghép ô ảnh OpenStreetMap theo phép chiếu Web Mercator, vẽ
// vòng bán kính + điểm bằng SVG đè lên. Kéo để dời, nút +/− để phóng, ⤢ để khớp lại mọi điểm. Có `onPick` thì bấm
// (không kéo) vào bản đồ trả toạ độ chỗ bấm — trang Quản trị dùng để chỉnh điểm văn phòng.

export type MapCircle = { lat: number; lng: number; radius_m: number; color?: string };
export type MapPoint = { lat: number; lng: number; accuracy_m?: number | null; color?: string };

const TILE = 256;
const MIN_Z = 3;
const MAX_Z = 19;
const DEFAULT_CENTER = { lat: 16.0, lng: 106.0 };   // giữa Việt Nam khi chưa có điểm nào

const world = (z: number) => TILE * 2 ** z;
function project(lat: number, lng: number, z: number) {
    const s = world(z);
    const sin = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
    return { x: ((lng + 180) / 360) * s, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s };
}
function unproject(x: number, y: number, z: number) {
    const s = world(z);
    const n = Math.PI - (2 * Math.PI * y) / s;
    return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lng: (x / s) * 360 - 180 };
}
const metersPerPx = (lat: number, z: number) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;

/** Khung nhìn chứa đủ mọi vòng + điểm, zoom lớn nhất còn vừa. */
function fitView(circles: MapCircle[], points: MapPoint[], w: number, h: number) {
    const boxes = [
        ...circles.map((c) => ({ lat: c.lat, lng: c.lng, r: c.radius_m })),
        ...points.map((p) => ({ lat: p.lat, lng: p.lng, r: Math.min(p.accuracy_m || 30, 2000) })),
    ];
    if (!boxes.length) return { ...DEFAULT_CENTER, z: 5 };
    let n = -90, s = 90, e = -180, wst = 180;
    for (const b of boxes) {
        const dLat = b.r / 111320, dLng = b.r / (111320 * Math.max(Math.cos((b.lat * Math.PI) / 180), 0.01));
        n = Math.max(n, b.lat + dLat); s = Math.min(s, b.lat - dLat);
        e = Math.max(e, b.lng + dLng); wst = Math.min(wst, b.lng - dLng);
    }
    const center = { lat: (n + s) / 2, lng: (e + wst) / 2 };
    for (let z = 18; z > MIN_Z; z--) {
        const a = project(n, wst, z), b = project(s, e, z);
        if (Math.abs(b.x - a.x) <= w - 48 && Math.abs(b.y - a.y) <= h - 48) return { ...center, z };
    }
    return { ...center, z: MIN_Z };
}

export default function MiniMap({ circles = [], points = [], onPick, height = 220, fitKey }: {
    circles?: MapCircle[];
    points?: MapPoint[];
    onPick?: (lat: number, lng: number) => void;
    height?: number;
    /** Đổi giá trị này thì bản đồ bỏ chỗ người dùng đã kéo / phóng, khớp lại mọi điểm. */
    fitKey?: string | number;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);
    // Chỗ người dùng đã kéo / phóng — gắn với fitKey lúc đó; fitKey đổi là tự bỏ (khớp lại mọi điểm).
    const [manual, setManual] = useState<{ lat: number; lng: number; z: number; key: string | number | undefined } | null>(null);
    const view = manual && manual.key === fitKey ? manual : null;
    const setView = (v: { lat: number; lng: number; z: number } | null) => setManual(v ? { ...v, key: fitKey } : null);
    const drag = useRef<{ x: number; y: number; cx: number; cy: number; z: number; moved: boolean } | null>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const ro = new ResizeObserver(() => setWidth(el.clientWidth));
        ro.observe(el);
        setWidth(el.clientWidth);
        return () => ro.disconnect();
    }, []);

    const auto = useMemo(() => (width ? fitView(circles, points, width, height) : null), [circles, points, width, height]);
    const v = view || auto;

    const pickAt = (clientX: number, clientY: number) => {
        if (!v || !ref.current || !onPick) return;
        const rect = ref.current.getBoundingClientRect();
        const c = project(v.lat, v.lng, v.z);
        const p = unproject(c.x - width / 2 + (clientX - rect.left), c.y - height / 2 + (clientY - rect.top), v.z);
        onPick(Math.round(p.lat * 1e6) / 1e6, Math.round(p.lng * 1e6) / 1e6);
    };

    let content: React.ReactNode = null;
    if (v && width) {
        const c = project(v.lat, v.lng, v.z);
        const left = c.x - width / 2, top = c.y - height / 2;
        const n = 2 ** v.z;
        const tiles: { key: string; src: string; x: number; y: number }[] = [];
        for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + height) / TILE); ty++) {
            if (ty < 0 || ty >= n) continue;
            for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + width) / TILE); tx++) {
                const wx = ((tx % n) + n) % n;
                tiles.push({ key: `${v.z}/${tx}/${ty}`, src: `https://tile.openstreetmap.org/${v.z}/${wx}/${ty}.png`, x: tx * TILE - left, y: ty * TILE - top });
            }
        }
        const at = (lat: number, lng: number) => { const p = project(lat, lng, v.z); return { x: p.x - left, y: p.y - top }; };
        content = (
            <>
                {tiles.map((t) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={t.key} src={t.src} alt="" draggable={false} loading="lazy"
                        className="pointer-events-none absolute max-w-none select-none"
                        style={{ left: t.x, top: t.y, width: TILE, height: TILE }} />
                ))}
                <svg className="pointer-events-none absolute inset-0" width={width} height={height}>
                    {circles.map((ci, i) => {
                        const p = at(ci.lat, ci.lng);
                        const r = ci.radius_m / metersPerPx(ci.lat, v.z);
                        const col = ci.color || "#6366f1";
                        return (
                            <g key={`c${i}`}>
                                <circle cx={p.x} cy={p.y} r={Math.max(r, 3)} fill={col} fillOpacity={0.15} stroke={col} strokeWidth={2} />
                                <circle cx={p.x} cy={p.y} r={4} fill={col} stroke="#fff" strokeWidth={1.5} />
                            </g>
                        );
                    })}
                    {points.map((pt, i) => {
                        const p = at(pt.lat, pt.lng);
                        const col = pt.color || "#0ea5e9";
                        const r = pt.accuracy_m ? pt.accuracy_m / metersPerPx(pt.lat, v.z) : 0;
                        return (
                            <g key={`p${i}`}>
                                {r > 8 && <circle cx={p.x} cy={p.y} r={r} fill={col} fillOpacity={0.1} stroke={col} strokeOpacity={0.4} strokeDasharray="4 3" />}
                                <circle cx={p.x} cy={p.y} r={7} fill={col} stroke="#fff" strokeWidth={2.5} />
                            </g>
                        );
                    })}
                </svg>
            </>
        );
    }

    const zoom = (d: number) => v && setView({ lat: v.lat, lng: v.lng, z: Math.min(MAX_Z, Math.max(MIN_Z, v.z + d)) });
    const btn = "flex h-7 w-7 items-center justify-center rounded-md bg-white/95 text-slate-700 shadow hover:bg-white dark:bg-slate-800/95 dark:text-slate-200";

    return (
        <div
            ref={ref}
            style={{ height }}
            className={`relative touch-none select-none overflow-hidden rounded-lg border border-border bg-muted ${onPick ? "cursor-crosshair" : "cursor-grab"}`}
            onPointerDown={(e) => {
                if (!v || (e.target as HTMLElement).closest("button")) return;
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                const c = project(v.lat, v.lng, v.z);
                drag.current = { x: e.clientX, y: e.clientY, cx: c.x, cy: c.y, z: v.z, moved: false };
            }}
            onPointerMove={(e) => {
                const d = drag.current;
                if (!d) return;
                const dx = e.clientX - d.x, dy = e.clientY - d.y;
                if (!d.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
                d.moved = true;
                setView({ ...unproject(d.cx - dx, d.cy - dy, d.z), z: d.z });
            }}
            onPointerUp={(e) => {
                const d = drag.current;
                drag.current = null;
                if (d && !d.moved) pickAt(e.clientX, e.clientY);
            }}
            onPointerCancel={() => { drag.current = null; }}
        >
            {content}
            <div className="absolute right-2 top-2 flex flex-col gap-1">
                <button type="button" className={btn} onClick={() => zoom(1)} aria-label="Phóng to"><Plus className="h-4 w-4" /></button>
                <button type="button" className={btn} onClick={() => zoom(-1)} aria-label="Thu nhỏ"><Minus className="h-4 w-4" /></button>
                <button type="button" className={btn} onClick={() => setView(null)} aria-label="Khớp mọi điểm" title="Khớp mọi điểm"><Maximize2 className="h-3.5 w-3.5" /></button>
            </div>
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer"
                className="absolute bottom-0 right-0 rounded-tl bg-white/80 px-1 text-[10px] text-slate-600 dark:bg-slate-900/80 dark:text-slate-300">
                © OpenStreetMap
            </a>
        </div>
    );
}
