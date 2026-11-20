// Lấy vị trí hiện tại từ trình duyệt (chấm công — tab Chấm công và /admin → Chấm công). Chỉ chạy ở trình duyệt.
// Trình duyệt chỉ cho định vị trên trang HTTPS (hoặc localhost) — máy chủ chạy https://<IP> qua nginx.

export type GeoFix = { lat: number; lng: number; accuracy_m: number };

export function getCurrentPosition(timeoutMs = 20_000): Promise<GeoFix> {
    return new Promise((resolve, reject) => {
        if (typeof window === "undefined" || !navigator.geolocation) {
            reject(new Error("Trình duyệt này không hỗ trợ định vị"));
            return;
        }
        if (!window.isSecureContext) {
            reject(new Error("Trình duyệt chỉ cho lấy vị trí trên trang https:// — mở dashboard bằng địa chỉ https"));
            return;
        }
        // Hạn riêng: `timeout` của trình duyệt chỉ tính SAU khi người dùng trả lời hộp hỏi quyền — không ai bấm "Cho phép"
        // thì lời gọi treo mãi, khung chấm công đứng ở "Đang kiểm tra…".
        let settled = false;
        const deadline = setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(new Error("Chưa lấy được vị trí — bấm \"Cho phép\" ở thông báo vị trí của trình duyệt (cạnh thanh địa chỉ) rồi thử lại"));
        }, timeoutMs + 5_000);
        const done = (fn: () => void) => { if (settled) return; settled = true; clearTimeout(deadline); fn(); };
        navigator.geolocation.getCurrentPosition(
            (p) => done(() => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy_m: Math.round(p.coords.accuracy) })),
            (e) => done(() => reject(new Error(
                e.code === e.PERMISSION_DENIED
                    ? "Bạn đang chặn quyền vị trí — bấm biểu tượng ổ khoá cạnh địa chỉ trang, cho phép Vị trí rồi thử lại"
                    : e.code === e.POSITION_UNAVAILABLE
                        ? "Máy không xác định được vị trí — bật GPS / Wi-Fi rồi thử lại"
                        : "Lấy vị trí quá lâu — thử lại"))),
            { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 10_000 },
        );
    });
}
