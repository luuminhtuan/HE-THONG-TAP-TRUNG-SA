// ═══════════════════════════════════════════════════════════════════
// Thị trường nhập ở /admin → Thị trường (04/11/2026) — phần THUẦN: phủ lên talpha_rules.json
// và soát khối nhập vào. Phần đụng đĩa ở lib/talpha/thi-truong-luu.ts. Có test: tests/thi-truong.test.cjs.
//
// talpha_rules.json nằm trong git, mà máy chủ lấy code bằng `reset --hard origin/main` — sửa nó
// trên trang là lần deploy sau mất. Nên nước thêm / sửa / tắt trên trang nằm ở file PHỦ ngoài git
// (data/thi_truong.json), và mọi nơi đọc luật phủ file đó lên bản gốc:
//   • dashboard: lib/talpha/rules.ts (bản này)
//   • sync, Sheet, view BigQuery: sync/core/thi_truong.py
//   • bot Zalo: ops/zalo-alerts/thi_truong.js
// Ba bản phải ra CÙNG kết quả — bộ dữ liệu chung tests/fixtures/thi_truong_phu.json.
// ═══════════════════════════════════════════════════════════════════

/** Một nước trong file phủ: các ô của markets.<nước>, cộng hai ô chỉ có ở đây. */
export type KhoiPhu = Record<string, unknown> & {
    /** Mã nước trên tên campaign ("TH", "THAI"…) → market_aliases + camp_market_tokens. */
    tokens?: string[];
    /** Team phụ trách (khoá ở access.teams) — nước chỉ nằm ở MỘT team. */
    team?: string;
};
export type FilePhu = { markets?: Record<string, KhoiPhu | unknown>; updated_at?: string; updated_by?: string };

const CHI_O_FILE_PHU = new Set(["tokens", "team"]);
const laKhoi = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

type LuatCoThiTruong = {
    markets?: Record<string, unknown>;
    market_aliases?: Record<string, string>;
    camp_market_tokens?: string[];
    access?: { teams?: Record<string, unknown> };
};

/**
 * Phủ file thị trường lên luật gốc. Không sửa `luat` truyền vào.
 * Mỗi nước: ô trong file phủ đè ô cùng tên của bản gốc, ô không nhắc tới giữ nguyên.
 * Mã campaign đang thuộc nước KHÁC không bị giành — chi tiêu nước đó không được nhảy sang nước mới.
 */
export function phuLuat<T extends LuatCoThiTruong>(luat: T, phu: FilePhu | null | undefined): T {
    const out = JSON.parse(JSON.stringify(luat)) as T & Required<Pick<LuatCoThiTruong, "markets" | "market_aliases" | "camp_market_tokens">>;
    out.markets = out.markets || {};
    out.market_aliases = out.market_aliases || {};
    out.camp_market_tokens = out.camp_market_tokens || [];
    const teams = out.access?.teams || {};
    for (const [key, khoi] of Object.entries(phu?.markets || {})) {
        if (key.startsWith("_") || !laKhoi(khoi)) continue;
        const moi: Record<string, unknown> = laKhoi(out.markets[key]) ? { ...(out.markets[key] as object) } : {};
        for (const [k, v] of Object.entries(khoi)) if (!CHI_O_FILE_PHU.has(k)) moi[k] = v;
        out.markets[key] = moi;

        for (const t of Array.isArray(khoi.tokens) ? khoi.tokens : []) {
            const T = String(t).trim().toUpperCase();
            if (!T) continue;
            const cua = out.market_aliases[T];
            if (cua && cua !== key) continue;
            out.market_aliases[T] = key;
            if (!out.camp_market_tokens.includes(T)) out.camp_market_tokens.push(T);
        }

        const team = typeof khoi.team === "string" ? khoi.team : null;
        if (team && laKhoi(teams[team])) {
            for (const [tk, t] of Object.entries(teams)) {
                if (!laKhoi(t)) continue;
                const ds = Array.isArray(t.markets) ? (t.markets as string[]) : [];
                t.markets = tk === team ? (ds.includes(key) ? ds : [...ds, key]) : ds.filter((m) => m !== key);
            }
        }
    }
    return out;
}

// ─── Soát khối nhập trên trang ──────────────────────────────────────

export type ThiTruongNhap = {
    key: string; display: string; shop_label: string; currency: string; currency_symbol: string;
    rate_vnd: number | null; pos_money_divisor: number | null; shop_id: string;
    status: "dang_ban" | "sap_chay" | "da_tat"; orders_from: string | null;
    flag: string; tokens: string[]; team: string | null;
};

/**
 * Lỗi của một nước nhập trên trang (rỗng = lưu được). `luat` là luật ĐÃ phủ hiện tại;
 * `laMoi` = thêm nước mới (khoá chưa có). Luật chặn đúng những thứ đã làm sai số thật:
 *   • mã shop vào thẳng câu SQL của view BigQuery → chỉ chữ in hoa;
 *   • nước đang bán / đã tắt thiếu tỷ giá hay số chia → doanh thu ra 0 hoặc lệch 100 lần;
 *   • mã campaign trùng nước khác → chi tiêu nước này chạy sang nước kia.
 */
export function loiThiTruong(n: ThiTruongNhap, luat: LuatCoThiTruong, laMoi: boolean): string[] {
    const loi: string[] = [];
    const markets = Object.entries(luat.markets || {}).filter(([k, v]) => !k.startsWith("_") && laKhoi(v)) as [string, Record<string, unknown>][];
    const khac = markets.filter(([k]) => k !== n.key);
    const cu = markets.find(([k]) => k === n.key)?.[1];

    if (!/^[A-Z][A-Za-z]{1,29}$/.test(n.key)) loi.push("Tên khoá phải là chữ cái không dấu, viết hoa chữ đầu (vd Thailand)");
    if (laMoi && cu) loi.push(`Đã có nước ${n.key}`);
    if (!laMoi && !cu) loi.push(`Chưa có nước ${n.key}`);
    if (!n.display.trim() || n.display.length > 40) loi.push("Tên hiển thị trống hoặc dài quá 40 ký tự");
    if (!/^[A-Z]{2,3}$/.test(n.shop_label)) loi.push("Mã shop phải là 2–3 chữ in hoa (vd TH)");
    if (cu && cu.shop_label && cu.shop_label !== n.shop_label) loi.push(`Không đổi được mã shop ${cu.shop_label} — đơn cũ đang mang mã đó`);
    if (khac.some(([, v]) => v.shop_label === n.shop_label)) loi.push(`Mã shop ${n.shop_label} đã thuộc nước khác`);
    if (!/^[A-Z]{3}$/.test(n.currency)) loi.push("Mã tiền tệ phải là 3 chữ in hoa (vd THB)");
    if (!n.currency_symbol.trim() || n.currency_symbol.length > 5) loi.push("Ký hiệu tiền trống hoặc dài quá 5 ký tự");
    if (n.flag.length > 8) loi.push("Cờ dài quá");
    if (!["dang_ban", "sap_chay", "da_tat"].includes(n.status)) loi.push("Trạng thái lạ");

    const canDu = n.status === "dang_ban" || n.status === "da_tat";
    if (n.rate_vnd !== null && !(Number.isFinite(n.rate_vnd) && n.rate_vnd > 0)) loi.push("Tỷ giá phải là số dương");
    if (canDu && n.rate_vnd === null) loi.push("Nước đang bán / đã tắt phải có tỷ giá");
    if (n.pos_money_divisor !== null && !(Number.isInteger(n.pos_money_divisor) && n.pos_money_divisor > 0)) loi.push("Số chia tiền POS phải là số nguyên dương");
    if (canDu && n.pos_money_divisor === null) loi.push("Nước đang bán / đã tắt phải có số chia tiền POS");
    if (n.shop_id && !/^\d{3,20}$/.test(n.shop_id)) loi.push("Mã shop POS chỉ gồm chữ số");
    if (canDu && !n.shop_id) loi.push("Nước đang bán / đã tắt phải có shop POS");
    if (n.shop_id && khac.some(([, v]) => String(v.shop_id || "") === n.shop_id)) loi.push(`Shop POS ${n.shop_id} đã thuộc nước khác`);
    if (n.orders_from !== null && !/^\d{4}-\d{2}-\d{2}$/.test(n.orders_from)) loi.push("Ngày bắt đầu tính đơn phải dạng YYYY-MM-DD");

    const aliases = luat.market_aliases || {};
    for (const t of n.tokens) {
        const T = t.trim().toUpperCase();
        if (!/^[\p{Lu}0-9]{2,20}$/u.test(T)) { loi.push(`Mã campaign "${t}" không hợp lệ (2–20 chữ hoặc số, không khoảng trắng)`); continue; }
        if (aliases[T] && aliases[T] !== n.key) loi.push(`Mã campaign ${T} đang thuộc ${aliases[T]}`);
    }
    if (!n.tokens.length) loi.push("Cần ít nhất một mã trên tên campaign (vd TH) — không có thì chi tiêu không tách được về nước này");
    const teams = luat.access?.teams || {};
    if (n.team !== null && !laKhoi(teams[n.team])) loi.push(`Không có team ${n.team}`);
    return loi;
}
