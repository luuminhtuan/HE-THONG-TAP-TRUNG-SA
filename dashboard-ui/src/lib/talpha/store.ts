/**
 * KHO DỮ LIỆU DO NGƯỜI DÙNG NHẬP — sao kê 3PL, sổ theo dõi vận đơn, bảng gán sale.
 *
 * Một chỗ chứa duy nhất: file data/*.json (ngoài git). Nhanh, dễ soi.
 *
 * Bản trước còn chỗ chứa thứ hai là bảng BigQuery `talpha_store` (STORE_BACKEND=bigquery, dành
 * cho nền serverless có ổ đĩa chỉ đọc) — đã bỏ cùng BigQuery (04/11/2026). Dồn các kho này vào
 * Postgres là bước 4 của docs/POSTGRES.md; tới lúc đó chỉ cần đổi phần thân các hàm dưới.
 *
 * Mọi nơi khác trong hệ thống chỉ thấy đúng các hàm readStore / readStoreFresh / updateStore.
 */
import fs from "fs";
import path from "path";

export type StoreBackend = "file";

/** Giữ cho nơi gọi cũ: nay chỉ còn chỗ chứa file. */
export function storeBackend(): StoreBackend {
    return "file";
}

function assertName(name: string) {
    if (!/^[a-z0-9_-]+$/i.test(name)) throw new Error(`Tên kho không hợp lệ: ${name}`);
}

// ─────────────────────────────────────────────────────────────────────────
// Chỗ chứa: file trên đĩa
// ─────────────────────────────────────────────────────────────────────────
const DATA_DIR = path.join(process.cwd(), "..", "data");
const filePath = (name: string) => path.join(DATA_DIR, `${name}.json`);

function fileRead<T>(name: string, fallback: T): T {
    const p = filePath(name);
    if (!fs.existsSync(p)) return fallback;
    try {
        return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
    } catch (e) {
        console.error(`Kho ${name} hỏng định dạng, dùng giá trị mặc định:`, e);
        return fallback;
    }
}

function fileWrite(name: string, value: unknown) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(filePath(name), JSON.stringify(value, null, 2), "utf-8");
}

// ─────────────────────────────────────────────────────────────────────────
// Các hàm duy nhất phần còn lại của hệ thống nhìn thấy
// ─────────────────────────────────────────────────────────────────────────

/** Đọc kho. Chưa có thì trả giá trị mặc định, KHÔNG ném lỗi. */
export function readStore<T>(name: string, fallback: T): T {
    assertName(name);
    return fileRead(name, fallback);
}

/** Như readStore nhưng đọc thẳng từ nguồn — dùng khi cần chắc chắn số mới nhất. */
export async function readStoreFresh<T>(name: string, fallback: T): Promise<T> {
    assertName(name);
    return fileRead(name, fallback);
}

/**
 * Sửa kho: đọc — biến đổi — ghi lại, trong cùng một lượt, để hai request cùng
 * lúc không ghi đè nhau.
 */
export async function updateStore<T>(
    name: string,
    fallback: T,
    mutate: (current: T) => T,
): Promise<T> {
    assertName(name);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const lockfile = require("proper-lockfile");
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const p = filePath(name);
    if (!fs.existsSync(p)) fileWrite(name, fallback);
    const release = await lockfile.lock(p, { retries: { retries: 5, minTimeout: 60 } });
    try {
        const next = mutate(fileRead(name, fallback));
        fileWrite(name, next);
        return next;
    } finally {
        await release();
    }
}
