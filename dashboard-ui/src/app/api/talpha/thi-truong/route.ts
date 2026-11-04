import { NextRequest, NextResponse } from "next/server";
import { getAccess } from "@/lib/talpha/access";
import { docKhoa, kiemKhoa } from "@/lib/talpha/khoa";
import { POS_API_URL } from "@/lib/talpha/rules";
import { khoiPhuTuNhap, loiThiTruong, nhapTuLuat, type ThiTruongNhap } from "@/lib/talpha/thi-truong";
import { choKhoiDongLai, docFilePhu, docGoc, khoiDongLai, luatMoiNhat, luuKhoiPhu } from "@/lib/talpha/thi-truong-luu";

export const dynamic = "force-dynamic";

// Thị trường (04/11/2026) — trang /admin → Thị trường. Chỉ giám đốc (API_RULES: full).
//
//   GET                       → mọi nước (đã phủ), lấy từ đâu, có key POS chưa, danh sách team
//   POST {nuoc, la_moi}       → thêm / sửa / bật / tắt một nước; bật bán thì gọi thử shop POS trước
//   DELETE ?key=              → bỏ phần sửa trên trang của nước có trong config (quay về config)
//
// Lưu vào data/thi_truong.json (lib/talpha/thi-truong-luu.ts) rồi dashboard tự khởi động lại.
// Nước thêm trên trang KHÔNG xoá được, chỉ tắt: xoá là đơn cũ của nó mất tỷ giá.

type Luat = { markets?: Record<string, unknown>; access?: { teams?: Record<string, { name?: string } | unknown> } };
const laKhoi = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const bienKey = (label: string) => `TALPHA_POSCAKE_${label}_KEY`;

function danhSach() {
    const luat = luatMoiNhat() as Luat;
    const goc = docGoc() as Luat;
    const phu = docFilePhu();
    const markets = Object.entries(luat.markets || {})
        .filter(([k, v]) => !k.startsWith("_") && laKhoi(v))
        .map(([key]) => {
            const n = nhapTuLuat(key, luat);
            const coGoc = laKhoi(goc.markets?.[key]);
            const coPhu = laKhoi(phu.markets?.[key]);
            return {
                ...n,
                nguon: coGoc ? (coPhu ? "sua_tren_trang" : "config") : "them_tren_trang",
                bien_key: n.shop_label ? bienKey(n.shop_label) : null,
                co_key: !!n.shop_label && !!docKhoa(bienKey(n.shop_label)),
            };
        });
    const teams = Object.entries(luat.access?.teams || {})
        .filter(([k, t]) => !k.startsWith("_") && laKhoi(t))
        .map(([key, t]) => ({ key, name: String((t as { name?: string }).name || key) }));
    return { markets, teams, cho_khoi_dong_lai: choKhoiDongLai(), updated_at: phu.updated_at || null, updated_by: phu.updated_by || null };
}

const chuoi = (v: unknown) => String(v ?? "").trim();
const soHoacNull = (v: unknown) => (v === "" || v === null || v === undefined ? null : Number(v));

/** Ô form → ThiTruongNhap. Kiểu sai (chữ ở ô số…) để lại cho loiThiTruong báo, không đoán. */
function docNhap(b: Record<string, unknown>): ThiTruongNhap {
    const tokens = Array.isArray(b.tokens) ? b.tokens : chuoi(b.tokens).split(/[,\s]+/);
    return {
        key: chuoi(b.key),
        display: chuoi(b.display),
        shop_label: chuoi(b.shop_label).toUpperCase(),
        currency: chuoi(b.currency).toUpperCase(),
        currency_symbol: chuoi(b.currency_symbol),
        rate_vnd: soHoacNull(b.rate_vnd),
        pos_money_divisor: soHoacNull(b.pos_money_divisor),
        shop_id: chuoi(b.shop_id),
        status: chuoi(b.status) as ThiTruongNhap["status"],
        orders_from: chuoi(b.orders_from) || null,
        flag: chuoi(b.flag),
        tokens: tokens.map(chuoi).filter(Boolean),
        team: chuoi(b.team) || null,
    };
}

export async function GET() {
    try {
        return NextResponse.json(danhSach());
    } catch (e) {
        return NextResponse.json({ error: `Không đọc được thị trường: ${e instanceof Error ? e.message : e}` }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    // Chỉ nhận JSON: trang lạ không gửi được JSON kèm cookie đăng nhập mà không qua bước hỏi trước.
    if (!(req.headers.get("content-type") || "").includes("application/json")) {
        return NextResponse.json({ error: "Chỉ nhận JSON" }, { status: 415 });
    }
    const body = await req.json().catch(() => null);
    if (!laKhoi(body?.nuoc)) return NextResponse.json({ error: "Thiếu thông tin nước" }, { status: 400 });
    const n = docNhap(body.nuoc);
    const laMoi = body.la_moi === true;

    const luat = luatMoiNhat();
    const loi = loiThiTruong(n, luat, laMoi);
    if (loi.length) return NextResponse.json({ error: loi.join(" · "), loi }, { status: 400 });

    // Bật bán, hoặc đổi shop khi đang bán → gọi thử shop POS bằng key ở Khoá kết nối trước khi lưu.
    // Lưu nước "đang bán" mà shop sai / chưa có key là sync kéo 0 đơn mỗi giờ mà không ai biết.
    const cu = laMoi ? null : nhapTuLuat(n.key, luat);
    if (n.status === "dang_ban" && (!cu || cu.status !== "dang_ban" || cu.shop_id !== n.shop_id)) {
        const bien = bienKey(n.shop_label);
        const key = docKhoa(bien);
        if (!key) {
            return NextResponse.json({
                error: `Chưa có key POS của ${n.display} — nhập ở Quản trị → Khoá kết nối (ô "Key POS ${n.display}") trước, hoặc lưu ở trạng thái Sắp chạy.`,
            }, { status: 422 });
        }
        const kq = await kiemKhoa({ ten: bien, nhan: "", dung_cho: "", loai: "pos", shop: { name: n.key, shop_id: n.shop_id, api_url: POS_API_URL } }, key);
        if (!kq.ok) return NextResponse.json({ error: `Chưa lưu — shop POS ${n.shop_id}: ${kq.chi_tiet}` }, { status: 422 });
    }

    const a = await getAccess(req);
    await luuKhoiPhu(n.key, khoiPhuTuNhap(n, docGoc()), a?.email || a?.name || "?");
    return NextResponse.json({ ok: true, khoi_dong_lai: khoiDongLai(), ...danhSach() });
}

export async function DELETE(req: NextRequest) {
    const key = req.nextUrl.searchParams.get("key") || "";
    if (!laKhoi((docGoc() as Luat).markets?.[key])) {
        return NextResponse.json({
            error: `${key} được thêm trên trang nên không bỏ được — chỉ tắt được (bỏ đi là đơn cũ của nước đó mất tỷ giá).`,
        }, { status: 400 });
    }
    const a = await getAccess(req);
    await luuKhoiPhu(key, null, a?.email || a?.name || "?");
    return NextResponse.json({ ok: true, khoi_dong_lai: khoiDongLai(), ...danhSach() });
}
