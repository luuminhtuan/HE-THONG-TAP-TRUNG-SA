/**
 * BẢN CHẠY Ở MÁY — đọc file từ đĩa, gọi engine dùng chung, lưu kỳ xuống đĩa.
 *
 * Phần nghiệp vụ nằm hết trong engine (xem src/engine.mjs). File này chỉ lo
 * ba việc mà engine cố tình không làm: đọc đĩa, lưu kỳ, và nhớ kỳ trước.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { reconcile, readAnySheets, detectKind, REPO_ROOT } from "./engine.mjs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Mỗi kỳ một thư mục: data/periods/<tuần ISO>/result.json + sources/ (bản sao file gốc). */
export const PERIODS_DIR = join(ROOT, "data", "periods");
export const RULES_FILE = join(REPO_ROOT, "config", "talpha_rules.json");

const RESULT_FILE = "result.json";
// Kỳ chạy trước khi đổi tên (16/11/2026) lưu "ket-qua.json" — vẫn đọc làm lịch sử nếu ai chép sang.
const LEGACY_RESULT_FILE = "ket-qua.json";

/** Luật nằm chung trong talpha_rules.json → khối ads_settlement. */
export function loadConfig(path = RULES_FILE) {
    const all = JSON.parse(readFileSync(path, "utf8"));
    const cfg = all.ads_settlement;
    if (!cfg) throw new Error(`Không thấy khối "ads_settlement" trong ${path}`);
    return cfg;
}

/** Roster TKQC cho bản dòng lệnh: file roster_file (dashboard thì lấy từ bảng tkqc). */
function loadRoster(cfg) {
    try {
        const p = resolve(REPO_ROOT, cfg.ad_accounts?.roster_file || "");
        return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
    } catch { return null; }
}

/**
 * Các kỳ đã đối soát, cũ → mới. Lọc kỳ cũ hơn kỳ đang chạy để so tăng/giảm
 * không bị ngược chiều khi chạy lại một kỳ cũ.
 */
export function loadHistory(excludePeriod = null) {
    if (!existsSync(PERIODS_DIR)) return [];
    const out = [];
    for (const d of readdirSync(PERIODS_DIR).sort()) {
        if (excludePeriod && d >= excludePeriod) continue;
        const f = [RESULT_FILE, LEGACY_RESULT_FILE].map((n) => join(PERIODS_DIR, d, n)).find(existsSync);
        if (!f) continue;
        try {
            const j = JSON.parse(readFileSync(f, "utf8"));
            out.push({ ky: j.ky, chay_luc: j.chay_luc, summary: j.summary, files: j.files });
        } catch { /* kỳ hỏng thì bỏ qua, không được làm chết lượt chạy mới */ }
    }
    return out;
}

/** Đọc một file từ đĩa (hoặc từ buffer) rồi nhận diện nó là nguồn nào. */
export async function loadFile(path, cfg, buffer = null, opts = {}) {
    const sheets = await readAnySheets(path, buffer, opts);
    return { sheets, kind: detectKind(sheets, cfg), name: basename(path) };
}

/**
 * @param {Array<{path:string, buffer?:Buffer, name?:string}>} files — mọi file
 *        của kỳ này; không cần đúng thứ tự, mỗi phía bao nhiêu file cũng được.
 * @param {{cfg?: object, save?: boolean, password?: string}} [opts] password — mở PDF bị khoá
 */
export async function runReconciliation(files, { cfg = loadConfig(), save = true, password = "" } = {}) {
    const list = Array.isArray(files) ? files : [files];
    if (list.length < 2) throw new Error("Cần ít nhất 2 file: chi phí TKQC và sao kê thẻ");

    const docs = [];
    const readOpts = password ? { password } : {};
    for (const f of list) docs.push({ ...(await loadFile(f.path, cfg, f.buffer || null, readOpts)), src: f });

    const result = reconcile(docs, cfg, { roster: loadRoster(cfg), history: loadHistory() });

    if (save) {
        const dir = join(PERIODS_DIR, result.ky);
        mkdirSync(join(dir, "sources"), { recursive: true });
        writeFileSync(join(dir, RESULT_FILE), JSON.stringify(result, null, 2), "utf8");
        for (const f of list) {
            try {
                if (f.buffer) writeFileSync(join(dir, "sources", f.name || basename(f.path)), f.buffer);
                else if (existsSync(f.path)) copyFileSync(f.path, join(dir, "sources", basename(f.path)));
            } catch { /* lưu bản gốc là tiện lợi, hỏng thì không được chặn kết quả */ }
        }
        result.saved_to = dir;
    }
    return result;
}
