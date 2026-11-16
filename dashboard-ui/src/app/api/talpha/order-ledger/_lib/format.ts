export const vnd = (n: number) => Math.round(n).toLocaleString("vi-VN");
/** Ngày đọc cho người, không đọc cho máy: 2026-08-25 → 25/08/2026. */
export const dmy = (s: string) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "—");
