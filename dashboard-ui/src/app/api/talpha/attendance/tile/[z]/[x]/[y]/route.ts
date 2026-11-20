import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Ô ảnh bản đồ cho khung bản đồ nhỏ (components/ui/mini-map.tsx) — chấm công, 20/11/2026.
//
// Trình duyệt KHÔNG gọi thẳng tile.openstreetmap.org nữa mà lấy qua máy chủ dashboard: máy người dùng có thể không tới
// được OpenStreetMap (DNS máy dev trỏ tên lạ về 127.0.0.1 — Laravel Valet; mạng công ty / chặn quảng cáo chặn tên miền
// bản đồ) — trên máy chủ thật bản đồ hiện toàn ô vỡ dù vòng bán kính + chấm vị trí vẫn vẽ đúng. Đi qua máy chủ thì chỉ
// cần vào được dashboard là thấy bản đồ; máy chủ giữ ô trong bộ nhớ nên đỡ gọi OSM (đúng chính sách dùng ô của OSM).
// Quyền: proxy.ts chặn như route /api/talpha/attendance (ai đăng nhập cũng xem) — route không đọc lại người dùng vì
// mỗi bản đồ tải 10–20 ô, đọc lại bảng users cho từng ô là phí.

const UPSTREAM = "https://tile.openstreetmap.org";
// Chính sách OSM: User-Agent phải nói rõ ứng dụng nào gọi; không giả trình duyệt.
const USER_AGENT = "attendance-minimap/1.0 (internal dashboard tile proxy)";
const MAX_ZOOM = 19;
const CACHE_MAX = 1500;                    // ~10–25 KB một ô → tối đa vài chục MB
const CACHE_TTL_MS = 7 * 24 * 3600_000;    // OSM cho giữ 7 ngày
const TIMEOUT_MS = 10_000;

type Tile = { body: ArrayBuffer; type: string; at: number };
const cache = new Map<string, Tile>();
const inflight = new Map<string, Promise<Tile>>();

function remember(key: string, tile: Tile) {
    cache.delete(key);
    cache.set(key, tile);
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
}

async function fetchTile(z: number, x: number, y: number): Promise<Tile> {
    const r = await fetch(`${UPSTREAM}/${z}/${x}/${y}.png`, {
        headers: { "User-Agent": USER_AGENT, Accept: "image/png" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
    });
    const type = r.headers.get("content-type") || "";
    if (!r.ok || !type.startsWith("image/")) throw new Error(`OSM ${r.status} ${type}`);
    return { body: await r.arrayBuffer(), type, at: Date.now() };
}

const int = (s: string) => (/^\d{1,7}$/.test(s) ? Number(s) : NaN);

export async function GET(_req: Request, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
    const p = await params;
    const z = int(p.z), x = int(p.x), y = int(String(p.y).replace(/\.png$/, ""));
    const n = 2 ** z;
    if (!(z >= 0 && z <= MAX_ZOOM) || !(x >= 0 && x < n) || !(y >= 0 && y < n)) {
        return NextResponse.json({ error: "Ô bản đồ không hợp lệ" }, { status: 400 });
    }
    const key = `${z}/${x}/${y}`;
    let tile = cache.get(key);
    if (!tile || Date.now() - tile.at > CACHE_TTL_MS) {
        let job = inflight.get(key);
        if (!job) {
            job = fetchTile(z, x, y).finally(() => inflight.delete(key));
            inflight.set(key, job);
        }
        try {
            tile = await job;
            remember(key, tile);
        } catch (e) {
            // Ô cũ còn trong bộ nhớ thì dùng tạm (OSM chập chờn), không có thì báo lỗi — bản đồ ẩn ô đó.
            if (!tile) {
                console.warn(`[map-tile] ${key}: ${e instanceof Error ? e.message : e}`);
                return NextResponse.json({ error: "Không tải được ô bản đồ" }, { status: 502 });
            }
        }
    }
    return new NextResponse(tile.body, {
        headers: { "Content-Type": tile.type, "Cache-Control": "private, max-age=604800" },
    });
}
