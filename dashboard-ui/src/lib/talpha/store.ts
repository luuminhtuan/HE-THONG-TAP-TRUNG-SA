/**
 * KHO DỮ LIỆU DO NGƯỜI DÙNG NHẬP — sao kê 3PL, việc đối soát COD, thanh toán quảng cáo, sổ theo dõi
 * vận đơn, chi phí vận hành.
 *
 * Một chỗ chứa duy nhất: bảng Postgres `app_documents` (15/11/2026, migration 0001), mỗi kho một
 * dòng, nội dung jsonb đúng như file data/<kho>.json trước đây (file cũ được chép vào ở bước
 * migrate — sync/core/file_import.py). Deploy code không còn đụng tới dữ liệu này: lần chép data/ từ
 * Mac đè máy chủ suýt mất một kỳ sao kê ngày 12/09/2026.
 *
 * Mọi nơi khác trong hệ thống chỉ thấy đúng các hàm readStoreFresh / updateStore.
 */
import { withTransaction, query } from "@/lib/db";

function assertName(name: string) {
    if (!/^[a-z0-9_-]+$/i.test(name)) throw new Error(`Tên kho không hợp lệ: ${name}`);
}

/** Đọc kho. Chưa có thì trả giá trị mặc định, KHÔNG ném lỗi vì thiếu. */
export async function readStoreFresh<T>(name: string, fallback: T): Promise<T> {
    assertName(name);
    const rows = await query<{ content: T }>("SELECT content FROM app_documents WHERE name = @name", { name });
    return rows.length ? rows[0].content : fallback;
}

/**
 * Sửa kho: đọc — biến đổi — ghi lại trong MỘT transaction, khoá đúng dòng của kho đó (FOR UPDATE)
 * để hai request cùng lúc không ghi đè nhau. `mutate` lỗi là không ghi gì.
 */
export async function updateStore<T>(
    name: string,
    fallback: T,
    mutate: (current: T) => T,
): Promise<T> {
    assertName(name);
    return withTransaction(async (q) => {
        // Kho chưa có thì tạo dòng mặc định trước, để có dòng mà khoá.
        await q("INSERT INTO app_documents (name, content) VALUES (@name, @content::jsonb) ON CONFLICT (name) DO NOTHING",
            { name, content: JSON.stringify(fallback) });
        const rows = await q("SELECT content FROM app_documents WHERE name = @name FOR UPDATE", { name });
        const next = mutate((rows[0]?.content ?? fallback) as T);
        await q("UPDATE app_documents SET content = @content::jsonb, updated_at = now() WHERE name = @name",
            { name, content: JSON.stringify(next) });
        return next;
    });
}
