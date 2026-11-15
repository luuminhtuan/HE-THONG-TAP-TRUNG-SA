// ═══════════════════════════════════════════════════════════════════
// Thị trường nhập ở /admin → Thị trường (04/11/2026) — phủ lên config/talpha_rules.json.
//
// talpha_rules.json nằm trong git (máy chủ lấy code bằng `reset --hard`), nên nước thêm / sửa / tắt
// trên trang nằm ở bảng PHỦ market_overrides trong Postgres (15/11/2026 — trước đó file
// data/thi_truong.json). Bot không nối Postgres: hỏi dashboard GET /api/talpha/thi-truong?phu=1 bằng
// chìa nội bộ. Bản này cho bot; bản dashboard ở dashboard-ui/src/lib/talpha/thi-truong.ts, bản Python
// ở sync/core/thi_truong.py. Ba bản phải ra CÙNG kết quả — bộ dữ liệu chung
// tests/fixtures/thi_truong_phu.json (thi_truong.test.js).
//
// Bot đọc luật một lần lúc khởi động; dấu vân tay phần phủ đổi thì bot.js tự thoát để pm2 / docker
// dựng lại (xem theoDoiThiTruong ở đó). TALPHA_THI_TRUONG (chỉ test) trỏ vào một FILE phủ.
// ═══════════════════════════════════════════════════════════════════
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const CHI_O_FILE_PHU = new Set(["tokens", "team"]);
const laKhoi = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** Route trả phần phủ + dấu vân tay (dashboard đọc bảng market_overrides). */
const urlPhu = () => `${require("./config").dashboardBaseUrl}/api/talpha/thi-truong?phu=1`;

/** Dấu vân tay của phần phủ đã nạp lúc khởi động — null nếu không hỏi được dashboard. */
let vanTayLucNap = null;

function docFilePhu(p) {
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
function docPhu() {
    if (process.env.TALPHA_THI_TRUONG) return docFilePhu(process.env.TALPHA_THI_TRUONG);
    try {
        const out = execFileSync(process.execPath, [path.join(__dirname, "goi_api_dong_bo.js"), urlPhu()],
            { timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] });
        const j = JSON.parse(out.toString("utf8"));
        vanTayLucNap = typeof j.van_tay === "string" ? j.van_tay : null;
        const phu = j.phu || null;
        return phu && laKhoi(phu.markets) && Object.keys(phu.markets).length ? phu : null;
    } catch (e) {
        const lyDo = (e && e.stderr && e.stderr.toString().trim()) || (e && e.message) || e;
        console.error(`thi_truong: không lấy được thị trường nhập trên trang từ dashboard (${lyDo}) — chạy bằng luật gốc`);
        return null;
    }
}

/** Dấu vân tay phần phủ hiện tại trên dashboard, hoặc null nếu không hỏi được. */
async function layVanTay() {
    try {
        const r = await fetch(urlPhu(), { signal: AbortSignal.timeout(25_000) });
        if (!r.ok) return null;
        const j = await r.json();
        return typeof j.van_tay === "string" ? j.van_tay : null;
    } catch {
        return null;
    }
}

/**
 * Phủ file thị trường lên luật gốc. Không sửa `luat` truyền vào. Mỗi nước: ô trong file phủ đè ô
 * cùng tên, ô không nhắc tới giữ nguyên. Mã campaign đang thuộc nước KHÁC không bị giành. Nước có
 * `team` thì chỉ nằm ở đúng team đó.
 */
function phuLuat(luat, phu) {
    const out = JSON.parse(JSON.stringify(luat));
    out.markets = out.markets || {};
    out.market_aliases = out.market_aliases || {};
    out.camp_market_tokens = out.camp_market_tokens || [];
    const teams = (out.access && out.access.teams) || {};
    for (const [key, khoi] of Object.entries((phu && phu.markets) || {})) {
        if (key.startsWith("_") || !laKhoi(khoi)) continue;
        const moi = laKhoi(out.markets[key]) ? { ...out.markets[key] } : {};
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
                const ds = Array.isArray(t.markets) ? t.markets : [];
                t.markets = tk === team ? (ds.includes(key) ? ds : [...ds, key]) : ds.filter((m) => m !== key);
            }
        }
    }
    return out;
}

module.exports = { phuLuat, docPhu, layVanTay, vanTayDaNap: () => vanTayLucNap };
