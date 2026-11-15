import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAccess } from "@/lib/talpha/access";
import { docKhoa, kiemKhoa, luuKhoa } from "@/lib/talpha/khoa";
import { cheKhoa, loiGiaTri } from "@/lib/talpha/khoa-file";
import { POS_API_URL } from "@/lib/talpha/rules";
import { khoiPhuTuNhap, loiThiTruong, nhapTuLuat, nuocCuaCamp, phuLuat, type ThiTruongNhap } from "@/lib/talpha/thi-truong";
import { choKhoiDongLai, docFilePhu, docGoc, khoiDongLai, luatMoiNhat, luuKhoiPhu, vanTayPhu } from "@/lib/talpha/thi-truong-luu";

export const dynamic = "force-dynamic";

// Thị trường (04/11/2026) — trang /admin → Thị trường. Chỉ giám đốc (API_RULES: full).
//
//   GET                       → mọi nước (đã phủ), lấy từ đâu, có key POS chưa, danh sách team
//   GET ?phu=1                → chỉ phần phủ + dấu vân tay — cho bot Zalo (chìa nội bộ) nạp luật
//   POST {nuoc, la_moi, key_pos?} → thêm / sửa / bật / tắt một nước; có key_pos (15/11/2026) thì gọi thử
//                             shop bằng key đó rồi lưu luôn key (bảng api_credentials, mã hoá) — khỏi
//                             sang Khoá kết nối; bật bán thì gọi thử shop POS trước
//   DELETE ?key=              → nước có trong config: bỏ phần sửa trên trang (quay về config);
//                               nước thêm trên trang: XOÁ HẲN (cả key POS) — chỉ khi chưa có đơn,
//                               chưa có chi tiêu (15/11/2026, vd nước tạo nhầm)
//
// Lưu vào bảng market_overrides (lib/talpha/thi-truong-luu.ts) rồi dashboard tự khởi động lại.
// Nước thêm trên trang đã có đơn / chi tiêu thì KHÔNG xoá được, chỉ tắt: xoá là đơn cũ mất tỷ giá,
// chi tiêu của camp mang mã nước đó nhảy về nước mặc định (Đài).

type Luat = {
    markets?: Record<string, unknown>; access?: { teams?: Record<string, { name?: string } | unknown> };
    market_aliases?: Record<string, string>; camp_market_tokens?: string[];
};
const laKhoi = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const bienKey = (label: string) => `TALPHA_POSCAKE_${label}_KEY`;

async function danhSach() {
    const phu = await docFilePhu();
    const luat = phuLuat(docGoc(), phu) as Luat;
    const goc = docGoc() as Luat;
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
                che_key: n.shop_label ? cheKhoa(docKhoa(bienKey(n.shop_label))) : "",
            };
        });
    const teams = Object.entries(luat.access?.teams || {})
        .filter(([k, t]) => !k.startsWith("_") && laKhoi(t))
        .map(([key, t]) => ({ key, name: String((t as { name?: string }).name || key) }));
    return { markets, teams, cho_khoi_dong_lai: await choKhoiDongLai(), updated_at: phu.updated_at || null, updated_by: phu.updated_by || null };
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

export async function GET(req: NextRequest) {
    try {
        if (req.nextUrl.searchParams.get("phu") === "1") {
            const phu = await docFilePhu();
            return NextResponse.json({ phu, van_tay: vanTayPhu(phu) });
        }
        return NextResponse.json(await danhSach());
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

    const luat = await luatMoiNhat();
    const loi = loiThiTruong(n, luat, laMoi);
    // Key POS dán ngay trong form (để trống = giữ key đang có). Soát trước khi gọi shop.
    const keyDan = chuoi(body.key_pos);
    if (keyDan) {
        const loiKey = loiGiaTri(keyDan);
        if (loiKey) loi.push(`Key POS: ${loiKey}`);
        if (!n.shop_id) loi.push("Có key POS thì phải có mã shop POS để máy gọi thử");
    }
    if (loi.length) return NextResponse.json({ error: loi.join(" · "), loi }, { status: 400 });

    // Có key mới, bật bán, hoặc đổi shop khi đang bán → gọi thử shop POS trước khi lưu. Lưu nước
    // "đang bán" mà shop sai / chưa có key là sync kéo 0 đơn mỗi giờ mà không ai biết.
    const bien = bienKey(n.shop_label);
    // Ô key mang lại đúng key đang dùng (vừa xem bằng con mắt) = không đổi key: khỏi gọi thử, khỏi ghi.
    const keyPos = keyDan && keyDan !== docKhoa(bien) ? keyDan : "";
    const cu = laMoi ? null : nhapTuLuat(n.key, luat);
    if (keyPos || (n.status === "dang_ban" && (!cu || cu.status !== "dang_ban" || cu.shop_id !== n.shop_id))) {
        const key = keyPos || docKhoa(bien);
        if (!key) {
            return NextResponse.json({
                error: `Chưa có key POS của ${n.display} — dán vào ô "Key POS" của form, hoặc lưu ở trạng thái Sắp chạy.`,
            }, { status: 422 });
        }
        const kq = await kiemKhoa({ ten: bien, nhan: "", dung_cho: "", loai: "pos", shop: { name: n.key, shop_id: n.shop_id, api_url: POS_API_URL } }, key);
        if (!kq.ok) {
            const ai = keyPos ? "Key POS vừa dán không gọi được shop" : `Shop POS ${n.shop_id}`;
            return NextResponse.json({ error: `Chưa lưu — ${ai}: ${kq.chi_tiet}` }, { status: 422 });
        }
    }

    const a = await getAccess(req);
    const ai = a?.email || a?.name || "?";
    // Key trước, nước sau: lưu key hỏng (vd thiếu chìa mã hoá) thì chưa ghi gì cả.
    if (keyPos) {
        const luc = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" });
        try {
            await luuKhoa(bien, keyPos, `${ai} lưu lúc ${luc} (Thị trường)`, ai);
        } catch (e) {
            return NextResponse.json({ error: `Chưa lưu — ${e instanceof Error ? e.message : e}` }, { status: 500 });
        }
    }
    const truoc = vanTayPhu(await docFilePhu());
    await luuKhoiPhu(n.key, khoiPhuTuNhap(n, docGoc()), ai);
    // Chỉ đổi key (thông tin nước y nguyên) → khỏi khởi động lại: docKhoa đã nạp lại key mới.
    const doi = vanTayPhu(await docFilePhu()) !== truoc;
    return NextResponse.json({ ok: true, luu_key: !!keyPos, khoi_dong_lai: doi ? khoiDongLai() : "khong_can", ...(await danhSach()) });
}

/** Số đã gắn với một nước: đơn trong kho (theo mã shop) + chi tiêu Meta (mọi TKQC) của camp mang mã
 *  nước đó — gán camp bằng nuocCuaCamp trên luật MỚI NHẤT, nước vừa thêm mà dashboard chưa khởi động
 *  lại vẫn được tính. */
async function soLieuCuaNuoc(key: string, label: string, luat: Luat): Promise<{ don: number; chiTieu: number; camp: number }> {
    const [d] = await query<{ n: number }>("SELECT COUNT(*) AS n FROM sale_order WHERE shop_label = @label", { label });
    const rows = await query<{ campaign_name: string | null; s: number }>(
        "SELECT campaign_name, SUM(spend) AS s FROM fb_ads_tat_ca GROUP BY campaign_name HAVING SUM(spend) > 0");
    let chiTieu = 0, camp = 0;
    for (const r of rows) {
        if (nuocCuaCamp(r.campaign_name, luat) === key) { chiTieu += Number(r.s) || 0; camp++; }
    }
    return { don: Number(d?.n || 0), chiTieu: Math.round(chiTieu), camp };
}

export async function DELETE(req: NextRequest) {
    const key = req.nextUrl.searchParams.get("key") || "";
    const a = await getAccess(req);
    const ai = a?.email || a?.name || "?";
    const goc = docGoc() as Luat;

    // Nước có trong config: chỉ bỏ phần sửa trên trang, quay về config.
    if (laKhoi(goc.markets?.[key])) {
        await luuKhoiPhu(key, null, ai);
        return NextResponse.json({ ok: true, khoi_dong_lai: khoiDongLai(), ...(await danhSach()) });
    }

    // Nước thêm trên trang: xoá hẳn, nhưng chỉ khi chưa có số nào gắn với nó.
    const phu = await docFilePhu();
    if (!laKhoi(phu.markets?.[key])) return NextResponse.json({ error: `Không có nước ${key}` }, { status: 404 });
    const luat = phuLuat(goc, phu) as Luat;
    const n = nhapTuLuat(key, luat);
    const so = await soLieuCuaNuoc(key, n.shop_label, luat);
    if (so.don || so.chiTieu) {
        const co = [so.don ? `${so.don.toLocaleString("vi-VN")} đơn` : "", so.chiTieu ? `${so.chiTieu.toLocaleString("vi-VN")}đ chi tiêu (${so.camp} campaign)` : ""]
            .filter(Boolean).join(" và ");
        return NextResponse.json({
            error: `${n.display || key} đã có ${co} — không xoá được (xoá là đơn cũ mất tỷ giá, chi tiêu nhảy sang nước khác). Chỉ tắt được.`,
        }, { status: 409 });
    }
    await luuKhoiPhu(key, null, ai);
    if (n.shop_label) await luuKhoa(bienKey(n.shop_label), null, "");
    console.log(`[thi-truong] ${ai} xoá nước ${key} (${n.shop_label || "chưa có mã shop"}) — chưa có đơn, chưa có chi tiêu`);
    return NextResponse.json({ ok: true, da_xoa: n.display || key, khoi_dong_lai: khoiDongLai(), ...(await danhSach()) });
}
