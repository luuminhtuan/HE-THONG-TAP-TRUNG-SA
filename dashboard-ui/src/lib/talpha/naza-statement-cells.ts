/**
 * Đọc ô / sheet của file sao kê NAZA: chuẩn hoá mã, số, ngày; tìm sheet, dòng tiêu đề, cột.
 * Tách khỏi naza-statement.ts (16/11/2026) — naza-statement.ts re-export nguyên tên.
 * Hàm thuần, nhận Buffer — không đọc đường dẫn, không gọi mạng.
 */
import ExcelJS from "exceljs";
import { CFG, SHEETS, ANCHORS } from "./naza-statement-config";

// ─────────────────────────────────────────────────────────────────────────
// Chuẩn hoá
// ─────────────────────────────────────────────────────────────────────────

/** Mã vận đơn: bỏ dấu cách và gạch, viết hoa. Bỏ số 0 ở đầu CHỈ KHI toàn chữ số
 *  — cùng một đơn được ghi '06722405704' ở file này và '6722405704' ở file kia.
 *  Giữ nguyên phần chữ vì mã 17TRACK có dạng '73N17897055'. Phải giống hệt
 *  `trkKey` trong cod-recon.ts, nếu không hai bên khoá lệch nhau. */
export function normTracking(v: unknown): string {
    const s = String(v ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    return /^\d+$/.test(s) ? s.replace(/^0+/, "") || s : s;
}

const STRIP_RULES = (CFG.order_id_strip || []).map((p) => new RegExp(p, "i"));

/** Mã đơn: bỏ tiền tố TAIWAN-, hậu tố -Z (chuyển tiếp) và -1 (lần giao lại).
 *  Mã đơn KHÔNG duy nhất — chỉ dùng làm khoá phụ, không bao giờ làm khoá chính. */
export function normOrderId(v: unknown): string {
    let s = String(v ?? "").trim().toUpperCase();
    // Mã kiểu 'T1467 (7564042426-z)' — phần trong ngoặc là mã lần giao trước.
    s = s.replace(/\s*\([^)]*\)\s*/g, " ").trim();
    for (const re of STRIP_RULES) s = s.replace(re, "");
    return s.trim();
}

/** Ô tiền/số có thể là number, hoặc chuỗi '1,499', hoặc công thức đã tính sẵn. */
export function toNumber(v: unknown): number | null {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "object") {
        const o = v as { result?: unknown; text?: unknown };
        if ("result" in o) return toNumber(o.result);
        if ("text" in o) return toNumber(o.text);
        return null;
    }
    const s = String(v).replace(/[^\d.,-]/g, "").replace(/,/g, "");
    if (!s || s === "-") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

export function cellText(v: unknown): string {
    if (v === null || v === undefined) return "";
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === "object") {
        const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[] };
        if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join("");
        if ("text" in o) return String(o.text ?? "");
        if ("result" in o) return String(o.result ?? "");
        return "";
    }
    return String(v).trim();
}

/** Ngày: ExcelJS trả Date cho ô định dạng ngày, còn lại là chuỗi kiểu
 *  '2026-08-25 10:58:27' hoặc '25/08/2026'. Trả về ISO yyyy-mm-dd. */
export function toIsoDate(v: unknown): string | null {
    if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
    const s = cellText(v);
    if (!s) return null;
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Tìm sheet và dòng tiêu đề
// ─────────────────────────────────────────────────────────────────────────
export type Grid = unknown[][];

function sheetMatches(title: string, tokens: string[]): boolean {
    const t = title.toUpperCase();
    return tokens.some((k) => t.includes(k.toUpperCase()));
}

/** Dò sheet PHÍ trước sheet COD: tên sheet COD ('COD账单') là chuỗi ngắn dễ
 *  lọt vào tên sheet phí, còn chiều ngược lại thì không. */
export function pickSheets(book: { name: string; grid: Grid }[]) {
    const feeTok = SHEETS.fee || ["运费", "VẬN CHUYỂN"];
    const codTok = SHEETS.cod || ["COD"];
    const sumTok = SHEETS.summary || ["汇总", "TỔNG", "TOTAL"];
    const fee = book.find((s) => sheetMatches(s.name, feeTok));
    const cod = book.find((s) => s !== fee && sheetMatches(s.name, codTok));
    const summary = book.find((s) => s !== fee && s !== cod && sheetMatches(s.name, sumTok)) || book[0];
    return { summary, cod, fee };
}

/** Dòng tiêu đề nằm ở r1, r3 hoặc r5 tuỳ file — dò 8 dòng đầu tìm neo 原单号. */
export function findHeader(grid: Grid, anchors: string[]): { row: number; cols: string[] } | null {
    for (let i = 0; i < Math.min(8, grid.length); i++) {
        const cells = (grid[i] || []).map(cellText);
        const joined = cells.join(" ");
        if (anchors.every((a) => joined.includes(a))) return { row: i, cols: cells };
    }
    return null;
}

/**
 * Chọn cột PHÍ SHIP và PHÍ THAO TÁC trong sheet phí.
 *
 * Chữ 快递运费 mang HAI nghĩa tuỳ file, nên không neo được bằng một từ:
 *   • file cũ ghi nhầm cột phí thao tác thành 快递运费, bên cạnh cột 速递运费;
 *   • từ kỳ 2026.9.11 NAZA đổi tên cột phí ship từ 速递运费 thành 快递运费, và
 *     cột phí thao tác ghi đúng là 操作费.
 * Bộ đọc cũ luôn coi 快递运费 là phí thao tác, nên kỳ 9.11 không thấy cột phí ship
 * nào, bỏ qua cả 85 dòng, và mục "phí đúng bảng giá" soát 0/0 dòng mà vẫn hiện xanh.
 *
 * Luật: có cột 操作费 thì đó là phí thao tác, và phí ship là 速递运费 hoặc (nếu
 * không có) 快递运费. Không có 操作费 thì theo kiểu file cũ: 快递运费 là phí thao tác.
 *
 * Từ kỳ 2026.09.24 NAZA đổi tiếp: phí thao tác ghi là 打包费 (phí đóng gói), và
 * chen thêm cột 头程运费 (phí chặng đầu, chỉ đơn Singapore có số) ngay sau cột
 * phí ship. Bộ đọc cũ không thấy 操作费 nên lấy "cột ngay sau phí ship" — chính là
 * cột chặng đầu — báo 96 đơn thu 0¥/7¥ và chi tiết lệch sheet TỔNG −288¥, trong
 * khi file đúng từng đồng.
 */
export function feeColumns(cols: string[]): { iFee: number; iOp: number; iFirstLeg: number } {
    const findCol = (tok: string) => cols.findIndex((c) => c.includes(tok));
    const iThaoTac = findCol("操作费") >= 0 ? findCol("操作费") : findCol("打包费");
    const iFirstLeg = findCol("头程运费");
    const iSuDi = findCol("速递运费");
    const iKuaiDi = findCol("快递运费");
    let iFee: number, iOp: number;
    if (iThaoTac >= 0) {
        iOp = iThaoTac;
        iFee = iSuDi >= 0 ? iSuDi : iKuaiDi;
    } else {
        iFee = iSuDi >= 0 ? iSuDi : iKuaiDi;
        iOp = iSuDi >= 0 && iKuaiDi >= 0 ? iKuaiDi : -1;
    }
    // Vẫn không thấy cột phí thao tác thì lấy cột ngay sau cột phí ship (như cũ) —
    // trừ khi cột đó là cột chặng đầu.
    if (iOp < 0 || iOp === iFee) iOp = iFee >= 0 && iFee + 1 !== iFirstLeg ? iFee + 1 : -1;
    return { iFee, iOp, iFirstLeg };
}

export function colIndex(cols: string[], anchorKey: string): number {
    const toks = ANCHORS[anchorKey] || [];
    for (const tok of toks) {
        const i = cols.findIndex((c) => c.includes(tok));
        if (i >= 0) return i;
    }
    return -1;
}

/** Dòng dữ liệu ăn khớp với cặp cột đang chọn: có mã đơn (không phải ngày giờ) và ô tiền là số. */
function rowFitsColumns(row: unknown[], iOrd: number, iVal: number): boolean {
    if (iOrd < 0 || iVal < 0) return false;
    return !!cellText(row[iOrd]) && toIsoDate(row[iOrd]) === null && toNumber(row[iVal]) !== null;
}

/**
 * Hàng tiêu đề LỆCH CỘT so với dữ liệu → độ dịch (0, +1, −1) phải cộng vào mọi chỉ số cột.
 *
 * Kỳ 2026.10.16 ("AT ĐỐI SOÁT TAIWAN 2026.10.16"): NAZA làm rơi ô tiêu đề 收货日期, cả hàng
 * tiêu đề sheet COD dồn sang trái một cột, cuối hàng lặp "COD金额" hai lần — dữ liệu vẫn nằm
 * chỗ cũ (cột A là ngày xuất kho). Đọc theo chữ tiêu đề thì mã đơn ra NGÀY, tiền COD ra
 * "中国台湾": bỏ cả 15 dòng, màn hình báo "không thấy dòng COD nào".
 * Thử từng độ dịch trên tối đa 20 dòng dữ liệu đầu, lấy độ dịch nhiều dòng khớp nhất; hoà
 * thì giữ 0 — file đúng mẫu không bị đụng tới.
 */
export function detectColumnShift(grid: Grid, headerRow: number, iOrd: number, iVal: number): number {
    const sampleRows = grid.slice(headerRow + 1).filter((r) => (r || []).some((c) => cellText(c))).slice(0, 20);
    let best = 0, bestScore = 0;
    for (const d of [0, 1, -1]) {
        const score = sampleRows.filter((r) => rowFitsColumns(r || [], iOrd + d, iVal + d)).length;
        if (score > bestScore) { best = d; bestScore = score; }
    }
    return best;
}

/** Cột ngày khi tiêu đề của nó bị mất (kỳ 2026.10.16): cột đầu tiên mà quá nửa dòng mẫu là ngày. */
export function findUnlabeledDateColumn(grid: Grid, headerRow: number): number {
    const sampleRows = grid.slice(headerRow + 1).filter((r) => (r || []).some((c) => cellText(c))).slice(0, 20);
    const width = Math.max(0, ...sampleRows.map((r) => (r || []).length));
    for (let i = 0; i < width; i++) {
        if (sampleRows.filter((r) => toIsoDate((r || [])[i]) !== null).length * 2 > sampleRows.length) return i;
    }
    return -1;
}

// ─────────────────────────────────────────────────────────────────────────
// Đọc file
// ─────────────────────────────────────────────────────────────────────────

export async function toGrids(buf: Buffer): Promise<{ name: string; grid: Grid }[]> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    return wb.worksheets.map((ws) => {
        const grid: Grid = [];
        ws.eachRow({ includeEmpty: true }, (row, n) => {
            const vals = row.values as unknown[];
            // ExcelJS đánh số cột từ 1 — bỏ phần tử 0 để về mảng 0-based. Ô trống là "lỗ"
            // (mảng thưa): .map() bỏ qua lỗ còn findIndex thì không → Array.from lấp thành
            // undefined (sao kê Sing 12/10/2026 có ô tiêu đề trống, cả file báo "không mở được").
            grid[n - 1] = Array.isArray(vals) ? Array.from(vals.slice(1)) : [];
        });
        for (let i = 0; i < grid.length; i++) if (!grid[i]) grid[i] = [];
        return { name: ws.name, grid };
    });
}

/** Mọi sheet của file .xlsx thành bảng chữ (ô ngày → yyyy-mm-dd) — cho bộ đọc sao kê
 *  không theo mẫu NAZA (lib/talpha/cod-statement-market.ts). */
export async function xlsxToTables(buf: Buffer): Promise<{ name: string; rows: string[][] }[]> {
    const book = await toGrids(buf);
    return book.map((s) => ({ name: s.name, rows: s.grid.map((r) => (r || []).map(cellText)) }));
}
