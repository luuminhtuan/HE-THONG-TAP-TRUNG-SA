import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAccess } from "@/lib/talpha/access";
import { getCredential, verifyCredential, saveCredential } from "@/lib/talpha/khoa";
import { maskCredential, credentialValueError } from "@/lib/talpha/khoa-file";
import { POS_API_URL } from "@/lib/talpha/rules";
import { overrideFromInput, marketInputErrors, inputFromRules, marketOfCampaign, applyMarketOverrides, type MarketInput } from "@/lib/talpha/thi-truong";
import { needsRestart, readOverrides, readBaseRules, scheduleRestart, latestRules, saveMarketOverride, overridesFingerprint } from "@/lib/talpha/thi-truong-luu";

export const dynamic = "force-dynamic";

// Thị trường (04/11/2026) — trang /admin → Thị trường. Chỉ giám đốc (API_RULES: full).
//
//   GET                       → mọi nước (đã phủ), lấy từ đâu, có key POS chưa, danh sách team
//   GET ?overrides=1          → chỉ phần phủ + dấu vân tay — cho bot Zalo (chìa nội bộ) nạp luật
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

type Rules = {
    markets?: Record<string, unknown>; access?: { teams?: Record<string, { name?: string } | unknown> };
    market_aliases?: Record<string, string>; camp_market_tokens?: string[];
};
const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const posKeyName = (label: string) => `TALPHA_POSCAKE_${label}_KEY`;

async function listMarkets() {
    const overrides = await readOverrides();
    const rules = applyMarketOverrides(readBaseRules(), overrides) as Rules;
    const baseRules = readBaseRules() as Rules;
    const markets = Object.entries(rules.markets || {})
        .filter(([k, v]) => !k.startsWith("_") && isPlainObject(v))
        .map(([key]) => {
            const n = inputFromRules(key, rules);
            const inBase = isPlainObject(baseRules.markets?.[key]);
            const inOverrides = isPlainObject(overrides.markets?.[key]);
            return {
                ...n,
                nguon: inBase ? (inOverrides ? "sua_tren_trang" : "config") : "them_tren_trang",
                bien_key: n.shop_label ? posKeyName(n.shop_label) : null,
                co_key: !!n.shop_label && !!getCredential(posKeyName(n.shop_label)),
                che_key: n.shop_label ? maskCredential(getCredential(posKeyName(n.shop_label))) : "",
            };
        });
    const teams = Object.entries(rules.access?.teams || {})
        .filter(([k, t]) => !k.startsWith("_") && isPlainObject(t))
        .map(([key, t]) => ({ key, name: String((t as { name?: string }).name || key) }));
    return { markets, teams, cho_khoi_dong_lai: await needsRestart(), updated_at: overrides.updated_at || null, updated_by: overrides.updated_by || null };
}

const str = (v: unknown) => String(v ?? "").trim();
const numberOrNull = (v: unknown) => (v === "" || v === null || v === undefined ? null : Number(v));

/** Ô form → ThiTruongNhap. Kiểu sai (chữ ở ô số…) để lại cho loiThiTruong báo, không đoán. */
function parseMarketInput(b: Record<string, unknown>): MarketInput {
    const tokens = Array.isArray(b.tokens) ? b.tokens : str(b.tokens).split(/[,\s]+/);
    return {
        key: str(b.key),
        display: str(b.display),
        shop_label: str(b.shop_label).toUpperCase(),
        currency: str(b.currency).toUpperCase(),
        currency_symbol: str(b.currency_symbol),
        rate_vnd: numberOrNull(b.rate_vnd),
        pos_money_divisor: numberOrNull(b.pos_money_divisor),
        shop_id: str(b.shop_id),
        status: str(b.status) as MarketInput["status"],
        orders_from: str(b.orders_from) || null,
        flag: str(b.flag),
        tokens: tokens.map(str).filter(Boolean),
        team: str(b.team) || null,
    };
}

export async function GET(req: NextRequest) {
    try {
        if (req.nextUrl.searchParams.get("overrides") === "1") {
            const overrides = await readOverrides();
            return NextResponse.json({ phu: overrides, van_tay: overridesFingerprint(overrides) });
        }
        return NextResponse.json(await listMarkets());
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
    if (!isPlainObject(body?.nuoc)) return NextResponse.json({ error: "Thiếu thông tin nước" }, { status: 400 });
    const n = parseMarketInput(body.nuoc);
    const isNew = body.la_moi === true;

    const rules = await latestRules();
    const errors = marketInputErrors(n, rules, isNew);
    // Key POS dán ngay trong form (để trống = giữ key đang có). Soát trước khi gọi shop.
    const pastedKey = str(body.key_pos);
    if (pastedKey) {
        const keyError = credentialValueError(pastedKey);
        if (keyError) errors.push(`Key POS: ${keyError}`);
        if (!n.shop_id) errors.push("Có key POS thì phải có mã shop POS để máy gọi thử");
    }
    if (errors.length) return NextResponse.json({ error: errors.join(" · "), loi: errors }, { status: 400 });

    // Có key mới, bật bán, hoặc đổi shop khi đang bán → gọi thử shop POS trước khi lưu. Lưu nước
    // "đang bán" mà shop sai / chưa có key là sync kéo 0 đơn mỗi giờ mà không ai biết.
    const keyName = posKeyName(n.shop_label);
    // Ô key mang lại đúng key đang dùng (vừa xem bằng con mắt) = không đổi key: khỏi gọi thử, khỏi ghi.
    const newPosKey = pastedKey && pastedKey !== getCredential(keyName) ? pastedKey : "";
    const existing = isNew ? null : inputFromRules(n.key, rules);
    if (newPosKey || (n.status === "dang_ban" && (!existing || existing.status !== "dang_ban" || existing.shop_id !== n.shop_id))) {
        const key = newPosKey || getCredential(keyName);
        if (!key) {
            return NextResponse.json({
                error: `Chưa có key POS của ${n.display} — dán vào ô "Key POS" của form, hoặc lưu ở trạng thái Sắp chạy.`,
            }, { status: 422 });
        }
        const checkResult = await verifyCredential({ ten: keyName, nhan: "", dung_cho: "", loai: "pos", shop: { name: n.key, shop_id: n.shop_id, api_url: POS_API_URL } }, key);
        if (!checkResult.ok) {
            const actor = newPosKey ? "Key POS vừa dán không gọi được shop" : `Shop POS ${n.shop_id}`;
            return NextResponse.json({ error: `Chưa lưu — ${actor}: ${checkResult.chi_tiet}` }, { status: 422 });
        }
    }

    const a = await getAccess(req);
    const actor = a?.email || a?.name || "?";
    // Key trước, nước sau: lưu key hỏng (vd thiếu chìa mã hoá) thì chưa ghi gì cả.
    if (newPosKey) {
        const savedAt = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" });
        try {
            await saveCredential(keyName, newPosKey, `${actor} lưu lúc ${savedAt} (Thị trường)`, actor);
        } catch (e) {
            return NextResponse.json({ error: `Chưa lưu — ${e instanceof Error ? e.message : e}` }, { status: 500 });
        }
    }
    const fingerprintBefore = overridesFingerprint(await readOverrides());
    await saveMarketOverride(n.key, overrideFromInput(n, readBaseRules()), actor);
    // Chỉ đổi key (thông tin nước y nguyên) → khỏi khởi động lại: docKhoa đã nạp lại key mới.
    const changed = overridesFingerprint(await readOverrides()) !== fingerprintBefore;
    return NextResponse.json({ ok: true, luu_key: !!newPosKey, khoi_dong_lai: changed ? scheduleRestart() : "khong_can", ...(await listMarkets()) });
}

/** Số đã gắn với một nước: đơn trong kho (theo mã shop) + chi tiêu Meta (mọi TKQC) của camp mang mã
 *  nước đó — gán camp bằng nuocCuaCamp trên luật MỚI NHẤT, nước vừa thêm mà dashboard chưa khởi động
 *  lại vẫn được tính. */
async function marketUsage(key: string, label: string, rules: Rules): Promise<{ don: number; chiTieu: number; camp: number }> {
    const [d] = await query<{ n: number }>("SELECT COUNT(*) AS n FROM sale_order WHERE shop_label = @label", { label });
    const rows = await query<{ campaign_name: string | null; s: number }>(
        "SELECT campaign_name, SUM(spend) AS s FROM fb_ads_tat_ca GROUP BY campaign_name HAVING SUM(spend) > 0");
    let spend = 0, camp = 0;
    for (const r of rows) {
        if (marketOfCampaign(r.campaign_name, rules) === key) { spend += Number(r.s) || 0; camp++; }
    }
    return { don: Number(d?.n || 0), chiTieu: Math.round(spend), camp };
}

export async function DELETE(req: NextRequest) {
    const key = req.nextUrl.searchParams.get("key") || "";
    const a = await getAccess(req);
    const actor = a?.email || a?.name || "?";
    const baseRules = readBaseRules() as Rules;

    // Nước có trong config: chỉ bỏ phần sửa trên trang, quay về config.
    if (isPlainObject(baseRules.markets?.[key])) {
        await saveMarketOverride(key, null, actor);
        return NextResponse.json({ ok: true, khoi_dong_lai: scheduleRestart(), ...(await listMarkets()) });
    }

    // Nước thêm trên trang: xoá hẳn, nhưng chỉ khi chưa có số nào gắn với nó.
    const overrides = await readOverrides();
    if (!isPlainObject(overrides.markets?.[key])) return NextResponse.json({ error: `Không có nước ${key}` }, { status: 404 });
    const rules = applyMarketOverrides(baseRules, overrides) as Rules;
    const n = inputFromRules(key, rules);
    const usage = await marketUsage(key, n.shop_label, rules);
    if (usage.don || usage.chiTieu) {
        const usageText = [usage.don ? `${usage.don.toLocaleString("vi-VN")} đơn` : "", usage.chiTieu ? `${usage.chiTieu.toLocaleString("vi-VN")}đ chi tiêu (${usage.camp} campaign)` : ""]
            .filter(Boolean).join(" và ");
        return NextResponse.json({
            error: `${n.display || key} đã có ${usageText} — không xoá được (xoá là đơn cũ mất tỷ giá, chi tiêu nhảy sang nước khác). Chỉ tắt được.`,
        }, { status: 409 });
    }
    await saveMarketOverride(key, null, actor);
    if (n.shop_label) await saveCredential(posKeyName(n.shop_label), null, "");
    console.log(`[thi-truong] ${actor} xoá nước ${key} (${n.shop_label || "chưa có mã shop"}) — chưa có đơn, chưa có chi tiêu`);
    return NextResponse.json({ ok: true, da_xoa: n.display || key, khoi_dong_lai: scheduleRestart(), ...(await listMarkets()) });
}
