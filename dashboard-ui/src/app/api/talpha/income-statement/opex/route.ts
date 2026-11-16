import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { MARKETS_PUBLIC } from "@/lib/talpha/rules";
import { getAccess } from "@/lib/talpha/access";
import { updateStore } from "@/lib/talpha/store";
import { opexItemError, type OpexItem } from "@/lib/talpha/income-statement";

export const dynamic = "force-dynamic";

// Chi phí vận hành (lương, mặt bằng, phần mềm…) của tab Lãi lỗ — kho data/operating_expenses.json.
// CHỈ người xem hết (giám đốc) ghi được: lương từng người là số riêng của công ty. Cửa proxy.ts
// đã cho mọi người có tab "income-statement" gọi tới đây (luật /api/talpha/income-statement phủ cả nhánh con),
// nên route tự chặn ghi.
type OpexStore = { items: OpexItem[] };
const OPEX_STORE = "operating_expenses";

async function requireDirector(req: NextRequest) {
    const a = await getAccess(req);
    if (!a) return { a: null, res: NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 }) };
    if (!a.full) return { a, res: NextResponse.json({ error: "Chỉ giám đốc ghi được chi phí vận hành" }, { status: 403 }) };
    return { a, res: null };
}

/** Thêm mới (không có id) hoặc sửa (có id) một khoản. */
export async function POST(req: NextRequest) {
    const { a, res } = await requireDirector(req);
    if (res) return res;
    let body: Partial<OpexItem>;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Dữ liệu gửi lên không đọc được" }, { status: 400 }); }
    const k: Partial<OpexItem> = {
        id: body.id ? String(body.id) : undefined,
        nhom: String(body.nhom || "").trim(),
        ten: String(body.ten || "").trim().slice(0, 120),
        so_tien_thang_vnd: Math.round(Number(body.so_tien_thang_vnd) || 0),
        tu_thang: String(body.tu_thang || ""),
        den_thang: body.den_thang ? String(body.den_thang) : null,
        thuoc: String(body.thuoc || "CHUNG").toUpperCase(),
        ghi_chu: String(body.ghi_chu || "").trim().slice(0, 300),
    };
    const validationError = opexItemError(k, MARKETS_PUBLIC.markets.map((m) => m.code));
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

    let notFound = false;
    const store = await updateStore<OpexStore>(OPEX_STORE, { items: [] }, (cur) => {
        const items = [...(cur.items || [])];
        const item: OpexItem = { ...(k as OpexItem), id: k.id || randomUUID(), sua_luc: new Date().toISOString(), sua_boi: a!.name };
        const i = k.id ? items.findIndex((x) => x.id === k.id) : -1;
        if (k.id && i < 0) { notFound = true; return cur; }
        if (i >= 0) items[i] = item; else items.push(item);
        return { ...cur, items };
    });
    if (notFound) return NextResponse.json({ error: "Không thấy khoản cần sửa — có thể đã bị xoá" }, { status: 404 });
    return NextResponse.json({ ok: true, items: store.items });
}

export async function DELETE(req: NextRequest) {
    const { res } = await requireDirector(req);
    if (res) return res;
    const id = req.nextUrl.searchParams.get("id") || "";
    if (!id) return NextResponse.json({ error: "Thiếu id" }, { status: 400 });
    const store = await updateStore<OpexStore>(OPEX_STORE, { items: [] }, (cur) => ({ ...cur, items: (cur.items || []).filter((x) => x.id !== id) }));
    return NextResponse.json({ ok: true, items: store.items });
}
