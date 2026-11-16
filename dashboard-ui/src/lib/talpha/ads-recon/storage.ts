/**
 * KHO DỮ LIỆU ĐỐI SOÁT — nơi giao dịch được CẤT LẠI, không phải đọc rồi vứt.
 *
 * Vì sao cần: bản kê thanh toán của Facebook là của ĐÚNG MỘT tài khoản quảng
 * cáo, mà công ty có bốn tài khoản đang chạy. Bắt phải gom đủ mọi file rồi tải
 * một lượt là đặt điều kiện sai với đời thật — file về rải rác, tài khoản này
 * xuất được trước, tài khoản kia sau. Có kho thì bổ sung tới đâu đối soát lại
 * tới đó, và số cũ không phải làm lại từ đầu.
 *
 * Chống đếm hai lần bằng KHOÁ của từng dòng, không bằng tên file: tải lại đúng
 * file cũ, hay hai bản xuất chồng ngày nhau, đều không làm tiền nhân đôi.
 *
 * Dòng trong kho được lưu ở bảng app_documents (dòng ads_recon_rows) — khoá `_key` và tên
 * trường của dòng phải giữ nguyên, nếu không dòng đã cất sẽ không còn nhận ra là trùng.
 */
import type { SideKind, TxnRow } from "./types.ts";

/** Khoá một dòng chi phí TKQC. Mã giao dịch của Facebook là duy nhất tuyệt đối. */
export function fbRowKey(r: { txn_id?: string; date?: string; amount?: number; account_id?: string }): string {
    if (r.txn_id && String(r.txn_id).length >= 8) return "t:" + r.txn_id;
    return `d:${r.date}|${r.amount}|${r.account_id || ""}`;
}

/** Khoá một dòng sao kê. Nội dung của VCB mang mã giao dịch riêng nên đủ phân biệt. */
export function bankRowKey(r: { date?: string; amount?: number; ref?: string; desc?: string }): string {
    return `b:${r.date}|${r.amount}|${r.ref || ""}|${(r.desc || "").slice(0, 60)}`;
}

const keyFnFor = (side: SideKind): ((r: TxnRow) => string) => (side === "fb" ? fbRowKey : bankRowKey);

/**
 * Nhập thêm dòng vào kho.
 *
 * Dòng nào trùng khoá với dòng đã có thì BỎ. Trùng khoá NGAY TRONG cùng một
 * bản tải lên thì giữ, và gắn thêm số thứ tự vào khoá — hai giao dịch thật sự
 * giống hệt nhau trong một file là chuyện có, bỏ đi là mất tiền.
 */
export function addRowsToStore<R extends TxnRow>(
    existing: R[] | null | undefined,
    side: SideKind,
    incoming: R[],
): { rows: R[]; added: R[]; duplicates: R[] } {
    const rows = [...(existing || [])];
    const knownKeys = new Set(rows.map((r) => r._key));
    const seenInBatch = new Map<string, number>();
    const added: R[] = [], duplicates: R[] = [];
    const keyOf = keyFnFor(side);

    for (const r of incoming) {
        let k = keyOf(r);
        const occurrence = (seenInBatch.get(k) || 0) + 1;
        seenInBatch.set(k, occurrence);
        if (occurrence > 1) k += "#" + occurrence;

        if (knownKeys.has(k)) { duplicates.push(r); continue; }
        knownKeys.add(k);
        const stored: R = { ...r, _key: k };
        delete stored._doc;
        delete stored.raw;
        rows.push(stored);
        added.push(stored);
    }
    return { rows, added, duplicates };
}

/** Bỏ mọi dòng đến từ một file — dùng khi tải nhầm. */
export function removeSourceFile<R extends TxnRow>(rows: R[] | null | undefined, fileName: string): R[] {
    return (rows || []).filter((r) => r.file !== fileName);
}

/** Tóm tắt một file nguồn trong kho (khoá giữ tiếng Việt: màn Thanh toán quảng cáo đọc `nguon`). */
export type SourceSummary = {
    ten: string;
    phia: SideKind;
    so_dong: number;
    tien: number;
    tu: string | null;
    den: string | null;
    tkqc: string[];
};

/** Tóm tắt kho theo file nguồn, kèm tài khoản quảng cáo của từng file. */
export function summarizeSources(rows: TxnRow[] | null | undefined, side: SideKind): SourceSummary[] {
    const byFile = new Map<string, Omit<SourceSummary, "tkqc"> & { tkqc: Set<string> }>();
    for (const r of rows || []) {
        const k = r.file || "(không tên)";
        let e = byFile.get(k);
        if (!e) {
            e = { ten: k, phia: side, so_dong: 0, tien: 0, tu: null, den: null, tkqc: new Set() };
            byFile.set(k, e);
        }
        e.so_dong++;
        e.tien += r.amount || 0;
        if (!e.tu || r.date < e.tu) e.tu = r.date;
        if (!e.den || r.date > e.den) e.den = r.date;
        // Chỉ dòng chi phí TKQC mang account_id; dòng sao kê không có trường này.
        const accountId = (r as { account_id?: string }).account_id;
        if (accountId) e.tkqc.add(accountId);
    }
    return [...byFile.values()].map((e) => ({ ...e, tkqc: [...e.tkqc] }));
}
