/**
 * Kho số Postgres (04/11/2026 — thay lib/bigquery.ts). Chuỗi kết nối ở DATABASE_URL: docker compose
 * đặt sẵn; chạy `npm run dev` ngoài Docker thì trỏ vào cổng compose mở ra máy (127.0.0.1:5433).
 * Bảng khai bằng migration ở db/migrations/, view ở db/views/ — xem docs/POSTGRES.md.
 *
 * Tham số đặt tên `@ten` như câu SQL cũ: query("… WHERE d >= @from", { from }) — tự đổi sang $1.
 * Mảng dùng `= ANY(@ds)` (không phải IN UNNEST).
 */
import { Pool, types } from "pg";

// Số trả về là SỐ như BigQuery trả. Mặc định node-pg trả CHUỖI cho bigint (COUNT, SUM số nguyên)
// và numeric (SUM bigint, ROUND numeric) — cộng hai cột là thành nối chuỗi "1" + "2" = "12".
types.setTypeParser(20, (v) => Number(v));       // int8
types.setTypeParser(1700, (v) => Number(v));     // numeric
// Ngày giữ nguyên chuỗi 'YYYY-MM-DD' — đổi sang Date là lệch ngày theo múi giờ máy chạy.
types.setTypeParser(1082, (v) => v);             // date
types.setTypeParser(1184, (v) => new Date(v).toISOString());   // timestamptz → ISO (UTC)
// timestamp KHÔNG múi giờ (vd safe_ts(inserted_at), giờ UTC của POS) giữ nguyên chuỗi — đổi sang Date
// là node hiểu theo múi giờ MÁY CHẠY, lệch đúng độ chênh múi giờ.
types.setTypeParser(1114, (v) => v.replace(" ", "T"));          // timestamp

let pool: Pool | null = null;

function getPool(): Pool {
    if (pool) return pool;
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("chưa đặt DATABASE_URL — xem docs/POSTGRES.md");
    // TimeZone UTC: CURRENT_DATE trong câu SQL là ngày UTC như BigQuery; ngày giờ VN tính bằng
    // AT TIME ZONE 'Asia/Ho_Chi_Minh' ở chỗ cần.
    pool = new Pool({ connectionString: url, max: 10, options: "-c TimeZone=UTC" });
    pool.on("error", (e) => console.error("Postgres pool:", e.message));
    return pool;
}

/** `@ten` → `$n` (bỏ qua chữ @ nằm trong chuỗi '…'). Trả câu mới + mảng giá trị theo thứ tự. */
export function bindNamedParams(sql: string, params?: Record<string, unknown>): { text: string; values: unknown[] } {
    if (!params) return { text: sql, values: [] };
    const values: unknown[] = [];
    const paramIndex = new Map<string, number>();
    let out = "";
    let inString = false;
    for (let i = 0; i < sql.length; i++) {
        const c = sql[i];
        if (!inString && c === "-" && sql[i + 1] === "-") {      // chú thích -- … hết dòng
            const newlineAt = sql.indexOf("\n", i);
            const commentEnd = newlineAt < 0 ? sql.length : newlineAt;
            out += sql.slice(i, commentEnd);
            i = commentEnd - 1;
            continue;
        }
        if (c === "'") inString = !inString;
        if (!inString && c === "@" && /[A-Za-z_]/.test(sql[i + 1] || "")) {
            let j = i + 1;
            while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j])) j++;
            const paramName = sql.slice(i + 1, j);
            if (!(paramName in params)) throw new Error(`thiếu tham số @${paramName}`);
            if (!paramIndex.has(paramName)) {
                values.push(params[paramName]);
                paramIndex.set(paramName, values.length);
            }
            out += `$${paramIndex.get(paramName)}`;
            i = j - 1;
            continue;
        }
        out += c;
    }
    return { text: out, values };
}

/** Chạy một câu SELECT / ghi, trả mảng dòng. */
export async function query<T = any>(sql: string, params?: Record<string, unknown>): Promise<T[]> {
    const { text, values } = bindNamedParams(sql, params);
    try {
        const r = await getPool().query(text, values);
        return r.rows as T[];
    } catch (e: any) {
        console.error("Postgres:", e?.message || e, "\nSQL:", text.slice(0, 400));
        throw e;
    }
}

// ─── Câu SQL dựng ở trình duyệt (/api/query) ───────────────────────────────────────────
// Đăng nhập bằng vai CHỈ ĐỌC riêng (migration 0001), KHÔNG dùng tài khoản chủ rồi SET ROLE: phiên
// của tài khoản quản trị thì câu SQL tự đổi vai ngược lại được bằng set_config('role', …).
export type ReadOnlyRole = "talpha_readonly" | "talpha_readonly_market";
const readOnlyPools = new Map<ReadOnlyRole, Pool>();

function getReadOnlyPool(role: ReadOnlyRole): Pool {
    const p = readOnlyPools.get(role);
    if (p) return p;
    // TALPHA_DOC_PASSWORD: tên cũ (trước 16/11/2026) — vẫn nhận để .env cũ không gãy.
    const mk = process.env.TALPHA_READONLY_PASSWORD || process.env.TALPHA_DOC_PASSWORD;
    const baseUrl = process.env.DATABASE_URL;
    if (!mk || !baseUrl) throw new Error("chưa cấu hình vai chỉ đọc (TALPHA_READONLY_PASSWORD) — xem docs/POSTGRES.md");
    const u = new URL(baseUrl);
    u.username = role;
    u.password = mk;
    const newPool = new Pool({ connectionString: u.toString(), max: 5, options: "-c TimeZone=UTC" });
    newPool.on("error", (e) => console.error(`Postgres ${role}:`, e.message));
    readOnlyPools.set(role, newPool);
    return newPool;
}

/** Một câu SELECT bằng vai chỉ đọc, trong transaction READ ONLY, tối đa 30 giây. */
export async function queryReadOnly<T = any>(sql: string, role: ReadOnlyRole, params?: Record<string, unknown>): Promise<T[]> {
    const { text, values } = bindNamedParams(sql, params);
    const client = await getReadOnlyPool(role).connect();
    try {
        await client.query("BEGIN READ ONLY");
        await client.query("SET LOCAL statement_timeout = 30000");
        const r = await client.query(text, values);
        await client.query("COMMIT");
        return r.rows as T[];
    } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
    } finally {
        client.release();
    }
}

/** Nhiều câu ghi trong MỘT transaction — lỗi giữa chừng là quay về như cũ. */
export async function withTransaction<T>(work: (q: typeof query) => Promise<T>): Promise<T> {
    const client = await getPool().connect();
    try {
        await client.query("BEGIN");
        const q = async (sql: string, params?: Record<string, unknown>) => {
            const { text, values } = bindNamedParams(sql, params);
            return (await client.query(text, values)).rows;
        };
        const kq = await work(q as typeof query);
        await client.query("COMMIT");
        return kq;
    } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
    } finally {
        client.release();
    }
}
