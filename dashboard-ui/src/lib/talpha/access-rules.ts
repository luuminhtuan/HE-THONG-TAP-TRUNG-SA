// ═══════════════════════════════════════════════════════════════════
// TALPHA — PHÂN QUYỀN theo team / thị trường (Sỹ Anh chốt 05/10/2026).
//
// Ba thị trường là ba team riêng, không liên quan nhau: leader team nào chỉ thấy
// số của nước team đó. Luật khai ở config/talpha_rules.json → access (teams, roles);
// file này chỉ ĐỌC luật đó và trả lời ba câu: người này thấy nước nào, thấy tab nào,
// gọi API này được không. Cố ý THUẦN — không đụng next-auth, không đọc danh sách
// người dùng — để test được (tests/access.test.cjs) và để proxy.ts lẫn từng route
// dùng chung MỘT cách hiểu. Hai nơi tự hiểu luật là sớm muộn một nơi hở.
// ═══════════════════════════════════════════════════════════════════
import { RULES, PRIMARY_MARKET, CAMP_MARKETS } from "./rules";

/** Mọi tab của dashboard-shell.tsx. Thêm tab mới thì thêm ở đây và ở access.roles. */
export const ALL_TABS = [
    "overview", "pnl", "product-pnl",
    "order-ledger", "income-statement", "cod-recon", "tracking",
    "products", "marketing",
    "ad-spend", "ads-command", "ad-health",
    "ads-recon",
    "customers", "market-intel",
    "ask-ai",
] as const;

/**
 * Tab mà route phía sau CHƯA lọc theo nước — người chỉ được xem một phần số
 * thì không thấy tab, kẻo tab hiện nguyên số của team khác. Thêm tab mới mà route
 * chưa kịp lọc thì khai vào đây; lọc xong thì gỡ ra. (ad-spend, ads-command đã lọc
 * từ 05/10/2026 — nay rỗng.)
 */
export const TABS_NOT_MARKET_FILTERED = new Set<string>();

/** Tab chỉ giám đốc: soát tiền ra của thẻ trả TKQC chung cả công ty; Hỏi AI (15/11/2026) — AI truy vấn
 *  số MỌI nước, route /api/talpha/ceo-ask chưa lọc theo team. */
export const DIRECTOR_ONLY_TABS = new Set(["ads-recon", "ask-ai"]);

type TeamCfg = { name: string; markets: string[]; leader?: string };
type RoleCfg = { label: string; desc?: string; full?: boolean; tabs?: string[] };
type AccessCfg = { teams?: Record<string, TeamCfg | string>; roles?: Record<string, RoleCfg | string> };

const CFG: AccessCfg = (RULES as unknown as { access?: AccessCfg }).access || {};
const isConfigKey = (k: string) => !k.startsWith("_");

export const TEAMS: Record<string, TeamCfg> = Object.fromEntries(
    Object.entries(CFG.teams || {}).filter(([k, v]) => isConfigKey(k) && v && typeof v === "object"),
) as Record<string, TeamCfg>;
export const ROLES: Record<string, RoleCfg> = Object.fromEntries(
    Object.entries(CFG.roles || {}).filter(([k, v]) => isConfigKey(k) && v && typeof v === "object"),
) as Record<string, RoleCfg>;

// ── Tên nước (khoá trong `markets`: Taiwan…) ↔ mã shop (TW…) ──
const MARKETS = Object.entries(RULES.markets as Record<string, { shop_label?: string; shop_id?: string } | string>)
    .filter(([k, v]) => isConfigKey(k) && v && typeof v === "object" && (v as { shop_label?: string }).shop_label) as
    [string, { shop_label: string; shop_id?: string }][];
export const MARKET_CODE: Record<string, string> = Object.fromEntries(MARKETS.map(([k, v]) => [k, v.shop_label.toUpperCase()]));
export const MARKET_KEY: Record<string, string> = Object.fromEntries(MARKETS.map(([k, v]) => [v.shop_label.toUpperCase(), k]));
export const ALL_MARKET_KEYS: string[] = MARKETS.map(([k]) => k);

export type UserLike = {
    id?: string | null; name?: string | null; email?: string | null;
    role?: string | null; teams?: string[] | null; status?: string | null;
};

export type Access = {
    /** user = người đăng nhập · internal = bot/việc nền trên máy chủ · public = DASHBOARD_PUBLIC bật. */
    kind: "user" | "internal" | "public";
    id: string | null;
    name: string;
    email: string | null;
    role: string;
    roleLabel: string;
    /** Xem hết mọi nước, mọi tab, vào được /admin. */
    full: boolean;
    /** Khoá nước được xem ("Taiwan"…). */
    markets: string[];
    /** Mã shop tương ứng ("TW"…). */
    codes: string[];
    tabs: string[];
    teams: { key: string; name: string; markets: string[] }[];
};

const listTeams = (keys: string[]) =>
    keys.map((key) => ({ key, name: TEAMS[key].name, markets: TEAMS[key].markets.filter((m) => MARKET_CODE[m]) }));

export function fullAccess(kind: Access["kind"], name: string, extra: Partial<Access> = {}): Access {
    return {
        kind, id: null, name, email: null, role: "director", roleLabel: ROLES.director?.label || "Giám đốc",
        full: true,
        markets: [...ALL_MARKET_KEYS],
        codes: ALL_MARKET_KEYS.map((k) => MARKET_CODE[k]),
        tabs: [...ALL_TABS],
        teams: listTeams(Object.keys(TEAMS)),
        ...extra,
    };
}

/**
 * Tài khoản → quyền. Vai trò lạ, không có team, team đã xoá → KHÔNG thấy gì (mặc định
 * đóng): khai thiếu thì người đó báo "không thấy gì", chứ không lặng lẽ thấy hết.
 */
export function accessForUser(u: UserLike): Access {
    const role = String(u.role || "");
    const rc = ROLES[role];
    const base = { kind: "user" as const, id: u.id ?? null, name: String(u.name || u.email || ""), email: u.email ?? null };
    if (rc?.full) return fullAccess("user", base.name, { ...base, role, roleLabel: rc.label });

    const ds = u.teams || [];
    const teamKeys = ds.includes("*") ? Object.keys(TEAMS) : ds.filter((k) => TEAMS[k]);
    const markets = [...new Set(teamKeys.flatMap((k) => TEAMS[k].markets))].filter((m) => MARKET_CODE[m]);
    const hasAllMarkets = ALL_MARKET_KEYS.length > 0 && ALL_MARKET_KEYS.every((m) => markets.includes(m));
    const tabs = markets.length === 0 ? [] : (rc?.tabs || []).filter((t) =>
        (ALL_TABS as readonly string[]).includes(t) && !DIRECTOR_ONLY_TABS.has(t) && (hasAllMarkets || !TABS_NOT_MARKET_FILTERED.has(t)));
    return {
        ...base, role, roleLabel: rc?.label || role,
        full: false,
        markets,
        codes: markets.map((m) => MARKET_CODE[m]),
        tabs,
        teams: listTeams(teamKeys),
    };
}

/** `m` là khoá nước ("UAE") hoặc mã shop ("AE"), không phân biệt hoa thường với mã. */
export function canMarket(a: Access, m?: string | null): boolean {
    if (a.full) return true;
    const s = String(m || "");
    return a.markets.includes(s) || a.codes.includes(s.toUpperCase());
}

export function canTab(a: Access, tab: string): boolean {
    return a.full || a.tabs.includes(tab);
}

/**
 * Ghi vào kho việc đối soát (/api/talpha/cod-actions) — Sỹ Anh chốt 07/10/2026 khi tách mục
 * Kế toán. "Đã nhắn NAZA đòi tiền" là việc THEO ĐƠN, nằm ở Sổ đơn hàng: ai thấy Sổ đơn cũng ghi
 * được (sale đi đòi). Còn lại — tiền về ngân hàng, đã hỏi / bỏ qua một khoản lệch, huỷ việc đã
 * ghi — là việc KẾ TOÁN: chỉ người thấy Tiền COD về (leader nước đó, giám đốc). Cửa proxy đã
 * kiểm nước; hàm này chỉ phân loại việc.
 */
export function canWriteCodAction(a: Access, kind: string, action?: string | null): boolean {
    if (kind === "done" && action === "da_doi") return canTab(a, "order-ledger") || canTab(a, "cod-recon");
    return canTab(a, "cod-recon");
}

/** Xem đủ mọi nước — route khỏi cần lọc gì (giám đốc, bot, hoặc người được giao cả ba team). */
export function seesAllMarkets(a: Access): boolean {
    return a.full || ALL_MARKET_KEYS.every((m) => a.markets.includes(m));
}

// ═══════════════════════════════════════════════════════════════════
// API nào ai gọi được. Khớp TIỀN TỐ DÀI NHẤT; đường không khai = chỉ giám đốc
// (mặc định đóng — thêm route mới mà quên khai thì leader bị chặn, không bị hở).
//
//   tabs   — gọi được khi thấy ÍT NHẤT MỘT tab trong danh sách ("*" = ai đăng nhập cũng được)
//   full   — chỉ người xem hết (giám đốc, bot)
//   market — route chỉ phục vụ MỘT nước: "TW" cố định · "param" theo ?market= ·
//            "tracking" theo ?market= với luật của trackMarket (mã lạ = Đài Loan)
//   Route gộp nhiều nước (sheet-report, query…) tự lọc bên trong theo Access.
// ═══════════════════════════════════════════════════════════════════
export type ApiRule = { tabs?: string[] | "*"; full?: boolean; market?: "TW" | "param" | "tracking" };

export const API_RULES: Record<string, ApiRule> = {
    "/api/talpha/me": { tabs: "*" },
    "/api/talpha/markets": { tabs: "*" },
    "/api/talpha/report-config": { tabs: "*" },
    "/api/talpha/sync-health": { tabs: "*" },
    // Đèn "Cập nhật lúc…" + nút "Cập nhật ngay" trên thanh đầu — ai đăng nhập cũng xem, bấm được (15/11/2026).
    "/api/talpha/refresh": { tabs: "*" },

    "/api/talpha/sheet-report": { tabs: ["overview", "pnl", "marketing"] },
    "/api/talpha/pnl-costs": { tabs: ["overview", "pnl"] },
    // Lãi lỗ (Kế toán, 04/11/2026) — mọi vai có tab; route tự cắt theo nước của team, ghi chi phí
    // vận hành (nhánh /opex) route tự chặn chỉ giám đốc.
    "/api/talpha/income-statement": { tabs: ["income-statement"] },
    "/api/talpha/targets": { tabs: ["overview", "marketing"] },
    "/api/talpha/product-pnl": { tabs: ["product-pnl"] },
    "/api/talpha/product-costs": { tabs: ["product-pnl"] },
    "/api/talpha/inventory": { tabs: ["products", "overview"] },
    "/api/talpha/marketer-perf": { tabs: ["marketing"] },
    "/api/query": { tabs: ["marketing", "ad-health", "customers", "market-intel"] },

    // Sổ đơn / Tiền COD về / vận đơn — mỗi lượt gọi là MỘT nước. cod-actions mở cho Sổ đơn
    // để ghi "đã nhắn NAZA"; việc kế toán trong đó route tự chặn thêm bằng ghiCodDuoc().
    "/api/talpha/order-ledger": { tabs: ["order-ledger", "cod-recon"], market: "TW" },
    "/api/talpha/order-ledger/market": { tabs: ["order-ledger"], market: "param" },
    "/api/talpha/cod-recon": { tabs: ["cod-recon"], market: "TW" },
    "/api/talpha/cod-recon/market": { tabs: ["cod-recon"], market: "param" },
    "/api/talpha/cod-actions": { tabs: ["order-ledger", "cod-recon"], market: "TW" },
    "/api/talpha/tracking": { tabs: ["tracking"], market: "tracking" },
    "/api/talpha/tracking/import": { tabs: ["tracking"], market: "TW" },

    // Chi tiêu Meta theo campaign — route tự lọc theo nước ở tên campaign.
    "/api/talpha/ad-spend": { tabs: ["ad-spend"] },
    "/api/talpha/realtime": { tabs: ["ads-command"] },
    // Tin nhắn Pancake + đơn theo page của MỘT nước (Nhật: Meta không báo mess, 09/10/2026).
    "/api/talpha/pancake-messages": { tabs: ["ads-command", "marketing"], market: "param" },

    // Chỉ bot gọi (cảnh báo spend cả công ty, chưa tách nước) — không tab nào dùng.
    "/api/talpha/ads-alerts": { full: true },
    // Số nước × người của một tháng (bảng market_monthly_reports) — bot Zalo đọc thay file cũ.
    "/api/talpha/market-report": { full: true },
    "/api/talpha/ads-recon": { full: true },
    "/api/talpha/ceo-ask": { full: true },
    "/api/talpha/export-report": { full: true },
    "/api/talpha/sync-inventory": { full: true },
    "/api/talpha/credentials": { full: true },
    "/api/talpha/market-config": { full: true },
    "/api/talpha/ad-accounts": { full: true },
    "/api/users": { full: true },
};

export function apiRule(pathname: string): ApiRule | null {
    let best: string | null = null;
    for (const k of Object.keys(API_RULES)) {
        if ((pathname === k || pathname.startsWith(k + "/")) && (!best || k.length > best.length)) best = k;
    }
    return best ? API_RULES[best] : null;
}

/**
 * Người này gọi được API này không. `trackCode` đổi ?market= ra mã nước theo đúng luật
 * route vận đơn (lib/talpha/tracking.ts → trackMarket) — truyền vào thay vì import để
 * file này không kéo theo cả thư viện vận đơn.
 */
export function checkApi(
    a: Access, pathname: string, search: URLSearchParams,
    trackCode: (m: string | null) => string = (m) => String(m || "TW").toUpperCase(),
): { ok: true } | { ok: false; error: string } {
    if (a.full) return { ok: true };
    const rule = apiRule(pathname);
    if (!rule || rule.full) return { ok: false, error: "Chỉ giám đốc xem được mục này" };
    const tabs = rule.tabs || [];
    if (tabs !== "*" && !tabs.some((t) => a.tabs.includes(t))) {
        return { ok: false, error: "Tài khoản không có quyền xem mục này" };
    }
    if (rule.market) {
        const code = rule.market === "TW" ? "TW"
            : rule.market === "tracking" ? trackCode(search.get("market"))
            : String(search.get("market") || "").toUpperCase();
        if (!code || !canMarket(a, code)) {
            const label = MARKET_KEY[code] || code || "(không ghi nước)";
            return { ok: false, error: `Tài khoản không được xem thị trường ${label}` };
        }
    }
    return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// /api/query — cổng SQL chung của 4 tab (Marketing, Sức khoẻ QC, Khách hàng, Market Intel).
// Câu SQL dựng ở trình duyệt nên KHÔNG tin được. Route chạy câu bằng vai CHỈ ĐỌC của Postgres
// (migration 0003): người xem mọi nước → talpha_readonly; người xem một phần nước → talpha_readonly_market,
// vai mà database chỉ cho đọc đúng 5 bảng/view ở dieuKien() bên dưới. Với người xem một phần, mỗi
// bảng trong câu còn bị thay bằng một câu con đã lọc theo nước; câu còn đường nào khác tới dữ liệu
// (tên bảng khác, bảng hệ thống, hàm chạy câu SQL nằm trong chuỗi…) thì từ chối — thà tab trống một
// ô còn hơn lộ số team khác.
// ═══════════════════════════════════════════════════════════════════

/** Chuỗi SQL của Postgres: nháy đơn nhân đôi, gạch ngược giữ nguyên (standard_conforming_strings). */
const sqlStr = (s: string) => `'${s.replace(/'/g, "''")}'`;
const sqlList = (xs: string[]) => (xs.length ? xs.map(sqlStr).join(", ") : "NULL");

/**
 * Nước (khoá "Taiwan"…) của một dòng chi tiêu theo tên campaign — CÙNG luật với
 * campaignMarket() ở rules.ts: ô (tách bằng "/") đầu tiên là mã nước thắng; không ô
 * nào là nước → primary_market.
 */
export function sqlCampaignMarketKey(col = "campaign_name"): string {
    const pairs = Object.entries(CAMP_MARKETS).filter(([, m]) => m);
    const mac = sqlStr(PRIMARY_MARKET || "");
    if (!pairs.length) return mac;
    return `COALESCE((
        SELECT CASE UPPER(TRIM(seg)) ${pairs.map(([t, m]) => `WHEN ${sqlStr(t.toUpperCase())} THEN ${sqlStr(m)}`).join(" ")} END
        FROM unnest(string_to_array(COALESCE(${col}, ''), '/')) WITH ORDINALITY AS o_(seg, vi_tri)
        WHERE UPPER(TRIM(seg)) IN (${pairs.map(([t]) => sqlStr(t.toUpperCase())).join(", ")})
        ORDER BY vi_tri LIMIT 1
    ), ${mac})`;
}

/** Bảng → điều kiện lọc theo nước. Bảng không có ở đây = người xem một phần không được đụng
 *  (và vai talpha_readonly_market cũng không có quyền đọc — migration 0003 + sync/core/pg_view.py). */
const FILTERABLE_TABLES = ["vw_orders_std", "sale_order", "order_items", "vw_fb_ads_std", "vw_ad_windows"];
function marketFilterFor(table: string, a: Access): string | null {
    const codes = sqlList(a.codes);
    switch (table) {
        case "vw_orders_std": return `market IN (${codes})`;
        case "sale_order": return `UPPER(shop_label) IN (${codes})`;
        case "order_items":
            return `shop_id IN (SELECT DISTINCT shop_id FROM sale_order WHERE UPPER(shop_label) IN (${codes}))`;
        case "vw_fb_ads_std":
        case "vw_ad_windows":
            return `${sqlCampaignMarketKey("campaign_name")} IN (${sqlList(a.markets)})`;
        default: return null;
    }
}

/**
 * Che chuỗi '…' và chú thích -- bằng ký hiệu \u0000N\u0000 để việc thay bảng và soát câu chỉ chạy
 * trên phần CODE. Trả null khi câu có thứ máy tách không chắc bằng Postgres: dấu " (tên trong nháy
 * kép là TÊN BẢNG ở Postgres, không phải chuỗi), $ (chuỗi $$…$$), gạch ngược và E'…' (chuỗi có ký tự
 * thoát), U& (tên / chuỗi mã unicode), chú thích khối mở bằng "/" + "*" (lồng nhau được), nháy không đóng. Tách lệch
 * Postgres là kẽ hở: một đoạn code chạy thật mà máy tưởng là chuỗi thì không bị soát.
 */
function maskStringLiterals(sql: string): { code: string; chuoi: string[] } | null {
    if (/["$\\\u0000]|\/\*|\bU&|\b[eE]'/.test(sql)) return null;
    const literals: string[] = [];
    const code = sql.replace(/'(?:[^']|'')*'|--[^\n]*/g, (m) => {
        literals.push(m);
        return ` \u0000${literals.length - 1}\u0000 `;
    });
    if (/'/.test(code)) return null;     // nháy không đóng
    return { code, chuoi: literals };
}

/**
 * `bangKhac`: tên MỌI bảng / view khác trong database (route lấy danh sách lúc chạy) — câu nhắc tới
 * bất kỳ cái nào là từ chối, kể cả bảng không có số tiền: soát theo danh sách đóng chứ không đoán.
 */
export function scopeQuery(
    sql: string, a: Access, otherTables: string[] = [],
): { ok: true; sql: string } | { ok: false; error: string } {
    if (seesAllMarkets(a)) return { ok: true, sql };
    const reject = (reason: string) => ({ ok: false as const, error: `Câu truy vấn có ${reason} — không cho phép với tài khoản xem một phần nước` });
    if (/__T\d+__/.test(sql)) return reject("ký hiệu __T…__");
    const che = maskStringLiterals(sql);
    if (!che) return reject("dấu \", $, gạch ngược, chuỗi E'…' / U&, chú thích khối hoặc dấu nháy không đóng");
    // Soát TRƯỚC khi thay bảng: thay xong thì "db.public.sale_order" chỉ còn "db. (câu con)".
    const THREE_PART_NAME = /\b[A-Za-z_]\w*\s*\.\s*[A-Za-z_]\w*\s*\.\s*[A-Za-z_]\w*\b(?!\s*\()/;
    if (THREE_PART_NAME.test(che.code)) return reject("đường dẫn bảng 3 phần");

    const replacements: string[] = [];
    let error: string | null = null;
    // Tên bảng của dashboard, có hoặc không có tiền tố schema "public." — mọi chỗ nó xuất hiện trong code.
    const re = new RegExp(`(?:\\bpublic\\s*\\.\\s*)?\\b(${[...FILTERABLE_TABLES, "vw_attribution_quality", "fb_ads_data", "fb_adset_data"].join("|")})\\b`, "gi");
    const withPlaceholders = che.code.replace(re, (_m, table: string) => {
        const b = table.toLowerCase();
        const dk = marketFilterFor(b, a);
        if (!dk) { error = error || `Bảng ${b} gộp số mọi nước — tài khoản chỉ xem một phần nước không đọc được`; return " "; }
        replacements.push(`(SELECT * FROM ${b} WHERE ${dk})`);
        return ` __T${replacements.length - 1}__ `;
    });
    if (error) return { ok: false, error: error };
    if (!replacements.length) return { ok: false, error: "Câu truy vấn không đọc bảng nào của dashboard" };

    // Phần code còn lại không được có đường nào khác tới dữ liệu.
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
    const khac = otherTables.map((b) => b.toLowerCase()).filter((b) => b && !FILTERABLE_TABLES.includes(b));
    const forbidden: [RegExp, string][] = [
        [/\bpg_\w*/i, "bảng / hàm hệ thống pg_…"],
        [/\binformation_schema\b/i, "information_schema"],
        // Hàm chạy một câu SQL nằm trong chuỗi — chuỗi đã bị che nên câu bên trong không được thay bảng.
        [/\b(\w*_to_xml\w*|xmlschema\w*|ts_stat|ts_rewrite|set_config|dblink\w*|lo_\w+)\s*\(/i, "hàm chạy câu SQL / đổi cấu hình"],
        [/\bpublic\s*\./i, "schema public."],
        ...khac.map((b): [RegExp, string] => [new RegExp(`\\b${esc(b)}\\b`, "i"), `bảng ${b}`]),
    ];
    for (const [r, label] of forbidden) if (r.test(withPlaceholders)) return reject(label);

    const finalSql = withPlaceholders
        .replace(/ __T(\d+)__ /g, (_m, i: string) => ` ${replacements[Number(i)]} `)
        .replace(/ \u0000(\d+)\u0000 /g, (_m, i: string) => che.chuoi[Number(i)]);
    return { ok: true, sql: finalSql };
}
