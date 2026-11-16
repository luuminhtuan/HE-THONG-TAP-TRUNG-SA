/**
 * Danh bạ TKQC tự động (04/11/2026) — bản dashboard của sync/core/ad_accounts.py.
 *
 * Không còn danh sách TKQC gõ tay (talpha.yaml → ad_account_ids, ops/talpha_reports/ad_accounts.json).
 * Mỗi vòng sync hỏi Meta token đọc được TKQC nào, ghi vào bảng ad_accounts và kéo chi tiêu của TẤT CẢ vào
 * fb_ads_all. Loại của từng TKQC quyết nó có vào báo cáo không (ad-account-rules.ts) — đổi ở /admin → TKQC.
 */
import { withTransaction, query } from "@/lib/db";
import { getCredential } from "@/lib/talpha/credentials";
import { META_TOKEN_VARS, listAccountKinds, initialAccountKind } from "@/lib/talpha/ad-account-rules";

const GRAPH = "https://graph.facebook.com/v21.0";

export type MetaAdAccount = {
    account_id: string; name?: string; account_status?: number; currency?: string; timezone_name?: string;
    token_env_var?: string;   // biến khoá của token đọc được TK này (nhiều token — META_TOKEN_VARS)
};

/** [(biến, token)] của các token Meta đã nhập, theo thứ tự ưu tiên. */
export function metaTokens(): [string, string][] {
    return META_TOKEN_VARS.map((b) => [b, getCredential(b)] as [string, string]).filter(([, t]) => !!t);
}

/** Mọi TKQC token đọc được (/me/adaccounts, đủ các trang). */
export async function fetchAdAccountsForToken(token: string): Promise<MetaAdAccount[]> {
    const out: MetaAdAccount[] = [];
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
export type NewAdAccount = { account_id: string; name: string; category: string };

export async function writeAdAccountDirectory(ds: MetaAdAccount[]): Promise<NewAdAccount[]> {
    return withTransaction(async (q) => {
        const known = new Set((await q("SELECT account_id FROM ad_accounts")).map((r: { account_id: string }) => r.account_id));
        const newAccounts: NewAdAccount[] = [];
        for (const a of ds) {
            const id = String(a.account_id || "").replace(/^act_/, "");
            if (!id) continue;
            const record = {
                id, name: a.name || "", status: a.account_status ?? null, currency: (a.currency || "").toUpperCase(),
                tz: a.timezone_name || null, tokenVar: a.token_env_var || null,
            };
            if (known.has(id)) {
                await q(`UPDATE ad_accounts SET name = @name, account_status = @status, currency = @currency, timezone_name = @tz,
                         token_env_var = COALESCE(@tokenVar, token_env_var), last_seen_at = now() WHERE account_id = @id`, record);
                continue;
            }
            const kind = initialAccountKind(id, record.currency);
            await q(`INSERT INTO ad_accounts (account_id, name, account_status, currency, timezone_name, category, token_env_var)
                     VALUES (@id, @name, @status, @currency, @tz, @category, @tokenVar)`, { ...record, category: kind });
            newAccounts.push({ account_id: id, name: record.name, category: kind });
        }
        return newAccounts;
    });
}

/** Hỏi Meta ngay bằng MỌI token đang lưu và ghi danh bạ — nút "Quét TKQC" và lần đầu chưa có danh bạ.
 *  Như sync: mỗi TK nhận token ĐẦU TIÊN thấy nó. */
export async function scanNow(): Promise<{
    seen: number; added: NewAdAccount[]; per_token: Record<string, number | string>;
}> {
    const tokens = metaTokens();
    if (!tokens.length) throw new Error("Chưa có token Meta — nhập ở /admin → Khoá kết nối");
    const byId = new Map<string, MetaAdAccount>();
    const perToken: Record<string, number | string> = {};
    for (const [tokenVar, tok] of tokens) {
        try {
            const ds = await fetchAdAccountsForToken(tok);
            perToken[tokenVar] = ds.length;
            for (const a of ds) {
                const id = String(a.account_id).replace(/^act_/, "");
                if (!byId.has(id)) byId.set(id, { ...a, token_env_var: tokenVar });
            }
        } catch (e: any) {
            perToken[tokenVar] = e?.message || String(e);
        }
    }
    if (!byId.size) throw new Error(`Không token nào đọc được danh sách TKQC: ${JSON.stringify(perToken)}`);
    return { seen: byId.size, added: await writeAdAccountDirectory([...byId.values()]), per_token: perToken };
}

/** TKQC thuộc loại VÀO BÁO CÁO mà token còn thấy trong 7 ngày — Ads Command Center gọi Meta sống
 *  cho đúng các TK này. Danh bạ trống (chưa vòng sync nào) thì quét ngay một lần. */
export type ReportingAdAccount = { id: string; name: string; timezone_name: string | null; token_env_var: string | null };

export async function reportingAdAccounts(scanIfEmpty = true): Promise<ReportingAdAccount[]> {
    const reportKinds = listAccountKinds().filter((l) => l.include_in_report).map((l) => l.code);
    const readAccounts = () => query<ReportingAdAccount>(
        `SELECT account_id AS id, name, timezone_name, token_env_var FROM ad_accounts
         WHERE category = ANY(@kinds) AND last_seen_at > now() - interval '7 days' ORDER BY name`, { kinds: reportKinds });
    let ds = await readAccounts();
    if (!ds.length && scanIfEmpty && metaTokens().length) {
        const co = await query<{ n: number }>("SELECT COUNT(*) AS n FROM ad_accounts");
        if (!co[0]?.n) {
            await scanNow().catch((e) => console.error("Quét TKQC lần đầu lỗi:", e?.message || e));
            ds = await readAccounts();
        }
    }
    return ds;
}

export type AdAccountRow = {
    account_id: string; name: string | null; account_status: number | null; currency: string | null; timezone_name: string | null;
    token_env_var: string | null;
    category: string; is_confirmed: boolean; first_seen_at: string; last_seen_at: string; note: string | null;
    spend_7d: number; spend_30d: number; last_spend_date: string | null;
};

/** Danh bạ kèm chi tiêu (mọi TKQC, kể cả loại ngoài báo cáo) — trang /admin → TKQC. */
export async function getAdAccountDirectory(): Promise<AdAccountRow[]> {
    return query<AdAccountRow>(`
        SELECT t.account_id, t.name, t.account_status, t.currency, t.timezone_name, t.token_env_var, t.category, t.is_confirmed,
               t.first_seen_at, t.last_seen_at, t.note,
               COALESCE(SUM(f.spend) FILTER (WHERE f.date >= CURRENT_DATE - 6), 0)  AS spend_7d,
               COALESCE(SUM(f.spend) FILTER (WHERE f.date >= CURRENT_DATE - 29), 0) AS spend_30d,
               to_char(MAX(f.date) FILTER (WHERE f.spend > 0), 'YYYY-MM-DD')        AS last_spend_date
        FROM ad_accounts t
        LEFT JOIN fb_ads_all f ON f.account_id = t.account_id
        GROUP BY t.account_id
        ORDER BY t.is_confirmed, spend_30d DESC, t.name`);
}

/** Đổi loại / ghi chú một TKQC — có tác dụng ngay ở mọi báo cáo (view fb_ads_data lọc theo loại). */
export async function setAccountKind(accountId: string, kind: string, note?: string | null): Promise<void> {
    if (!listAccountKinds().some((l) => l.code === kind)) throw new Error(`Loại lạ: ${kind}`);
    const n = await query("UPDATE ad_accounts SET category = @category, is_confirmed = true, note = COALESCE(@note, note) WHERE account_id = @id RETURNING 1",
        { id: String(accountId).replace(/^act_/, ""), category: kind, note: note ?? null });
    if (!n.length) throw new Error(`Không có TKQC ${accountId} trong danh bạ`);
}
