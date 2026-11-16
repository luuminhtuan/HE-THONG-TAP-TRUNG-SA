import { NextResponse } from "next/server";
import {
    buildAlerts, carrierFor, countByStatus, mergeStatus, planRegister, planTrack, TERMINAL,
    type Shipment, type TrackMarket,
} from "@/lib/talpha/tracking";
import {
    apiKeys, allocateToKeys, register, changeCarrier, getTrackInfo, getQuota, Track17Error,
    ERR_ALREADY_REGISTERED, ERR_QUOTA_OUT, type ApiKey, type Quota, type RegisterResult, type TrackInfo,
} from "@/lib/talpha/track17";
import { readStoreFresh, updateStore } from "@/lib/talpha/store";
import { envWithCredentials } from "@/lib/talpha/credentials";
import { clean, emptyStore, sumQuotas, type KeySync, type LastSync, type Store } from "./store-types";
import { loadShipments } from "./load-shipments";

/**
 * POST của Đài / Singapore (nước theo dõi bằng 17TRACK): đăng ký mã mới (TỐN QUOTA) rồi hỏi
 * trạng thái (miễn phí). Xem chú thích đầu route.ts.
 */
export async function sync17Track(mk: TrackMarket, from: string, to: string) {
    const STORE = mk.store;
    const keys = apiKeys(envWithCredentials());
    if (!keys.length) {
        return NextResponse.json({
            error: "Chưa có khoá 17TRACK. Lấy ở 17track.net/en/api rồi nhập ở Quản trị → Khoá kết nối.",
        }, { status: 428 });
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const recordRun = (x: LastSync) => updateStore<Store>(STORE, emptyStore(), (cur) => { cur.last_sync = x; return cur; });
    // Một khoá hỏng (hết hạn, bị khoá) KHÔNG làm hỏng cả lượt — ghi lại rồi chạy tiếp khoá khác.
    const syncByKey = new Map<string, KeySync>(keys.map((k) => [k.id, { label: k.label, ok: true }]));
    const markKeyFailed = (k: ApiKey, e: unknown) => {
        const x = syncByKey.get(k.id)!;
        x.ok = false;
        x.error = e instanceof Error ? e.message : String(e);
        console.warn(`17TRACK ${k.label} lỗi:`, x.error);
    };
    // Lỗi giữa chừng vẫn giữ phần đã xong (batched gắn vào e.partial) — mã đã đăng ký
    // ở lô trước là quota đã trừ, phải ghi sổ.
    const partialOr = <T>(e: unknown, fallback: T): T =>
        e instanceof Track17Error && e.partial ? (e.partial as T) : fallback;

    try {
        // ── 0. Sổ cũ (lúc mới có MỘT khoá) chưa ghi khoá nào → của khoá 1 ──
        await updateStore<Store>(STORE, emptyStore(), (cur) => {
            for (const r of Object.values(cur.registered)) if (!r.key_id) r.key_id = keys[0].id;
            return cur;
        });

        const { shipments } = await loadShipments(mk, from, to);
        const byNumber = new Map<string, Shipment[]>();
        for (const s of shipments) {
            if (!s.track17_code) continue;
            const l = byNumber.get(s.track17_code);
            if (l) l.push(s); else byNumber.set(s.track17_code, [s]);
        }

        // Hỏi quota từng khoá TRƯỚC (miễn phí) để không bao giờ gửi quá số còn lại: gửi quá
        // thì 17TRACK từ chối phần thừa — mà phần thừa có khi lại là đơn gấp nhất.
        const quotas = new Map<string, Quota | null>();
        for (const k of keys) {
            try { quotas.set(k.id, await getQuota(k)); } catch (e) { quotas.set(k.id, null); markKeyFailed(k, e); }
        }
        const totalQuota = sumQuotas([...quotas.values()].filter((q): q is Quota => !!q));
        const plan = planRegister(shipments, now, {
            quotaRemain: totalQuota?.remain ?? null, quotaTotal: totalQuota?.total ?? null, staleDays: mk.stale_days,
        });

        // ── 1. Đăng ký mã mới (TỐN QUOTA) — chia cho các khoá theo quota còn lại ──
        // Sổ đăng ký là nơi DUY NHẤT biết mã nào đã có chủ: planRegister bỏ mọi mã đã nằm
        // trong sổ dù thuộc khoá nào, nên một mã không bao giờ bị hai khoá cùng đăng ký.
        let registered = 0;
        const rejected: { number: string; code: number; message: string }[] = [];
        const justRegistered = new Set<string>();
        const allocation = allocateToKeys(plan.pick, keys.map((k) => ({ id: k.id, remain: quotas.get(k.id)?.remain ?? null })));
        for (const k of keys) {
            const batch = allocation.get(k.id);
            if (!batch?.length) continue;
            const numbers = batch.map((s) => s.track17_code as string);
            const tags = Object.fromEntries(batch.filter((s) => s.order_id).map((s) => [s.track17_code as string, s.order_id]));
            let r: RegisterResult;
            try { r = await register(k, numbers, tags, mk.code); }
            catch (e) { markKeyFailed(k, e); r = partialOr(e, { accepted: [], rejected: [] }); }
            const newlyAccepted = new Map<string, number | null>();
            for (const a of r.accepted) newlyAccepted.set(clean(a.number), a.carrier || null);
            for (const x of r.rejected) {
                // Đã đăng ký từ trước ở CHÍNH khoá này (lượt trước chết giữa chừng) —
                // 17TRACK KHÔNG trừ quota lần này, chỉ cần ghi sổ lại cho khớp.
                if (x.code === ERR_ALREADY_REGISTERED) newlyAccepted.set(clean(x.number), null);
                else rejected.push(x);
            }
            registered += r.accepted.length;
            syncByKey.get(k.id)!.registered = r.accepted.length;

            // Ghi sổ NGAY: quota đã bị trừ rồi, mất sổ là lần sau trừ lần nữa.
            if (newlyAccepted.size) {
                for (const n of newlyAccepted.keys()) justRegistered.add(n);
                await updateStore<Store>(STORE, emptyStore(), (cur) => {
                    for (const [n, carrier] of newlyAccepted) {
                        for (const s of byNumber.get(n) || []) {
                            cur.registered[s.tracking] = {
                                order_uid: s.order_uid, registered_at: nowIso, carrier, number: n, key_id: k.id,
                            };
                        }
                    }
                    return cur;
                });
            }
        }

        // ── 1b. Đổi hãng cho mã 17TRACK đoán nhầm (không trừ quota), bằng khoá của mã ──
        // Lượt đầu 25/09/2026 để 17TRACK tự đoán: 7 mã FamilyMart thành Bưu điện Ý. Mã
        // đăng ký rồi không đăng ký lại được, chỉ đổi hãng — thử tối đa 2 lần mỗi mã.
        const MAX_CARRIER_CHANGES = 2;
        const registry = await readStoreFresh<Store>(STORE, emptyStore());
        const carrierChanges = new Map<string, Map<string, { number: string; carrier_old: number; carrier_new: number }>>();
        for (const r of Object.values(registry.registered)) {
            const want = carrierFor(r.number, mk.code);
            if (!r.number || !r.key_id || !want || !r.carrier || r.carrier === want) continue;
            if ((r.carrier_changes ?? 0) >= MAX_CARRIER_CHANGES) continue;
            if (!carrierChanges.has(r.key_id)) carrierChanges.set(r.key_id, new Map());
            carrierChanges.get(r.key_id)!.set(r.number, { number: r.number, carrier_old: r.carrier, carrier_new: want });
        }
        let carrierFixed = 0;
        for (const k of keys) {
            const items = carrierChanges.get(k.id);
            if (!items?.size) continue;
            let r: RegisterResult;
            try { r = await changeCarrier(k, [...items.values()]); }
            catch (e) { markKeyFailed(k, e); r = partialOr(e, { accepted: [], rejected: [] }); }
            const ok = new Set(r.accepted.map((a) => clean(a.number)));
            carrierFixed += ok.size;
            await updateStore<Store>(STORE, emptyStore(), (cur) => {
                for (const reg of Object.values(cur.registered)) {
                    const d = reg.key_id === k.id && reg.number ? items.get(reg.number) : undefined;
                    if (!d) continue;
                    reg.carrier_changes = (reg.carrier_changes ?? 0) + 1;
                    if (ok.has(d.number)) reg.carrier = d.carrier_new;
                }
                return cur;
            });
        }

        // ── 2. Hỏi trạng thái (miễn phí) — mỗi khoá chỉ hỏi mã của chính nó ──
        const latestRegistry = await readStoreFresh<Store>(STORE, emptyStore());
        const keyByNumber = new Map<string, string>();
        for (const r of Object.values(latestRegistry.registered)) if (r.number && r.key_id) keyByNumber.set(r.number, r.key_id);
        const activeKeyIds = new Set(keys.map((k) => k.id));
        const numbersByKey = new Map<string, string[]>();
        let orphaned = 0;
        for (const n of planTrack(shipments, justRegistered)) {
            const kid = keyByNumber.get(n);
            if (!kid || !activeKeyIds.has(kid)) { orphaned++; continue; }
            if (!numbersByKey.has(kid)) numbersByKey.set(kid, []);
            numbersByKey.get(kid)!.push(n);
        }
        const found: TrackInfo[] = [];
        const trackRejected: { number: string; message: string }[] = [];
        for (const k of keys) {
            const ns = numbersByKey.get(k.id);
            if (!ns?.length) continue;
            let r: { found: TrackInfo[]; rejected: { number: string; message: string }[] };
            try { r = await getTrackInfo(k, ns); }
            catch (e) { markKeyFailed(k, e); r = partialOr(e, { found: [], rejected: [] }); }
            found.push(...r.found);
            trackRejected.push(...r.rejected);
            syncByKey.get(k.id)!.checked = r.found.length;
        }

        let changed = 0;
        await updateStore<Store>(STORE, emptyStore(), (cur) => {
            for (const t of found) {
                for (const s of byNumber.get(clean(t.number)) || []) {
                    // Sổ chưa biết hãng (mã đăng ký từ trước, 17TRACK báo "đã đăng ký") thì
                    // học từ đây — lượt sau mới soát được hãng có đúng luật không.
                    const reg = cur.registered[s.tracking];
                    if (reg && !reg.carrier && t.carrier) reg.carrier = t.carrier;
                    // 17TRACK chưa có tin (vừa đăng ký, chưa nhận ra hãng) thì giữ trạng thái
                    // đối tác — ghi "NotFound" đè lên là mất luôn "đang ở cửa hàng", và lần
                    // nạp file sau cũng không sửa lại được vì nguồn đã thành 17track.
                    if (!t.status || t.status === "NotFound") continue;
                    const prev = cur.statuses[s.tracking];
                    // Đơn đối tác đã báo KẾT THÚC (hoàn, huỷ…) thì 17TRACK không kéo lùi —
                    // chỉ lưu bên cạnh để đối chiếu (buildAlerts báo khi lệch kiểu mất tiền).
                    if (prev?.status && TERMINAL.has(prev.status) && prev.source !== "17track") {
                        cur.statuses[s.tracking] = {
                            ...prev, t17_status: t.status, t17_sub_status: t.sub_status,
                            t17_event: t.last_event, t17_at: nowIso,
                        };
                        continue;
                    }
                    // Lần đầu 17TRACK có tin cho đơn này: đồng hồ lấy mốc của 17TRACK,
                    // không kế thừa mốc "lúc ta nhìn thấy" của file đối tác.
                    const m = mergeStatus(prev?.source === "17track" ? prev : undefined, t, now);
                    if (prev?.status !== m.status) changed++;
                    // Đánh dấu nguồn 17track: lần nhập file đối tác sau sẽ KHÔNG ghi
                    // đè, vì file trễ 2 ngày còn 17TRACK gần thời gian thực.
                    cur.statuses[s.tracking] = { ...prev, ...m, source: "17track" };
                }
            }
            return cur;
        });

        // ── 3. Quota sau lượt này (miễn phí) — hỏng thì giữ số hỏi lúc đầu ──
        for (const k of keys) {
            if (!syncByKey.get(k.id)!.registered && quotas.get(k.id)) continue;
            try { quotas.set(k.id, await getQuota(k)); } catch { /* giữ số cũ */ }
        }
        for (const k of keys) syncByKey.get(k.id)!.quota = quotas.get(k.id) ?? null;
        const keySyncs = [...syncByKey.values()];
        // MỌI khoá đều hỏng thì lượt này hỏng thật — báo lỗi, không báo "cập nhật xong".
        if (keySyncs.every((x) => !x.ok)) throw new Track17Error(keySyncs.map((x) => `${x.label}: ${x.error}`).join(" · "));

        const quota = sumQuotas([...quotas.values()].filter((q): q is Quota => !!q));
        // Hết quota = còn đơn CẦN XỬ LÝ mà không đăng ký được (gói miễn phí: hết tháng).
        const quotaOut = rejected.some((x) => x.code === ERR_QUOTA_OUT) || plan.quota_limited;
        await recordRun({
            at: nowIso, ok: true, registered, checked: found.length, changed, carrier_fixed: carrierFixed,
            register_rejected: rejected.length, over_cap: plan.over_cap, deferred: plan.deferred,
            quota_out: quotaOut, quota, keys: keySyncs, orphaned,
        });

        const { shipments: after } = await loadShipments(mk, from, to);
        return NextResponse.json({
            ok: true,
            registered,
            register_rejected: rejected.map((x) => ({ number: x.number, message: x.message })),
            over_cap: plan.over_cap,
            deferred: plan.deferred,
            quota_out: quotaOut,
            quota,
            keys: keySyncs,
            orphaned,
            checked: found.length,
            carrier_fixed: carrierFixed,
            track_rejected: trackRejected.map((x) => ({ number: x.number, message: x.message })),
            status_changed: changed,
            alerts: buildAlerts(after, now, { staleDays: mk.stale_days }),
            counts: countByStatus(after),
        });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await recordRun({ at: nowIso, ok: false, error: msg, keys: [...syncByKey.values()] }).catch(() => {});
        if (e instanceof Track17Error) {
            return NextResponse.json({ error: e.message }, { status: e.code === 429 ? 429 : 502 });
        }
        console.error("tracking POST lỗi:", e);
        return NextResponse.json({ error: "Đồng bộ thất bại" }, { status: 500 });
    }
}
