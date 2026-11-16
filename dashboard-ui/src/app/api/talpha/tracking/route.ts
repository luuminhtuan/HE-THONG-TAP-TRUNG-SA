import { NextRequest, NextResponse } from "next/server";
import { PHONE_RULES, DISABLED_MARKETS, SHOP2MKT } from "@/lib/talpha/rules";
import { todayVn, filterByOrderDate } from "@/lib/talpha/order-ledger";
import { buildAlerts, countByStatus, planRegister, trackMarket, TRACK_CFG, TRACK_MARKETS } from "@/lib/talpha/tracking";
import { hasApiKey } from "@/lib/talpha/track17";
import { orderConfirmationMessage, waLink } from "@/lib/talpha/whatsapp";
import { getAccess } from "@/lib/talpha/access";
import { canMarket } from "@/lib/talpha/access-rules";
import { envWithCredentials } from "@/lib/talpha/credentials";
import { loadShipments, undeclaredStatuses } from "./_lib/load-shipments";
import { sync17Track } from "./_lib/sync-17track";
import { syncWeship } from "./_lib/sync-weship";

export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════
// THEO DÕI VẬN ĐƠN
//
//   GET  — đọc đơn trong kỳ, ghép trạng thái đã lưu, trả kèm cảnh báo
//   POST — đồng bộ với 17TRACK: đăng ký mã mới rồi hỏi trạng thái
//
// ⚠️ Đăng ký TỐN QUOTA (1 mã = 1 lần tính tiền), hỏi trạng thái thì miễn phí.
// Sổ đăng ký ở data/tracking.json là thứ chặn đăng ký trùng — mất nó là đốt
// tiền. Vì thế POST luôn ghi sổ NGAY sau khi 17TRACK nhận, trước khi làm gì tiếp.
//
// Chỉ theo dõi đơn ĐÃ GỬI ĐI và CHƯA kết thúc. Đơn huỷ hay đơn thô chưa có hàng
// chạy ngoài đường, đăng ký vào là phí quota. Luật chọn ở planRegister (tracking.ts).
//
// POST chạy tự động mỗi sáng sau khi nạp bảng đối tác (ops/deploy/tracking-import.sh),
// kết quả ghi vào `last_sync` để bot Zalo báo được "17TRACK cập nhật lúc nào, còn bao
// nhiêu quota" — và báo LỖI, chứ không im lặng gửi số cũ như số mới.
//
// ?market=SG (Sỹ Anh chốt 25/09/2026): mỗi thị trường một SỔ RIÊNG, đọc bảng đối tác
// riêng — Đài từ data/tracking.json (nút "Đọc bảng đối tác"), nước khác từ bảng
// partner_orders. Không có market (hoặc mã lạ) = Đài Loan. Khoá 17TRACK dùng chung.
//
// ?market=AE (Sỹ Anh chốt 28/09/2026): UAE không có bảng đối tác, không qua 17TRACK — đơn đọc
// từ POS, POST tra thẳng trang WeShip (miễn phí, không quota; lib/talpha/weship.ts).
//
// Phần nặng nằm ở _lib/: load-shipments.ts (đọc sổ + kho số), sync-17track.ts (POST qua
// 17TRACK), sync-weship.ts (POST của UAE), store-types.ts (kiểu sổ vận đơn).
// ═══════════════════════════════════════════════════════════════════

function range(req: NextRequest) {
    const q = req.nextUrl.searchParams;
    const from = q.get("from") || "";
    const to = q.get("to") || "";
    const ok = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to);
    return { from, to, ok };
}

export async function GET(req: NextRequest) {
    const { from, to, ok } = range(req);
    if (!ok) return NextResponse.json({ error: "from/to phải dạng YYYY-MM-DD" }, { status: 400 });
    const mk = trackMarket(req.nextUrl.searchParams.get("market"));
    // proxy.ts đã chặn nước ngoài team; ở đây chỉ bớt nút nước khác khỏi danh sách.
    const a = await getAccess(req);

    try {
        // Danh sách chỉ kiện lên đơn trong khoảng đang chọn (15/11/2026 — mặc định tháng này: hơn nghìn
        // kiện một lượt là trang nặng). Cảnh báo, chữ trạng thái lạ, số mã chờ đăng ký vẫn tính trên MỌI
        // kiện đã nạp: kiện tháng trước còn kẹt không được biến mất chỉ vì đang xem tháng này. Đơn POS Đài
        // (chỉ đọc theo ngày) nạp lùi tới 60 ngày cho cảnh báo — như mặc định 60 ngày trước đây.
        const today = todayVn();
        const sixtyDaysAgo = new Date(Date.parse(today) - 60 * 86_400_000).toISOString().slice(0, 10);
        const { shipments: raw, store, lastImport } = await loadShipments(mk, from < sixtyDaysAgo ? from : sixtyDaysAgo, to);
        // Nút WhatsApp kèm tin xác nhận đơn (29/09/2026, chỉ nước bật whatsapp — UAE) — gắn TRƯỚC
        // buildAlerts để cảnh báo mang theo luôn.
        const phoneRule = PHONE_RULES[mk.code];
        const allShipments = raw.map((s) => ({
            ...s,
            wa: phoneRule ? waLink(s.phone, phoneRule, orderConfirmationMessage({
                customer: s.customer, cod: s.cod_local, currency: mk.currency,
                address: s.address || s.city, tracking: s.track17_code,
            })) : null,
        }));
        const alerts = buildAlerts(allShipments, new Date(), { staleDays: mk.stale_days });
        const shipments = filterByOrderDate(allShipments, from, to, today);
        return NextResponse.json({
            from, to,
            market: { code: mk.code, label: mk.label, currency: mk.currency, provider: mk.provider, source: mk.source },
            // Nút chọn nước: bỏ nước đã tắt (sổ vận đơn của nó vẫn đọc được nếu gọi thẳng ?market=).
            markets: TRACK_MARKETS.filter((m) => !!a && canMarket(a, m.code) && !DISABLED_MARKETS.has(SHOP2MKT[m.code]))
                .map((m) => ({ code: m.code, label: m.label })),
            // Tên nguồn trạng thái cho màn hình và bot Zalo ("17TRACK" / "WeShip").
            provider: mk.provider,
            // WeShip không cần khoá — "có khoá" = tra được.
            has_api_key: mk.provider === "weship" ? true : hasApiKey(envWithCredentials()),
            last_sync: store.last_sync ?? null,
            last_import: lastImport,
            config: {
                pickup_expire_days: TRACK_CFG.pickup_expire_days,
                warn_before_expire_days: TRACK_CFG.warn_before_expire_days,
                stale_days: mk.stale_days,
            },
            shipments,
            alerts,
            counts: countByStatus(shipments),
            // Nước ngoài Đài: bảng đối tác nạp tự động nên không có lượt "Đọc bảng" để báo chữ
            // trạng thái lạ — báo ở đây, kẻo đơn mang chữ lạ lặng lẽ rơi khỏi mọi cảnh báo.
            ...(mk.code !== "TW" ? { unknown_statuses: undeclaredStatuses(allShipments) } : {}),
            totals: {
                shipments: shipments.length,
                registered: shipments.filter((s) => s.registered).length,
                // Chỉ đếm mã SẼ được đăng ký (đơn chưa kết thúc, còn mới) — đếm cả đơn đã
                // giao xong thì con số này không bao giờ về 0 và chẳng nói lên gì.
                pending_register: mk.provider === "weship"
                    // WeShip không đăng ký — "chưa theo dõi" = có mã AWB mà chưa tra lần nào.
                    ? allShipments.filter((s) => s.track17_code && !s.registered).length
                    : planRegister(allShipments, new Date(), { staleDays: mk.stale_days }).eligible,
                at_store_value: shipments
                    .filter((s) => s.status === "AvailableForPickup")
                    .reduce((n, s) => n + s.cod_local, 0),
            },
        });
    } catch (e) {
        console.error("tracking GET lỗi:", e);
        return NextResponse.json({ error: "Query lỗi" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const { from, to, ok } = range(req);
    if (!ok) return NextResponse.json({ error: "from/to phải dạng YYYY-MM-DD" }, { status: 400 });
    const mk = trackMarket(req.nextUrl.searchParams.get("market"));
    if (mk.provider === "weship") return syncWeship(mk, from, to);
    return sync17Track(mk, from, to);
}
