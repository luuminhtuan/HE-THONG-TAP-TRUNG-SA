// ═══════════════════════════════════════════════════════════════════
// Chấm công online (20/11/2026) — phần THUẦN: soát IP / vị trí, đọc cấu hình, tóm tắt ngày công.
// Không import gì: route phía máy chủ (lib/talpha/attendance.ts), trang Quản trị (thử cấu hình chưa lưu ngay trên trình
// duyệt) và test (tests/attendance.test.cjs) dùng chung MỘT cách hiểu. Phần đụng kho: attendance.ts.
//
// Soát nơi chấm:
//   • IP: IP máy chủ thấy (nginx đặt X-Real-IP) thuộc một mạng / dải CIDR đã khai — IP công cộng của văn phòng.
//   • Vị trí: toạ độ GPS trình duyệt gửi nằm trong bán kính của một điểm văn phòng, và sai số GPS không quá
//     max_accuracy_m. Toạ độ do máy người chấm gửi lên — soát IP mới là cái máy chủ tự thấy.
//   • match = "any": đạt MỘT trong các mục đang bật là chấm được; "all": phải đạt cả hai.
//   Không bật mục nào = chấm được ở bất kỳ đâu (vẫn ghi IP + toạ độ để soát lại).
// ═══════════════════════════════════════════════════════════════════

export type AttendanceNetwork = { name: string; cidr: string };
export type AttendanceLocation = { name: string; lat: number; lng: number; radius_m: number };
export type AttendanceMatch = "any" | "all";

export type AttendanceSettings = {
    check_ip: boolean;
    check_location: boolean;
    match: AttendanceMatch;
    networks: AttendanceNetwork[];
    locations: AttendanceLocation[];
    /** GPS báo sai số lớn hơn mức này (mét) thì không tính là đúng vị trí. */
    max_accuracy_m: number;
    /** "HH:MM" theo timezone. */
    shift_start: string;
    shift_end: string;
    /** Vào trễ không quá chừng này phút thì chưa tính đi muộn. */
    grace_minutes: number;
    /** ISO: 1 = thứ Hai … 7 = Chủ nhật. */
    workdays: number[];
    /** Múi giờ tính ngày công — talpha_rules.json → attendance.timezone, không sửa trên trang. */
    timezone: string;
    /**
     * Có tính giờ làm không (đi muộn, về sớm, ngày làm / ngày nghỉ, vắng) — talpha_rules.json → attendance.schedule_enabled,
     * không sửa trên trang. Tắt (20/11/2026, tạm bỏ theo yêu cầu) thì trang Quản trị ẩn khung Giờ làm, lịch chỉ còn đủ
     * vào – ra / đang làm / thiếu chấm + tổng giờ. Giờ vào / ra / ngày làm đã lưu vẫn giữ để bật lại.
     */
    schedule_enabled: boolean;
};

/** talpha_rules.json → attendance. */
export type AttendanceDefaults = {
    timezone: string; schedule_enabled: boolean; shift_start: string; shift_end: string; grace_minutes: number;
    workdays: number[]; default_radius_m: number; max_accuracy_m: number;
};

export const FALLBACK_DEFAULTS: AttendanceDefaults = {
    timezone: "Asia/Ho_Chi_Minh", schedule_enabled: false, shift_start: "08:30", shift_end: "17:30", grace_minutes: 5,
    workdays: [1, 2, 3, 4, 5, 6], default_radius_m: 150, max_accuracy_m: 200,
};

export const MAX_NETWORKS = 50;
export const MAX_LOCATIONS = 20;
export const RADIUS_MIN_M = 10;
export const RADIUS_MAX_M = 5000;
export const NOTE_MAX = 300;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : null;
};
const text = (v: unknown, max = 80) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// ── IP ────────────────────────────────────────────────────────────

function parseIPv4(s: string): number | null {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
    if (!m) return null;
    const parts = m.slice(1).map(Number);
    if (parts.some((p, i) => p > 255 || (m[i + 1].length > 1 && m[i + 1].startsWith("0")))) return null;
    return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function parseIPv6(s: string): bigint | null {
    if (!/^[0-9a-f:.]+$/i.test(s) || s.split("::").length > 2) return null;
    let tail: number[] = [];
    let body = s;
    // Đuôi IPv4 nhúng (::ffff:1.2.3.4).
    const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(body);
    if (v4) {
        const n = parseIPv4(v4[1]);
        if (n === null) return null;
        tail = [n >>> 16, n & 0xffff];
        body = body.slice(0, -v4[1].length);
        if (body.endsWith(":") && !body.endsWith("::")) body = body.slice(0, -1);
    }
    const [head, rest] = body.includes("::") ? body.split("::") : [body, null];
    const hex = (p: string) => (p ? p.split(":") : []);
    const a = hex(head), b = rest === null ? [] : hex(rest);
    if ([...a, ...b].some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
    const missing = 8 - a.length - b.length - tail.length;
    if (rest === null ? missing !== 0 : missing < 1) return null;
    const groups = [...a.map((g) => parseInt(g, 16)), ...Array(rest === null ? 0 : missing).fill(0), ...b.map((g) => parseInt(g, 16)), ...tail];
    return groups.reduce((acc, g) => (acc << BigInt(16)) + BigInt(g), BigInt(0));
}

type ParsedIp = { v: 4; n: number } | { v: 6; n: bigint };

/** "1.2.3.4" · "::ffff:1.2.3.4" (đổi về IPv4) · "[2001:db8::1]" · "1.2.3.4:5678" → dạng gọn; lạ → null. */
export function normalizeIp(raw: string | null | undefined): string | null {
    let s = String(raw ?? "").trim().toLowerCase();
    if (!s) return null;
    const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(s);
    if (bracket) s = bracket[1];
    else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(s)) s = s.replace(/:\d+$/, "");
    s = s.replace(/%.*$/, "");                       // fe80::1%eth0
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
    if (mapped) s = mapped[1];
    if (parseIPv4(s) !== null) return s;
    return parseIPv6(s) !== null ? s : null;
}

function parseIp(s: string): ParsedIp | null {
    const n = normalizeIp(s);
    if (!n) return null;
    const v4 = parseIPv4(n);
    if (v4 !== null) return { v: 4, n: v4 };
    const v6 = parseIPv6(n);
    return v6 === null ? null : { v: 6, n: v6 };
}

/** "1.2.3.4" (một IP) · "1.2.3.0/24" · "2001:db8::/48" → dạng chuẩn; sai → null. */
export function normalizeCidr(raw: string): string | null {
    const s = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, "");
    const [addr, bitsRaw, extra] = s.split("/");
    if (extra !== undefined || !addr) return null;
    const ip = parseIp(addr);
    if (!ip) return null;
    const max = ip.v === 4 ? 32 : 128;
    if (bitsRaw === undefined) return normalizeIp(addr);
    if (!/^\d{1,3}$/.test(bitsRaw)) return null;
    const bits = Number(bitsRaw);
    if (bits < 0 || bits > max) return null;
    return bits === max ? normalizeIp(addr) : `${normalizeIp(addr)}/${bits}`;
}

/** IP có nằm trong mạng / dải CIDR không. IPv4 không bao giờ khớp dải IPv6 và ngược lại. */
export function ipInCidr(ipRaw: string | null | undefined, cidr: string): boolean {
    const ip = ipRaw ? parseIp(ipRaw) : null;
    const norm = normalizeCidr(cidr);
    if (!ip || !norm) return false;
    const [addr, bitsRaw] = norm.split("/");
    const net = parseIp(addr)!;
    if (net.v !== ip.v) return false;
    const max = ip.v === 4 ? 32 : 128;
    const bits = bitsRaw === undefined ? max : Number(bitsRaw);
    if (bits === 0) return true;
    if (ip.v === 4) {
        const shift = 32 - bits;
        return shift === 32 ? true : (ip.n >>> shift) === ((net.n as number) >>> shift);
    }
    const shift = BigInt(128 - bits);
    return (ip.n >> shift) === ((net.n as bigint) >> shift);
}

/**
 * IP người gọi từ header. nginx (ops/deploy/nginx-talpha-https.conf) GHI ĐÈ X-Real-IP = địa chỉ thật của kết nối, nên
 * đọc nó trước. Không có thì lấy mục CUỐI của X-Forwarded-For — mục do proxy gần nhất thêm vào; mục đầu là do trình
 * duyệt tự khai, giả được.
 */
export function clientIpFromHeaders(get: (name: string) => string | null | undefined): string | null {
    const real = normalizeIp(get("x-real-ip"));
    if (real) return real;
    const parts = String(get("x-forwarded-for") || "").split(",").map((p) => p.trim()).filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
        const ip = normalizeIp(parts[i]);
        if (ip) return ip;
    }
    return null;
}

// ── Vị trí ────────────────────────────────────────────────────────

export type Geo = { lat: number; lng: number; accuracy_m: number | null };

/** Khoảng cách mặt đất (mét), công thức haversine. */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    const R = 6371008.8;
    const rad = (d: number) => (d * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 56 → "56 m" · 1112 → "1,1 km" · 287595 → "288 km" */
export function fmtDistance(m: number): string {
    if (m < 1000) return `${Math.round(m)} m`;
    const km = m / 1000;
    return km < 100 ? `${km.toFixed(1).replace(".", ",")} km` : `${Math.round(km).toLocaleString("vi-VN")} km`;
}

/** {lat, lng, accuracy_m} gửi lên → Geo, hoặc null khi thiếu / ngoài khoảng. */
export function parseGeo(v: unknown): Geo | null {
    if (!isRecord(v)) return null;
    const lat = num(v.lat), lng = num(v.lng), acc = num(v.accuracy_m ?? v.accuracy);
    if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng, accuracy_m: acc !== null && acc >= 0 ? Math.round(acc) : null };
}

// ── Soát một lần chấm ─────────────────────────────────────────────

export type PunchCheck = {
    ip: string | null;
    /** null = không soát IP. */
    ip_ok: boolean | null;
    network_name: string | null;
    /** null = không soát vị trí. */
    location_ok: boolean | null;
    /** Điểm văn phòng khớp; không khớp thì điểm gần nhất. */
    location_name: string | null;
    distance_m: number | null;
    accuracy_m: number | null;
    allowed: boolean;
    /** Câu giải thích từng mục KHÔNG đạt (kể cả khi vẫn chấm được nhờ mục kia ở chế độ "any"). */
    problems: string[];
};

export function evaluatePunch(s: AttendanceSettings, ip: string | null, geo: Geo | null): PunchCheck {
    const problems: string[] = [];
    const network = ip ? s.networks.find((n) => ipInCidr(ip, n.cidr)) || null : null;
    let ipOk: boolean | null = null;
    if (s.check_ip) {
        ipOk = !!network;
        if (!ip) problems.push("Máy chủ không đọc được IP của bạn");
        else if (!network) problems.push(`IP ${ip} không thuộc mạng văn phòng — nối Wi-Fi văn phòng rồi thử lại`);
    }

    let best: { loc: AttendanceLocation; d: number } | null = null;
    let inside: { loc: AttendanceLocation; d: number } | null = null;
    if (geo) {
        for (const loc of s.locations) {
            const d = distanceMeters(geo, loc);
            if (!best || d < best.d) best = { loc, d };
            if (d <= loc.radius_m && (!inside || d < inside.d)) inside = { loc, d };
        }
    }
    const pick = inside || best;
    let locOk: boolean | null = null;
    if (s.check_location) {
        if (!geo) {
            locOk = false;
            problems.push("Chưa lấy được vị trí — cho phép trình duyệt dùng vị trí rồi thử lại");
        } else if (geo.accuracy_m !== null && geo.accuracy_m > s.max_accuracy_m) {
            locOk = false;
            problems.push(`Vị trí sai số ${geo.accuracy_m} m (quá ${s.max_accuracy_m} m) — bật GPS / Wi-Fi hoặc ra chỗ thoáng rồi thử lại`);
        } else if (!inside) {
            locOk = false;
            problems.push(best
                ? `Bạn cách ${best.loc.name} ${fmtDistance(best.d)} — chỉ chấm được trong bán kính ${best.loc.radius_m} m`
                : "Chưa khai điểm văn phòng nào");
        } else locOk = true;
    }

    const checks = [ipOk, locOk].filter((x): x is boolean => x !== null);
    const allowed = checks.length === 0 || (s.match === "all" ? checks.every(Boolean) : checks.some(Boolean));
    return {
        ip, ip_ok: ipOk, network_name: network?.name ?? null,
        location_ok: locOk, location_name: pick?.loc.name ?? null,
        distance_m: pick ? Math.round(pick.d) : null, accuracy_m: geo?.accuracy_m ?? null,
        allowed, problems,
    };
}

// ── Cấu hình ──────────────────────────────────────────────────────

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const hhmmToMinutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
const normHhmm = (v: unknown): string | null => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? "").trim());
    if (!m) return null;
    const s = `${m[1].padStart(2, "0")}:${m[2]}`;
    return HHMM.test(s) ? s : null;
};

export function defaultSettings(d: AttendanceDefaults = FALLBACK_DEFAULTS): AttendanceSettings {
    return {
        check_ip: false, check_location: false, match: "any", networks: [], locations: [],
        max_accuracy_m: d.max_accuracy_m, shift_start: d.shift_start, shift_end: d.shift_end,
        grace_minutes: d.grace_minutes, workdays: [...d.workdays], timezone: d.timezone,
        schedule_enabled: d.schedule_enabled === true,
    };
}

/**
 * Cấu hình gửi lên (hoặc đọc từ kho) → cấu hình sạch + danh sách lỗi đọc được. Có lỗi thì route KHÔNG lưu; đọc từ kho
 * thì vẫn dùng phần sạch.
 */
export function parseSettings(raw: unknown, d: AttendanceDefaults = FALLBACK_DEFAULTS): { settings: AttendanceSettings; errors: string[] } {
    const base = defaultSettings(d);
    if (!isRecord(raw)) return { settings: base, errors: raw === undefined || raw === null ? [] : ["Cấu hình không đọc được"] };
    const errors: string[] = [];

    const networks: AttendanceNetwork[] = [];
    const rawNetworks = Array.isArray(raw.networks) ? raw.networks : [];
    if (rawNetworks.length > MAX_NETWORKS) errors.push(`Tối đa ${MAX_NETWORKS} mạng`);
    rawNetworks.slice(0, MAX_NETWORKS).forEach((n, i) => {
        const r: Record<string, unknown> = isRecord(n) ? n : { cidr: n };
        const name = text(r.name) || `Mạng ${i + 1}`;
        const cidr = normalizeCidr(String(r.cidr ?? r.ip ?? ""));
        if (!cidr) errors.push(`${name}: "${text(r.cidr ?? r.ip, 60)}" không phải IP hoặc dải CIDR (vd 113.161.1.20 hoặc 113.161.1.0/24)`);
        else if (networks.some((x) => x.cidr === cidr)) errors.push(`${name}: ${cidr} bị khai hai lần`);
        else networks.push({ name, cidr });
    });

    const locations: AttendanceLocation[] = [];
    const rawLocations = Array.isArray(raw.locations) ? raw.locations : [];
    if (rawLocations.length > MAX_LOCATIONS) errors.push(`Tối đa ${MAX_LOCATIONS} điểm văn phòng`);
    rawLocations.slice(0, MAX_LOCATIONS).forEach((l, i) => {
        const r = isRecord(l) ? l : {};
        const name = text(r.name) || `Điểm ${i + 1}`;
        const lat = num(r.lat), lng = num(r.lng);
        const radius = num(r.radius_m) ?? d.default_radius_m;
        if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            errors.push(`${name}: toạ độ không hợp lệ — bấm "Lấy vị trí hiện tại" hoặc chấm trên bản đồ`);
            return;
        }
        if (radius < RADIUS_MIN_M || radius > RADIUS_MAX_M) {
            errors.push(`${name}: bán kính phải từ ${RADIUS_MIN_M} đến ${RADIUS_MAX_M} m`);
            return;
        }
        locations.push({ name, lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, radius_m: Math.round(radius) });
    });

    const checkIp = raw.check_ip === true;
    const checkLocation = raw.check_location === true;
    if (checkIp && !networks.length) errors.push("Bật soát IP thì phải khai ít nhất một mạng");
    if (checkLocation && !locations.length) errors.push("Bật soát vị trí thì phải khai ít nhất một điểm văn phòng");

    const maxAcc = num(raw.max_accuracy_m) ?? base.max_accuracy_m;
    if (maxAcc < 10 || maxAcc > 5000) errors.push("Sai số GPS tối đa phải từ 10 đến 5000 m");
    const start = raw.shift_start === undefined ? base.shift_start : normHhmm(raw.shift_start);
    const end = raw.shift_end === undefined ? base.shift_end : normHhmm(raw.shift_end);
    if (!start || !end) errors.push("Giờ vào / giờ ra phải dạng HH:MM (vd 08:30)");
    else if (hhmmToMinutes(end) <= hhmmToMinutes(start)) errors.push("Giờ ra phải sau giờ vào");
    const grace = num(raw.grace_minutes) ?? base.grace_minutes;
    if (grace < 0 || grace > 240) errors.push("Số phút cho phép đi muộn phải từ 0 đến 240");
    const workdays = Array.isArray(raw.workdays)
        ? [...new Set(raw.workdays.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x >= 1 && x <= 7))].sort((a, b) => a - b)
        : base.workdays;
    if (!workdays.length) errors.push("Chọn ít nhất một ngày làm việc");

    return {
        settings: {
            check_ip: checkIp, check_location: checkLocation, match: raw.match === "all" ? "all" : "any",
            networks, locations,
            max_accuracy_m: maxAcc >= 10 && maxAcc <= 5000 ? Math.round(maxAcc) : base.max_accuracy_m,
            shift_start: start && end && hhmmToMinutes(end) > hhmmToMinutes(start) ? start : base.shift_start,
            shift_end: start && end && hhmmToMinutes(end) > hhmmToMinutes(start) ? end : base.shift_end,
            grace_minutes: grace >= 0 && grace <= 240 ? Math.round(grace) : base.grace_minutes,
            workdays: workdays.length ? workdays : base.workdays,
            timezone: d.timezone,
            schedule_enabled: d.schedule_enabled === true,
        },
        errors,
    };
}

/** Phần cấu hình người chấm được thấy — KHÔNG có danh sách IP văn phòng. */
export function publicSettings(s: AttendanceSettings) {
    return {
        check_ip: s.check_ip, check_location: s.check_location, match: s.match,
        locations: s.locations, network_names: s.networks.map((n) => n.name),
        shift_start: s.shift_start, shift_end: s.shift_end, grace_minutes: s.grace_minutes,
        workdays: s.workdays, timezone: s.timezone, max_accuracy_m: s.max_accuracy_m, schedule_enabled: s.schedule_enabled,
    };
}
export type PublicAttendanceSettings = ReturnType<typeof publicSettings>;

/** Một dòng tóm tắt cách soát — hiện ở tab Chấm công và trang Quản trị. */
export function describeRule(s: Pick<AttendanceSettings, "check_ip" | "check_location" | "match">): string {
    if (!s.check_ip && !s.check_location) return "Chấm được ở bất kỳ đâu (chưa giới hạn IP / vị trí)";
    if (s.check_ip && !s.check_location) return "Chỉ chấm được khi nối mạng văn phòng";
    if (!s.check_ip && s.check_location) return "Chỉ chấm được khi ở trong bán kính văn phòng";
    return s.match === "all"
        ? "Phải nối mạng văn phòng VÀ ở trong bán kính văn phòng"
        : "Nối mạng văn phòng HOẶC ở trong bán kính văn phòng";
}

// ── Giờ địa phương ────────────────────────────────────────────────

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();
const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Thời điểm → ngày, giờ (phút trong ngày), thứ theo múi giờ `tz`. */
export function localParts(at: string | number | Date, tz: string): { date: string; minutes: number; hhmm: string; weekday: number } {
    let f = FORMATTERS.get(tz);
    if (!f) {
        f = new Intl.DateTimeFormat("en-US", {
            timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
            hourCycle: "h23", weekday: "short",
        });
        FORMATTERS.set(tz, f);
    }
    const p = Object.fromEntries(f.formatToParts(new Date(at)).map((x) => [x.type, x.value]));
    const hh = p.hour === "24" ? "00" : p.hour;
    return {
        date: `${p.year}-${p.month}-${p.day}`, minutes: Number(hh) * 60 + Number(p.minute),
        hhmm: `${hh}:${p.minute}`, weekday: WEEKDAY[p.weekday] ?? 0,
    };
}

/** "2026-11-20" → thứ ISO (1 = thứ Hai … 7 = Chủ nhật) — ngày lịch, không phụ thuộc múi giờ. */
export function isoWeekday(date: string): number {
    const [y, m, d] = date.split("-").map(Number);
    const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return w === 0 ? 7 : w;
}

export const isMonth = (s: unknown): s is string => typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
/** "YYYY-MM-DD" có thật (không nhận 2026-02-30). */
export function isDate(s: unknown): s is string {
    if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Mọi ngày của tháng "2026-11" → ["2026-11-01", …]. */
export function monthDays(month: string): string[] {
    const [y, m] = month.split("-").map(Number);
    const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

export function shiftMonth(month: string, delta: number): string {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ── Ngày công ─────────────────────────────────────────────────────

export type PunchKind = "in" | "out";
/** Một lần chấm như route trả về (đã đổi giờ theo múi giờ chấm công). */
export type PunchRow = {
    id: number; user_id: string; kind: PunchKind; at: string; work_date: string; source: "self" | "manual";
    voided: boolean;
    ip?: string | null; lat?: number | null; lng?: number | null; accuracy_m?: number | null;
    location_name?: string | null; distance_m?: number | null; network_name?: string | null;
    ip_ok?: boolean | null; location_ok?: boolean | null; note?: string | null; created_by?: string | null;
    voided_by?: string | null; void_reason?: string | null;
};

export type DayStatus =
    | "ok" | "late" | "early" | "late_early"     // đủ vào + ra (có tính giờ làm)
    | "done"                                     // đủ vào + ra (không tính giờ làm)
    | "working"                                  // hôm nay, đang trong ca (lần cuối là chấm vào)
    | "missing_out" | "missing_in"               // ngày đã qua, thiếu một đầu
    | "absent"                                   // ngày làm đã qua, không chấm (chỉ khi tính giờ làm)
    | "pending"                                  // hôm nay, chưa chấm
    | "off" | "off_worked"                       // ngày nghỉ / có chấm ngày nghỉ (chỉ khi tính giờ làm)
    | "none"                                     // ngày đã qua, không chấm (không tính giờ làm)
    | "future" | "untracked";                    // chưa tới / trước khi bắt đầu chấm công

/** Một ca trong ngày: một lần vào → lần ra kế tiếp. in_at null = ra mà không có vào (chỉ xảy ra khi chấm bù lệch). */
export type WorkSession = { in_at: string | null; out_at: string | null; in_hhmm: string | null; out_hhmm: string | null; minutes: number | null };

export type DaySummary = {
    date: string; weekday: number; workday: boolean; status: DayStatus;
    /** Lần vào đầu tiên / lần ra cuối cùng — đang trong ca thì giờ ra trống. */
    first_in: string | null; last_out: string | null; in_hhmm: string | null; out_hhmm: string | null;
    /** Tổng phút các ca đã đóng (vào → ra). */
    worked_minutes: number | null; late_minutes: number; early_minutes: number;
    punch_count: number;
    sessions: WorkSession[];
    /** Đang trong ca (lần chấm cuối là chấm vào) — từ lúc nào. */
    open: boolean; open_since: string | null;
};

/**
 * Ghép các lần chấm (đã xếp theo giờ) thành ca: vào → ra kế tiếp. Vào hai lần liền (chấm bù) giữ lần đầu; ra hai lần
 * liền thì lần sau dời giờ ra của ca trước (sửa giờ ra); ra mà chưa từng vào là ca thiếu đầu vào.
 */
function buildSessions(live: PunchRow[], tz: string): { sessions: WorkSession[]; open: PunchRow | null } {
    const hh = (p: PunchRow | null) => (p ? localParts(p.at, tz).hhmm : null);
    const make = (i: PunchRow | null, o: PunchRow | null): WorkSession => ({
        in_at: i?.at ?? null, out_at: o?.at ?? null, in_hhmm: hh(i), out_hhmm: hh(o),
        minutes: i && o && Date.parse(o.at) > Date.parse(i.at) ? Math.round((Date.parse(o.at) - Date.parse(i.at)) / 60000) : null,
    });
    const sessions: WorkSession[] = [];
    const ins: (PunchRow | null)[] = [];
    let open: PunchRow | null = null;
    for (const p of live) {
        if (p.kind === "in") { if (!open) open = p; continue; }
        if (open) { sessions.push(make(open, p)); ins.push(open); open = null; continue; }
        const lastIn = ins.length ? ins[ins.length - 1] : null;
        if (lastIn) sessions[sessions.length - 1] = make(lastIn, p);
        else { sessions.push(make(null, p)); ins.push(null); }
    }
    if (open) sessions.push(make(open, null));
    return { sessions, open };
}

/**
 * Một ngày của một người. `punches` = các lần chấm của ngày đó (dòng đã huỷ tự bỏ qua). Một ngày có thể nhiều ca
 * (vào → ra → vào → ra…); giờ làm = tổng các ca đã đóng.
 * Tính giờ làm (`schedule_enabled`): đi muộn = lần vào ĐẦU TIÊN sau giờ vào + số phút cho phép (tính đủ số phút kể từ
 * giờ vào); về sớm = lần ra CUỐI CÙNG trước giờ ra; ngày làm không chấm = vắng; ngày nghỉ có chấm không tính muộn / sớm.
 * Không tính giờ làm: chỉ còn đủ vào – ra / đang làm / thiếu chấm.
 * `trackFrom`: ngày bắt đầu tính công của người này (lần chấm đầu tiên) — ngày trước đó không tính vắng.
 */
export function summarizeDay(
    date: string, punches: PunchRow[], s: AttendanceSettings, today: string, trackFrom: string | null,
): DaySummary {
    const weekday = isoWeekday(date);
    const schedule = s.schedule_enabled;
    const workday = schedule ? s.workdays.includes(weekday) : true;
    const live = punches.filter((p) => !p.voided).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const { sessions, open } = buildSessions(live, s.timezone);
    const firstIn = live.find((p) => p.kind === "in") || null;
    const lastOut = open ? null : [...live].reverse().find((p) => p.kind === "out") || null;
    const inP = firstIn ? localParts(firstIn.at, s.timezone) : null;
    const outP = lastOut ? localParts(lastOut.at, s.timezone) : null;
    const closed = sessions.filter((x) => x.minutes !== null);
    const base = {
        date, weekday, workday,
        first_in: firstIn?.at ?? null, last_out: lastOut?.at ?? null,
        in_hhmm: inP?.hhmm ?? null, out_hhmm: outP?.hhmm ?? null,
        worked_minutes: closed.length ? closed.reduce((a, x) => a + (x.minutes || 0), 0) : null,
        late_minutes: 0, early_minutes: 0, punch_count: live.length,
        sessions, open: !!open, open_since: open?.at ?? null,
    };
    const startMin = hhmmToMinutes(s.shift_start), endMin = hhmmToMinutes(s.shift_end);
    const late = schedule && workday && inP && inP.minutes > startMin + s.grace_minutes ? inP.minutes - startMin : 0;
    const early = schedule && workday && outP && outP.minutes < endMin ? endMin - outP.minutes : 0;

    if (!live.length) {
        const status: DayStatus = date > today ? "future"
            : !schedule ? (date === today ? "pending" : "none")
            : !workday ? "off"
            : !trackFrom || date < trackFrom ? "untracked"
            : date === today ? "pending" : "absent";
        return { ...base, status };
    }
    if (schedule && !workday) return { ...base, status: "off_worked" };
    if (open) return { ...base, late_minutes: late, status: date === today ? "working" : "missing_out" };
    if (sessions.some((x) => !x.in_at)) return { ...base, early_minutes: early, status: "missing_in" };
    if (!schedule) return { ...base, status: "done" };
    return {
        ...base, late_minutes: late, early_minutes: early,
        status: late && early ? "late_early" : late ? "late" : early ? "early" : "ok",
    };
}

export type MonthTotals = {
    /** Ngày làm đã tới (tính tới hôm nay, từ ngày bắt đầu chấm công) — chỉ khi tính giờ làm, không thì 0. */
    workdays: number;
    /** Số ngày có chấm. */
    present: number; on_time: number; late: number; early: number;
    missing: number; absent: number; off_worked: number;
    worked_minutes: number; late_minutes: number;
};

export function summarizeMonth(
    month: string, punches: PunchRow[], s: AttendanceSettings, today: string, trackFrom: string | null,
): { days: DaySummary[]; totals: MonthTotals } {
    const byDate = new Map<string, PunchRow[]>();
    for (const p of punches) byDate.set(p.work_date, [...(byDate.get(p.work_date) || []), p]);
    const days = monthDays(month).map((d) => summarizeDay(d, byDate.get(d) || [], s, today, trackFrom));
    const t: MonthTotals = { workdays: 0, present: 0, on_time: 0, late: 0, early: 0, missing: 0, absent: 0, off_worked: 0, worked_minutes: 0, late_minutes: 0 };
    for (const d of days) {
        if (s.schedule_enabled && d.workday && d.status !== "future" && d.status !== "untracked") t.workdays++;
        if (["ok", "late", "early", "late_early", "done", "working", "missing_out", "missing_in"].includes(d.status)) t.present++;
        if (d.status === "ok") t.on_time++;
        if (d.status === "late" || d.status === "late_early" || (d.status === "working" && d.late_minutes > 0)) t.late++;
        if (d.status === "early" || d.status === "late_early") t.early++;
        if (d.status === "missing_out" || d.status === "missing_in") t.missing++;
        if (d.status === "absent") t.absent++;
        if (d.status === "off_worked") t.off_worked++;
        t.worked_minutes += d.worked_minutes || 0;
        t.late_minutes += d.late_minutes;
    }
    return { days, totals: t };
}

// ── Thao tác gửi lên ──────────────────────────────────────────────

export type AttendanceAction =
    | { action: "check"; geo: Geo | null }
    | { action: "punch"; kind: PunchKind; geo: Geo | null }
    | { action: "manual"; user_id: string; kind: PunchKind; date: string; time: string; note: string }
    | { action: "void"; punch_id: number; reason: string };

/** Body POST /api/talpha/attendance → thao tác hợp lệ, hoặc lỗi đọc được. */
export function parseAttendanceAction(body: unknown): AttendanceAction | { error: string } {
    if (!isRecord(body)) return { error: "Thiếu nội dung" };
    const action = String(body.action || "");
    if (action === "check") return { action, geo: parseGeo(body.geo) };
    const kind = body.kind === "in" || body.kind === "out" ? body.kind : null;
    if (action === "punch") {
        if (!kind) return { error: "kind phải là in hoặc out" };
        return { action, kind, geo: parseGeo(body.geo) };
    }
    if (action === "manual") {
        const user_id = text(body.user_id, 200);
        const time = normHhmm(body.time);
        const note = text(body.note, NOTE_MAX);
        if (!user_id) return { error: "Chọn người cần chấm bù" };
        if (!kind) return { error: "Chọn giờ vào hay giờ ra" };
        if (!isDate(body.date)) return { error: "Ngày phải dạng YYYY-MM-DD" };
        if (!time) return { error: "Giờ phải dạng HH:MM" };
        if (!note) return { error: "Ghi lý do chấm bù (vd: quên chấm, máy hỏng)" };
        return { action, user_id, kind, date: body.date, time, note };
    }
    if (action === "void") {
        const id = Number(body.punch_id);
        const reason = text(body.reason, NOTE_MAX);
        if (!Number.isInteger(id) || id <= 0) return { error: "punch_id không hợp lệ" };
        if (!reason) return { error: "Ghi lý do huỷ lần chấm này" };
        return { action, punch_id: id, reason };
    }
    return { error: `Thao tác lạ: ${action || "(trống)"}` };
}

/**
 * Chấm được loại này lúc này không — `todayPunches`: các lần chấm hôm nay của người đó. Vào và ra XEN KẼ: chưa chấm
 * hoặc lần cuối là chấm ra → chỉ chấm vào; lần cuối là chấm vào → chỉ chấm ra. Một ngày bao nhiêu ca cũng được.
 */
export function punchAllowed(kind: PunchKind, todayPunches: PunchRow[], tz: string): { ok: true } | { ok: false; error: string } {
    const live = todayPunches.filter((p) => !p.voided).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const last = live[live.length - 1];
    if (kind === "in") {
        if (last?.kind === "in") return { ok: false, error: `Bạn đang trong ca từ ${localParts(last.at, tz).hhmm} — chấm ra trước khi chấm vào lại` };
        return { ok: true };
    }
    if (!last) return { ok: false, error: "Hôm nay bạn chưa chấm vào — chấm vào trước" };
    if (last.kind === "out") return { ok: false, error: `Bạn đã chấm ra lúc ${localParts(last.at, tz).hhmm} — chấm vào trước` };
    return { ok: true };
}

/** Lần chấm kế tiếp của hôm nay theo luật xen kẽ — nút trên tab hiện đúng một loại. */
export function nextPunchKind(today: Pick<DaySummary, "open">): PunchKind {
    return today.open ? "out" : "in";
}
