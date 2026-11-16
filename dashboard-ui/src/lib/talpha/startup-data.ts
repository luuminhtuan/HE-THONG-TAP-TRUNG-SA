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
    /** null = chưa ai nhập thị trường trên trang (hoặc kho lỗi — đã kêu ra log). */
    marketOverrides: MarketOverridesFile | null;
    /** null = không đọc được bảng khoá (thiếu chìa / kho lỗi) — credentials.ts tự thử lại nền. */
    credentials: StoredCredentialRow[] | null;
    loadedAt: number;
};

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

async function loadMarketOverrides(query: QueryFn): Promise<MarketOverridesFile | null> {
    try {
        const rows = await query<{ market_key: string; settings: Record<string, unknown> }>(
            "SELECT market_key, settings FROM market_overrides ORDER BY market_key");
        return rows.length ? { markets: Object.fromEntries(rows.map((r) => [r.market_key, r.settings])) } : null;
    } catch (e) {
        console.error("rules: KHÔNG đọc được market_overrides — chạy bằng luật gốc, bỏ qua thị trường nhập trên trang:", e);
        return null;
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

/** Nạp một lần lúc khởi động. Không có DATABASE_URL (máy chưa chuyển Postgres, phép thử) thì để trống. */
export async function primeStartupData(query: QueryFn): Promise<void> {
    if (!process.env.DATABASE_URL) {
        (globalThis as Holder)[SLOT] = { marketOverrides: null, credentials: null, loadedAt: Date.now() };
        return;
    }
    const [marketOverrides, credentials] = await Promise.all([loadMarketOverrides(query), loadCredentials(query)]);
    (globalThis as Holder)[SLOT] = { marketOverrides, credentials, loadedAt: Date.now() };
}
