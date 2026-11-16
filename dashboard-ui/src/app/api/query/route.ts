import { NextResponse } from "next/server";
import { query, queryReadOnly } from "@/lib/db";
import { getAccess } from "@/lib/talpha/access";
import { scopeQuery, seesAllMarkets } from "@/lib/talpha/access-rules";

// Force dynamic rendering to prevent caching issues
export const dynamic = "force-dynamic";

// Tên mọi bảng / view trong database — câu của người xem một phần nước không được nhắc tới cái nào
// ngoài 5 bảng lọc được (scopeQuery). Hỏi Postgres 10 phút một lần.
let tableCache: { at: number; ds: string[] } | null = null;
async function listTables(): Promise<string[]> {
    if (tableCache && Date.now() - tableCache.at < 600_000) return tableCache.ds;
    const rows = await query<{ ten: string }>(
        "SELECT c.relname AS ten FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
        "WHERE n.nspname = current_schema() AND c.relkind IN ('r', 'v', 'm', 'p', 'f')");
    tableCache = { at: Date.now(), ds: rows.map((r) => r.ten) };
    return tableCache.ds;
}

// ═══ SECURITY: API Key Authentication ═══
const API_KEY = process.env.DASHBOARD_API_KEY || "";

// ═══ SECURITY: SQL Whitelist ═══
// Only allow SELECT and WITH (for CTEs) queries — block all DDL/DML. Lớp chặn thật nằm ở database:
// câu chạy bằng vai chỉ đọc trong transaction READ ONLY (lib/db.ts → queryChiDoc).
const BLOCKED_KEYWORDS = [
    "INSERT", "UPDATE", "DELETE", "DROP", "CREATE", "ALTER",
    "TRUNCATE", "MERGE", "GRANT", "REVOKE", "EXEC", "EXECUTE",
    "CALL", "BEGIN", "COMMIT", "ROLLBACK",
];

function isQuerySafe(query: string): { safe: boolean; reason?: string } {
    const trimmed = query.trim().toUpperCase();

    // Must start with SELECT or WITH (CTEs)
    if (!trimmed.startsWith("SELECT") && !trimmed.startsWith("WITH")) {
        return { safe: false, reason: "Only SELECT queries are allowed" };
    }

    // Block multiple statements (semicolons)
    if (query.includes(";")) {
        return { safe: false, reason: "Multiple statements not allowed" };
    }

    // Block dangerous keywords anywhere in the query
    for (const keyword of BLOCKED_KEYWORDS) {
        // Use word boundary check to avoid false positives
        // e.g. "SELECTED" should not trigger "SELECT" check on blocked list
        const regex = new RegExp(`\\b${keyword}\\b`, "i");
        if (regex.test(query)) {
            return { safe: false, reason: `Blocked keyword: ${keyword}` };
        }
    }

    return { safe: true };
}

export async function POST(request: Request) {
    try {
        // ═══ AUTH CHECK ═══
        // If API_KEY is configured, require it. If not set, allow all (dev mode).
        if (API_KEY) {
            const providedKey =
                request.headers.get("x-api-key") ||
                request.headers.get("authorization")?.replace("Bearer ", "");

            if (providedKey !== API_KEY) {
                return NextResponse.json(
                    { error: "Unauthorized — invalid or missing API key" },
                    { status: 401 }
                );
            }
        }

        const { query: sqlText, params } = await request.json();

        if (!sqlText) {
            return NextResponse.json({ error: "Query is required" }, { status: 400 });
        }

        // ═══ SQL SAFETY CHECK ═══
        const safety = isQuerySafe(sqlText);
        if (!safety.safe) {
            console.warn(`🔒 Blocked unsafe query: ${safety.reason} — "${sqlText.substring(0, 100)}..."`);
            return NextResponse.json(
                { error: `Query blocked: ${safety.reason}` },
                { status: 403 }
            );
        }

        // ═══ PHÂN QUYỀN THEO TEAM (05/10/2026) ═══
        // Câu SQL dựng ở trình duyệt. Người chỉ xem một phần nước: mỗi bảng bị thay bằng
        // câu con đã lọc theo nước của họ (lib/talpha/access-rules.ts → scopeQuery), và câu chạy
        // bằng vai talpha_readonly_market — database chỉ cho vai này đọc đúng các bảng lọc được.
        const a = await getAccess(request);
        if (!a) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
        let sql: string = sqlText;
        const seesAll = seesAllMarkets(a);
        if (!seesAll) {
            const scoped = scopeQuery(sqlText, a, await listTables());
            if (!scoped.ok) {
                console.warn(`🔒 query bị chặn (${a.email || a.name}): ${scoped.error}`);
                return NextResponse.json({ error: scoped.error }, { status: 403 });
            }
            sql = scoped.sql;
        }

        const rows = await queryReadOnly(sql, seesAll ? "talpha_readonly" : "talpha_readonly_market", params || undefined);
        return NextResponse.json({ data: rows });
    } catch (error: any) {
        console.error("API Error:", error);
        return NextResponse.json(
            { error: error.message || "Internal Server Error" },
            { status: 500 }
        );
    }
}
