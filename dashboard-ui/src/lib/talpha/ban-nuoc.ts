// ═══════════════════════════════════════════════════════════════════
// Bản số theo NƯỚC × NGÀY × NGƯỜI — vòng ghi Sheet (ops/talpha_reports/format_all.py) ghi mỗi giờ
// vào bảng market_monthly_reports (15/11/2026 — trước đó file data/bao_cao_nuoc/<YYYY-MM>.json),
// mỗi tháng một dòng, CÙNG lúc với bảng TỔNG TEAM:
//   { thang, ghi_luc, khong_gan, nuoc: { "Japan": { "2026-10-12": { "SAnh": { ads, mess, don,
//     doanh_so, ds_giao_tc } } } } }
// Số tin nhắn của nước Meta không báo (Nhật) trong bản này đã là số Pancake — nên màn nào tự tính
// từ kho số (số Meta) mà cần mess Nhật thì lấy ở đây cho khớp Sheet (Sỹ Anh 13/10/2026).
// ═══════════════════════════════════════════════════════════════════
// Phần THUẦN (có test, tests/pancake.test.cjs). Phần đọc kho (docBan, messPancakeTuBan) ở
// ./market-report-store.ts — tách riêng để bản build test không kéo theo lib/db.ts.

export type BanNuoc = {
    thang: string; ghi_luc?: string | null; khong_gan?: string;
    nuoc: Record<string, Record<string, Record<string, { mess?: number | null }>>>;
};

/** Các tháng "YYYY-MM" chạm khoảng [tu, den]. */
export function cacThang(tu: string, den: string): string[] {
    const out: string[] = [];
    let y = Number(tu.slice(0, 4)), m = Number(tu.slice(5, 7));
    const yd = Number(den.slice(0, 4)), md = Number(den.slice(5, 7));
    while ((y < yd || (y === yd && m <= md)) && out.length < 36) {
        out.push(`${y}-${String(m).padStart(2, "0")}`);
        if (++m > 12) { m = 1; y++; }
    }
    return out;
}

/** Mess của các nước `keys` trong khoảng [tu, den], gom theo người (khoá tab: "SAnh"…). THUẦN. */
export function gomMess(bans: BanNuoc[], tu: string, den: string, keys: string[]): { tong: number; theoNguoi: Record<string, number> } {
    const theoNguoi: Record<string, number> = {};
    let tong = 0;
    for (const b of bans) {
        for (const k of keys) {
            for (const [ngay, nguoi] of Object.entries(b.nuoc?.[k] || {})) {
                if (ngay < tu || ngay > den) continue;
                for (const [nv, so] of Object.entries(nguoi || {})) {
                    const n = Number(so?.mess || 0);
                    if (!n) continue;
                    theoNguoi[nv] = (theoNguoi[nv] || 0) + n;
                    tong += n;
                }
            }
        }
    }
    return { tong, theoNguoi };
}
