// Timezone handling:
// - Each Meta ad account has its OWN timezone (Bangkok +7, Kuwait +3, Dubai +4,
//   Tokyo +9, LA -7, …). Meta insights are ALREADY bucketed per account tz.
// - Pancake/Poscake `inserted_at` is naive UTC (no offset, e.g. "2026-06-16T20:00:00").
//   To align a POS order with its ad's daily cutoff we MUST convert UTC → that
//   account's timezone before deciding which calendar day it belongs to.
export const DEFAULT_POS_TZ = 'Asia/Ho_Chi_Minh'; // VN +7 — POS-native day (reset 00:00 VN), used for unmatched orders

// Parse a naive-UTC POS timestamp ("2026-06-16T20:00:00.000000" or "... 20:00:00") to epoch ms.
function posUtcMs(insertedAt: string): number {
    const s = insertedAt.includes('T') ? insertedAt : insertedAt.replace(' ', 'T');
    return Date.parse(s.endsWith('Z') ? s : s + 'Z');
}
// Calendar date (YYYY-MM-DD) of a POS order in a given IANA timezone.
export function dateInTz(insertedAt: string, tz: string): string {
    const ms = posUtcMs(insertedAt);
    if (Number.isNaN(ms)) return String(insertedAt).slice(0, 10); // fallback: raw date
    return new Date(ms).toLocaleDateString('sv-SE', { timeZone: tz });
}
// Shift a YYYY-MM-DD string by n days (UTC-based, label arithmetic only).
export function addDaysStr(date: string, n: number): string {
    const d = new Date(date + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}
