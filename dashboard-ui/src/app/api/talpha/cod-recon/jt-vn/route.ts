import { NextRequest, NextResponse } from "next/server";
import { RULES } from "@/lib/talpha/rules";
import { getAccess } from "@/lib/talpha/access";
import { trackMarket } from "@/lib/talpha/tracking";
import { loadMarketShipments } from "@/lib/talpha/tracking-market";
import { classifyByShipment, statusText } from "@/lib/talpha/cod-market";
import {
    buildJtLedger, cleanToken, fetchJtSnapshot, JtTokenExpired, snapshotFromExport, tokenExpiry,
    type JtSnapshot, type VnPosOrder,
} from "@/lib/talpha/jt-vn";
import { readStoreFresh, updateStore } from "@/lib/talpha/store";

export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════
// TIỀN COD VỀ — VIỆT NAM (J&T), 13/11/2026
//
//   GET    ?market=VN[&refresh=1] — số đối soát: kỳ J&T + đơn đang luân chuyển + đối chiếu đơn POS.
//                                   Có token còn hạn và lần kéo trước cũ hơn refresh_after_minutes
//                                   (hoặc refresh=1) thì kéo lại từ J&T; không thì dùng số đã cất.
//   POST   ?market=VN  {export}   — ĐƯỜNG CHÍNH: nạp bản xuất từ trang J&T (ops/jt_vn/load.cjs).
//   POST   ?market=VN  {token}    — đường phụ: token đăng nhập J&T VIP (localStorage.YL_TOKEN), kéo thử ngay.
//   DELETE ?market=VN             — xoá token đã lưu.
// Màn hình KHÔNG có ô dán token (Sỹ Anh bỏ 13/11/2026) — POST / DELETE chỉ chìa nội bộ hoặc giám đốc.
//
// Kho trong app_documents: `jt_vn` (số đã nạp) và `jt_vn_token` (token — KHÔNG BAO GIỜ trả ra ngoài).
// ═══════════════════════════════════════════════════════════════════

type TokenDoc = { token: string | null; het_han: string | null; luu_luc: string | null };
type SnapshotDoc = { du_lieu: JtSnapshot | null; loi: string | null; loi_luc: string | null };
const emptyToken = (): TokenDoc => ({ token: null, het_han: null, luu_luc: null });
const emptySnapshot = (): SnapshotDoc => ({ du_lieu: null, loi: null, loi_luc: null });

const CFG = ((RULES as unknown as { cod_settlement?: { jt_vn?: { from_date?: string; refresh_after_minutes?: number } } })
    .cod_settlement?.jt_vn) || {};
const FROM_DATE = CFG.from_date || "2026-10-15";
const REFRESH_MS = (CFG.refresh_after_minutes ?? 15) * 60_000;

const wrongMarket = (req: NextRequest) => String(req.nextUrl.searchParams.get("market") || "").toUpperCase() !== "VN";
const WRONG_MARKET = { error: "Màn này chỉ cho Việt Nam (market=VN)" };
const tokenValid = (t: TokenDoc, now = Date.now()) => !!t.token && (!t.het_han || Date.parse(t.het_han) > now + 60_000);

/** POST / DELETE: chỉ chìa nội bộ (ops/jt_vn/load.cjs, việc nền) hoặc giám đốc. */
async function canWrite(req: NextRequest) {
    const a = await getAccess(req);
    return !!a?.full && a.kind !== "public";
}
const FORBIDDEN = { error: "Chỉ giám đốc / chìa nội bộ nạp được số J&T" };

async function loadPosOrders(): Promise<VnPosOrder[]> {
    const tm = trackMarket("VN");
    if (tm.code !== "VN") return [];
    const { shipments } = await loadMarketShipments(tm,
        (): { registered: Record<string, never>; statuses: Record<string, unknown> } => ({ registered: {}, statuses: {} }));
    return shipments.map((s) => ({
        order_id: s.order_id, tracking: s.track17_code || "", order_date: s.order_date,
        trang_thai: s.track17_code ? statusText(s.status, s.raw_status) : "Chưa gửi hàng",
        nhom: classifyByShipment(s.status, s.sub_status).nhom,
        cod: Number(s.cod_local) || 0, khach: s.customer || "",
    }));
}

/** Kéo J&T rồi cất; token hết hạn thì đánh dấu hết hạn (để không kéo nữa) nhưng giữ số cũ. */
async function pullAndSave(t: TokenDoc, previous: JtSnapshot | null): Promise<{ du_lieu: JtSnapshot | null; loi: string | null }> {
    try {
        const snapshot = await fetchJtSnapshot(t.token!, FROM_DATE, previous);
        await updateStore<SnapshotDoc>("jt_vn", emptySnapshot(), () => ({ du_lieu: snapshot, loi: null, loi_luc: null }));
        return { du_lieu: snapshot, loi: null };
    } catch (e) {
        const expired = e instanceof JtTokenExpired;
        const error = expired ? "Token J&T đã hết hạn — số dưới đây là lần nạp trước." : `Không kéo được J&T: ${(e as Error).message}`;
        console.error("cod-recon/jt-vn kéo lỗi:", e);
        await updateStore<SnapshotDoc>("jt_vn", emptySnapshot(), (c) => ({ ...c, loi: error, loi_luc: new Date().toISOString() }));
        if (expired) await updateStore<TokenDoc>("jt_vn_token", emptyToken(), (c) => ({ ...c, het_han: new Date().toISOString() }));
        return { du_lieu: previous, loi: error };
    }
}

export async function GET(req: NextRequest) {
    if (wrongMarket(req)) return NextResponse.json(WRONG_MARKET, { status: 400 });
    try {
        const [t, doc] = await Promise.all([
            readStoreFresh<TokenDoc>("jt_vn_token", emptyToken()),
            readStoreFresh<SnapshotDoc>("jt_vn", emptySnapshot()),
        ]);
        let snapshot = doc.du_lieu, error = doc.loi;
        const age = snapshot ? Date.now() - Date.parse(snapshot.keo_luc) : Infinity;
        if (tokenValid(t) && (req.nextUrl.searchParams.get("refresh") === "1" || age > REFRESH_MS)) {
            const r = await pullAndSave(t, snapshot);
            snapshot = r.du_lieu; error = r.loi;
        }
        const pos = await loadPosOrders();
        const t2 = await readStoreFresh<TokenDoc>("jt_vn_token", emptyToken());
        return NextResponse.json({
            so: snapshot ? buildJtLedger(snapshot, pos) : null,
            keo_luc: snapshot?.keo_luc ?? null,
            so_du_cap_nhat: snapshot?.so_du_cap_nhat ?? null,
            tu_ngay: FROM_DATE,
            token: { co: !!t2.token, het_han: t2.het_han, con_han: tokenValid(t2), luu_luc: t2.luu_luc },
            loi: error,
        });
    } catch (e) {
        console.error("cod-recon/jt-vn lỗi:", e);
        return NextResponse.json({ error: "Không đọc được số đối soát J&T" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    if (wrongMarket(req)) return NextResponse.json(WRONG_MARKET, { status: 400 });
    if (!(await canWrite(req))) return NextResponse.json(FORBIDDEN, { status: 403 });
    let body: { token?: string; export?: unknown };
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Thiếu nội dung (export hoặc token)" }, { status: 400 }); }

    // ── Đường chính: bản xuất từ trang J&T ──
    if (body.export !== undefined) {
        let snapshot: JtSnapshot;
        try { snapshot = snapshotFromExport(body.export); }
        catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
        await updateStore<SnapshotDoc>("jt_vn", emptySnapshot(), () => ({ du_lieu: snapshot, loi: null, loi_luc: null }));
        const s = buildJtLedger(snapshot, []);
        return NextResponse.json({
            ok: true, so_ky: snapshot.ky.length, van_don: s.tong.don_da_doi_soat, da_ve: s.tong.da_ve,
            so_du: s.tong.so_du, dang_chay: snapshot.dang_chay.length,
        });
    }

    // ── Đường phụ: token ──
    const token = cleanToken(body.token || "");
    if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) {
        return NextResponse.json({ error: "Đây không giống token J&T (phải là chuỗi dài có 2 dấu chấm)." }, { status: 400 });
    }
    const expiry = tokenExpiry(token);
    if (expiry && Date.parse(expiry) <= Date.now()) {
        return NextResponse.json({ error: "Token này đã hết hạn — đăng nhập lại J&T VIP rồi chép token mới." }, { status: 400 });
    }
    const t: TokenDoc = { token, het_han: expiry, luu_luc: new Date().toISOString() };
    const doc = await readStoreFresh<SnapshotDoc>("jt_vn", emptySnapshot());
    // Kéo thử TRƯỚC khi lưu: token sai thì không đè token đang chạy.
    try {
        const snapshot = await fetchJtSnapshot(token, FROM_DATE, doc.du_lieu);
        await updateStore<TokenDoc>("jt_vn_token", emptyToken(), () => t);
        await updateStore<SnapshotDoc>("jt_vn", emptySnapshot(), () => ({ du_lieu: snapshot, loi: null, loi_luc: null }));
        return NextResponse.json({ ok: true, het_han: expiry, so_ky: snapshot.ky.length, dang_chay: snapshot.dang_chay.length });
    } catch (e) {
        if (e instanceof JtTokenExpired) return NextResponse.json({ error: "J&T không nhận token này (sai hoặc đã hết hạn)." }, { status: 400 });
        console.error("cod-recon/jt-vn POST lỗi:", e);
        return NextResponse.json({ error: `Không kéo được J&T: ${(e as Error).message}` }, { status: 502 });
    }
}

export async function DELETE(req: NextRequest) {
    if (wrongMarket(req)) return NextResponse.json(WRONG_MARKET, { status: 400 });
    if (!(await canWrite(req))) return NextResponse.json(FORBIDDEN, { status: 403 });
    await updateStore<TokenDoc>("jt_vn_token", emptyToken(), () => emptyToken());
    return NextResponse.json({ ok: true });
}
