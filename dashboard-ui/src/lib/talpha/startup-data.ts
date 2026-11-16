// ═══════════════════════════════════════════════════════════════════
// Số trong kho cần có NGAY lúc nạp code — nạp BẤT ĐỒNG BỘ một lần khi server khởi động (16/11/2026).
//
//   • rules.ts: RULES (luật gốc + thị trường nhập trên trang, bảng market_overrides) là hằng số mà hàng
//     chục hằng số khác sinh ra từ nó, tính một lần khi module được nạp;
//   • credentials.ts: getCredential() được gọi đồng bộ ở khắp nơi — cần sẵn bảng api_credentials.
//
// Trước đây hai chỗ đó gọi execFileSync(node scripts/sync-query.cjs) — chặn cả event loop 100–300 ms ở
// lượt nạp đầu. Nay instrumentation.ts → register() gọi primeStartupData() (Next chờ register() xong rồi
// mới nhận request — route nào cũng nạp rules.ts SAU đó), kết quả giữ ở globalThis cho mọi lần nạp lại
// module (dev hot-reload) dùng chung.
//
// File này KHÔNG được import rules.ts / credentials.ts: import là RULES bị tính trước khi kho kịp nạp.
// ═══════════════════════════════════════════════════════════════════
// Hàm truy vấn do instrumentation.ts truyền vào (query của lib/db.ts) — file này KHÔNG import db: rules.ts import
// file này, import db là module đọc luật kéo theo driver Postgres và bản dựng phép thử (tsc, không alias @/) gãy.
export type QueryFn = <T>(sql: string, params?: Record<string, unknown>) => Promise<T[]>;

export type MarketOverridesFile = { markets: Record<string, Record<string, unknown>> };
export type StoredCredentialRow = {
    name: string; value: string; note: string | null; updated_at: string; updated_by: string | null;
};

type StartupData = {
    /** null = chưa ai nhập thị trường trên trang, HOẶC đọc lỗi (xem marketOverridesFailed). */
    marketOverrides: MarketOverridesFile | null;
    /** true = kho lỗi / quá hạn lúc khởi động → đang chạy bằng luật gốc; startup-recovery.ts thử lại nền. */
    marketOverridesFailed: boolean;
    /** null = không đọc được bảng khoá (thiếu chìa / kho lỗi) — credentials.ts tự thử lại nền. Bản rõ của
     *  khoá: credentials.ts nhận MỘT lần (takeStartupCredentials) rồi xoá khỏi đây. */
    credentials: StoredCredentialRow[] | null;
    loadedAt: number;
};

/** Hạn chờ kho lúc khởi động. Next chờ register() xong mới nhận request — kho treo (nhận kết nối mà không trả
 *  lời) thì không có hạn là dashboard đứng ở "Starting…" mãi (16/11/2026). */
const PRIME_TIMEOUT_MS = 15_000;

const SLOT = Symbol.for("talpha.startupData");
type Holder = { [SLOT]?: StartupData };

export const ENCRYPTION_KEY_VAR = "TALPHA_ENCRYPTION_KEY";
export const getEncryptionKey = () => (process.env[ENCRYPTION_KEY_VAR] || "").trim();
export const CREDENTIALS_SQL = `SELECT name, public.pgp_sym_decrypt(encrypted_value, @encryptionKey) AS value, note, updated_at, updated_by
                 FROM api_credentials`;

/** Đã nạp chưa — undefined nghĩa là module đọc luật bị nạp TRƯỚC register() (không được xảy ra). */
export function getStartupData(): StartupData | undefined {
    return (globalThis as Holder)[SLOT];
}

/** Đọc lỗi lúc khởi động — instrumentation.ts bật startup-recovery.ts để thử lại và tự khởi động lại. */
export function startupMarketOverridesFailed(): boolean {
    return getStartupData()?.marketOverridesFailed === true;
}

/** Bảng khoá đọc lúc khởi động — trả MỘT lần rồi xoá khỏi globalThis để bản rõ không nằm đó suốt đời tiến trình. */
export function takeStartupCredentials(): { rows: StoredCredentialRow[]; loadedAt: number } | null {
    const startup = getStartupData();
    if (!startup?.credentials) return null;
    const taken = { rows: startup.credentials, loadedAt: startup.loadedAt };
    startup.credentials = null;
    return taken;
}

async function loadMarketOverrides(query: QueryFn): Promise<{ overrides: MarketOverridesFile | null; failed: boolean }> {
    try {
        const rows = await query<{ market_key: string; settings: Record<string, unknown> }>(
            "SELECT market_key, settings FROM market_overrides ORDER BY market_key");
        const overrides = rows.length ? { markets: Object.fromEntries(rows.map((r) => [r.market_key, r.settings])) } : null;
        return { overrides, failed: false };
    } catch (e) {
        console.error("rules: KHÔNG đọc được market_overrides — tạm chạy bằng luật gốc, thử lại nền:", e);
        return { overrides: null, failed: true };
    }
}

async function loadCredentials(query: QueryFn): Promise<StoredCredentialRow[] | null> {
    const encryptionKey = getEncryptionKey();
    if (!encryptionKey) {
        console.error(`credentials: chưa đặt ${ENCRYPTION_KEY_VAR} — không giải mã được khoá trong kho, dùng khoá trong .env.local`);
        return null;
    }
    try {
        return await query<StoredCredentialRow>(CREDENTIALS_SQL, { encryptionKey });
    } catch (e) {
        console.error("credentials: KHÔNG đọc được bảng api_credentials — dùng khoá trong .env.local:", e);
        return null;
    }
}

/** Nạp một lần lúc khởi động, tối đa timeoutMs. Không có DATABASE_URL (máy chưa chuyển Postgres, phép thử) thì
 *  để trống. Quá hạn = coi như đọc lỗi: luật gốc + khoá .env.local, thử lại nền. */
export async function primeStartupData(query: QueryFn, timeoutMs: number = PRIME_TIMEOUT_MS): Promise<void> {
    if (!process.env.DATABASE_URL) {
        (globalThis as Holder)[SLOT] = { marketOverrides: null, marketOverridesFailed: false, credentials: null, loadedAt: Date.now() };
        return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
    const loaded = await Promise.race([Promise.all([loadMarketOverrides(query), loadCredentials(query)]), timedOut]);
    clearTimeout(timer);
    if (!loaded) {
        console.error(`startup: kho không trả lời sau ${timeoutMs / 1000} giây — tạm chạy bằng luật gốc + khoá .env.local, thử lại nền`);
        (globalThis as Holder)[SLOT] = { marketOverrides: null, marketOverridesFailed: true, credentials: null, loadedAt: Date.now() };
        return;
    }
    const [markets, credentials] = loaded;
    (globalThis as Holder)[SLOT] = {
        marketOverrides: markets.overrides, marketOverridesFailed: markets.failed, credentials, loadedAt: Date.now(),
    };
}
