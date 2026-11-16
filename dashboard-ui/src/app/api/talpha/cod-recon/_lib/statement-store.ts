import type { StatementRow } from "@/lib/talpha/cod-recon";
import type { NazaStatement } from "@/lib/talpha/naza-statement";
import { statementDateFromName } from "@/lib/talpha/purchase-sheet";

export const STORE = "cod_statements";

export type Statement = {
    id: string;
    filename: string;
    uploaded_at: string;
    row_count: number;
    detected_columns: string[];
    missing_columns: string[];
    rows: StatementRow[];
    /** Chỉ có ở sao kê NAZA .xlsx — phép quyết toán, phí từng đơn, kết quả soát phí. */
    naza?: {
        sheets: NazaStatement["sheets"];
        summary: NazaStatement["summary"];
        checks: NazaStatement["checks"];
        fee_audit: NazaStatement["fee_audit"];
        fee_lines: NazaStatement["fee_lines"];
        /** Phần Singapore NAZA gộp vào kỳ này (chỉ kỳ 24/09/2026). Kho cũ không có. */
        sg_gop?: NazaStatement["sg_gop"];
    };
};

export const emptyStore = (): { statements: Statement[] } => ({ statements: [] });

/**
 * Tải lại CÙNG MỘT FILE thì THAY, không cộng thêm.
 *
 * Sao kê là sổ tiền: một đơn chỉ được trả một lần. Để hai bản của cùng một kỳ
 * nằm cạnh nhau thì mọi dòng của kỳ đó bị đếm hai lượt — "khớp sạch" phồng lên
 * và một khoản lệch 14 TWD hoá thành 28. Đã dính thật khi thử.
 *
 * Mà tải lại là chuyện thường: 3PL gửi bản sửa, hoặc người dùng bấm nhầm.
 *
 * So tên theo dạng Unicode NFC. Máy Mac có lúc gửi tên file tách dấu (NFD):
 * "ĐỐI SOÁT COD 2026.9.11.xlsx" lưu 30 ký tự, tải lại gửi 27 ký tự — nhìn y
 * hệt mà so chuỗi thì khác, thành hai bản cùng một kỳ. Đã dính thật 13/09/2026.
 *
 * Và bản sửa của 3PL thường ĐỔI TÊN file: kỳ 24/09 bản đầu "ĐỐI SOÁT COD
 * 2026.09.24", bản sửa (bỏ đơn Singapore) "ĐỐI SOÁT COD TAIWAN 2026.09.24". Nên
 * cùng NGÀY trên tên file cũng là cùng kỳ → thay. Kho này chỉ chứa sao kê Đài,
 * NAZA gửi một file mỗi tuần, nên một ngày là một kỳ. (30/09/2026 Sỹ Anh chốt
 * dùng lại bản GỘP Sing cho kỳ 24/09 — đúng số tiền về; tải lên là thay bản
 * TAIWAN.) Từ kỳ sau NAZA gửi thêm file Sing CÙNG NGÀY — file đó bị chặn ở
 * POST (laFileSing), không thì nó đè mất kỳ Đài.
 */
export const normalizeFileName = (name: string) => name.normalize("NFC").trim();
export function replaceSameFile(list: Statement[], filename: string): Statement[] {
    const key = normalizeFileName(filename).toLowerCase();
    const statementDate = statementDateFromName(normalizeFileName(filename));
    return list.filter((s) => normalizeFileName(s.filename).toLowerCase() !== key
        && !(statementDate && statementDateFromName(normalizeFileName(s.filename)) === statementDate));
}

// Từ 08/10/2026 Singapore có kho sao kê riêng (/api/talpha/cod-recon/market?market=SG).
export const SG_STATEMENT_REJECTED =
    "Đây là sao kê SINGAPORE. Màn này là sổ COD Đài Loan (tiền đọc như TWD, và file cùng ngày " +
    "sẽ thay kỳ Đài) — bấm nút Singapore ở đầu màn rồi tải lại file ở đó.";
