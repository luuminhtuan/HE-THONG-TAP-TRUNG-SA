import { NextResponse } from "next/server";
import { parseStatement, MATCH_KEY, type StatementRow } from "@/lib/talpha/cod-recon";
import { isSgFile, parseNazaStatement } from "@/lib/talpha/naza-statement";
import { updateStore } from "@/lib/talpha/store";
import {
    STORE, emptyStore, normalizeFileName, replaceSameFile, SG_STATEMENT_REJECTED, type Statement,
} from "./statement-store";
import { warnings } from "./statement-warnings";

// Hai đường nhận file của POST — route.ts đã soát có file và cỡ file trước khi gọi vào đây.

/** Sao kê NAZA (.xlsx) — đọc cả phép quyết toán lẫn phí từng đơn. */
export async function saveNazaStatement(file: File, mkId: () => string) {
    const buf = Buffer.from(await file.arrayBuffer());
    let naza;
    try {
        naza = await parseNazaStatement(buf, file.name);
    } catch (e) {
        console.error("đọc xlsx lỗi:", e);
        return NextResponse.json({
            error: "Không mở được file .xlsx. Kiểm tra file có mở được bằng Excel không, " +
                "hoặc Lưu thành .csv rồi tải lại.",
        }, { status: 422 });
    }
    if (isSgFile(file.name, naza.market)) {
        return NextResponse.json({ error: SG_STATEMENT_REJECTED }, { status: 422 });
    }
    if (!naza.cod_lines.length) {
        return NextResponse.json({
            error: "Mở được file nhưng không thấy dòng COD nào. Sao kê NAZA phải có sheet " +
                `COD với cột 原单号 và COD金额. Các sheet đọc được: ${JSON.stringify(naza.sheets)}`,
        }, { status: 422 });
    }

    // Quy về StatementRow để dùng chung một hàm đối soát với đường CSV.
    // Chỉ dòng COD Đài: tiền đơn Sing là SGD, cộng vào sổ TWD là sai.
    const rows: StatementRow[] = naza.cod_lines.filter((l) => l.market !== "SG").map((l) => ({
        tracking: l.tracking,
        order_id: l.order_id,
        amount: l.cod_twd,
        fee: 0,                       // phí nằm ở sheet riêng, KHÔNG theo từng đơn COD
        paid_date: l.recv_date || "",
        status: "paid",
    }));

    const statement: Statement = {
        id: mkId(),
        filename: normalizeFileName(file.name),
        uploaded_at: new Date().toISOString(),
        row_count: rows.length,
        detected_columns: ["tracking", "order_id", "amount", "paid_date"],
        missing_columns: [],
        rows,
        naza: {
            sheets: naza.sheets,
            summary: naza.summary,
            checks: naza.checks,
            fee_audit: naza.fee_audit,
            fee_lines: naza.fee_lines,
            sg_gop: naza.sg_gop,
        },
    };

    await updateStore(STORE, emptyStore(), (cur) => ({
        statements: [...replaceSameFile(cur.statements, file.name), statement].slice(-20),
    }));

    return NextResponse.json({
        ok: true,
        statement: {
            id: statement.id, filename: statement.filename,
            uploaded_at: statement.uploaded_at, row_count: statement.row_count,
            detected_columns: statement.detected_columns,
            missing_columns: statement.missing_columns,
            naza: statement.naza,
        },
        warnings: warnings(statement),
    });
}

/** Đường lui .csv — chỉ có tiền COD. */
export async function saveCsvStatement(file: File, mkId: () => string) {
    if (isSgFile(file.name, null)) {
        return NextResponse.json({ error: SG_STATEMENT_REJECTED }, { status: 422 });
    }
    const text = await file.text();
    const { rows, mapping, header } = parseStatement(text);

    const need = MATCH_KEY === "tracking" ? "tracking" : "order_id";
    if (mapping[need] === undefined) {
        return NextResponse.json({
            error: `Không tìm ra cột "${need}" trong file. Các cột đọc được: ${header.join(" · ")}. ` +
                `Khai thêm tên cột của 3PL vào talpha_rules.json → cod_settlement.column_map.${need}`,
            header,
        }, { status: 422 });
    }
    if (mapping.amount === undefined) {
        return NextResponse.json({
            error: `Không tìm ra cột số tiền. Các cột đọc được: ${header.join(" · ")}. ` +
                "Khai thêm vào cod_settlement.column_map.amount",
            header,
        }, { status: 422 });
    }
    if (!rows.length) {
        return NextResponse.json({ error: "File không có dòng dữ liệu nào" }, { status: 422 });
    }

    const detected = Object.keys(mapping);
    const statement: Statement = {
        id: mkId(),
        filename: normalizeFileName(file.name),
        uploaded_at: new Date().toISOString(),
        row_count: rows.length,
        detected_columns: detected,
        missing_columns: ["tracking", "order_id", "amount", "fee", "paid_date", "status"]
            .filter((f) => !detected.includes(f)),
        rows,
    };

    // Giữ tối đa 20 bản gần nhất — sao kê cũ hơn thì đối soát lại từ file gốc.
    await updateStore(STORE, emptyStore(), (cur) => ({
        statements: [...replaceSameFile(cur.statements, file.name), statement].slice(-20),
    }));

    return NextResponse.json({
        ok: true,
        statement: {
            id: statement.id, filename: statement.filename,
            uploaded_at: statement.uploaded_at, row_count: statement.row_count,
            detected_columns: statement.detected_columns,
            missing_columns: statement.missing_columns,
        },
        warnings: warnings(),
    });
}
