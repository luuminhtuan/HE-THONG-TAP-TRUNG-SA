import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { getAccess, unauthorized } from "@/lib/talpha/access";
import { canMarket, seesAllMarkets } from "@/lib/talpha/access-rules";
import { requiredConfigPath } from "@/lib/talpha/config-path";
import { filterByMarket, type CompetitorResearchFile } from "@/lib/talpha/competitor-research";

export const dynamic = "force-dynamic";

// Tab Khách hàng → Soi đối thủ (15/11/2026): kết quả soi nhóm bán khác (bản đầu: Team 5 KIOT
// Taiwan) đọc từ config/competitor_research.json. Mỗi bản soi gắn một thị trường; người chỉ xem một
// phần nước thì chỉ thấy bản soi của nước mình, như mọi route gộp nhiều nước.
function readCompetitorResearch(): CompetitorResearchFile {
    const raw = JSON.parse(fs.readFileSync(requiredConfigPath("competitor_research.json"), "utf8"));
    return { snapshots: Array.isArray(raw.snapshots) ? raw.snapshots : [] };
}

export async function GET(req: NextRequest) {
    const a = await getAccess(req);
    if (!a) return unauthorized();
    try {
        const f = readCompetitorResearch();
        const seesAll = seesAllMarkets(a);
        const out = seesAll ? f : filterByMarket(f, (code) => canMarket(a, code));
        return NextResponse.json({ ...out, seen_all: seesAll });
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
}
