/**
 * SAO KÊ COD CÁC NƯỚC NGOÀI ĐÀI (Singapore, UAE…) — bước 2 của đối soát COD nước khác.
 *
 * 08/10/2026 Sỹ Anh yêu cầu màn Tiền COD về của Singapore, UAE có chỗ tải sao kê như Đài. Lúc
 * đó CHƯA có file mẫu của nước nào, nên bộ đọc nhận hai kiểu:
 *
 *   • SAO KÊ NAZA (.xlsx ba sheet) — NAZA giao Singapore. Kỳ gộp 24/09/2026 cho thấy đơn Sing ghi
 *     国家名称 = 新加坡, kênh 'S新加坡CODJT专线', mã vận đơn JT…; đọc bằng chính parseNazaStatement
 *     của Đài, chỉ lấy dòng của nước đang mở. Có sheet TỔNG thì lấy luôn số "phải nhận" VND.
 *   • BẢNG BẤT KỲ (.xlsx / .csv) có cột mã vận đơn (hoặc mã đơn) và cột tiền COD — dò tên cột
 *     theo danh sách COT dưới đây; đối tác đặt tên lạ thì khai thêm ở
 *     talpha_rules.json → cod_settlement.column_map (cùng khoá tracking / order_id / amount…).
 *
 * Kho riêng từng nước (cod_statements_sg, cod_statements_ae…) — KHÔNG đụng kho Đài: kho Đài đọc
 * tiền như TWD và coi "cùng ngày trên tên file là cùng kỳ", file nước khác vào đó là đè mất kỳ Đài.
 *
 * Hàm thuần — không đọc file, không gọi mạng — để test được.
 */
import { RULES } from "./rules";
import { reconcile, parseAmount, parseDelimited, type PosOrder, type StatementRow } from "./cod-recon";
import { isSgFile, matchChannel, normTracking, toIsoDate, type NazaStatement } from "./naza-statement";
import type { CodOrder } from "./cod-market";

// ─────────────────────────────────────────────────────────────────────────
// Dò cột của bảng sao kê
// ─────────────────────────────────────────────────────────────────────────

/** Tên cột: bỏ dấu, chữ thường, ký tự lạ thành dấu cách — giữ chữ Hán (转单号…). */
export function normalizeColumnName(s: string): string {
    return String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/đ/g, "d").replace(/[^a-z0-9㐀-鿿]+/g, " ").trim();
}

type StatementField = "tracking" | "order_id" | "amount" | "fee" | "paid_date" | "status";
const FIELD_ORDER: StatementField[] = ["tracking", "order_id", "amount", "fee", "paid_date", "status"];

/** Tên cột hay gặp ở sao kê COD (Anh · Việt · Trung). Viết sẵn ở dạng chuanTenCot. */
const COLUMN_ALIASES: Record<StatementField, string[]> = {
    tracking: ["tracking", "tracking no", "tracking number", "tracking id", "tracking code", "awb", "awb no",
        "awb number", "hawb", "waybill", "waybill no", "waybill number", "airway bill", "shipment no",
        "shipment number", "consignment no", "consignment number", "ma van don", "van don", "mvd", "ma tracking",
        "转单号", "运单号", "跟踪号", "物流单号"],
    order_id: ["order id", "order no", "order number", "order code", "order", "ma don", "ma don hang",
        "ma don he thong", "ma don khach hang", "reference", "reference no", "ref", "ref no",
        "customer reference", "原单号", "客户单号", "客户的订单号", "订单号"],
    amount: ["cod", "cod amount", "cod value", "cod collected", "collected", "collected amount", "collect amount",
        "amount collected", "total cod", "amount", "tien cod", "so tien", "thu ho", "tien thu ho",
        "cod金额", "代收金额", "代收货款", "回款金额"],
    fee: ["fee", "fees", "shipping fee", "delivery fee", "cod fee", "service fee", "phi", "phi ship",
        "phi van chuyen", "运费"],
    paid_date: ["date", "delivered date", "delivery date", "delivered at", "remit date", "remittance date",
        "payment date", "paid date", "ngay", "ngay giao", "收货日期", "签收日期", "日期"],
    status: ["status", "trang thai", "状态"],
};

const EXTRA_COLUMN_ALIASES: Record<string, string[]> =
    (RULES as unknown as { cod_settlement?: { column_map?: Record<string, string[]> } }).cod_settlement?.column_map || {};

const aliasesFor = (f: StatementField) => [...(EXTRA_COLUMN_ALIASES[f] || []).map(normalizeColumnName), ...COLUMN_ALIASES[f]].filter(Boolean);
const hasHanChars = (s: string) => /[㐀-鿿]/.test(s);
/** Cột phí cũng hay có chữ "cod" ("COD fee") — đừng để nó thành cột tiền COD. */
const FEE_COLUMN_RE = /\b(fee|fees|phi|charge|charges)\b|运费|手续费/;

export type StatementColumns = Partial<Record<StatementField, number>>;

/**
 * Cột nào là cột gì. Hai lượt: khớp NGUYÊN tên trước (chắc nhất), rồi mới tới tên cột BẮT ĐẦU
 * bằng tên quen ("Tracking No." · "转单号 Mã vận đơn" — NAZA ghi hai thứ tiếng trong một ô).
 * Mỗi cột chỉ được nhận một nghĩa.
 */
export function detectStatementColumns(header: string[]): StatementColumns {
    const h = header.map(normalizeColumnName);
    const out: StatementColumns = {};
    const usedColumns = new Set<number>();
    const assign = (f: StatementField, i: number) => { if (i >= 0) { out[f] = i; usedColumns.add(i); } };
    for (const f of FIELD_ORDER) {
        const name = aliasesFor(f);
        assign(f, h.findIndex((x, i) => !usedColumns.has(i) && x && name.includes(x)));
    }
    for (const f of FIELD_ORDER) {
        if (out[f] !== undefined) continue;
        const name = aliasesFor(f);
        assign(f, h.findIndex((x, i) => {
            if (usedColumns.has(i) || !x) return false;
            if (f === "amount" && FEE_COLUMN_RE.test(x)) return false;
            return name.some((t) => hasHanChars(t) ? x.includes(t) : x === t || x.startsWith(`${t} `));
        }));
    }
    return out;
}

/**
 * Tiền SGD / AED có số lẻ, và file kiểu châu Âu ghi "45,90". parseAmount (của Đài — tiền TWD
 * nguyên, dấu phẩy luôn là ngăn nghìn) đọc thành 4.590. Nên: MỘT dấu phẩy, sau nó 1–2 chữ số,
 * không có dấu chấm → phẩy thập phân. "1,399" (3 chữ số sau phẩy) vẫn là ngăn nghìn.
 */
export function parseStatementAmount(raw: string): number {
    const s = String(raw ?? "").trim();
    const numStr = s.replace(/[^\d.,()-]/g, "");
    return parseAmount(/^\(?-?\d+,\d{1,2}\)?$/.test(numStr) ? s.replace(",", ".") : s);
}

const TOTAL_ROW_RE = /^(total|tong|tong cong|grand total|sum|合计|总计|小计)\b/i;

/**
 * Một bảng (CSV đã tách, hoặc một sheet .xlsx) → dòng sao kê. Dòng tiêu đề có thể nằm dưới vài
 * dòng tên công ty / ngày — dò 12 dòng đầu, lấy dòng đầu tiên có cột mã (vận đơn hoặc đơn) VÀ
 * cột tiền. Bỏ dòng "Tổng".
 */
export function parseStatementTable(table: string[][]): { rows: StatementRow[]; cot: StatementColumns; header: string[] } | null {
    for (let r = 0; r < Math.min(12, table.length); r++) {
        const header = (table[r] || []).map((c) => String(c ?? "").trim());
        const columns = detectStatementColumns(header);
        if ((columns.tracking === undefined && columns.order_id === undefined) || columns.amount === undefined) continue;
        const o = (row: string[], i?: number) => (i === undefined ? "" : String(row[i] ?? "").trim());
        const rows: StatementRow[] = [];
        for (const row of table.slice(r + 1)) {
            const tracking = o(row, columns.tracking), order_id = o(row, columns.order_id);
            if (!tracking && !order_id) continue;
            if (TOTAL_ROW_RE.test(normalizeColumnName(tracking || order_id))) continue;
            const paidDate = o(row, columns.paid_date);
            rows.push({
                tracking, order_id,
                amount: parseStatementAmount(o(row, columns.amount)),
                fee: parseStatementAmount(o(row, columns.fee)),
                paid_date: toIsoDate(paidDate) || paidDate,
                status: o(row, columns.status),
            });
        }
        return { rows, cot: columns, header };
    }
    return null;
}

/** File .csv / .tsv / .txt → dòng sao kê. */
export function parseStatementCsv(text: string) {
    return parseStatementTable(parseDelimited(text));
}

/** Nhiều sheet .xlsx → lấy sheet đọc được NHIỀU dòng nhất (sheet tóm tắt thường ít dòng). */
export function pickStatementSheet(sheets: { name: string; rows: string[][] }[]) {
    let best: (ReturnType<typeof parseStatementTable> & { sheet: string }) | null = null;
    for (const s of sheets) {
        const d = parseStatementTable(s.rows);
        if (d && d.rows.length && (!best || d.rows.length > best.rows.length)) best = { ...d, sheet: s.name };
    }
    return best;
}

// ─────────────────────────────────────────────────────────────────────────
// Sao kê kiểu NAZA — chỉ lấy dòng của nước đang mở
// ─────────────────────────────────────────────────────────────────────────

const TAIWAN_NAME_RE = /TAIWAN|ĐÀI LOAN|台湾/;
/** Dòng có dấu hiệu Đài: kênh 'STWCOD专线-711', hoặc kênh có trong bảng giá Đài. */
const isTaiwanChannel = (channel: string) => /台湾|STW|TAIWAN/i.test(channel) || matchChannel(channel) !== null;

export type NazaMarketPart = {
    /** Tổng tiền COD (tiền nước đó) của các dòng đã chọn. */
    cod_local: number | null;
    ty_gia_rmb: number | null;      // tiền nước → tệ (mẫu Sing ghi theo từng đơn)
    ty_gia_vnd: number | null;      // tệ → VND
    /** Phí NAZA tính trên các đơn của nước này ở sheet PHÍ (ship + chặng đầu + đóng gói), tệ. */
    phi_rmb: number | null;
    /** Số đơn có dòng phí — kỳ chưa thu được COD vẫn có phí đơn đã gửi đi. */
    don_phi?: number;
    /** Tiền hàng NAZA trừ trong kỳ (新加坡本期采购费…), VND. */
    tien_hang_vnd?: number | null;
    phai_nhan_vnd: number | null;   // 本期应退金额VND — có thể ÂM (kỳ chỉ có phí)
    sheets: NazaStatement["sheets"];
    // ── Thêm 08/10/2026 (màn Sing giống Đài). Kho tải trước đó chưa có → tải lại file. ──
    /** Dòng sheet TỔNG đúng thứ tự file — dựng luồng tiền (cod-market-ledger.ts). */
    tong_dong?: { zh: string; vi: string; so: number }[];
    /** COD quy ra tệ theo tỷ giá từng đơn (COD金额（RMB）), và tiền về sau phí thu hộ (回款金额). */
    quy_te_rmb?: number | null;
    ve_rmb?: number | null;
    /** Từng đơn: COD quy tệ + phí thu hộ — soát phí thu hộ với bảng giá. */
    thu_ho?: { tracking: string; cod_rmb: number; phi_rmb: number }[];
    /** Từng dòng phí (sheet PHÍ) của nước này — soát với bảng giá, biết đơn nào đã bị trừ phí. */
    phi_dong?: { tracking: string; order_id: string; kg: number | null; ship: number; first_leg: number; op: number }[];
    /** Mã vận đơn bị tính phí từ hai lần trở lên trong kỳ. */
    trung_phi?: { tracking: string; order_ids: string[]; times: number; extra_rmb: number }[];
};

/**
 * Sao kê NAZA tải ở màn một nước ngoài Đài → dòng COD của nước đó, hoặc lỗi nói rõ phải tải ở đâu.
 *   • Singapore: lấy dòng 国家名称 = 新加坡. File Sing mà từng dòng không ghi nước thì tin tên file.
 *     Kỳ CHƯA THU được COD nào (file chỉ có sheet TỔNG + PHÍ — thật: "ĐỐI SOÁT COD SINGAPORE
 *     2026.09.24", phải nhận −3.600.206đ) vẫn nhận: không có đơn để khớp, nhưng có phí + tiền hàng.
 *   • Nước khác: NAZA không giao — file có dòng Đài hay Sing là tải nhầm màn.
 *
 * Mẫu Sing (thật, kỳ 05/10/2026) KHÁC mẫu Đài ở sheet TỔNG: 本期回款金额 là TỆ sau phí thu hộ
 * (cột 回款金额（RMB) cộng lại), không phải tiền SGD. Đem so với tổng COD SGD là báo lệch giả.
 */
export function pickNazaRows(naza: NazaStatement, code: string, filename: string):
    { rows: StatementRow[]; bo_qua: number; tong: NazaMarketPart; canh_bao: string[] } | { loi: string } {
    const lines = naza.cod_lines;
    const fees = naza.fee_lines || [];
    const sgCod = lines.filter((l) => l.market === "SG");
    const sgFee = fees.filter((l) => l.market === "SG");
    const upperFileName = filename.normalize("NFC").toUpperCase();
    const isSgName = isSgFile(filename, null) && !TAIWAN_NAME_RE.test(upperFileName);
    let picked = lines, pickedFees = fees;
    if (code === "SG") {
        if (sgCod.length) { picked = sgCod; pickedFees = sgFee; }
        else if (lines.length && isSgName) picked = lines;
        else if (!lines.length && (sgFee.length || isSgName)) { picked = []; pickedFees = sgFee.length ? sgFee : fees; }
        else return { loi: "File này là sao kê ĐÀI LOAN (không có dòng COD nào của Singapore). Bấm nút Đài Loan rồi tải lại ở đó." };
    } else {
        if (sgCod.length || sgFee.length) return { loi: "File này là sao kê SINGAPORE. Bấm nút Singapore rồi tải lại ở đó." };
        const allChannels = [...lines.map((l) => l.channel), ...fees.map((l) => l.channel)];
        if (TAIWAN_NAME_RE.test(upperFileName) || (allChannels.length && allChannels.filter(isTaiwanChannel).length * 2 >= allChannels.length)) {
            return { loi: "File này là sao kê ĐÀI LOAN. Bấm nút Đài Loan rồi tải lại ở đó." };
        }
    }
    // Số ở sheet TỔNG chỉ là của nước này khi cả file là của nước này (file gộp thì không).
    const caFile = picked.length === lines.length && pickedFees.length === fees.length;
    const s = naza.summary;
    const numStr = (n: number) => (Math.round(n * 100) / 100).toLocaleString("vi-VN");
    const warnings: string[] = [];
    if (lines.length - picked.length) warnings.push(`Bỏ ${lines.length - picked.length} dòng COD của nước khác trong file.`);

    const cod = picked.reduce((t, l) => t + (Number(l.cod_twd) || 0), 0);
    const hasReceived = picked.some((l) => l.ve_rmb != null);
    if (caFile && s.cod_twd != null && picked.length) {
        // Mẫu Sing: so tiền về (tệ) từng đơn với sheet TỔNG. Mẫu Đài: so tiền COD.
        const detailSum = hasReceived ? picked.reduce((t, l) => t + (Number(l.ve_rmb) || 0), 0) : cod;
        if (Math.abs(detailSum - s.cod_twd) > 0.5) {
            warnings.push(`Chi tiết COD cộng ra ${numStr(detailSum)}${hasReceived ? "¥" : ""} nhưng sheet TỔNG ghi ${numStr(s.cod_twd)}${hasReceived ? "¥" : ""} — hỏi lại bên giao hàng.`);
        }
    }
    const rate = picked.find((l) => l.ty_gia_rmb != null)?.ty_gia_rmb ?? null;
    const hasRates = picked.length > 0 && picked.every((l) => l.ty_gia_rmb != null);
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const codFees = picked.filter((l) => l.ty_gia_rmb != null && l.ve_rmb != null).map((l) => ({
        tracking: l.tracking, cod_rmb: round2(l.cod_twd * l.ty_gia_rmb!), phi_rmb: round2(l.cod_twd * l.ty_gia_rmb! - l.ve_rmb!),
    }));
    const feeTrackings = new Set(pickedFees.map((l) => normTracking(l.tracking)));
    return {
        rows: picked.map((l) => ({
            tracking: l.tracking, order_id: l.order_id, amount: l.cod_twd,
            fee: 0, paid_date: l.recv_date || "", status: "paid",
        })),
        bo_qua: lines.length - picked.length,
        canh_bao: warnings,
        tong: {
            cod_local: Math.round(cod * 100) / 100,
            // Tỷ giá ở sheet TỔNG của file Sing có lúc là số Đài chép sang (kỳ 24/09 ghi 0,2021) —
            // chỉ tin tỷ giá ghi trên từng đơn.
            ty_gia_rmb: code === "SG" ? rate : rate ?? s.rate_twd_rmb ?? null,
            ty_gia_vnd: s.rate_rmb_vnd ?? null,
            phi_rmb: Math.round(pickedFees.reduce((t, l) => t + l.ship_fee + l.op_fee + (l.first_leg_fee ?? 0), 0) * 100) / 100,
            don_phi: pickedFees.length,
            tien_hang_vnd: caFile ? (code === "SG" ? s.purchase_sg_vnd ?? s.purchase_vnd : s.purchase_vnd) ?? null : null,
            phai_nhan_vnd: caFile ? s.payable_vnd ?? null : null,
            sheets: naza.sheets,
            tong_dong: caFile ? naza.summary_lines || [] : [],
            quy_te_rmb: hasRates ? round2(picked.reduce((t, l) => t + l.cod_twd * l.ty_gia_rmb!, 0)) : picked.length ? null : 0,
            ve_rmb: hasReceived ? round2(picked.reduce((t, l) => t + (Number(l.ve_rmb) || 0), 0)) : picked.length ? null : 0,
            thu_ho: codFees,
            phi_dong: pickedFees.map((l) => ({
                tracking: l.tracking, order_id: l.order_id, kg: l.chargeable_kg,
                ship: l.ship_fee, first_leg: l.first_leg_fee ?? 0, op: l.op_fee,
            })),
            trung_phi: (naza.fee_audit?.duplicates || []).filter((d) => feeTrackings.has(normTracking(d.tracking))),
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────
// Kho sao kê một nước
// ─────────────────────────────────────────────────────────────────────────

export type MarketStatement = {
    id: string;
    filename: string;
    uploaded_at: string;
    kieu: "naza" | "bang";
    /** Ngày của kỳ: theo tên file, không có thì ngày trả muộn nhất trong file. */
    ngay: string | null;
    rows: StatementRow[];
    /** Tên cột đã nhận ra (kiểu bảng) — để người dùng soát máy đọc đúng cột chưa. */
    cot?: Partial<Record<StatementField, string>>;
    naza?: NazaMarketPart;
    canh_bao: string[];
};

export const statementStoreName = (code: string) => `cod_statements_${code.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
/** Kho việc người làm (tiền về ngân hàng, đã hỏi / bỏ qua) của một nước — như `cod_actions` của Đài. */
export const actionStoreName = (code: string) => `cod_actions_${code.toLowerCase().replace(/[^a-z0-9]/g, "")}`;

const normFilename = (s: string) => s.normalize("NFC").trim().toLowerCase();
const rowKey = (r: StatementRow) => normTracking(r.tracking) || `#${String(r.order_id).trim().toUpperCase()}`;

/**
 * Tải lại CÙNG MỘT KỲ thì THAY, không cộng thêm — một đơn chỉ được trả một lần, để hai bản
 * cùng kỳ nằm cạnh nhau là mọi dòng bị đếm hai lượt (bài học kho Đài 13/09/2026).
 *
 * Cùng kỳ = cùng tên file, HOẶC trùng từ một nửa số đơn trở lên (bản sửa thường đổi tên file),
 * HOẶC hai file NAZA cùng ngày (NAZA gửi mỗi kỳ một file mỗi nước; kỳ chỉ có phí thì không có
 * đơn nào để so trùng). Bảng của đối tác khác thì KHÔNG dùng luật cùng ngày: chưa biết họ gửi
 * mấy file một ngày, mà thay nhầm là mất cả một kỳ.
 */
export function replaceSamePeriod(list: MarketStatement[], incoming: MarketStatement): { list: MarketStatement[]; thay: string[] } {
    const incomingKeys = new Set(incoming.rows.map(rowKey));
    const replaced: string[] = [];
    const giu = list.filter((s) => {
        if (normFilename(s.filename) === normFilename(incoming.filename)) { replaced.push(s.filename); return false; }
        if (s.kieu === "naza" && incoming.kieu === "naza" && s.ngay && s.ngay === incoming.ngay) { replaced.push(s.filename); return false; }
        const ks = new Set(s.rows.map(rowKey));
        let shared = 0;
        for (const k of ks) if (incomingKeys.has(k)) shared++;
        const smallerSize = Math.min(ks.size, incomingKeys.size);
        if (smallerSize > 0 && shared * 2 >= smallerSize) { replaced.push(s.filename); return false; }
        return true;
    });
    return { list: [...giu, incoming].slice(-30), thay: replaced };
}

export function periodDate(filename: string, rows: StatementRow[], dateFromName: (f: string) => string | null): string | null {
    const fromName = dateFromName(filename);
    if (fromName) return fromName;
    const paidDates = rows.map((r) => r.paid_date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    return paidDates.length ? paidDates[paidDates.length - 1] : null;
}

// ─────────────────────────────────────────────────────────────────────────
// Khớp sao kê với đơn của nước đó
// ─────────────────────────────────────────────────────────────────────────

export type MarketPeriod = {
    id: string; filename: string; uploaded_at: string; kieu: MarketStatement["kieu"]; ngay: string | null;
    so_dong: number; cod_local: number;
    phai_nhan_vnd: number | null;   // theo sao kê (NAZA có sheet TỔNG) — có thể ÂM
    uoc_vnd: number | null;         // không có thì ước = tiền COD × tỷ giá, CHƯA trừ phí
    /** Kỳ âm (chỉ có phí + tiền hàng) không cộng vào "đã gửi về": NAZA trừ khoản đó ở chỗ khác. */
    tinh_vao_da_gui: boolean;
    /** Kỳ âm đã được NAZA trừ thẳng vào tiền COD Đài cùng ngày (bản gộp, như 24/09/2026). */
    tru_vao_dai: string | null;
    phi_rmb: number | null; don_phi: number; tien_hang_vnd: number | null;
    khop: number; lech: number; khong_co_don: number;
    cot?: MarketStatement["cot"]; canh_bao: string[];
};
export type PaidOrder = CodOrder & { da_tra?: { ky: string; so_tien: number } };
export type MarketMatchResult = {
    ky: MarketPeriod[];
    don: PaidOrder[];
    lech: { order_id: string; tracking: string; cod_don: number; tra: number; ky: string }[];
    khong_co_don: { order_id: string; tracking: string; so_tien: number; ky: string }[];
    tra_hai_lan: { order_id: string; tracking: string; ky: string[] }[];
    da_gui_ve: { vnd: number; co_uoc: boolean; cod_local: number; so_ky: number; ky_am: number; am_vnd: number };
    da_tra: { so_don: number; cod_local: number };
};

/**
 * Khớp từng kỳ với MỌI đơn của nước đó (đã giao, chưa giao, cả hoàn/huỷ): trạng thái giao
 * thường chậm hơn tiền — đối tác đã trả mà bảng mình còn ghi "đang giao" thì vẫn phải nhận ra
 * là đã trả, không thì đơn đó bị đếm vào "chưa giao" lẫn "trả cho đơn mình không có".
 *
 * Khoá như Đài (reconcile): mã vận đơn trước, mã đơn sau. Mỗi kỳ khớp riêng nên một đơn được
 * hai kỳ trả là bắt được (tra_hai_lan).
 *
 * "Đã gửi về" cộng số phải nhận các kỳ DƯƠNG, như màn Đài (kỳ âm Đài cũng không cộng — NAZA
 * mang sang trừ kỳ sau, số kỳ sau đã trừ rồi). Kỳ âm Sing 24/09/2026 (−3.600.206đ) NAZA trừ thẳng
 * vào tiền COD Đài cùng ngày (bản gộp) — cộng ở đây nữa là trừ hai lần. `ngayGopDai` = các ngày
 * kỳ Đài có gộp phần Sing, để màn hình ghi rõ khoản âm đó đã trừ ở đâu.
 */
export function matchMarketStatements(orders: CodOrder[], statements: MarketStatement[], rateVnd: number, twMergedDates: string[] = []): MarketMatchResult {
    const uid = (i: number) => `D${i}`;
    const pos: PosOrder[] = orders.map((d, i) => ({
        order_uid: uid(i), order_id: d.order_id, tracking: d.tracking || null,
        order_date: d.order_date || "", status_category: d.nhom, status_name: d.trang_thai,
        cod_local: Number(d.cod_local) || 0, marketer: "", sale: "",
    }));
    const paidIn = new Map<string, { ky: string; so_tien: number }[]>();
    const out: MarketMatchResult = {
        ky: [], don: [], lech: [], khong_co_don: [], tra_hai_lan: [],
        da_gui_ve: { vnd: 0, co_uoc: false, cod_local: 0, so_ky: statements.length, ky_am: 0, am_vnd: 0 },
        da_tra: { so_don: 0, cod_local: 0 },
    };

    for (const s of statements) {
        const r = reconcile(pos, s.rows);
        let khop = 0, mismatched = 0, unmatched = 0;
        for (const l of r.lines) {
            if (l.verdict === "thua_o_sao_ke") {
                unmatched++;
                out.khong_co_don.push({ order_id: l.order_id, tracking: l.tracking, so_tien: l.stm_amount, ky: s.filename });
                continue;
            }
            if (l.verdict !== "khop" && l.verdict !== "lech_tien") continue;
            if (l.verdict === "khop") khop++;
            else {
                mismatched++;
                out.lech.push({ order_id: l.order_id, tracking: l.tracking, cod_don: l.pos_amount, tra: l.stm_amount, ky: s.filename });
            }
            const k = l.order_uid!;
            paidIn.set(k, [...(paidIn.get(k) || []), { ky: s.filename, so_tien: l.stm_amount }]);
        }
        const cod = s.rows.reduce((t, x) => t + (Number(x.amount) || 0), 0);
        const phai = s.naza?.phai_nhan_vnd ?? null;
        const estVnd = phai == null && rateVnd > 0 && cod > 0 ? Math.round(cod * rateVnd) : null;
        const am = phai != null && phai < 0;
        out.ky.push({
            id: s.id, filename: s.filename, uploaded_at: s.uploaded_at, kieu: s.kieu, ngay: s.ngay,
            so_dong: s.rows.length, cod_local: Math.round(cod * 100) / 100,
            phai_nhan_vnd: phai, uoc_vnd: estVnd,
            tinh_vao_da_gui: !am,
            tru_vao_dai: am && s.ngay && twMergedDates.includes(s.ngay) ? s.ngay : null,
            phi_rmb: s.naza?.phi_rmb ?? null, don_phi: s.naza?.don_phi ?? 0, tien_hang_vnd: s.naza?.tien_hang_vnd ?? null,
            khop, lech: mismatched, khong_co_don: unmatched, cot: s.cot, canh_bao: s.canh_bao || [],
        });
        out.da_gui_ve.cod_local += cod;
        if (am) { out.da_gui_ve.ky_am++; out.da_gui_ve.am_vnd += phai; }
        else if (phai != null) out.da_gui_ve.vnd += phai;
        else if (estVnd != null) { out.da_gui_ve.vnd += estVnd; out.da_gui_ve.co_uoc = true; }
    }
    out.da_gui_ve.cod_local = Math.round(out.da_gui_ve.cod_local * 100) / 100;

    out.don = orders.map((d, i) => {
        const t = paidIn.get(uid(i));
        if (!t) return d;
        if (t.length > 1) out.tra_hai_lan.push({ order_id: d.order_id, tracking: d.tracking, ky: t.map((x) => x.ky) });
        out.da_tra.so_don++;
        out.da_tra.cod_local += Number(d.cod_local) || 0;
        return { ...d, da_tra: { ky: t[0].ky, so_tien: t.reduce((n, x) => n + x.so_tien, 0) } };
    });
    out.da_tra.cod_local = Math.round(out.da_tra.cod_local * 100) / 100;
    // Kỳ mới nhất lên đầu, như bảng các kỳ của Đài.
    out.ky.sort((a, b) => (b.ngay || b.uploaded_at).localeCompare(a.ngay || a.uploaded_at));
    return out;
}
