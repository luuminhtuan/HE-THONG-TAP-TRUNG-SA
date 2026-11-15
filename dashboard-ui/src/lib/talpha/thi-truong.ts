// ═══════════════════════════════════════════════════════════════════
// Thị trường nhập ở /admin → Thị trường (04/11/2026) — phần THUẦN: phủ lên talpha_rules.json
// và soát khối nhập vào. Phần đụng đĩa ở lib/talpha/thi-truong-luu.ts. Có test: tests/thi-truong.test.cjs.
//
// talpha_rules.json nằm trong git, mà máy chủ lấy code bằng `reset --hard origin/main` — sửa nó
// trên trang là lần deploy sau mất. Nên nước thêm / sửa / tắt trên trang nằm ở file PHỦ ngoài git
// (data/thi_truong.json), và mọi nơi đọc luật phủ file đó lên bản gốc:
//   • dashboard: lib/talpha/rules.ts (bản này)
//   • sync, Sheet, view Postgres (sync/core/pg_view.py): sync/core/thi_truong.py
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
 * Nước của một campaign theo `luat` truyền vào — CÙNG cách campaignMarket (rules.ts): ô nào trong
 * tên (tách bằng "/") là mã nước thì lấy, ô trái nhất thắng. null = không ô nào là mã nước (rules.ts
 * khi đó tính về nước mặc định). Dùng khi cần luật MỚI NHẤT (vd soát trước khi xoá nước vừa thêm),
 * còn lại dùng campaignMarket.
 */
export function nuocCuaCamp(ten: string | null | undefined, luat: LuatCoThiTruong): string | null {
    const aliases = luat.market_aliases || {};
    const ma: Record<string, string> = Object.fromEntries(
        (luat.camp_market_tokens || []).map((t) => [String(t).toUpperCase(), aliases[t]]));
    return String(ten || "").split("/").map((x) => ma[x.trim().toUpperCase()]).find(Boolean) || null;
}

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

const teamCua = (key: string, luat: LuatCoThiTruong): string | null =>
    Object.entries(luat.access?.teams || {}).find(([, t]) => laKhoi(t) && Array.isArray(t.markets) && (t.markets as string[]).includes(key))?.[0] || null;
const soHoacNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Một nước của luật (đã phủ) ở dạng ô nhập trên trang — để mở form sửa. */
export function nhapTuLuat(key: string, luat: LuatCoThiTruong): ThiTruongNhap {
    const v = (laKhoi(luat.markets?.[key]) ? luat.markets![key] : {}) as Record<string, unknown>;
    const status = String(v.status || "dang_ban");
    return {
        key,
        display: String(v.display || key),
        shop_label: String(v.shop_label || ""),
        currency: String(v.currency || ""),
        currency_symbol: String(v.currency_symbol || v.currency || ""),
        rate_vnd: soHoacNull(v.rate_vnd),
        pos_money_divisor: soHoacNull(v.pos_money_divisor),
        shop_id: String(v.shop_id || ""),
        status: (["dang_ban", "sap_chay", "da_tat"].includes(status) ? status : "dang_ban") as ThiTruongNhap["status"],
        orders_from: typeof v.orders_from === "string" ? v.orders_from : null,
        flag: String(v.flag || ""),
        tokens: Object.entries(luat.market_aliases || {})
            .filter(([t, m]) => !t.startsWith("_") && m === key && (luat.camp_market_tokens || []).includes(t)).map(([t]) => t),
        team: teamCua(key, luat),
    };
}

/**
 * Khối ghi vào file phủ cho một nước nhập trên trang. Nước có trong talpha_rules.json thì CHỈ ghi
 * ô khác bản gốc — ô không sửa vẫn theo file gốc, sửa file gốc (qua git) vẫn có tác dụng. Nước
 * thêm trên trang thì ghi đủ. Mã campaign chỉ ghi mã MỚI; team chỉ ghi khi khác team gốc.
 */
export function khoiPhuTuNhap(n: ThiTruongNhap, goc: LuatCoThiTruong): KhoiPhu {
    // So với đúng cái form HIỆN cho bản gốc (đã điền mặc định: ký hiệu tiền = mã tiền…), không so
    // với ô thô — không thì bấm Lưu mà chẳng sửa gì vẫn ghi ô mặc định vào file phủ.
    const cu = laKhoi(goc.markets?.[n.key]) ? (nhapTuLuat(n.key, goc) as unknown as Record<string, unknown>) : null;
    const o: Record<string, unknown> = {
        display: n.display.trim(), shop_label: n.shop_label, currency: n.currency, currency_symbol: n.currency_symbol.trim(),
        rate_vnd: n.rate_vnd, pos_money_divisor: n.pos_money_divisor, shop_id: n.shop_id, status: n.status,
        orders_from: n.orders_from, flag: n.flag.trim(),
    };
    const trong = (x: unknown) => x === undefined || x === null || x === "";
    const khoi: KhoiPhu = {};
    for (const [k, v] of Object.entries(o)) {
        if (cu ? JSON.stringify(cu[k]) === JSON.stringify(v) : trong(v)) continue;
        khoi[k] = v;
    }
    const tokGoc = new Set(nhapTuLuat(n.key, goc).tokens);
    const tokMoi = [...new Set(n.tokens.map((t) => t.trim().toUpperCase()).filter(Boolean))].filter((t) => !tokGoc.has(t));
    if (tokMoi.length) khoi.tokens = tokMoi;
    if (n.team && n.team !== teamCua(n.key, goc)) khoi.team = n.team;
    return khoi;
}

/**
 * Lỗi của một nước nhập trên trang (rỗng = lưu được). `luat` là luật ĐÃ phủ hiện tại;
 * `laMoi` = thêm nước mới (khoá chưa có). Luật chặn đúng những thứ đã làm sai số thật:
 *   • mã shop vào thẳng câu SQL của view (sync/core/pg_view.py) → chỉ chữ in hoa;
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
