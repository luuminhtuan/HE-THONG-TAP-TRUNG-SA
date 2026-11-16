#!/usr/bin/env node
/**
 * Nạp số J&T VIP vào dashboard (kho `jt_vn` trong Postgres, bảng app_documents) từ file
 * jt_vn_raw.json do ops/jt_vn/export-from-jt-page.js tải về.
 *
 *   node ops/jt_vn/load.cjs ~/Downloads/jt_vn_raw.json
 *   TALPHA_DASHBOARD_URL=https://<máy chủ> node ops/jt_vn/load.cjs ~/Downloads/jt_vn_raw.json
 *
 * Gửi lên POST /api/talpha/cod-recon/jt-vn?market=VN bằng chìa nội bộ (header x-talpha-token):
 * TALPHA_INTERNAL_TOKEN nếu có, không thì đọc data/.internal_token của repo này — chạy trên CHÍNH
 * máy chạy dashboard thì không cần đặt gì. Dashboard dựng lại số (lib/talpha/jt-vn.ts →
 * snapshotFromExport) rồi cất; mở lại màn Tiền COD về → Việt Nam là thấy, không cần khởi động lại.
 */
const fs = require("fs");
const path = require("path");

const BASE = String(process.env.TALPHA_DASHBOARD_URL || "http://localhost:3200").replace(/\/+$/, "");

function internalToken() {
    if (process.env.TALPHA_INTERNAL_TOKEN) return process.env.TALPHA_INTERNAL_TOKEN.trim();
    const file = path.join(__dirname, "..", "..", "data", ".internal_token");
    try { return fs.readFileSync(file, "utf8").trim(); }
    catch { throw new Error(`Không có chìa nội bộ: đặt TALPHA_INTERNAL_TOKEN hoặc chạy trên máy có ${file}`); }
}

async function main() {
    const [input] = process.argv.slice(2);
    if (!input) { console.error("Dùng: node ops/jt_vn/load.cjs <jt_vn_raw.json>"); process.exit(1); }
    const exported = JSON.parse(fs.readFileSync(input, "utf-8"));
    const r = await fetch(`${BASE}/api/talpha/cod-recon/jt-vn?market=VN`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-talpha-token": internalToken() },
        body: JSON.stringify({ export: exported }),
        signal: AbortSignal.timeout(60_000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    const vnd = (n) => (n == null ? "?" : Number(n).toLocaleString("vi-VN"));
    console.log(`Đã nạp vào ${BASE}: ${j.so_ky} kỳ, ${j.van_don} vận đơn, đã chuyển về ${vnd(j.da_ve)}đ, ` +
        `số dư ${vnd(j.so_du)}đ, đang luân chuyển ${j.dang_chay} đơn.`);
}

main().catch((e) => { console.error("Nạp số J&T lỗi:", e.message); process.exit(1); });
