import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { getAccess, unauthorized } from "@/lib/talpha/access";
import { canMarket, seesAllMarkets } from "@/lib/talpha/access-rules";
import { requiredConfigPath } from "@/lib/talpha/config-path";
import { filterByMarket, type CustomerSegmentsFile } from "@/lib/talpha/customer-segments";

export const dynamic = "force-dynamic";

// Tab Khách hàng → Tệp khách (14/11/2026): số tham chiếu về người Việt / Phi / Indo ở từng
// thị trường, đọc từ config/customer_segments.json. Không phải số bán hàng, nhưng vẫn cắt theo team
// như mọi route gộp nhiều nước: người chỉ xem một phần nước thì chỉ thấy thị trường của mình.
// `seen_all` = false báo giao diện biết bảng đang thiếu nước (câu tóm tắt 9 tệp không còn đúng).
function readCustomerSegments(): CustomerSegmentsFile {
    const raw = JSON.parse(fs.readFileSync(requiredConfigPath("customer_segments.json"), "utf8"));
    return { groups: raw.groups, snapshots: Array.isArray(raw.snapshots) ? raw.snapshots : [] };
}

export async function GET(req: NextRequest) {
    const a = await getAccess(req);
    if (!a) return unauthorized();
    try {
        const f = readCustomerSegments();
        const seesAll = seesAllMarkets(a);
        const out = seesAll ? f : filterByMarket(f, (code) => canMarket(a, code));
        return NextResponse.json({ ...out, seen_all: seesAll });
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
}
