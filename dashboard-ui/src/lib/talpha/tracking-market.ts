/**
 * Đơn của một thị trường ngoài Đài (Singapore…), đọc từ bảng đối tác trong kho số
 * `partner_orders` (talpha-sync nạp mỗi giờ) rồi ghép trạng thái 17TRACK trong sổ riêng của
 * nước đó (data/tracking_<mã>.json).
 *
 * Dùng chung cho HAI màn: Theo dõi vận đơn (/api/talpha/tracking?market=SG) và Đối soát COD
 * (/api/talpha/cod-recon/market?market=SG) — hai màn đọc hai cách là sớm muộn hai con số.
 *
 * Đọc kho số hỏng thì NÉM lỗi: nước này không có nguồn thứ hai, trả danh sách rỗng là nói
 * dối "không có đơn".
 *
 * UAE (source "pos", Sỹ Anh chốt 28/09/2026) không có bảng đối tác: đơn đọc thẳng từ POS, trạng
 * thái tra ở trang WeShip (lib/talpha/weship.ts) — xem loadPosMarketShipments / syncWeshipMarket.
 */
import { query } from "@/lib/db";
import { readStoreFresh, updateStore } from "@/lib/talpha/store";
import { DISPLAY, normPosMarketer } from "@/lib/talpha/rules";
import {
    mergeStatus, partnerOrderShipment, TERMINAL, TRACK_CFG,
    type PartnerOrderRow, type SavedTrack, type Shipment, type TrackMarket,
} from "./tracking";
import {
    awbFromPartner, fetchWeship, mapPool, posWeshipShipment, weshipTrack,
    type PosOrderRow, type WeshipEvent, type WeshipSaved,
} from "./weship";

/** Tối thiểu một sổ vận đơn phải có để ghép trạng thái. */
export type MarketStoreBase = {
    registered: Record<string, { number?: string }>;
    statuses: Record<string, unknown>;
};

// Mã vận đơn có khi dính ký tự lạ từ Sheet — bỏ đi trước khi so.
const clean = (x?: string | null) => String(x || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

export async function loadPartnerMarketShipments<S extends MarketStoreBase>(
    mk: TrackMarket, emptyStore: () => S,
): Promise<{ shipments: Shipment[]; store: S; lastImport: string | null }> {
    const store = await readStoreFresh<S>(mk.store, emptyStore());
    const regNumbers = new Set(Object.entries(store.registered).map(([k, r]) => r.number || clean(k)));
    // NULLS FIRST giữ thứ tự BigQuery (NULL đứng đầu khi xếp tăng) — dòng đầu của một mã thắng khoá.
    const rows = await query<PartnerOrderRow & { synced_at?: string }>(
        `SELECT order_no, tracking, status, note, ship_method, city, contact_name, phone, cod, marketer, sku, quantity,
                to_char(order_date, 'YYYY-MM-DD') AS order_date,
                to_char(ship_date, 'YYYY-MM-DD') AS ship_date,
                to_char(synced_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS synced_at
         FROM partner_orders
         WHERE market = @m
         ORDER BY row_no NULLS FIRST`,
        { m: mk.partner_market },
    );
    const byKey = new Map<string, Shipment>();
    let lastImport: string | null = null;
    for (const r of rows) {
        if (r.synced_at && (!lastImport || r.synced_at > lastImport)) lastImport = r.synced_at;
        const t = clean(r.tracking);
        const key0 = t || `DON-${r.order_no || "?"}`;
        // Hai dòng cùng mã vận đơn (đơn tách/ghép) → khoá thứ hai kèm mã đơn, không đè nhau.
        const key = byKey.has(key0) ? `${key0}#${r.order_no || byKey.size}` : key0;
        const s = partnerOrderShipment(mk, r, store.statuses[key0] as SavedTrack | undefined,
            !!store.registered[key0] || (!!t && regNumbers.has(t)));
        byKey.set(key, {
            ...s, tracking: key,
            sku: r.sku ? String(r.sku) : null,
            quantity: Math.max(1, Number(String(r.quantity ?? "").replace(/[^\d.]/g, "")) || 1),
        });
    }
    return { shipments: [...byKey.values()], store, lastImport };
}

// ═══════════════════════════════════════════════════════════════════
// NGUỒN "pos" (UAE) — đơn đọc thẳng từ POS, trạng thái tra ở trang WeShip
// ═══════════════════════════════════════════════════════════════════

/** Kết quả một lượt tra WeShip — màn hình và bot Zalo đọc để nói số mới tới đâu. */
export type WeshipLastSync = {
    at: string; ok: boolean; error?: string; provider: "weship";
    /** Số mã đem tra · tra được · đổi trạng thái · trang báo không có · lỗi mạng/đọc trang. */
    targets: number; checked: number; changed: number; not_found: number; failed: number;
};

type WeshipStore = MarketStoreBase & {
    statuses: Record<string, WeshipSaved & {
        checked_at?: string; ref?: string | null; events?: WeshipEvent[]; weight?: string | null;
    }>;
    last_sync?: WeshipLastSync;
};
const emptyWeship = (): WeshipStore => ({ registered: {}, statuses: {} });

/**
 * Đơn của thị trường source "pos": mọi đơn POS của nước đó từ register_from_date, trừ đơn huỷ
 * và đơn thô (chưa có hàng đi đường). Đọc kho số hỏng thì NÉM lỗi — như bảng đối tác.
 */
export async function loadPosMarketShipments<S extends MarketStoreBase>(
    mk: TrackMarket, emptyStore: () => S,
): Promise<{ shipments: Shipment[]; store: S; lastImport: string | null }> {
    const store = await readStoreFresh<S>(mk.store, emptyStore());
    const registerFromDate = TRACK_CFG.register_from_date;
    // NULLS LAST giữ thứ tự BigQuery (NULL cuối khi xếp giảm). Mã đơn không phải số (hoặc dài quá
    // bigint) thì coi là NULL như SAFE_CAST cũ, không làm chết câu.
    const rows = await query<PosOrderRow>(
        `SELECT v.order_id, to_char(v.order_date, 'YYYY-MM-DD') AS order_date,
                v.status_name, v.status_category, v.marketer_name AS marketer,
                safe_divide(o.cod, NULLIF(v.pos_money_divisor, 0)) AS cod,
                o.partner, o.bill_full_name AS customer, o.bill_phone_number AS phone,
                o.shipping_province AS province, o.shipping_district AS district,
                o.shipping_address AS address,
                o.note, o.time_send_partner
         FROM vw_orders_std v
         LEFT JOIN sale_order o
                ON v.shop_id = o.shop_id AND v.order_id = o.id
         WHERE v.market = @m
           AND v.status_category NOT IN ('HUY', 'DON_THO')
           ${registerFromDate ? "AND v.order_date >= @tu::date" : ""}
         ORDER BY v.order_date DESC NULLS LAST,
                  CASE WHEN v.order_id ~ '^-?[0-9]{1,18}$' THEN v.order_id::bigint END DESC NULLS LAST`,
        registerFromDate ? { m: mk.pos_market || mk.code, tu: registerFromDate } : { m: mk.pos_market || mk.code },
    );
    const statuses = store.statuses as Record<string, WeshipSaved>;
    const shipments = rows.map((r) => {
        const awb = awbFromPartner(r.partner);
        const key = normPosMarketer(r.marketer);
        return posWeshipShipment(r, awb ? statuses[awb] : undefined, key ? (DISPLAY[key] || key) : (r.marketer || null));
    });
    // Không có "bảng đối tác" để báo tuổi — tuổi số là lần tra WeShip, nằm ở last_sync.
    return { shipments, store, lastImport: null };
}

/**
 * Nhãn nguồn số của nước đọc bảng đối tác. "+ 17TRACK" chỉ đúng khi có mã thật sự được 17TRACK
 * theo dõi — Nhật 13/10/2026: 17TRACK từ chối đăng ký mọi mã Sagawa ("The carrier temporarily
 * does not support registration") nên trạng thái chỉ theo bảng đối tác.
 */
export function partnerSourceLabel(
    shipments: Pick<Shipment, "registered">[], store: { last_sync?: { register_rejected?: number } },
): string {
    if (!shipments.some((s) => s.registered) && Number(store.last_sync?.register_rejected) > 0) {
        return "Bảng đối tác (17TRACK chưa nhận đăng ký hãng này)";
    }
    return "Bảng đối tác + 17TRACK";
}

/** Đơn của một thị trường ngoài Đài — chọn nguồn theo khai báo tracking.markets.<mã>.source. */
export function loadMarketShipments<S extends MarketStoreBase>(
    mk: TrackMarket, emptyStore: () => S,
): Promise<{ shipments: Shipment[]; store: S; lastImport: string | null }> {
    return mk.source === "pos" ? loadPosMarketShipments(mk, emptyStore) : loadPartnerMarketShipments(mk, emptyStore);
}

/**
 * Một lượt tra WeShip: tra lại MỌI mã AWB chưa kết thúc (miễn phí, không quota), ghi sổ
 * data/<store>.json rồi ghi last_sync. Mã đã Delivered/Returned theo WeShip thì thôi tra.
 * Một mã lỗi không làm hỏng cả lượt; MỌI mã đều lỗi thì lượt hỏng thật (ok=false).
 */
export async function syncWeshipMarket(mk: TrackMarket, now: Date = new Date()): Promise<WeshipLastSync> {
    if (!mk.weship) throw new Error(`thị trường ${mk.code} không khai provider weship`);
    const cfg = mk.weship;
    const nowIso = now.toISOString();
    const { shipments } = await loadPosMarketShipments(mk, emptyWeship);
    const targets = [...new Set(shipments
        .filter((s) => s.track17_code && !(s.source === "weship" && s.status && TERMINAL.has(s.status)))
        .map((s) => s.track17_code as string))];

    const kq = await mapPool(targets, cfg.concurrency, async (awb) => {
        try { return { awb, page: await fetchWeship(awb, cfg) }; }
        catch (e) { return { awb, error: e instanceof Error ? e.message : String(e) }; }
    });

    let checked = 0, changed = 0, notFound = 0;
    const error = kq.filter((x) => "error" in x) as { awb: string; error: string }[];
    const updatedStore = await updateStore<WeshipStore>(mk.store, emptyWeship(), (cur) => {
        for (const x of kq) {
            if (!("page" in x) || !x.page) continue;
            if (!x.page.found) { notFound++; continue; }
            checked++;
            const t = weshipTrack(x.page, mk.status_rules);
            const prev = cur.statuses[x.awb];
            const m = mergeStatus(prev?.source === "weship" ? { status: prev.status, status_since: prev.status_since } : undefined, t, now);
            if (prev?.status !== m.status) changed++;
            cur.statuses[x.awb] = {
                ...m, source: "weship", raw_status: t.raw_status, fail_count: t.fail_count,
                checked_at: nowIso, ref: x.page.ref, weight: x.page.weight,
                events: x.page.events.slice(0, 15),
            };
        }
        const ok = !targets.length || error.length < targets.length;
        cur.last_sync = {
            at: nowIso, ok, provider: "weship",
            targets: targets.length, checked, changed, not_found: notFound, failed: error.length,
            ...(error.length ? { error: `${error.length}/${targets.length} mã lỗi — ${error[0].awb}: ${error[0].error}` } : {}),
        };
        return cur;
    });
    return updatedStore.last_sync!;
}
