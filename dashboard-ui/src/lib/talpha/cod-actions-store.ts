/**
 * GHI VIỆC ĐỐI SOÁT VÀO KHO — dùng chung cho Đài (/api/talpha/cod-actions, kho `cod_actions`) và
 * từng nước khác (/api/talpha/cod-recon/market/actions, kho `cod_actions_<mã>`, 08/10/2026).
 * Cùng một luật cho mọi nước: tiền về không âm, không ở tương lai; bỏ qua phải có lý do; ghi lại
 * cùng một việc thì ĐẾM TIẾP chứ không đè. Tách ra từ route Đài để hai nơi không lệch nhau.
 */
import { updateStore } from "./store";
import { bankKey, emptyActions, type CodActions, type DoneKind } from "./cod-actions";

export type CodActionBody = {
    kind: "bank" | "done";
    filename?: string; thuc_nhan_vnd?: number; ngay_ve?: string;
    key?: string; viec?: DoneKind;
    ghi_chu?: string;
};
type ActionResult = { status: number; json: Record<string, unknown> };

const today = () => new Date().toISOString().slice(0, 10);
const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function recordCodAction(store: string, body: CodActionBody): Promise<ActionResult> {
    // ── Ghi tiền thật về tài khoản ────────────────────────────────────
    if (body.kind === "bank") {
        const f = String(body.filename || "").trim();
        if (!f) return { status: 400, json: { error: "Thiếu tên file kỳ sao kê" } };
        const amount = Number(body.thuc_nhan_vnd);
        if (!Number.isFinite(amount) || amount < 0) return { status: 400, json: { error: "Số tiền không hợp lệ" } };
        // Ngày về phải là ngày thật, không nhận ngày tương lai: gõ nhầm năm là
        // kỳ đó biến mất khỏi mọi phép so theo kỳ mà không ai thấy.
        const receivedDate = isDate(body.ngay_ve) ? (body.ngay_ve as string) : today();
        if (receivedDate > today()) return { status: 400, json: { error: "Ngày tiền về không thể ở tương lai" } };
        const after = await updateStore<CodActions>(store, emptyActions(), (cur) => ({
            bank: {
                ...(cur.bank || {}),
                [bankKey(f)]: {
                    thuc_nhan_vnd: Math.round(amount), ngay_ve: receivedDate,
                    ghi_chu: String(body.ghi_chu || "").slice(0, 300) || undefined,
                    luc: new Date().toISOString(),
                },
            },
            done: cur.done || {},
        }));
        return { status: 200, json: { ok: true, bank: after.bank[bankKey(f)] } };
    }

    // ── Ghi một việc đã xử ────────────────────────────────────────────
    if (body.kind === "done") {
        const key = String(body.key || "").trim();
        const action = body.viec;
        if (!key) return { status: 400, json: { error: "Thiếu khoá việc" } };
        if (action !== "da_doi" && action !== "da_hoi" && action !== "bo_qua") return { status: 400, json: { error: "Loại việc không hợp lệ" } };
        const note = String(body.ghi_chu || "").trim().slice(0, 300);
        // Bỏ qua một khoản lệch là quyết định mất tiền — phải nói vì sao, để
        // sau này còn tra được ai bỏ qua cái gì và với lý do nào.
        if (action === "bo_qua" && !note) return { status: 400, json: { error: "Bỏ qua thì phải ghi lý do" } };
        const after = await updateStore<CodActions>(store, emptyActions(), (cur) => {
            const previous = (cur.done || {})[key];
            // Đòi lần hai thì ĐẾM TIẾP, không ghi đè: "đòi 3 lần vẫn im" là
            // chuyện khác hẳn "vừa đòi hôm nay".
            const count = previous && previous.viec === action ? previous.lan + 1 : 1;
            return {
                bank: cur.bank || {},
                done: { ...(cur.done || {}), [key]: { viec: action, ngay: today(), lan: count, ghi_chu: note || undefined } },
            };
        });
        return { status: 200, json: { ok: true, done: after.done[key] } };
    }
    return { status: 400, json: { error: "kind phải là bank hoặc done" } };
}

export async function deleteCodAction(store: string, kind: string | null, key: string): Promise<ActionResult> {
    if (!key) return { status: 400, json: { error: "Thiếu khoá" } };
    const after = await updateStore<CodActions>(store, emptyActions(), (cur) => {
        const bank = { ...(cur.bank || {}) };
        const done = { ...(cur.done || {}) };
        if (kind === "bank") delete bank[bankKey(key)];
        else delete done[key];
        return { bank, done };
    });
    return { status: 200, json: { ok: true, remaining: Object.keys(after.bank).length + Object.keys(after.done).length } };
}
