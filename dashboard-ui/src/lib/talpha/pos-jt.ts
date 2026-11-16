/**
 * Vận đơn Việt Nam (mở 11/11/2026): shop POS "VIỆT NAM" nối THẲNG J&T Express Việt Nam — mỗi
 * đơn POS mang sẵn mã vận đơn (partner.extend_code) và nhật ký trạng thái J&T
 * (partner.extend_update: [{status, note, update_at}]). talpha-sync nạp sale_order mỗi giờ, nên
 * không cần 17TRACK (quota đã hết) hay tra trang của hãng.
 *
 * Chữ trạng thái J&T → trạng thái chuẩn qua tracking.markets.VN.status_rules (regex, luật trên
 * thắng), áp lên "<trạng thái> — <ghi chú>" để lý do giao hỏng ("Không liên lạc được Khách
 * hàng/khóa máy", "Người mua hẹn lại ngày nhận", "Từ chối…") ra đúng sub_status.
 */
import type { Shipment, StatusRule } from "./tracking";
import type { PosOrderRow } from "./weship";
import { mapWeshipStatus } from "./weship";

export type JtEvent = { status: string; note: string | null; at: string | null };

/** "2026-11-11T21:33:11+07:00" / "2026-11-11T14:34:46" (UTC, POS) → ISO; hỏng → null. */
function iso(s: unknown): string | null {
    const g = String(s || "").trim();
    if (!g) return null;
    const ms = Date.parse(/Z$|[+-]\d{2}:?\d{2}$/.test(g) ? g : `${g}Z`);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * Chữ kiểu Python repr ("{'a': 'x', 'b': None, 'c': [1, True]}") → giá trị JS. Cột
 * sale_order.partner trong kho số lưu dạng này (str(dict) của talpha-sync — đo 16/11/2026 trên Postgres:
 * cột text, đơn UAE mở đầu "{'updated_at': …"), KHÔNG phải JSON — chuỗi có dấu ' bên trong thì Python
 * bọc bằng " — nên phải đọc đúng cả hai kiểu nháy.
 * Hỏng ở đâu → null (không đoán).
 */
export function parsePythonRepr(src: string): unknown {
    let i = 0;
    const ws = () => { while (i < src.length && /\s/.test(src[i])) i++; };
    const val = (): unknown => {
        ws();
        const c = src[i];
        if (c === "{") {
            i++; const o: Record<string, unknown> = {};
            ws(); if (src[i] === "}") { i++; return o; }
            for (;;) {
                const k = val(); ws();
                if (src[i++] !== ":") throw new Error("thiếu :");
                o[String(k)] = val(); ws();
                const d = src[i++];
                if (d === "}") return o;
                if (d !== ",") throw new Error("thiếu ,");
            }
        }
        if (c === "[" || c === "(") {
            const close = c === "[" ? "]" : ")"; i++; const a: unknown[] = [];
            ws(); if (src[i] === close) { i++; return a; }
            for (;;) {
                a.push(val()); ws();
                const d = src[i++];
                if (d === close) return a;
                if (d !== ",") throw new Error("thiếu ,");
                ws(); if (src[i] === close) { i++; return a; }
            }
        }
        if (c === "'" || c === '"') {
            i++; let out = "";
            while (i < src.length && src[i] !== c) {
                if (src[i] === "\\") {
                    const n = src[i + 1];
                    const map: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\", "'": "'", '"': '"' };
                    if (n === "x" || n === "u") {
                        const len = n === "x" ? 2 : 4;
                        out += String.fromCharCode(parseInt(src.slice(i + 2, i + 2 + len), 16)); i += 2 + len; continue;
                    }
                    out += map[n] ?? n; i += 2; continue;
                }
                out += src[i++];
            }
            i++; return out;
        }
        const m = /^(None|True|False|-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/.exec(src.slice(i, i + 40));
        if (!m) throw new Error(`ký tự lạ ở ${i}`);
        i += m[1].length;
        return m[1] === "None" ? null : m[1] === "True" ? true : m[1] === "False" ? false : Number(m[1]);
    };
    try { const v = val(); return v; } catch { return null; }
}

/** Đọc ô partner (Python repr / JSON chuỗi / object) → mã vận đơn + nhật ký J&T, cũ → mới. */
export function parsePartnerJt(partner: unknown): { awb: string | null; events: JtEvent[] } {
    type RawEvent = { status?: unknown; note?: unknown; update_at?: unknown } | null;
    let p: unknown = partner;
    if (typeof p === "string") {
        const t = p.trim();
        try { p = JSON.parse(t); } catch { p = parsePythonRepr(t); }
    }
    if (!p || typeof p !== "object") return { awb: null, events: [] };
    const o = p as { extend_code?: unknown; extend_update?: unknown };
    const awb = String(o.extend_code || "").trim() || null;
    const events = (Array.isArray(o.extend_update) ? (o.extend_update as RawEvent[]) : [])
        .map((e): JtEvent => ({
            status: String(e?.status || "").trim(),
            note: String(e?.note || "").trim() || null,
            at: iso(e?.update_at),
        }))
        .filter((e: JtEvent) => e.status)
        .sort((a: JtEvent, b: JtEvent) => String(a.at || "").localeCompare(String(b.at || "")));
    return { awb, events };
}

const eventText = (e: JtEvent) => (e.note ? `${e.status} — ${e.note}` : e.status);

/** Đơn POS Việt Nam → Shipment (khuôn chung màn Theo dõi vận đơn + bot Zalo). */
export function posJtShipment(row: PosOrderRow, rules: StatusRule[], marketer: string | null = null): Shipment {
    const { awb, events } = parsePartnerJt(row.partner);
    const latest = events[events.length - 1] || null;
    const rule = latest ? mapWeshipStatus(eventText(latest), rules) : null;
    const status = rule?.status || (awb ? "InfoReceived" : null);
    // Lần đầu vào trạng thái hiện tại: lùi qua các sự kiện liền trước cùng trạng thái.
    let since = latest?.at || null;
    for (let i = events.length - 2; i >= 0 && rule; i--) {
        if (mapWeshipStatus(eventText(events[i]), rules)?.status !== rule.status) break;
        since = events[i].at || since;
    }
    const failCount = events.filter((e) => mapWeshipStatus(eventText(e), rules)?.status === "DeliveryFailure").length;
    const orderDate = row.order_date ? String(row.order_date).slice(0, 10) : null;
    const sentAt = iso(row.time_send_partner);
    const anchor = sentAt || (orderDate ? `${orderDate}T00:00:00Z` : null);
    const place = [...new Set([row.district, row.province].map((x) => String(x || "").trim()).filter(Boolean))].join(", ");
    return {
        tracking: awb || `DON-${row.order_id ?? "?"}`,
        track17_code: awb,
        order_uid: null,
        order_id: String(row.order_id ?? ""),
        order_date: orderDate,
        customer: String(row.customer || ""),
        phone: String(row.phone || ""),
        store_name: "", store_code: "", ship_method: "J&T",
        marketer,
        sale: null,
        cod_local: Number(row.cod) || 0,
        status,
        sub_status: rule?.sub_status ?? null,
        status_since: since || anchor,
        last_event_time: latest?.at || anchor,
        last_event: latest ? (rule ? `${rule.vi} · ${eventText(latest)}` : eventText(latest))
            : awb ? "Có mã J&T, chưa có cập nhật" : `Chưa có mã vận đơn — POS: ${String(row.status_name || row.status_category || "?")}`,
        registered: !!awb,
        source: "pos",
        // Chữ J&T chưa khai luật → để nguyên văn (màn hình liệt kê "trạng thái lạ" để khai thêm).
        raw_status: latest ? eventText(latest) : null,
        ship_date: sentAt ? sentAt.slice(0, 10) : null,
        note: String(row.note || "").trim() || null,
        city: place || null,
        address: String(row.address || "").replace(/\s+/g, " ").trim() || null,
        fail_count: failCount || null,
    };
}
