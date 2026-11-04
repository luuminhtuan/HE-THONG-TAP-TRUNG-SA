/**
 * Danh bạ TKQC tự động (04/11/2026) — bản dashboard của sync/core/tkqc.py.
 *
 * Không còn danh sách TKQC gõ tay (talpha.yaml → ad_account_ids, ops/talpha_reports/ad_accounts.json).
 * Mỗi vòng sync hỏi Meta token đọc được TKQC nào, ghi vào bảng tkqc và kéo chi tiêu của TẤT CẢ vào
 * fb_ads_tat_ca. Loại của từng TKQC quyết nó có vào báo cáo không (tkqc-luat.ts) — đổi ở /admin → TKQC.
 */
import { giaoDich, query } from "@/lib/db";
import { docKhoa } from "@/lib/talpha/khoa";
import { BIEN_TOKEN_META, cacLoai, loaiLanDau } from "@/lib/talpha/tkqc-luat";

const GRAPH = "https://graph.facebook.com/v21.0";

export type MetaTkqc = {
    account_id: string; name?: string; account_status?: number; currency?: string; timezone_name?: string;
    bien_token?: string;   // biến khoá của token đọc được TK này (nhiều token — BIEN_TOKEN_META)
};

/** [(biến, token)] của các token Meta đã nhập, theo thứ tự ưu tiên. */
export function cacToken(): [string, string][] {
    return BIEN_TOKEN_META.map((b) => [b, docKhoa(b)] as [string, string]).filter(([, t]) => !!t);
}

/** Mọi TKQC token đọc được (/me/adaccounts, đủ các trang). */
export async function docTkqcToken(token: string): Promise<MetaTkqc[]> {
    const out: MetaTkqc[] = [];
    let url: string | null = `${GRAPH}/me/adaccounts?${new URLSearchParams({
        fields: "account_id,name,account_status,currency,timezone_name", limit: "200", access_token: token,
    })}`;
    while (url) {
        const r: Response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.error) throw new Error(`Meta từ chối: ${j.error?.message || `HTTP ${r.status}`}`);
        out.push(...(j.data || []));
        url = j.paging?.next || null;
    }
    return out;
}

/** Ghi danh bạ như sync: TKQC mới thì thêm với loại lần đầu, TKQC cũ chỉ cập nhật tên / trạng thái /
 *  múi giờ / token đọc nó / lần cuối thấy — GIỮ loại người đã chọn. Trả các TKQC mới. */
export async function ghiDanhBa(ds: MetaTkqc[]): Promise<{ account_id: string; ten: string; loai: string }[]> {
    return giaoDich(async (q) => {
        const coSan = new Set((await q("SELECT account_id FROM tkqc")).map((r: { account_id: string }) => r.account_id));
        const moi: { account_id: string; ten: string; loai: string }[] = [];
        for (const a of ds) {
            const id = String(a.account_id || "").replace(/^act_/, "");
            if (!id) continue;
            const tham = {
                id, ten: a.name || "", st: a.account_status ?? null, tien: (a.currency || "").toUpperCase(),
                tz: a.timezone_name || null, bien: a.bien_token || null,
            };
            if (coSan.has(id)) {
                await q(`UPDATE tkqc SET ten = @ten, trang_thai = @st, tien_te = @tien, mui_gio = @tz,
                         bien_token = COALESCE(@bien, bien_token), thay_lan_cuoi = now() WHERE account_id = @id`, tham);
                continue;
            }
            const loai = loaiLanDau(id, tham.tien);
            await q(`INSERT INTO tkqc (account_id, ten, trang_thai, tien_te, mui_gio, loai, bien_token)
                     VALUES (@id, @ten, @st, @tien, @tz, @loai, @bien)`, { ...tham, loai });
            moi.push({ account_id: id, ten: tham.ten, loai });
        }
        return moi;
    });
}

/** Hỏi Meta ngay bằng MỌI token đang lưu và ghi danh bạ — nút "Quét TKQC" và lần đầu chưa có danh bạ.
 *  Như sync: mỗi TK nhận token ĐẦU TIÊN thấy nó. */
export async function quetNgay(): Promise<{
    thay: number; moi: { account_id: string; ten: string; loai: string }[]; theo_token: Record<string, number | string>;
}> {
    const tokens = cacToken();
    if (!tokens.length) throw new Error("Chưa có token Meta — nhập ở /admin → Khoá kết nối");
    const gom = new Map<string, MetaTkqc>();
    const theoToken: Record<string, number | string> = {};
    for (const [bien, tok] of tokens) {
        try {
            const ds = await docTkqcToken(tok);
            theoToken[bien] = ds.length;
            for (const a of ds) {
                const id = String(a.account_id).replace(/^act_/, "");
                if (!gom.has(id)) gom.set(id, { ...a, bien_token: bien });
            }
        } catch (e: any) {
            theoToken[bien] = e?.message || String(e);
        }
    }
    if (!gom.size) throw new Error(`Không token nào đọc được danh sách TKQC: ${JSON.stringify(theoToken)}`);
    return { thay: gom.size, moi: await ghiDanhBa([...gom.values()]), theo_token: theoToken };
}

/** TKQC thuộc loại VÀO BÁO CÁO mà token còn thấy trong 7 ngày — Ads Command Center gọi Meta sống
 *  cho đúng các TK này. Danh bạ trống (chưa vòng sync nào) thì quét ngay một lần. */
export async function tkqcBaoCao(quetNeuTrong = true): Promise<{ id: string; ten: string; mui_gio: string | null; bien_token: string | null }[]> {
    const vao = cacLoai().filter((l) => l.vao_bao_cao).map((l) => l.ma);
    const doc = () => query<{ id: string; ten: string; mui_gio: string | null; bien_token: string | null }>(
        `SELECT account_id AS id, ten, mui_gio, bien_token FROM tkqc
         WHERE loai = ANY(@vao) AND thay_lan_cuoi > now() - interval '7 days' ORDER BY ten`, { vao });
    let ds = await doc();
    if (!ds.length && quetNeuTrong && cacToken().length) {
        const co = await query<{ n: number }>("SELECT COUNT(*) AS n FROM tkqc");
        if (!co[0]?.n) {
            await quetNgay().catch((e) => console.error("Quét TKQC lần đầu lỗi:", e?.message || e));
            ds = await doc();
        }
    }
    return ds;
}

export type DongTkqc = {
    account_id: string; ten: string | null; trang_thai: number | null; tien_te: string | null; mui_gio: string | null;
    bien_token: string | null;
    loai: string; da_xac_nhan: boolean; thay_lan_dau: string; thay_lan_cuoi: string; ghi_chu: string | null;
    chi_7_ngay: number; chi_30_ngay: number; chi_lan_cuoi: string | null;
};

/** Danh bạ kèm chi tiêu (mọi TKQC, kể cả loại ngoài báo cáo) — trang /admin → TKQC. */
export async function danhBa(): Promise<DongTkqc[]> {
    return query<DongTkqc>(`
        SELECT t.account_id, t.ten, t.trang_thai, t.tien_te, t.mui_gio, t.bien_token, t.loai, t.da_xac_nhan,
               t.thay_lan_dau, t.thay_lan_cuoi, t.ghi_chu,
               COALESCE(SUM(f.spend) FILTER (WHERE f.date >= CURRENT_DATE - 6), 0)  AS chi_7_ngay,
               COALESCE(SUM(f.spend) FILTER (WHERE f.date >= CURRENT_DATE - 29), 0) AS chi_30_ngay,
               to_char(MAX(f.date) FILTER (WHERE f.spend > 0), 'YYYY-MM-DD')        AS chi_lan_cuoi
        FROM tkqc t
        LEFT JOIN fb_ads_tat_ca f ON f.account_id = t.account_id
        GROUP BY t.account_id
        ORDER BY t.da_xac_nhan, chi_30_ngay DESC, t.ten`);
}

/** Đổi loại / ghi chú một TKQC — có tác dụng ngay ở mọi báo cáo (view fb_ads_data lọc theo loại). */
export async function doiLoai(accountId: string, loai: string, ghiChu?: string | null): Promise<void> {
    if (!cacLoai().some((l) => l.ma === loai)) throw new Error(`Loại lạ: ${loai}`);
    const n = await query("UPDATE tkqc SET loai = @loai, da_xac_nhan = true, ghi_chu = COALESCE(@ghi, ghi_chu) WHERE account_id = @id RETURNING 1",
        { id: String(accountId).replace(/^act_/, ""), loai, ghi: ghiChu ?? null });
    if (!n.length) throw new Error(`Không có TKQC ${accountId} trong danh bạ`);
}
