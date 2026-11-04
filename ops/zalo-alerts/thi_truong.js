// ═══════════════════════════════════════════════════════════════════
// Thị trường nhập ở /admin → Thị trường (04/11/2026) — phủ lên config/talpha_rules.json.
//
// talpha_rules.json nằm trong git (máy chủ lấy code bằng `reset --hard`), nên nước thêm / sửa / tắt
// trên trang nằm ở file PHỦ ngoài git: data/thi_truong.json. Bản này cho bot; bản dashboard ở
// dashboard-ui/src/lib/talpha/thi-truong.ts, bản Python ở sync/core/thi_truong.py. Ba bản phải ra
// CÙNG kết quả — bộ dữ liệu chung tests/fixtures/thi_truong_phu.json (thi_truong.test.js).
//
// Bot đọc luật một lần lúc khởi động; file phủ đổi thì bot.js tự thoát để pm2 dựng lại (xem
// theoDoiThiTruong ở đó).
// ═══════════════════════════════════════════════════════════════════
const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..", "..");
const CHI_O_FILE_PHU = new Set(["tokens", "team"]);
const laKhoi = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** data/thi_truong.json của repo; TALPHA_THI_TRUONG trỏ chỗ khác (test). */
const duongDanPhu = () => process.env.TALPHA_THI_TRUONG || path.join(REPO, "data", "thi_truong.json");

/** File phủ, hoặc null nếu chưa ai nhập. Hỏng thì KÊU và bỏ qua — không làm sập bot. */
function docPhu() {
    const p = duongDanPhu();
    if (!fs.existsSync(p)) return null;
    try {
        return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch (e) {
        console.error(`thi_truong: ${p} hỏng định dạng (${e.message}) — bỏ qua thị trường nhập trên trang`);
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

module.exports = { phuLuat, docPhu, duongDanPhu };
