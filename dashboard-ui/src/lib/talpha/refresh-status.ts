// ═══════════════════════════════════════════════════════════════════
// Trạng thái cập nhật số cho NGƯỜI DÙNG (15/11/2026): đang kéo số không, kéo xong lúc nào, vòng báo
// cáo gần nhất ra sao, TKQC / shop nào đọc lỗi, yêu cầu "Cập nhật ngay" tới đâu.
//
// Nguồn: job_runs + refresh_requests (migration 0001, lịch Docker ghi — sync/core/job_log.py) và
// sync_health (vòng báo cáo ghi — daily_guarded.sh). Máy chưa ghi job_runs (máy chủ VPS chạy systemd)
// thì lấy giờ kéo số từ sale_order.sync_time.
// ═══════════════════════════════════════════════════════════════════
import { query } from "@/lib/db";

/** Tên TKQC / shop đọc lỗi trong vòng chạy — daily_guarded.sh đặt đầu `detail` theo nhãn
 *  "TKQC_LOI=a; b || SHOP_LOI=… || MAT_QUYEN=… || TKQC_BO_QUA=…". Không có nhãn = không mục nào lỗi.
 *  bo_qua (28/10/2026): TK đọc lỗi mà vẫn còn TK khác đọc được — sync bỏ qua, vòng vẫn OK. */
export function parseFetchErrors(detail: unknown) {
    const s = String(detail || "");
    const listFor = (label: string) => {
        const m = new RegExp(`${label}=([^|]*)`).exec(s);
        return m ? m[1].split(";").map((x) => x.trim()).filter(Boolean) : [];
    };
    return { tkqc: listFor("TKQC_LOI"), shops: listFor("SHOP_LOI"), mat_quyen: listFor("MAT_QUYEN"), bo_qua: listFor("TKQC_BO_QUA") };
}

export type JobRun = { job: string; started_at: string; triggered_by: string | null };
export type YeuCau = {
    id: number; status: "pending" | "running" | "ok" | "failed"; requested_by: string | null;
    requested_at: string; started_at: string | null; finished_at: string | null;
};
export type RefreshStatus = {
    /** Việc đang chạy (kéo số "sync", dựng báo cáo "bao_cao"…). */
    dang_chay: JobRun[];
    /** Yêu cầu "Cập nhật ngay" gần nhất trong 6 giờ. */
    yeu_cau: YeuCau | null;
    /** Lần kéo số gần nhất đã xong (ok hoặc hỏng). */
    lan_keo_cuoi: { luc: string; ok: boolean; ai: string | null; loi: string | null } | null;
    /** Lần kéo số THÀNH CÔNG gần nhất — số trên màn hình mới tới lúc này. */
    lan_keo_ok: string | null;
    /** Vòng dựng báo cáo gần nhất (Tổng quan, P&L, Marketing đọc số của vòng này). */
    bao_cao: { luc: string; ok: boolean; loi: ReturnType<typeof parseFetchErrors> } | null;
    /** Máy có lịch Docker ghi sổ + nhận nút "Cập nhật ngay" không. */
    co_lich: boolean;
};

const isMissingTable = (e: unknown) => (e as { code?: string })?.code === "42P01";

async function tryOr<T>(run: () => Promise<T>, fallback: T): Promise<T> {
    try { return await run(); } catch (e) { if (isMissingTable(e)) return fallback; throw e; }
}

export async function getRefreshStatus(): Promise<RefreshStatus> {
    const [running, lastSync, lastOk, yc, bc, coLich] = await Promise.all([
        tryOr(() => query<JobRun>(
            `SELECT job, started_at, triggered_by FROM job_runs
             WHERE status = 'running' AND started_at > now() - interval '3 hours' ORDER BY started_at`), []),
        tryOr(() => query<{ finished_at: string; status: string; triggered_by: string | null; output_tail: string | null }>(
            `SELECT finished_at, status, triggered_by, output_tail FROM job_runs
             WHERE job = 'sync' AND status <> 'running' ORDER BY started_at DESC LIMIT 1`), []),
        tryOr(() => query<{ luc: string | null }>(
            `SELECT COALESCE(
                 (SELECT max(finished_at) FROM job_runs WHERE job = 'sync' AND status = 'ok'),
                 -- sync_time là chữ ISO giờ UTC ('2026-11-15T03:06:29.6') — ép kiểu rồi mới gắn múi giờ.
                 (SELECT max(sync_time)::timestamp AT TIME ZONE 'UTC' FROM sale_order)) AS luc`), []),
        tryOr(() => query<YeuCau>(
            `SELECT id, status, requested_by, requested_at, started_at, finished_at FROM refresh_requests
             WHERE requested_at > now() - interval '6 hours' ORDER BY id DESC LIMIT 1`), []),
        tryOr(() => query<{ ts: string; ok: boolean; detail: string | null }>(
            "SELECT ts, ok, detail FROM sync_health ORDER BY ts DESC LIMIT 1"), []),
        tryOr(() => query<{ co: boolean }>("SELECT EXISTS (SELECT 1 FROM job_runs) AS co"), []),
    ]);
    const c = lastSync[0];
    return {
        dang_chay: running,
        yeu_cau: yc[0] ?? null,
        lan_keo_cuoi: c ? {
            luc: c.finished_at, ok: c.status === "ok", ai: c.triggered_by,
            // Lượt hỏng: vài dòng log cuối để người xem biết vì sao (vd token Meta chết).
            loi: c.status === "ok" ? null : (c.output_tail || "").trim().split("\n").slice(-4).join("\n") || null,
        } : null,
        lan_keo_ok: lastOk[0]?.luc ?? null,
        bao_cao: bc[0] ? { luc: bc[0].ts, ok: !!bc[0].ok, loi: parseFetchErrors(bc[0].detail) } : null,
        co_lich: !!coLich[0]?.co,
    };
}
