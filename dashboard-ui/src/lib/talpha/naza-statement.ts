/**
 * ĐỌC SAO KÊ NAZA供应链 — file .xlsx đối tác gửi hằng tuần.
 *
 * Mỗi file có ĐÚNG BA sheet, và cả ba đều cần:
 *
 *   1. TỔNG   — phép quyết toán của kỳ: COD thu × tỷ giá − phí = tiền phải trả
 *   2. COD    — từng đơn ĐÃ THU ĐƯỢC TIỀN trong kỳ
 *   3. PHÍ    — từng đơn ĐÃ XUẤT KHO trong kỳ, kèm phí vận chuyển + thao tác
 *
 * Hai sheet 2 và 3 là HAI TẬP ĐƠN KHÁC NHAU, không phải hai cột của cùng một
 * bảng: đơn xuất kho tuần này thường mãi tuần sau mới thu được tiền. Chính chỗ
 * lệch giữa hai tập đó là tiền đang treo ở 3PL.
 *
 * Tên sheet và tên cột đổi gần như mỗi file ('汇总 TỔNG', 'TỔNG', '汇总',
 * ' ĐỐI SOÁT COD' có dấu cách ở đầu). Thứ KHÔNG đổi là mã tiếng Trung, nên
 * mọi thứ ở đây neo vào mã tiếng Trung chứ không so tên tiếng Việt.
 *
 * Hàm thuần, nhận Buffer — không đọc đường dẫn, không gọi mạng.
 */
import { OP_FEE_PER_PARCEL, matchChannel, expectedShipFee } from "./naza-statement-config";
import {
    normTracking, toNumber, cellText, toIsoDate, pickSheets, findHeader, feeColumns, colIndex,
    detectColumnShift, findUnlabeledDateColumn, toGrids, type Grid,
} from "./naza-statement-cells";
import type { NazaCodLine, NazaFeeLine, NazaMarket, NazaSgPart, NazaStatement, NazaSummary } from "./naza-statement-types";

// Cấu hình + bảng giá, đọc ô / sheet, kiểu dữ liệu nằm ở naza-statement-config.ts /
// naza-statement-cells.ts / naza-statement-types.ts (tách 16/11/2026) — mặt tiền này giữ nguyên mọi tên cũ.
export { FEE_TABLE_DECLARED, OP_FEE_PER_PARCEL, matchChannel, expectedShipFee } from "./naza-statement-config";
export { normTracking, normOrderId, toNumber, toIsoDate, feeColumns, detectColumnShift, xlsxToTables } from "./naza-statement-cells";
export type { NazaCodLine, NazaMarket, NazaFeeLine, NazaSgPart, NazaSummary, NazaStatement } from "./naza-statement-types";

/**
 * File sao kê RIÊNG của Singapore — NAZA tách từ kỳ sau 24/09/2026.
 *
 * Kho sao kê là sổ tiền COD ĐÀI: số tiền đọc như TWD và khớp với đơn Đài. Nhận
 * file Sing vào đó thì (1) tiền SGD bị cộng như TWD, và (2) tệ hơn, luật "cùng
 * ngày trên tên file là cùng kỳ" cho file Sing ĐÈ MẤT file Đài cùng ngày. Nên
 * chặn, cho tới khi có chỗ đối soát COD Sing riêng (bước 2).
 *
 * Nhận bằng NỘI DUNG trước (không dòng COD nào của Đài), rồi bằng tên file —
 * nhóm gọi Sing là SING / SIG / SG. Kỳ gộp 24/09 tên chỉ ghi "ĐỐI SOÁT COD
 * 2026.09.24" và có dòng COD Đài, nên vẫn là file Đài.
 */
const SG_FILENAME_RE = /(^|[^A-Z])(SING|SINGAPORE|SIG|SG)([^A-Z]|$)|新加坡/;
export function isSgFile(filename: string, market: NazaMarket | null | undefined): boolean {
    if (market === "SG") return true;
    const upperName = filename.normalize("NFC").toUpperCase();
    if (/TAIWAN|ĐÀI|台湾/.test(upperName)) return false;
    return SG_FILENAME_RE.test(upperName);
}

/** Câu giải thích kỳ NAZA gộp Singapore vào sao kê Đài (kỳ 24/09/2026). */
export function sgMergeWarning(sg: NazaSgPart, payable: number | null): string {
    const fmtNum = (n: number) => Math.round(n).toLocaleString("vi-VN");
    const parts = [
        sg.don ? `phí ship ${sg.don} đơn Sing ${fmtNum(sg.phi_rmb)}¥` +
            (sg.phi_vnd != null ? ` (≈ ${fmtNum(sg.phi_vnd)}đ)` : "") : "",
        sg.tien_hang_vnd != null ? `tiền hàng Sing ${fmtNum(sg.tien_hang_vnd)}đ` : "",
    ].filter(Boolean).join(" và ");
    return `Kỳ này NAZA GỘP Singapore vào sao kê Đài: ${parts} trừ thẳng vào tiền COD Đài` +
        (sg.tong_vnd != null ? ` — tổng ${fmtNum(sg.tong_vnd)}đ` : "") + ". " +
        (payable != null ? `Phải nhận ${fmtNum(payable)}đ là số SAU khi trừ phần Sing. ` : "") +
        "Từ kỳ sau NAZA tách file Sing riêng.";
}

/** Đơn Singapore nhận ra bằng cột nước (目的国家 · 国家名称 = 新加坡) hoặc tên kênh
 *  ('S新加坡CODJT专线'). Không có dấu hiệu Sing thì là Đài, như mọi kỳ trước. */
export function rowMarket(country: string, channel: string): NazaMarket {
    const s = `${country} ${channel}`.toUpperCase();
    return s.includes("新加坡") || /\bSINGAPORE\b/.test(s) ? "SG" : "TW";
}

// ─────────────────────────────────────────────────────────────────────────
// Đọc file (bảng chữ của từng sheet: naza-statement-cells.ts → toGrids)
// ─────────────────────────────────────────────────────────────────────────

/** Sheet TỔNG là bảng hai cột nhãn + một cột số. Đọc bằng nhãn tiếng Trung ở
 *  cột A, vì cột B (tiếng Việt) đổi cách gọi gần như mỗi kỳ. */
function readSummary(grid: Grid): NazaSummary {
    // Bỏ hết dấu cách trong nhãn trước khi so: kỳ 2026.09.24 ghi '本期应退金额 VND '
    // (có cách) nên dò '本期应退金额VND' trượt, số phải nhận của kỳ thành trống.
    const pick = (...keys: string[]): number | null => pickIf(() => true, ...keys);
    const pickIf = (accepts: (label: string) => boolean, ...keys: string[]): number | null => {
        for (const row of grid) {
            const label = cellText((row || [])[0]).replace(/\s+/g, "");
            if (!label || !accepts(label)) continue;
            if (keys.some((k) => label.includes(k))) {
                const v = toNumber((row || [])[2]);
                if (v !== null) return v;
            }
        }
        return null;
    };
    // 汇率 xuất hiện HAI lần: lần đầu là TWD→RMB (số nhỏ ~0.2), lần sau là
    // RMB→VND (~3900). Phân biệt bằng độ lớn chứ không bằng nhãn.
    const rates: number[] = [];
    for (const row of grid) {
        const label = cellText((row || [])[0]);
        if (!label) continue;
        if (label.includes("汇率") || label.includes("人民币折越南盾") || label.includes("人民币换成越南盾")) {
            const v = toNumber((row || [])[2]);
            if (v !== null) rates.push(v);
        }
    }
    // Có kỳ gộp hai loại phí vào một dòng '速递运费 + 操作费 RMB'. Nhãn đó chứa
    // CẢ HAI mã, nên nếu cứ dò riêng từng mã thì cùng một con số bị trừ hai lần
    // và phép quyết toán lệch đúng bằng phần phí thao tác. Đã dính thật ở kỳ
    // 24/07: tính ra −1.098,29 RMB trong khi file ghi −163,29 RMB.
    const combined = grid.some((row) => {
        const label = cellText((row || [])[0]);
        return label.includes("运费") && label.includes("操作费");
    });
    // Kỳ 2026.10.16 NAZA đổi nhãn dòng phí ship ở sheet TỔNG thành '运费 人民币' — mất chữ
    // 速递运费, nên phí ship của kỳ thành trống và phép tự soát quyết toán báo lệch giả 560¥.
    const shipFee = pick("速递运费", "快递运费") ?? pickIf((l) => l.startsWith("运费"), "运费");

    return {
        cod_twd: pick("本期回款金额"),
        refund_twd: pick("退款手续费", "客诉退款"),
        // Tỷ giá tiền nước → tệ: Đài ~0,2 nhưng SGD ~5,5 và AED ~1,9 (file Sing riêng từ
        // 10/2026) — nên mốc là "dưới 100", không phải "dưới 2"; RMB→VND luôn cỡ nghìn.
        rate_twd_rmb: rates.find((r) => r > 0 && r < 100) ?? null,
        ship_fee_rmb: shipFee,
        op_fee_rmb: combined ? 0 : pick("操作费"),
        net_rmb: pick("本期应退金额RMB"),
        rate_rmb_vnd: rates.find((r) => r >= 100) ?? null,
        // Kỳ 2026.09.24 có HAI dòng tiền hàng: '台湾本期采购费' rồi '新加坡本期采购费'.
        // Bộ đọc cũ lấy dòng đầu nên bỏ sót 1.840.046đ tiền hàng Sing — luồng tiền
        // trên màn hình không cộng trừ ra được "phải nhận".
        purchase_vnd: pickIf((l) => !l.includes("新加坡"), "采购费"),
        purchase_sg_vnd: pickIf((l) => l.includes("新加坡"), "采购费"),
        payable_vnd: pick("本期应退金额VND"),
        fees_combined: combined,
    };
}

/**
 * MÃ VẬN ĐƠN TRỐNG Ở SHEET COD → LẤY TỪ SHEET PHÍ.
 *
 * Kỳ 05/10, 12/10, 16/10/2026 NAZA ghi cột mã vận đơn ở sheet COD là '运单号' thay vì
 * '转单号'. Bộ đọc chỉ nhận 转单号 nên 98 dòng mất mã vận đơn, mà 原单号 lúc đó lại là mã
 * POS ('20261015-1862725244-875') Sheet đơn không có → 78 đơn NAZA ĐÃ TRẢ bị tính "còn
 * phải gửi": màn hiện 100 đơn · 104.992 NT$, thật là 22 đơn · 22.078 NT$ (26/10/2026).
 * Đã thêm 运单号 vào header_anchors; hàm này là lưới đỡ cho lần NAZA đổi tên cột tiếp
 * theo, và cho kho đã lưu tự lành mà không phải tải lại file.
 *
 * Sheet PHÍ ghi cả 原单号 lẫn 转单号, và đơn thường bị tính phí ở kỳ TRƯỚC kỳ trả tiền
 * — nên ở cấp kho phải tra trên phí của mọi kỳ (dienMaVanDonKho). Khớp nguyên chuỗi
 * 原单号, không cắt -Z / -1: '17990334-Z' là lần giao lại, khác đơn '17990334'. Một mã đơn
 * mang nhiều mã vận đơn thì không đoán — để trống, đơn vẫn khớp được bằng mã đơn.
 */
export function fillTrackingFromFees<T extends { tracking: string; order_id: string }>(
    lines: T[], fees: { tracking: string; order_id: string }[],
): T[] {
    const byOrderId = new Map<string, Map<string, string>>();
    for (const f of fees) {
        const orderId = String(f.order_id ?? "").trim();
        const trk = String(f.tracking ?? "").trim();
        if (!orderId || !trk) continue;
        const fields = byOrderId.get(orderId) ?? new Map<string, string>();
        fields.set(normTracking(trk), trk);
        byOrderId.set(orderId, fields);
    }
    return lines.map((d) => {
        if (String(d.tracking ?? "").trim()) return d;
        const fields = byOrderId.get(String(d.order_id ?? "").trim());
        return fields && fields.size === 1 ? { ...d, tracking: [...fields.values()][0] } : d;
    });
}

type OrderTrackingRow = { tracking: string; order_id: string };

/** dienMaVanDonTuPhi cho cả kho sao kê Đài: dòng COD của mọi kỳ tra trên phí của MỌI kỳ. */
export function fillTrackingInStatements<S extends { rows: OrderTrackingRow[]; naza?: { fee_lines?: OrderTrackingRow[] } | null }>(
    ds: S[],
): S[] {
    const fees = ds.flatMap((s) => s.naza?.fee_lines || []);
    return ds.map((s) => ({ ...s, rows: fillTrackingFromFees(s.rows, fees) }));
}

export async function parseNazaStatement(buf: Buffer, fileName = ""): Promise<NazaStatement> {
    const book = await toGrids(buf);
    const { summary: sSum, cod: sCod, fee: sFee } = pickSheets(book);

    const summary = sSum ? readSummary(sSum.grid) : ({} as NazaSummary);

    // ── Sheet COD ────────────────────────────────────────────────────────
    const cod_lines: NazaCodLine[] = [];
    if (sCod) {
        const h = findHeader(sCod.grid, ["原单号"]) || findHeader(sCod.grid, ["MÃ ĐƠN"]);
        if (h) {
            const shift = detectColumnShift(sCod.grid, h.row, colIndex(h.cols, "order_id"), colIndex(h.cols, "cod_amount"));
            const dich = (i: number) => (i >= 0 ? i + shift : -1);
            const iOrd = dich(colIndex(h.cols, "order_id"));
            const iTrk = dich(colIndex(h.cols, "tracking"));
            const iAmt = dich(colIndex(h.cols, "cod_amount"));
            const iRcvTd = dich(colIndex(h.cols, "recv_date"));
            const iRcv = iRcvTd >= 0 ? iRcvTd : shift !== 0 ? findUnlabeledDateColumn(sCod.grid, h.row) : -1;
            const iCh = dich(colIndex(h.cols, "channel"));
            const iMarket = dich(h.cols.findIndex((c) => c.includes("国家")));
            const iRate = dich(h.cols.findIndex((c) => c.includes("汇率")));
            const iReceived = dich(h.cols.findIndex((c) => c.includes("回款金额")));
            for (let r = h.row + 1; r < sCod.grid.length; r++) {
                const row = sCod.grid[r] || [];
                const amt = iAmt >= 0 ? toNumber(row[iAmt]) : null;
                const ord = iOrd >= 0 ? cellText(row[iOrd]) : "";
                if (amt === null || !ord) continue;
                const channel = iCh >= 0 ? cellText(row[iCh]) : "";
                cod_lines.push({
                    recv_date: iRcv >= 0 ? toIsoDate(row[iRcv]) : null,
                    order_id: ord,
                    tracking: iTrk >= 0 ? cellText(row[iTrk]) : "",
                    channel,
                    cod_twd: amt,
                    market: rowMarket(iMarket >= 0 ? cellText(row[iMarket]) : "", channel),
                    ...(iRate >= 0 ? { ty_gia_rmb: toNumber(row[iRate]) } : {}),
                    ...(iReceived >= 0 ? { ve_rmb: toNumber(row[iReceived]) } : {}),
                });
            }
        }
    }

    // ── Sheet PHÍ ────────────────────────────────────────────────────────
    const fee_lines: NazaFeeLine[] = [];
    if (sFee) {
        const h = findHeader(sFee.grid, ["原单号"]) || findHeader(sFee.grid, ["MÃ ĐƠN"]);
        if (h) {
            const feeColumn = feeColumns(h.cols);
            const shift = detectColumnShift(sFee.grid, h.row, colIndex(h.cols, "order_id"), feeColumn.iFee);
            const dich = (i: number) => (i >= 0 ? i + shift : -1);
            const iOrd = dich(colIndex(h.cols, "order_id"));
            const iTrk = dich(colIndex(h.cols, "tracking"));
            const iShp = dich(colIndex(h.cols, "ship_date"));
            const iKg = dich(colIndex(h.cols, "chargeable_kg"));
            const iCh = dich(h.cols.findIndex((c) => c.includes("运输方式")));
            const iMarket = dich(h.cols.findIndex((c) => c.includes("国家")));
            const iFee = dich(feeColumn.iFee), iOp = dich(feeColumn.iOp), iFirstLeg = dich(feeColumn.iFirstLeg);
            for (let r = h.row + 1; r < sFee.grid.length; r++) {
                const row = sFee.grid[r] || [];
                const ord = iOrd >= 0 ? cellText(row[iOrd]) : "";
                const fee = iFee >= 0 ? toNumber(row[iFee]) : null;
                if (!ord || fee === null) continue;
                const channel = iCh >= 0 ? cellText(row[iCh]) : "";
                const kg = iKg >= 0 ? toNumber(row[iKg]) : null;
                const market = rowMarket(iMarket >= 0 ? cellText(row[iMarket]) : "", channel);
                // Bảng giá ở đây là bảng Đài — đơn Sing đem soát theo nó là báo sai.
                const ch = market === "TW" ? matchChannel(channel) : null;
                fee_lines.push({
                    ship_date: iShp >= 0 ? toIsoDate(row[iShp]) : null,
                    order_id: ord,
                    tracking: iTrk >= 0 ? cellText(row[iTrk]) : "",
                    channel,
                    chargeable_kg: kg,
                    ship_fee: fee,
                    op_fee: iOp >= 0 ? toNumber(row[iOp]) ?? 0 : 0,
                    first_leg_fee: iFirstLeg >= 0 ? toNumber(row[iFirstLeg]) ?? 0 : 0,
                    expected_ship_fee: expectedShipFee(ch, kg),
                    channel_code: ch?.code ?? null,
                    market,
                });
            }
        }
    }

    // Cột mã vận đơn sheet COD mang tên bộ đọc chưa biết → lấy từ sheet PHÍ cùng file.
    cod_lines.splice(0, cod_lines.length, ...fillTrackingFromFees(cod_lines, fee_lines));

    // ── Kiểm chéo nội bộ file ────────────────────────────────────────────
    const codDetail = cod_lines.reduce((s, l) => s + l.cod_twd, 0);
    // Phí chặng đầu đi chung dòng '速递运费' ở sheet TỔNG nên cộng vào phí ship.
    const shipDetail = fee_lines.reduce((s, l) => s + l.ship_fee + (l.first_leg_fee ?? 0), 0);
    const opDetail = fee_lines.reduce((s, l) => s + l.op_fee, 0);
    const abs = (n: number | null) => (n === null ? null : Math.abs(n));

    // Sheet TỔNG không có dòng 操作费 riêng mà sheet phí vẫn có phí thao tác
    // (kỳ 2026.09.24: '速递运费 RMB' −2.575 = ship 2.323 + thao tác 252) thì đó là
    // một kiểu GỘP nữa, chỉ là nhãn không ghi chữ 操作费.
    if (summary.op_fee_rmb == null && summary.ship_fee_rmb != null && opDetail > 0) {
        summary.fees_combined = true;
        summary.op_fee_rmb = 0;
    }

    let mathOk: boolean | null = null;
    let mathNote = "Thiếu số ở sheet TỔNG, không kiểm được phép quyết toán.";
    const s = summary;
    if (s.cod_twd !== null && s.rate_twd_rmb !== null && s.net_rmb !== null) {
        const twd = s.cod_twd - (s.refund_twd ?? 0);
        const expNet = twd * s.rate_twd_rmb - Math.abs(s.ship_fee_rmb ?? 0) - Math.abs(s.op_fee_rmb ?? 0);
        const gap = Math.abs(expNet - s.net_rmb);
        mathOk = gap < 0.5;
        mathNote = mathOk
            ? `Phép quyết toán tự khớp (lệch ${gap.toFixed(2)} RMB).`
            : `Phép quyết toán KHÔNG khớp: tính ra ${expNet.toFixed(2)} RMB, file ghi ${s.net_rmb.toFixed(2)} RMB.`;
    }

    // ── Soát phí với bảng giá ────────────────────────────────────────────
    // Chỉ soát đơn Đài: bảng giá và mức phí thao tác khai ở đây là của Đài.
    // Đơn Sing gộp vào kỳ 24/09 nằm riêng ở `sg_gop`, không tính là "không nhận ra kênh".
    const feeTw = fee_lines.filter((l) => l.market !== "SG");
    const auditLines: NazaStatement["fee_audit"]["lines"] = [];
    let ok = 0, unknown = 0;
    for (const l of feeTw) {
        if (l.expected_ship_fee === null) { unknown++; continue; }
        const diff = l.ship_fee - l.expected_ship_fee;
        if (Math.abs(diff) < 0.01) { ok++; continue; }
        auditLines.push({
            tracking: l.tracking, order_id: l.order_id, channel: l.channel,
            kg: l.chargeable_kg, expected: l.expected_ship_fee, charged: l.ship_fee, diff,
        });
    }

    // ── THU HAI LẦN PHÍ TRÊN MỘT ĐƠN ─────────────────────────────────────
    //
    // Một mã vận đơn chỉ được tính phí một lần trong một kỳ. Trùng nghĩa là
    // trả thừa, và không ai bắt được bằng mắt vì bảng phí dài cả trăm dòng và
    // hai dòng trùng thường nằm cách xa nhau.
    //
    // Cẩn thận với đơn GIAO LẠI: mã vận đơn khác nhau thì là hai lần gửi thật,
    // có thu phí hai lần cũng đúng. Nên đối chiếu bằng MÃ VẬN ĐƠN, không phải
    // mã đơn — mã đơn giữ nguyên khi gửi lại.
    const byTrack = new Map<string, NazaFeeLine[]>();
    for (const l of fee_lines) {
        const k = normTracking(l.tracking);
        if (!k) continue;
        (byTrack.get(k) || byTrack.set(k, []).get(k)!).push(l);
    }
    const duplicates: NazaStatement["fee_audit"]["duplicates"] = [];
    for (const [tracking, ls] of byTrack) {
        if (ls.length < 2) continue;
        const each = ls.map((l) => l.ship_fee + l.op_fee + (l.first_leg_fee ?? 0));
        duplicates.push({
            tracking,
            order_ids: [...new Set(ls.map((l) => l.order_id))],
            times: ls.length,
            extra_rmb: each.reduce((a, b) => a + b, 0) - each[0],
        });
    }

    // ── PHÍ THAO TÁC ─────────────────────────────────────────────────────
    // Mức đã khai là 3¥/đơn. Khác mức đó thì phải hỏi, dù chỉ lệch 1¥ — trên
    // vài trăm đơn mỗi kỳ thì 1¥ lệch cũng thành tiền thật.
    const opExpected = OP_FEE_PER_PARCEL;
    const opWrong = opExpected > 0
        ? feeTw.filter((l) => Math.abs(l.op_fee - opExpected) > 0.01)
            .map((l) => ({ tracking: l.tracking, order_id: l.order_id, charged: l.op_fee, expected: opExpected }))
        : [];

    // ── PHẦN SINGAPORE ───────────────────────────────────────────────────
    const feeSg = fee_lines.filter((l) => l.market === "SG");
    const sgFeeRmb = feeSg.reduce((t, l) => t + l.ship_fee + l.op_fee + (l.first_leg_fee ?? 0), 0);
    const sgGoodsVnd = s.purchase_sg_vnd ?? null;
    const coSg = feeSg.length > 0 || sgGoodsVnd != null;
    const sgFeeVnd = coSg && s.rate_rmb_vnd != null ? sgFeeRmb * s.rate_rmb_vnd : null;
    const sgPart: NazaSgPart | null = coSg ? {
        don: feeSg.length,
        phi_rmb: sgFeeRmb,
        phi_vnd: sgFeeVnd,
        tien_hang_vnd: sgGoodsVnd,
        tong_vnd: sgFeeVnd == null ? null : sgFeeVnd + (sgGoodsVnd ?? 0),
    } : null;
    // Không dòng COD nào của Đài mà có dòng Sing → đây là file Sing riêng
    // (NAZA tách từ kỳ sau 24/09), không phải file Đài gộp Sing.
    const coCodTw = cod_lines.some((l) => l.market !== "SG");
    const market: NazaMarket = !coCodTw && (cod_lines.length > 0 || feeSg.length > 0) ? "SG" : "TW";

    const summary_lines = (sSum?.grid || []).map((r) => ({
        zh: cellText((r || [])[0]).trim(), vi: cellText((r || [])[1]).trim(), so: toNumber((r || [])[2]),
    })).filter((x): x is { zh: string; vi: string; so: number } => !!x.zh && x.so !== null);

    return {
        file: fileName,
        sheets: { summary: sSum?.name ?? null, cod: sCod?.name ?? null, fee: sFee?.name ?? null },
        summary,
        cod_lines,
        fee_lines,
        market,
        sg_gop: sgPart,
        summary_lines,
        checks: {
            cod_detail_total: codDetail,
            cod_summary_total: s.cod_twd,
            cod_gap: s.cod_twd === null ? null : codDetail - s.cod_twd,
            // Kỳ gộp phí thì con số ở sheet TỔNG là ship+op, phải so với tổng
            // của cả hai cột chi tiết chứ không riêng cột phí vận chuyển.
            ship_fee_detail_total: s.fees_combined ? shipDetail + opDetail : shipDetail,
            ship_fee_summary_total: abs(s.ship_fee_rmb),
            op_fee_detail_total: opDetail,
            op_fee_summary_total: s.fees_combined ? 0 : abs(s.op_fee_rmb),
            math_ok: mathOk,
            math_note: mathNote,
        },
        fee_audit: {
            checked: feeTw.length,
            ok,
            wrong: auditLines.length,
            unknown_channel: unknown,
            overcharge_rmb: auditLines.reduce((t, l) => t + l.diff, 0),
            lines: auditLines,
            duplicates,
            duplicate_extra_rmb: duplicates.reduce((t, d) => t + d.extra_rmb, 0),
            op_wrong: opWrong,
            op_expected: opExpected,
        },
    };
}
