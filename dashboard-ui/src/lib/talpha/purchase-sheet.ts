// ═══════════════════════════════════════════════════════════════════
// TALPHA — FILE TIỀN HÀNG: tiền mua hàng phải trả ở mỗi kỳ đối soát COD
// ───────────────────────────────────────────────────────────────────
// Google Sheet ghi tay: mỗi dòng một lần mua (ngày · sản phẩm · số lượng · giá
// tệ/sp), và bên cạnh mỗi tuần có một ô ghi đợt thanh toán, kiểu:
//
//     THANH TOÁN NGÀY 14/8 TỔNG : 8.393.597 VND
//     （ ĐÃ THANH TOÁN 6.988.000 VND） CÒN THIẾU : 1.405.597 VND
//
// Đợt thanh toán rơi ĐÚNG ngày NAZA gửi sao kê COD mỗi tuần. Đó là mảnh cuối của
// luồng tiền NAZA:
//
//     COD (TWD) × tỷ giá → RMB − phí thao tác − phí ship → × tỷ giá → VND
//                                                      − PHÍ MUA HÀNG → PHẢI NHẬN
//
// Từ kỳ 21/08 NAZA tự trừ tiền hàng trong sao kê; 4 kỳ trước đó (24/07 → 14/08)
// Sỹ Anh tự chuyển khoản riêng. Khi NAZA trừ một số mà file này ghi số khác thì
// TIN FILE NÀY — Sỹ Anh chốt 13/09/2026.
//
// Module chỉ ĐỌC, không tính luồng tiền — việc đó ở api/talpha/order-ledger.
// ═══════════════════════════════════════════════════════════════════

import { RULES } from "./rules";
import { fetchSheetCsv } from "./sheet-source";

/** Một đợt thanh toán tiền hàng đọc được từ file. */
export type PurchasePayment = {
    ngay: string;                  // YYYY-MM-DD — ngày thanh toán
    tong_vnd: number;              // tổng phải trả của đợt (đã gồm nợ kỳ trước nếu có)
    moi_vnd: number;               // tiền hàng mới của kỳ này
    no_ky_truoc_vnd: number;       // phần nợ kỳ trước cộng dồn vào đợt này
    da_ghi_thanh_toan: boolean;    // file có chữ "ĐÃ THANH TOÁN"
    da_tra_vnd: number | null;     // số đã trả nếu file ghi rõ; null = file không ghi số
    con_thieu_vnd: number | null;  // "CÒN THIẾU" nếu file ghi rõ
    dong: number;                  // số dòng trong Sheet — để người đọc tra lại
    nguyen_van: string;            // chữ gốc của ô, đã gộp khoảng trắng
};

type Cfg = { sheet_id?: string; sheet_gid?: string; match_window_days?: number };
const CFG: Cfg = ((RULES as unknown as { cod_settlement?: { purchase_sheet?: Cfg } })
    .cod_settlement?.purchase_sheet) ?? {};

// ─────────────────────────────────────────────────────────────────────────
// CSV — đọc được ô có xuống dòng bên trong (ô ghi đợt thanh toán luôn có)
// ─────────────────────────────────────────────────────────────────────────
export function csvToGrid(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (q) {
            if (ch === '"') {
                if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
            } else cell += ch;
        } else if (ch === '"') q = true;
        else if (ch === ",") { row.push(cell); cell = ""; }
        else if (ch === "\n" || ch === "\r") {
            if (ch === "\r" && text[i + 1] === "\n") i++;
            row.push(cell); rows.push(row); row = []; cell = "";
        } else cell += ch;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows;
}

/** "1.009.562" · "6.988.000" → số. */
function parseVnd(s: string): number {
    return Number(String(s).replace(/[^\d]/g, "")) || 0;
}

// Số tiền: nhóm số ngăn bằng "." hoặc ",", cho phép MỘT dấu cách gõ nhầm ngay sau
// dấu ngăn. Đợt 2/10/2026 ghi "TỔNG : 420. 325 VND" — bộ đọc cũ trượt cả ô, kỳ
// sao kê 05/10 báo "không có đợt nào" dù NAZA trừ đúng 420.325đ. Cách mà không có
// dấu ngăn thì không nối ("2026 6.185.790" vẫn là hai số).
const NUM_RE = String.raw`\d+(?:[.,]\s?\d+)*`;
const RE_DATE = /THANH\s*TOÁN\s*NGÀY\s*(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{4}))?/;
const RE_TOTAL = new RegExp(String.raw`TỔNG\s*:?\s*(${NUM_RE})\s*VN`);
const RE_SUM = new RegExp(String.raw`(${NUM_RE})\s*\+\s*(${NUM_RE})`);
const RE_PAID_AMOUNT = new RegExp(String.raw`ĐÃ\s*THANH\s*TOÁN\s*(${NUM_RE})`);
const RE_PAID = /ĐÃ\s*THANH\s*TOÁN/;
const RE_OUTSTANDING = new RegExp(String.raw`CÒN\s*THIẾU\s*:?\s*(${NUM_RE})`);

/**
 * Tìm mọi đợt thanh toán trong lưới ô.
 *
 * Năm: ô ghi "27/7" không có năm. Lấy năm gần nhất từng thấy trong file (ô ngày
 * "16/7/2026" ở đầu bảng), và khi tháng tụt hẳn so với đợt trước (12 → 1) thì
 * sang năm mới.
 */
export function parsePurchasePayments(grid: string[][]): PurchasePayment[] {
    const nam0 = (() => {
        for (const row of grid) for (const c of row) {
            const m = String(c).match(/\b\d{1,2}\/\d{1,2}\/(20\d{2})\b/);
            if (m) return Number(m[1]);
        }
        return new Date().getFullYear();
    })();

    const dot: PurchasePayment[] = [];
    let year = nam0, prevMonth = 0;
    grid.forEach((row, r) => {
        for (const raw of row) {
            const text = String(raw ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
            const upper = text.toUpperCase();
            const mn = upper.match(RE_DATE);
            if (!mn) continue;
            const mt = upper.match(RE_TOTAL);
            if (!mt) continue;          // ô nói "thanh toán ngày…" mà không có tổng → không phải đợt

            const day = Number(mn[1]), month = Number(mn[2]);
            if (mn[3]) year = Number(mn[3]);
            else if (prevMonth && month < prevMonth - 6) year += 1;
            prevMonth = month;

            const total = parseVnd(mt[1]);
            // "6.185.790 + 1.405.597 TỔNG: 7.591.387" — phần cộng nằm TRƯỚC chữ TỔNG.
            const beforeTotal = upper.slice(0, mt.index);
            const mc = beforeTotal.match(RE_SUM);
            const no = mc ? parseVnd(mc[2]) : 0;
            const newAmount = mc ? parseVnd(mc[1]) : total;

            const paidMatch = upper.match(RE_PAID_AMOUNT);
            const outstandingMatch = upper.match(RE_OUTSTANDING);
            dot.push({
                ngay: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
                tong_vnd: total,
                moi_vnd: newAmount,
                no_ky_truoc_vnd: no,
                da_ghi_thanh_toan: RE_PAID.test(upper),
                da_tra_vnd: paidMatch ? parseVnd(paidMatch[1]) : (RE_PAID.test(upper) ? total : null),
                con_thieu_vnd: outstandingMatch ? parseVnd(outstandingMatch[1]) : null,
                dong: r + 1,
                nguyen_van: text,
            });
            break;                      // mỗi dòng tối đa một đợt
        }
    });
    return dot;
}

/**
 * Ngày NAZA gửi sao kê, đọc từ TÊN FILE: "2026.9.11" · "2026-7-24" · "14.08.2026" ·
 * "20261012" (viết liền — kỳ 12/10/2026 tên "TAIWAN 20261012.xlsx", trước đây đọc ra rỗng nên
 * kỳ đó không ghép được đợt nào trong file tiền hàng).
 */
export function statementDateFromName(filename: string): string | null {
    const ymd = filename.match(/(20\d{2})[.\-_/](\d{1,2})[.\-_/](\d{1,2})/);
    const dmy = filename.match(/(\d{1,2})[.\-_/](\d{1,2})[.\-_/](20\d{2})/);
    const compact = filename.match(/(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)/);
    const [y, m, d] = ymd ? [ymd[1], ymd[2], ymd[3]] : dmy ? [dmy[3], dmy[2], dmy[1]]
        : compact ? [compact[1], compact[2], compact[3]] : [];
    if (!y) return null;
    const mm = Number(m), dd = Number(d);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    return `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

const daysApart = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

/**
 * Ghép mỗi đợt thanh toán vào đúng MỘT kỳ sao kê: gần ngày nhất, trong cửa sổ
 * vài ngày. Ghép toàn cục theo khoảng cách tăng dần, để một đợt nằm giữa hai kỳ
 * (27/7 cách 24/7 ba ngày, cách 31/7 bốn ngày) về kỳ gần hơn chứ không về kỳ
 * nào được duyệt trước.
 */
export function matchPaymentsToPeriods(
    dot: PurchasePayment[],
    periods: { id: string; ngay: string | null }[],
    windowDays = CFG.match_window_days ?? 4,
): Map<string, PurchasePayment> {
    const cap: { id: string; i: number; d: number }[] = [];
    for (const k of periods) {
        if (!k.ngay) continue;
        dot.forEach((x, i) => {
            const d = daysApart(k.ngay!, x.ngay);
            if (d <= windowDays) cap.push({ id: k.id, i, d });
        });
    }
    cap.sort((a, b) => a.d - b.d);
    const out = new Map<string, PurchasePayment>();
    const usedPayments = new Set<number>();
    for (const c of cap) {
        if (out.has(c.id) || usedPayments.has(c.i)) continue;
        out.set(c.id, dot[c.i]);
        usedPayments.add(c.i);
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Đọc Google Sheet — có bộ nhớ đệm, KHÔNG BAO GIỜ ném lỗi ra ngoài
// ─────────────────────────────────────────────────────────────────────────
// Màn đối soát không được sập vì file tiền hàng tạm không mở được. Lỗi thì trả
// danh sách rỗng kèm câu nói rõ vì sao — mục soát sẽ hiện câu đó.
const CACHE_MS = 5 * 60_000;
let cache: { luc: number; ket: PurchaseSheetResult } | null = null;

export type PurchaseSheetResult = { dot: PurchasePayment[]; loi: string | null; doc_luc: string };

export async function readPurchaseSheet(): Promise<PurchaseSheetResult> {
    if (cache && Date.now() - cache.luc < CACHE_MS) return cache.ket;
    const luc = new Date().toISOString();
    let result: PurchaseSheetResult;
    if (!CFG.sheet_id) {
        result = { dot: [], loi: "Chưa khai file tiền hàng ở config/talpha_rules.json → cod_settlement.purchase_sheet.", doc_luc: luc };
    } else {
        try {
            const r = await fetchSheetCsv(CFG.sheet_id, CFG.sheet_gid || "0");
            const grid = csvToGrid(r.csv);
            const dot = parsePurchasePayments(grid);
            // Cả file chỉ còn ô lỗi công thức (#REF!, #N/A…) thì nói thẳng ra. 14/09/2026 bản
            // sao dùng IMPORTRANGE theo TÊN tab, tab gốc đổi tên là cả file thành một ô #REF!
            // — câu "không thấy đợt nào" khi đó chỉ khiến người ta đi soát nhầm chỗ.
            const o = grid.flat().map((c) => c.trim()).filter(Boolean);
            const allFormulaErrors = o.length > 0 && o.every((c) => /^#(REF!|N\/A|ERROR!|VALUE!|NAME\?)$/i.test(c));
            result = {
                dot,
                loi: dot.length ? null
                    : allFormulaErrors ? `File tiền hàng đang ra lỗi công thức ${o[0]} — thường là IMPORTRANGE trỏ tới tab đã đổi tên. Sửa công thức, hoặc khai thẳng file gốc vào cod_settlement.purchase_sheet.`
                        : "Đọc được file tiền hàng nhưng không thấy đợt thanh toán nào.",
                doc_luc: luc,
            };
        } catch (e) {
            result = { dot: [], loi: `Không đọc được file tiền hàng: ${(e as Error).message}`, doc_luc: luc };
        }
    }
    cache = { luc: Date.now(), ket: result };
    return result;
}
