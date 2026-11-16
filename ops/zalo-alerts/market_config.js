// ═══════════════════════════════════════════════════════════════════
// Thị trường nhập ở /admin → Thị trường (04/11/2026) — phủ lên config/talpha_rules.json.
//
// talpha_rules.json nằm trong git (máy chủ lấy code bằng `reset --hard`), nên nước thêm / sửa / tắt
// trên trang nằm ở bảng PHỦ market_overrides trong Postgres (15/11/2026 — trước đó file
// data/thi_truong.json). Bot không nối Postgres: hỏi dashboard GET /api/talpha/market-config?overrides=1 bằng
// chìa nội bộ. Bản này cho bot; bản dashboard ở dashboard-ui/src/lib/talpha/market-config.ts, bản Python
// ở sync/core/market_config.py. Ba bản phải ra CÙNG kết quả — bộ dữ liệu chung
// tests/fixtures/market_overrides.json (market_config.test.js).
//
// Bot đọc luật một lần lúc khởi động; dấu vân tay phần phủ đổi thì bot.js tự thoát để pm2 / docker
// dựng lại (xem theoDoiThiTruong ở đó). TALPHA_MARKET_OVERRIDES_FILE (chỉ test) trỏ vào một FILE phủ.
//
// Phần phủ hỏi dashboard BẤT ĐỒNG BỘ: điểm chạy (bot.js, pair.js) gọi primeMarketOverrides() TRƯỚC khi
// require module đọc luật (rules.js đọc đồng bộ lúc được require). Trước 16/11/2026 chỗ này gọi
// execFileSync(fetch_sync.js) — chặn cả tiến trình tới 30 giây khi dashboard chậm.
// ═══════════════════════════════════════════════════════════════════
const fs = require("fs");

const OVERRIDE_ONLY_FIELDS = new Set(["tokens", "team"]);
const isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** Route trả phần phủ + dấu vân tay (dashboard đọc bảng market_overrides). */
const overridesUrl = () => `${require("./config").dashboardBaseUrl}/api/talpha/market-config?overrides=1`;

/** Dấu vân tay của phần phủ đã nạp lúc khởi động — null nếu không hỏi được dashboard. */
let loadedFingerprint = null;
/** Phần phủ đã hỏi được (null = chưa ai nhập / không hỏi được); undefined = chưa gọi primeMarketOverrides(). */
let primedOverrides;

function readOverrides(p) {
    if (!fs.existsSync(p)) return null;
    try {
        return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch (e) {
        console.error(`thi_truong: ${p} hỏng định dạng (${e.message}) — bỏ qua thị trường nhập trên trang`);
        return null;
    }
}

/** Phần phủ, hoặc null nếu chưa ai nhập. Không hỏi được dashboard thì KÊU và chạy bằng luật gốc —
 *  không làm sập bot; theoDoiThiTruong (bot.js) thấy vân tay khác là tự khởi động lại để nạp đủ. */
async function primeMarketOverrides() {
    if (process.env.TALPHA_MARKET_OVERRIDES_FILE) return;
    try {
        const r = await fetch(overridesUrl(), { signal: AbortSignal.timeout(30_000) });
        const body = await r.text();
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${body.slice(0, 200)}`);
        const j = JSON.parse(body);
        loadedFingerprint = typeof j.fingerprint === "string" ? j.fingerprint : null;
        const overrides = j.overrides || null;
        primedOverrides = overrides && isPlainObject(overrides.markets) && Object.keys(overrides.markets).length ? overrides : null;
    } catch (e) {
        primedOverrides = null;
        console.error(`market_config: không lấy được thị trường nhập trên trang từ dashboard (${(e && e.message) || e}) — chạy bằng luật gốc`);
    }
}

function loadMarketOverrides() {
    if (process.env.TALPHA_MARKET_OVERRIDES_FILE) return readOverrides(process.env.TALPHA_MARKET_OVERRIDES_FILE);
    if (primedOverrides === undefined) {
        console.error("market_config: luật được nạp TRƯỚC primeMarketOverrides() — chạy bằng luật gốc, THIẾU thị trường nhập trên trang");
        return null;
    }
    return primedOverrides;
}

/** Dấu vân tay phần phủ hiện tại trên dashboard, hoặc null nếu không hỏi được. */
async function fetchOverridesFingerprint() {
    try {
        const r = await fetch(overridesUrl(), { signal: AbortSignal.timeout(25_000) });
        if (!r.ok) return null;
        const j = await r.json();
        return typeof j.fingerprint === "string" ? j.fingerprint : null;
    } catch {
        return null;
    }
}

/**
 * Phủ file thị trường lên luật gốc. Không sửa `luat` truyền vào. Mỗi nước: ô trong file phủ đè ô
 * cùng tên, ô không nhắc tới giữ nguyên. Mã campaign đang thuộc nước KHÁC không bị giành. Nước có
 * `team` thì chỉ nằm ở đúng team đó.
 */
function applyMarketOverrides(rules, overrides) {
    const out = JSON.parse(JSON.stringify(rules));
    out.markets = out.markets || {};
    out.market_aliases = out.market_aliases || {};
    out.camp_market_tokens = out.camp_market_tokens || [];
    const teams = (out.access && out.access.teams) || {};
    for (const [key, block] of Object.entries((overrides && overrides.markets) || {})) {
        if (key.startsWith("_") || !isPlainObject(block)) continue;
        const merged = isPlainObject(out.markets[key]) ? { ...out.markets[key] } : {};
        for (const [k, v] of Object.entries(block)) if (!OVERRIDE_ONLY_FIELDS.has(k)) merged[k] = v;
        out.markets[key] = merged;

        for (const t of Array.isArray(block.tokens) ? block.tokens : []) {
            const T = String(t).trim().toUpperCase();
            if (!T) continue;
            const ownerKey = out.market_aliases[T];
            if (ownerKey && ownerKey !== key) continue;
            out.market_aliases[T] = key;
            if (!out.camp_market_tokens.includes(T)) out.camp_market_tokens.push(T);
        }

        const team = typeof block.team === "string" ? block.team : null;
        if (team && isPlainObject(teams[team])) {
            for (const [teamKey, t] of Object.entries(teams)) {
                if (!isPlainObject(t)) continue;
                const teamMarkets = Array.isArray(t.markets) ? t.markets : [];
                t.markets = teamKey === team ? (teamMarkets.includes(key) ? teamMarkets : [...teamMarkets, key]) : teamMarkets.filter((m) => m !== key);
            }
        }
    }
    return out;
}

module.exports = {
    applyMarketOverrides, primeMarketOverrides, loadMarketOverrides, fetchOverridesFingerprint,
    getLoadedFingerprint: () => loadedFingerprint,
};
