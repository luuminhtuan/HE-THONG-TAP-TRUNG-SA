import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { RULES } from "@/lib/talpha/rules";
import { readStoreFresh, updateStore } from "@/lib/talpha/store";
import { MAX_UPLOAD_BYTES, tooBigMessage } from "@/lib/talpha/upload-limit";
import {
    ingestDocs, reconcileRows, readAnySheets, detectKind, toCsv, sendAlerts,
    addRowsToStore, removeSourceFile, summarizeSources,
    type AdsSettlementConfig, type BankRow, type FbRow, type HistoryEntry, type PdfPasswordError,
    type ReconResult, type Roster, type SourceDoc,
} from "@/lib/talpha/ads-recon/recon";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";           // engine đọc .xlsx bằng node:zlib

// ═══════════════════════════════════════════════════════════════════
// ĐỐI SOÁT CHI PHÍ QUẢNG CÁO
//
//   POST                 — nhận từ 2 file trở lên (chi phí TKQC + sao kê thẻ,
//                          mỗi phía bao nhiêu file cũng được), chạy đối soát,
//                          lưu kỳ, trả kết quả ngay
//   POST ?action=notify  — bắn cảnh báo của một kỳ sang chat
//   GET                  — danh sách kỳ; ?ky= một kỳ; ?ky=&csv=1 xuất CSV
//   DELETE ?ky=          — xoá một kỳ
//
// Đối soát COD là tiền VỀ (3PL trả mình), màn này là tiền RA (mình trả
// Facebook). Cùng một câu hỏi theo hai chiều: số có khớp không.
//
// Toàn bộ nghiệp vụ nằm ở lib/talpha/ads-recon/ — dùng chung với bản dòng lệnh
// ở thư mục ads-reconciliation-cli. Route này chỉ lo nhận file, lưu kho, trả JSON.
// ═══════════════════════════════════════════════════════════════════

const STORE = "ads_recon";
const ROW_STORE = "ads_recon_rows";        // kho dòng giao dịch tích luỹ
const MAX_PERIODS_KEPT = 52;                     // một năm; kỳ cũ hơn tự rụng khỏi kho
const MAX_FILES = 12;                    // đủ cho nhiều thẻ + nhiều TKQC trong một kỳ

type Period = { ky: string; chay_luc: string; summary?: Record<string, unknown> } & Record<string, unknown>;
type Store = { periods: Period[] };
const EMPTY: Store = { periods: [] };

/** Kho dòng giao dịch — cất lại để lần sau bổ sung file là đối soát tiếp được. */
type RowStore = { fb: FbRow[]; bank: BankRow[] };
const EMPTY_ROW_STORE: RowStore = { fb: [], bank: [] };

/** Khối luật ads_settlement trong talpha_rules.json. */
function cfg(): AdsSettlementConfig {
    const c = (RULES as unknown as { ads_settlement?: AdsSettlementConfig }).ads_settlement;
    if (!c) throw new Error('Thiếu khối "ads_settlement" trong config/talpha_rules.json');
    return c;
}

/** Roster TKQC = danh bạ TKQC tự động (bảng tkqc, 04/11/2026 — trước đó file ad_accounts.json gõ tay):
 *  mọi TKQC token từng thấy, kể cả loại ngoài báo cáo — vẫn là TK của công ty, thẻ trả cho nó không "lạ".
 *  Kho số lỗi thì engine tự bỏ qua kiểm tra TKQC lạ, không chết. Giữ dạng {projects: {…: {accounts}}}. */
async function roster(): Promise<Roster | null> {
    try {
        const rows = await query<{ account_id: string; name: string | null }>("SELECT account_id, name FROM ad_accounts");
        return { projects: { ad_accounts: { accounts: rows.map((r) => ({ id: `act_${r.account_id}`, name: r.name || r.account_id })) } } };
    } catch {
        return null;
    }
}

/** act_xxx → tên người đọc được, lấy từ roster. */
function adAccountNames(rosterJson: unknown) {
    const names: Record<string, string> = {};
    const projects = (rosterJson as { projects?: Record<string, { accounts?: { id?: string; name?: string }[] }> })?.projects || {};
    for (const p of Object.values(projects)) {
        for (const a of p.accounts || []) if (a.id) names[String(a.id).replace(/^act_/i, "")] = a.name || a.id;
    }
    return names;
}

const sortByPeriod = (a: Period, b: Period) => (a.ky < b.ky ? 1 : a.ky > b.ky ? -1 : 0);   // mới → cũ

// ─────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
    try {
        const period = req.nextUrl.searchParams.get("ky");
        const store = await readStoreFresh<Store>(STORE, EMPTY);

        if (req.nextUrl.searchParams.get("kho") === "1") {
            const rowStore = await readStoreFresh<RowStore>(ROW_STORE, EMPTY_ROW_STORE);
            return NextResponse.json({
                kho: { fb: rowStore.fb.length, bank: rowStore.bank.length },
                nguon: [...summarizeSources(rowStore.fb, "fb"), ...summarizeSources(rowStore.bank, "bank")],
                tkqc_ten: adAccountNames(await roster()),
            });
        }

        if (!period) {
            // Danh sách gọn cho ô chọn kỳ — không kéo cả nghìn dòng chi tiết về
            const periods = [...store.periods].sort(sortByPeriod).map((p) => ({
                ky: p.ky, chay_luc: p.chay_luc, summary: p.summary,
                files: (p as { files?: unknown }).files,
            }));
            return NextResponse.json({ periods });
        }

        const found = store.periods.find((p) => p.ky === period);
        if (!found) return NextResponse.json({ error: `Chưa có kỳ ${period}` }, { status: 404 });

        if (req.nextUrl.searchParams.get("csv") === "1") {
            return new NextResponse(toCsv(found as unknown as ReconResult), {
                headers: {
                    "content-type": "text/csv; charset=utf-8",
                    "content-disposition": `attachment; filename="doi-soat-ads-${period}.csv"`,
                },
            });
        }
        return NextResponse.json(found);
    } catch (e) {
        console.error("ads-recon GET:", e);
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}

// ─────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
    try {
        const c = cfg();

        // ── Bắn cảnh báo của một kỳ đã có ────────────────────────────────
        if (req.nextUrl.searchParams.get("action") === "notify") {
            const period = req.nextUrl.searchParams.get("ky") || "";
            const store = await readStoreFresh<Store>(STORE, EMPTY);
            const found = store.periods.find((p) => p.ky === period);
            if (!found) return NextResponse.json({ error: `Chưa có kỳ ${period}` }, { status: 404 });
            const out = await sendAlerts(found as unknown as ReconResult, c, { force: true });
            return NextResponse.json(out);
        }

        // ── Nhận 2 file rồi đối soát ─────────────────────────────────────
        const form = await req.formData();
        const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
        // MỘT file cũng nhận: dữ liệu được cất vào kho, bổ sung phía kia lúc nào
        // cũng đối soát tiếp được. Bắt phải gom đủ mọi file rồi tải một lượt là
        // đặt điều kiện sai với đời thật — file về rải rác chứ không cùng lúc.
        if (!files.length) {
            return NextResponse.json({ error: "Chưa chọn file nào." }, { status: 400 });
        }
        if (files.length > MAX_FILES) {
            return NextResponse.json({
                error: `Nhiều nhất ${MAX_FILES} file một lượt — quá số đó thì nhiều khả năng đang gộp nhầm nhiều kỳ vào một.`,
            }, { status: 400 });
        }
        for (const f of files) {
            if (f.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: tooBigMessage() }, { status: 413 });
        }

        // Mật khẩu chỉ dùng cho đúng lượt đọc này — không ghi vào kho, không
        // vào log, không nằm trong kết quả trả về.
        const password = String(form.get("matkhau") || "").trim();
        // Mặc định CỘNG DỒN vào kho. Muốn làm lại từ đầu thì gửi lam_moi=1.
        const startOver = String(form.get("lam_moi") || "") === "1";

        const doc: SourceDoc[] = [];
        for (const f of files) {
            const buf = Buffer.from(await f.arrayBuffer());
            try {
                const sheets = await readAnySheets(f.name, buf, password ? { password: password } : {});
                doc.push({ sheets, kind: detectKind(sheets, c), name: f.name });
            } catch (e) {
                const err = e as Partial<PdfPasswordError> & Error;
                return NextResponse.json({
                    error: `Không mở được "${f.name}": ${err.message}`,
                    can_mat_khau: err.needsPassword === true,
                    mat_khau_sai: err.wrongPassword === true,
                    file: f.name,
                }, { status: 422 });
            }
        }

        // ── 1. Đọc file thành hai phía (KHÔNG đối soát vội) ──────────────
        let doc2;
        try {
            doc2 = ingestDocs(doc, c, { allowSingleSide: true });
        } catch (e) {
            // Lỗi ĐỌC HIỂU file (thiếu cột, không nhận ra nguồn) — nói thẳng
            // thiếu gì để người dùng sửa file, đừng nuốt.
            return NextResponse.json({ error: (e as Error).message }, { status: 422 });
        }

        // ── 2. Nạp vào kho, bỏ dòng đã có ────────────────────────────────
        const importStats = { fb: { them: 0, trung: 0 }, bank: { them: 0, trung: 0 } };
        const updatedRowStore = await updateStore<RowStore>(ROW_STORE, EMPTY_ROW_STORE, (cur) => {
            const base = startOver ? EMPTY_ROW_STORE : cur;
            const a = addRowsToStore(base.fb, "fb", doc2.fb.rows);
            const b = addRowsToStore(base.bank, "bank", doc2.bank.rows);
            importStats.fb = { them: a.added.length, trung: a.duplicates.length };
            importStats.bank = { them: b.added.length, trung: b.duplicates.length };
            return { fb: a.rows, bank: b.rows };
        });

        // ── 3. Đối soát trên TOÀN BỘ kho ─────────────────────────────────
        const sources = [...summarizeSources(updatedRowStore.fb, "fb"), ...summarizeSources(updatedRowStore.bank, "bank")];
        if (!updatedRowStore.fb.length || !updatedRowStore.bank.length) {
            // Mới có một phía thì chưa đối soát được, nhưng dữ liệu ĐÃ CẤT rồi —
            // bổ sung phía kia lúc nào cũng chạy tiếp được.
            return NextResponse.json({
                chua_du: true, nap: importStats, nguon: sources,
                kho: { fb: updatedRowStore.fb.length, bank: updatedRowStore.bank.length },
                thieu: !updatedRowStore.fb.length ? "chi phí TKQC" : "sao kê thẻ",
                tkqc_ten: adAccountNames(await roster()),
            });
        }

        const previousStore = await readStoreFresh<Store>(STORE, EMPTY);
        const reconRun = reconcileRows(
            { ...doc2.fb, rows: updatedRowStore.fb },
            { ...doc2.bank, rows: updatedRowStore.bank },
            c, { roster: await roster(), history: previousStore.periods as HistoryEntry[] });

        const result: Period = {
            ...reconRun, nap: importStats, nguon: sources,
            kho: { fb: updatedRowStore.fb.length, bank: updatedRowStore.bank.length },
            tkqc_ten: adAccountNames(await roster()),
        };

        await updateStore<Store>(STORE, EMPTY, (cur) => {
            const rest = (cur.periods || []).filter((p) => p.ky !== result.ky);   // chạy lại thì đè kỳ cũ
            return { periods: [...rest, result].sort(sortByPeriod).slice(0, MAX_PERIODS_KEPT) };
        });

        return NextResponse.json(result);
    } catch (e) {
        console.error("ads-recon POST:", e);
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}

// ─────────────────────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
    try {
        // Bỏ một file khỏi kho — tải nhầm thì rút ra, không phải xoá sạch làm lại.
        const sources = req.nextUrl.searchParams.get("nguon");
        if (sources) {
            const rowStore = await updateStore<RowStore>(ROW_STORE, EMPTY_ROW_STORE, (cur) => ({
                fb: removeSourceFile(cur.fb, sources), bank: removeSourceFile(cur.bank, sources),
            }));
            return NextResponse.json({ ok: true, kho: { fb: rowStore.fb.length, bank: rowStore.bank.length } });
        }

        const period = req.nextUrl.searchParams.get("ky");
        if (!period) return NextResponse.json({ error: "Thiếu tham số ky hoặc nguon" }, { status: 400 });
        const next = await updateStore<Store>(STORE, EMPTY, (cur) => ({
            periods: (cur.periods || []).filter((p) => p.ky !== period),
        }));
        return NextResponse.json({ ok: true, con_lai: next.periods.length });
    } catch (e) {
        console.error("ads-recon DELETE:", e);
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
