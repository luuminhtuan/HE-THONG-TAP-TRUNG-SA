/**
 * ĐỐI SOÁT CHI PHÍ QUẢNG CÁO — lõi thuần, KHÔNG đọc đĩa, KHÔNG gọi mạng.
 *
 * Mỗi tuần có hai con số nói về cùng một khoản tiền: Facebook nói đã thu bao
 * nhiêu, ngân hàng nói đã trừ bao nhiêu. Phần lệch giữa hai con số đó là chỗ
 * tiền bị trừ trùng, thẻ lạ tiêu tiền công ty, hoá đơn báo lỗi mà tiền vẫn ra.
 *
 * File này là chỗ DUY NHẤT định nghĩa "một lượt đối soát". Hai nơi gọi vào:
 *   · route /api/talpha/ads-recon  — màn Thanh toán quảng cáo trong dashboard
 *   · ads-reconciliation-cli/bin   — bản dòng lệnh chạy ở máy, dùng cho cron
 * Giữ nó thuần để hai nơi không bao giờ ra hai kết quả khác nhau.
 */
import { ingestFb, ingestBank, detectKind } from "./ingest.ts";
import { matchTransactions } from "./match.ts";
import { buildAlerts } from "./rules.ts";
import { isoWeek } from "./normalize.ts";
import type {
    AdsSettlementConfig, BankRow, FbRow, ReconcileOptions, ReconResult, Side, SideKind,
    SlimBankRow, SlimFbRow, SourceDoc, TxnRow,
} from "./types.ts";

/**
 * Chia các file đã tải lên làm hai phía. Không bắt người dùng nhớ thứ tự, và
 * KHÔNG giới hạn mỗi phía một file: công ty có mấy thẻ thì mấy sao kê, TKQC
 * xuất theo từng tài khoản thì mấy bản chi phí. Bắt gộp tay bằng Excel trước
 * khi tải lên là trả việc về đúng chỗ mà hệ thống này sinh ra để bỏ đi.
 */
export function splitSources(
    docs: SourceDoc[],
    cfg: AdsSettlementConfig,
    opts: { allowSingleSide?: boolean } = {},
): { fb: SourceDoc[]; bank: SourceDoc[] } {
    const fb: SourceDoc[] = [], bank: SourceDoc[] = [], unknown: SourceDoc[] = [];
    for (const d of docs) {
        const k = d.kind ?? detectKind(d.sheets, cfg);
        if (k === "fb") fb.push(d);
        else if (k === "bank") bank.push(d);
        else unknown.push(d);
    }
    // File không nhận ra được thì dồn về phía đang thiếu — một phía trống là
    // không đối soát được gì cả. Nhưng khi chỉ đang NẠP KHO thì không dồn bừa:
    // lúc đó một phía trống là chuyện bình thường, dồn nhầm mới là tai hoạ.
    if (!opts.allowSingleSide) for (const d of unknown) (fb.length && !bank.length ? bank : fb).push(d);
    else for (const d of unknown) (detectKind(d.sheets, cfg) === "bank" ? bank : fb).push(d);

    if (!opts.allowSingleSide && (!fb.length || !bank.length)) {
        throw new Error(
            `Cần cả hai phía: ${fb.length} file chi phí TKQC và ${bank.length} file sao kê. ` +
            `Kiểm tra lại nội dung file, hoặc thêm bí danh cột vào ads_settlement.columns.`);
    }
    return { fb, bank };
}

/**
 * Bỏ dòng trùng nhau GIỮA CÁC FILE.
 *
 * Hai bản xuất chồng ngày nhau là chuyện thường: cùng một hoá đơn nằm trong cả
 * hai file. Để nguyên thì bản thứ hai không tìm được ai để ghép và nổi lên
 * thành "TKQC thu mà thẻ không trừ" — báo động giả, mà lại là loại báo động
 * đắt tiền nhất. Giữ bản gặp trước, ghi lại đã bỏ những gì để nói ra.
 */
function dedupeAcrossFiles<R extends TxnRow>(rows: R[], keyOf: (r: R) => string) {
    const seen = new Map<string, R>();
    const kept: R[] = [], dropped: { kept: R; dropped: R }[] = [];
    for (const r of rows) {
        const k = keyOf(r);
        if (!k) { kept.push(r); continue; }
        const prev = seen.get(k);
        if (!prev) { seen.set(k, r); kept.push(r); }
        // So bằng SỐ THỨ TỰ bản tải lên chứ không bằng tên file: tải nhầm đúng
        // một file hai lần thì hai bản trùng tên, mà đó lại chính là trường hợp
        // phải bỏ. So bằng tên là tổng tiền nhân đôi mà không ai biết.
        else if (prev._doc !== r._doc) dropped.push({ kept: prev, dropped: r });
        else kept.push(r);            // trùng trong CÙNG một bản tải lên là dữ liệu thật
    }
    return { kept, dropped };
}

const keyFb = (r: FbRow) => (r.txn_id ? `t:${r.txn_id}` : `d:${r.date}|${r.amount}|${r.account_id}`);
const keyBank = (r: BankRow) => `d:${r.date}|${r.amount}|${r.ref || r.desc}`;

/** Phần chung của kết quả đọc một file, phía nào cũng có. */
type IngestPart<R extends TxnRow> = {
    rows: R[];
    skipped: Side<R>["skipped"];
    meta: { sheet: string; header_row: number; warnings: string[] };
    other_ads?: BankRow[];
};

/**
 * Đọc một phía (có thể nhiều file) rồi gộp thành một danh sách.
 *
 * MỘT FILE HỎNG KHÔNG ĐƯỢC GIẾT CẢ LƯỢT. Tải 4 file sao kê mà một file lạ
 * định dạng thì ba file kia vẫn phải đối soát được — bắt người dùng ngồi thử
 * bỏ từng file ra để đoán file nào hỏng là việc của máy chứ không phải của họ.
 * File đọc không được thì bỏ qua và báo ĐỎ, nói rõ tên file và vì sao.
 */
function ingestSide(docs: SourceDoc[], cfg: AdsSettlementConfig, kind: "fb"): Side<FbRow>;
function ingestSide(docs: SourceDoc[], cfg: AdsSettlementConfig, kind: "bank"): Side<BankRow>;
function ingestSide(docs: SourceDoc[], cfg: AdsSettlementConfig, kind: SideKind): Side<FbRow> | Side<BankRow> {
    const parts: IngestPart<TxnRow>[] = [], failedFiles: Side<TxnRow>["failedFiles"] = [], ok: SourceDoc[] = [];
    for (const d of docs) {
        try {
            parts.push(kind === "fb" ? ingestFb(d.sheets, cfg, d.name || "") : ingestBank(d.sheets, cfg, d.name || ""));
            ok.push(d);
        } catch (e) {
            failedFiles.push({ name: d.name || "(không tên)", reason: (e as Error | null)?.message || String(e) });
        }
    }
    if (!parts.length) {
        const details = failedFiles.map((h) => `"${h.name}": ${h.reason}`).join("\n\n");
        throw new Error(`Không đọc được file nào ở phía ${kind === "fb" ? "chi phí TKQC" : "sao kê"}.\n\n${details}`);
    }
    docs = ok;
    const rows = parts.flatMap((p, i) => p.rows.map((r) => ({ ...r, _doc: i })));
    const { kept, dropped } = kind === "fb"
        ? dedupeAcrossFiles(rows as FbRow[], keyFb)
        : dedupeAcrossFiles(rows as BankRow[], keyBank);

    return {
        rows: kept,
        duplicatesAcrossFiles: dropped,
        failedFiles,
        other_ads: parts.flatMap((p) => p.other_ads || []),
        skipped: parts.flatMap((p) => p.skipped || []),
        meta: {
            files: parts.map((p, i) => ({
                ten: docs[i].name || "", sheet: p.meta.sheet,
                dong_tieu_de: p.meta.header_row, so_dong: p.rows.length,
            })),
            warnings: [...new Set(parts.flatMap((p) => p.meta.warnings || []))],
        },
    } as Side<FbRow> | Side<BankRow>;
}

/**
 * Chạy một lượt đối soát.
 * @param docs mọi file đã tải lên, KHÔNG cần đúng thứ tự và không giới hạn số lượng mỗi phía
 * @param cfg  khối ads_settlement trong talpha_rules.json
 * @param opts roster — để bắt TKQC lạ; history — các kỳ TRƯỚC, để bắt tăng vọt
 */
export function reconcile(docs: SourceDoc | SourceDoc[], cfg: AdsSettlementConfig, opts: ReconcileOptions = {}): ReconResult {
    const { fb, bank } = ingestDocs(docs, cfg);
    return reconcileRows(fb, bank, cfg, opts);
}

/**
 * Đọc các file thành hai phía, KHÔNG đối soát.
 * Tách ra để đường "kho dữ liệu" đọc file xong đem cất, rồi mới đối soát trên
 * toàn bộ kho — chứ không phải chỉ trên mấy file vừa tải lên.
 *
 * `allowSingleSide` chỉ đúng cho đường nạp kho: nạp mỗi bản kê TKQC hôm nay,
 * mai bổ sung sao kê là chuyện thường. Còn gọi thẳng reconcile() mà thiếu một
 * phía thì phải báo lỗi — không có gì để đối soát cả.
 */
export function ingestDocs(
    docs: SourceDoc | SourceDoc[],
    cfg: AdsSettlementConfig,
    { allowSingleSide = false }: { allowSingleSide?: boolean } = {},
): { fb: Side<FbRow>; bank: Side<BankRow> } {
    const list = Array.isArray(docs) ? docs : [docs];
    const split = splitSources(list, cfg, { allowSingleSide });
    return {
        fb: split.fb.length ? ingestSide(split.fb, cfg, "fb") : emptySide<FbRow>(),
        bank: split.bank.length ? ingestSide(split.bank, cfg, "bank") : emptySide<BankRow>(),
    };
}

const emptySide = <R extends TxnRow>(): Side<R> => ({
    rows: [], duplicatesAcrossFiles: [], failedFiles: [], other_ads: [], skipped: [], meta: { files: [], warnings: [] },
});

/**
 * Đối soát trên HAI DANH SÁCH DÒNG đã có sẵn (thường là toàn bộ kho).
 * @param fb   phía chi phí TKQC — { rows, ... }
 * @param bank phía sao kê — { rows, ... }
 */
export function reconcileRows(
    fb: Side<FbRow>,
    bank: Side<BankRow>,
    cfg: AdsSettlementConfig,
    { roster = null, history = [] }: ReconcileOptions = {},
): ReconResult {
    const match = matchTransactions(fb.rows, bank.rows, cfg);

    // Mã kỳ lấy theo NGÀY ĐẦU CỦA SAO KÊ, không phải ngày sớm nhất của mọi
    // file: bản kê TKQC có thể trải 9 tháng về trước, lấy ngày đó thì kỳ mang
    // tên một tuần cách đây gần một năm — vô nghĩa với người đọc.
    const bankDates = bank.rows.map((r) => r.date).filter(Boolean).sort();
    const dates = [...bankDates, ...fb.rows.map((r) => r.date).filter(Boolean)].sort();
    const anchor = bankDates[0] || dates[0];
    const ky = anchor ? isoWeek(anchor) : isoWeek(new Date().toISOString().slice(0, 10));

    // Chỉ so với kỳ CŨ hơn: chạy lại một kỳ cũ mà lấy kỳ mới hơn làm "kỳ trước"
    // thì kết luận tăng/giảm sẽ ngược chiều.
    const earlier = (history || [])
        .filter((h) => h.ky && h.ky < ky)
        .sort((x, y) => ((x.ky ?? "") < (y.ky ?? "") ? -1 : 1));

    const { alerts, summary } = buildAlerts({ fb, bank, match, cfg, roster, history: earlier });

    return {
        ky,
        chay_luc: new Date().toISOString(),
        files: { fb: fb.meta.files, bank: bank.meta.files },
        summary,
        stats: match.stats,
        alerts,
        pairs: match.pairs.map((p) => ({
            fb: slimFbRow(p.fb), bank: slimBankRow(p.bank),
            date_diff: p.date_diff, amount_diff: p.amount_diff, amount_diff_pct: p.amount_diff_pct,
            exact: p.exact, ambiguous: p.ambiguous, card_ok: p.card_ok, confidence: p.confidence,
        })),
        fb_unmatched: match.fb_unmatched.map(slimFbRow),
        bank_unmatched: match.bank_unmatched.map(slimBankRow),
        fb_failed: match.fb_failed.map(slimFbRow),
        other_ads: (bank.other_ads || []).map(slimBankRow),
        meta: { fb: fb.meta, bank: bank.meta, skipped: { fb: fb.skipped, bank: bank.skipped } },
        history: earlier.map((h) => ({ ky: h.ky, bank_total: h.summary?.bank_total ?? 0, fb_total: h.summary?.fb_total ?? 0 })),
    };
}

// Bản gọn của một dòng — bỏ mảng `raw` để kết quả lưu xuống không phình.
// _doc chỉ dùng lúc chạy để phân biệt hai bản tải lên, không lưu xuống.
function slimFbRow(r: FbRow): SlimFbRow {
    return {
        src: r.src, file: r.file || "", line: r.line, date: r.date, amount: r.amount, card4: r.card4 ?? null,
        txn_id: r.txn_id, account_id: r.account_id, account_name: r.account_name, method: r.method,
        status: r.status, status_norm: r.status_norm,
    };
}

function slimBankRow(r: BankRow): SlimBankRow {
    return {
        src: r.src, file: r.file || "", line: r.line, date: r.date, amount: r.amount, card4: r.card4 ?? null,
        desc: r.desc, ref: r.ref, balance: r.balance,
    };
}

export { readSheets, readAnySheets } from "./xlsx.ts";
export { addRowsToStore, removeSourceFile, summarizeSources, fbRowKey, bankRowKey } from "./storage.ts";
export type { SourceSummary } from "./storage.ts";
export type { PdfPasswordError } from "./pdf.ts";
export { detectKind } from "./ingest.ts";
export { toCsv } from "./csv.ts";
export { buildMessage, sendAlerts } from "./notify.ts";
export { fmtVND } from "./normalize.ts";
export type * from "./types.ts";
