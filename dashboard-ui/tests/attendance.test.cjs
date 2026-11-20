// node tests/attendance.test.cjs (chạy qua npm test — tsc dựng .test-build trước)
// Chấm công online (20/11/2026): IP / dải CIDR, khoảng cách GPS, cách soát any / all, đọc cấu hình, ngày công.
const assert = require("assert");
const R = require("../.test-build/attendance-rules.js");

let ok = 0;
const t = (name, fn) => { try { fn(); ok++; console.log("  ✓", name); } catch (e) { console.error("  ✗", name); throw e; } };

const TZ = "Asia/Ho_Chi_Minh";
const OFFICE = { name: "Văn phòng", lat: 21.028511, lng: 105.804817, radius_m: 150 };
const settings = (o = {}) => ({ ...R.defaultSettings(R.FALLBACK_DEFAULTS), ...o });
// 0.001 độ vĩ ≈ 111 m.
const near = { lat: OFFICE.lat + 0.0005, lng: OFFICE.lng, accuracy_m: 20 };   // ~56 m
const far = { lat: OFFICE.lat + 0.01, lng: OFFICE.lng, accuracy_m: 20 };      // ~1.1 km

console.log("── IP ──");
t("chuẩn hoá IP: IPv4, IPv4 nhúng trong IPv6, có cổng, ngoặc vuông; rác → null", () => {
    assert.strictEqual(R.normalizeIp(" 113.161.1.20 "), "113.161.1.20");
    assert.strictEqual(R.normalizeIp("::ffff:113.161.1.20"), "113.161.1.20");
    assert.strictEqual(R.normalizeIp("113.161.1.20:51234"), "113.161.1.20");
    assert.strictEqual(R.normalizeIp("[2001:db8::1]:443"), "2001:db8::1");
    assert.strictEqual(R.normalizeIp("2001:DB8::1"), "2001:db8::1");
    for (const bad of ["", "abc", "256.1.1.1", "1.2.3", "01.2.3.4", "1::2::3", "unknown"]) assert.strictEqual(R.normalizeIp(bad), null, bad);
});
t("CIDR: một IP, dải /24, IPv6 /48; sai → null", () => {
    assert.strictEqual(R.normalizeCidr("113.161.1.20"), "113.161.1.20");
    assert.strictEqual(R.normalizeCidr("113.161.1.0/24"), "113.161.1.0/24");
    assert.strictEqual(R.normalizeCidr("113.161.1.20/32"), "113.161.1.20");
    assert.strictEqual(R.normalizeCidr("2001:db8:abcd::/48"), "2001:db8:abcd::/48");
    for (const bad of ["113.161.1.0/33", "1.2.3.4/x", "1.2.3.4/24/1", "/24", "2001:db8::/129"]) assert.strictEqual(R.normalizeCidr(bad), null, bad);
});
t("IP thuộc dải: khớp đúng ranh giới, IPv4 không khớp dải IPv6", () => {
    assert.ok(R.ipInCidr("113.161.1.20", "113.161.1.20"));
    assert.ok(!R.ipInCidr("113.161.1.21", "113.161.1.20"));
    assert.ok(R.ipInCidr("113.161.1.255", "113.161.1.0/24"));
    assert.ok(!R.ipInCidr("113.161.2.1", "113.161.1.0/24"));
    assert.ok(R.ipInCidr("10.9.8.7", "0.0.0.0/0"));
    assert.ok(R.ipInCidr("200.1.2.3", "200.0.0.0/8") && !R.ipInCidr("201.1.2.3", "200.0.0.0/8"));
    assert.ok(R.ipInCidr("2001:db8:abcd:12::5", "2001:db8:abcd::/48"));
    assert.ok(!R.ipInCidr("2001:db8:abce::5", "2001:db8:abcd::/48"));
    assert.ok(!R.ipInCidr("113.161.1.20", "2001:db8::/32"));
    assert.ok(R.ipInCidr("::ffff:113.161.1.20", "113.161.1.0/24"));
    assert.ok(!R.ipInCidr(null, "0.0.0.0/0"));
});
t("IP người gọi: X-Real-IP (nginx ghi đè) thắng; không có thì mục CUỐI của X-Forwarded-For", () => {
    const h = (o) => (n) => o[n] ?? null;
    assert.strictEqual(R.clientIpFromHeaders(h({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9, 1.2.3.4" })), "1.2.3.4");
    assert.strictEqual(R.clientIpFromHeaders(h({ "x-forwarded-for": "9.9.9.9, 5.6.7.8" })), "5.6.7.8");
    assert.strictEqual(R.clientIpFromHeaders(h({ "x-forwarded-for": "9.9.9.9, rac" })), "9.9.9.9");
    assert.strictEqual(R.clientIpFromHeaders(h({})), null);
});

console.log("── Vị trí ──");
t("khoảng cách haversine: 0.001 độ vĩ ≈ 111 m; Hà Nội → TP.HCM ≈ 1140 km", () => {
    const d = R.distanceMeters(OFFICE, { lat: OFFICE.lat + 0.001, lng: OFFICE.lng });
    assert.ok(d > 110 && d < 112, d);
    const hn_hcm = R.distanceMeters({ lat: 21.0285, lng: 105.8542 }, { lat: 10.7769, lng: 106.7009 });
    assert.ok(hn_hcm > 1130e3 && hn_hcm < 1150e3, hn_hcm);
});
t("khoảng cách dễ đọc: dưới 1 km ghi mét, xa thì km", () => {
    assert.deepStrictEqual([R.fmtDistance(56.4), R.fmtDistance(999), R.fmtDistance(1112), R.fmtDistance(287595)], ["56 m", "999 m", "1,1 km", "288 km"]);
});
t("đọc toạ độ gửi lên: thiếu / ngoài khoảng → null; sai số âm bỏ", () => {
    assert.deepStrictEqual(R.parseGeo({ lat: "21.5", lng: 105.1, accuracy_m: 12.6 }), { lat: 21.5, lng: 105.1, accuracy_m: 13 });
    assert.deepStrictEqual(R.parseGeo({ lat: 1, lng: 2, accuracy_m: -1 }), { lat: 1, lng: 2, accuracy_m: null });
    assert.strictEqual(R.parseGeo({ lat: 91, lng: 0 }), null);
    assert.strictEqual(R.parseGeo({ lat: 10 }), null);
    assert.strictEqual(R.parseGeo(null), null);
});

console.log("── Soát một lần chấm ──");
const s2 = settings({ networks: [{ name: "Wi-Fi VP", cidr: "113.161.1.0/24" }], locations: [OFFICE] });
t("không bật mục nào: chấm được ở đâu cũng được, vẫn ghi mạng / điểm gần nhất", () => {
    const c = R.evaluatePunch(s2, "8.8.8.8", far);
    assert.strictEqual(c.allowed, true);
    assert.strictEqual(c.ip_ok, null);
    assert.strictEqual(c.location_ok, null);
    assert.strictEqual(c.location_name, "Văn phòng");
    assert.ok(c.distance_m > 1000);
    assert.deepStrictEqual(c.problems, []);
});
t("chỉ soát IP", () => {
    const s = { ...s2, check_ip: true };
    assert.ok(R.evaluatePunch(s, "113.161.1.20", null).allowed);
    const c = R.evaluatePunch(s, "8.8.8.8", near);
    assert.strictEqual(c.allowed, false);
    assert.match(c.problems[0], /8\.8\.8\.8 không thuộc mạng văn phòng/);
    assert.strictEqual(R.evaluatePunch(s, null, near).allowed, false);
});
t("chỉ soát vị trí: trong bán kính, ngoài bán kính, sai số GPS quá lớn, không có vị trí", () => {
    const s = { ...s2, check_location: true };
    const inside = R.evaluatePunch(s, "8.8.8.8", near);
    assert.ok(inside.allowed && inside.location_ok && inside.distance_m < 60, JSON.stringify(inside));
    const out = R.evaluatePunch(s, "113.161.1.20", far);
    assert.ok(!out.allowed && out.location_ok === false);
    assert.match(out.problems[0], /cách Văn phòng 1,1 km — chỉ chấm được trong bán kính 150 m/);
    const blurry = R.evaluatePunch(s, null, { ...near, accuracy_m: 900 });
    assert.ok(!blurry.allowed);
    assert.match(blurry.problems[0], /sai số 900 m/);
    assert.ok(!R.evaluatePunch(s, null, null).allowed);
});
t("nhiều điểm: chọn điểm KHỚP gần nhất, không khớp thì báo điểm gần nhất", () => {
    const branch = { name: "Kho", lat: OFFICE.lat + 0.01, lng: OFFICE.lng, radius_m: 300 };
    const s = { ...s2, check_location: true, locations: [OFFICE, branch] };
    const c = R.evaluatePunch(s, null, far);
    assert.ok(c.allowed);
    assert.strictEqual(c.location_name, "Kho");
    const nowhere = R.evaluatePunch(s, null, { lat: OFFICE.lat - 0.02, lng: OFFICE.lng, accuracy_m: 10 });
    assert.ok(!nowhere.allowed);
    assert.strictEqual(nowhere.location_name, "Văn phòng");
});
t("bật cả hai: any = đạt một là được (vẫn báo mục hỏng); all = phải đạt cả hai", () => {
    const any = { ...s2, check_ip: true, check_location: true, match: "any" };
    const c = R.evaluatePunch(any, "8.8.8.8", near);
    assert.ok(c.allowed && c.ip_ok === false && c.location_ok === true);
    assert.strictEqual(c.problems.length, 1);
    assert.ok(!R.evaluatePunch(any, "8.8.8.8", far).allowed);
    const all = { ...any, match: "all" };
    assert.ok(!R.evaluatePunch(all, "8.8.8.8", near).allowed);
    assert.ok(!R.evaluatePunch(all, "113.161.1.20", far).allowed);
    assert.ok(R.evaluatePunch(all, "113.161.1.20", near).allowed);
});

console.log("── Cấu hình ──");
t("cấu hình hợp lệ: chuẩn hoá CIDR, làm tròn toạ độ, bán kính mặc định, ngày làm sắp xếp", () => {
    const { settings: s, errors } = R.parseSettings({
        check_ip: true, check_location: true, match: "all",
        networks: [{ name: " Wi-Fi  tầng 3 ", cidr: "113.161.1.20/32" }, "14.1.0.0/16"],
        locations: [{ name: "VP", lat: "21.0285111", lng: 105.8048171 }],
        shift_start: "8:30", shift_end: "17:30", grace_minutes: 10, workdays: [6, 1, 1, 2, 9],
    }, R.FALLBACK_DEFAULTS);
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(s.networks, [{ name: "Wi-Fi tầng 3", cidr: "113.161.1.20" }, { name: "Mạng 2", cidr: "14.1.0.0/16" }]);
    assert.deepStrictEqual(s.locations, [{ name: "VP", lat: 21.028511, lng: 105.804817, radius_m: 150 }]);
    assert.strictEqual(s.shift_start, "08:30");
    assert.deepStrictEqual(s.workdays, [1, 2, 6]);
    assert.strictEqual(s.match, "all");
    assert.strictEqual(s.timezone, TZ);
});
t("cấu hình sai: báo đủ lỗi, không lưu được", () => {
    const { errors } = R.parseSettings({
        check_ip: true, check_location: true, networks: [{ name: "A", cidr: "1.2.3" }],
        locations: [{ name: "B", lat: 200, lng: 1 }, { name: "C", lat: 1, lng: 1, radius_m: 5 }],
        shift_start: "18:00", shift_end: "08:00", workdays: [],
    }, R.FALLBACK_DEFAULTS);
    for (const re of [/A: "1\.2\.3" không phải IP/, /B: toạ độ không hợp lệ/, /C: bán kính phải từ 10/,
        /phải khai ít nhất một mạng/, /ít nhất một điểm văn phòng/, /Giờ ra phải sau giờ vào/, /ít nhất một ngày làm việc/]) {
        assert.ok(errors.some((e) => re.test(e)), `thiếu lỗi ${re} trong ${JSON.stringify(errors)}`);
    }
    assert.ok(R.parseSettings({ networks: ["1.2.3.4", "1.2.3.4/32"] }).errors.some((e) => /khai hai lần/.test(e)));
});
t("chưa lưu cấu hình (null) = mặc định, không giới hạn nơi chấm; phần công khai không lộ IP văn phòng", () => {
    const { settings: s, errors } = R.parseSettings(null, R.FALLBACK_DEFAULTS);
    assert.deepStrictEqual(errors, []);
    assert.ok(!s.check_ip && !s.check_location);
    assert.match(R.describeRule(s), /bất kỳ đâu/);
    const pub = R.publicSettings(s2);
    assert.ok(!("networks" in pub));
    assert.deepStrictEqual(pub.network_names, ["Wi-Fi VP"]);
});

console.log("── Ngày công ──");
// 2026-11-20 là thứ Sáu. 08:30 giờ VN = 01:30Z.
const P = (id, kind, iso, o = {}) => ({ id, user_id: "u1", kind, at: iso, work_date: o.work_date || iso.slice(0, 10), source: "self", voided: false, ...o });
// Có tính giờ làm (bật lại được ở talpha_rules.json → attendance.schedule_enabled) — mặc định đang TẮT.
const sd = settings({ schedule_enabled: true });
const sOff = settings();
t("giờ địa phương + thứ trong tuần", () => {
    assert.deepStrictEqual(R.localParts("2026-11-20T01:35:00Z", TZ), { date: "2026-11-20", minutes: 515, hhmm: "08:35", weekday: 5 });
    assert.deepStrictEqual(R.localParts("2026-11-20T17:10:00Z", TZ).date, "2026-11-21");
    assert.strictEqual(R.isoWeekday("2026-11-22"), 7);
    assert.strictEqual(R.isoWeekday("2026-11-23"), 1);
    assert.ok(R.isDate("2026-02-28") && !R.isDate("2026-02-30") && !R.isDate("20-11-2026"));
    assert.ok(R.isMonth("2026-11") && !R.isMonth("2026-13"));
    assert.deepStrictEqual([R.monthDays("2026-02").length, R.monthDays("2028-02").length], [28, 29]);
    assert.deepStrictEqual([R.shiftMonth("2026-01", -1), R.shiftMonth("2026-12", 1)], ["2025-12", "2027-01"]);
});
t("đúng giờ (trễ trong số phút cho phép), đi muộn, về sớm", () => {
    const okDay = R.summarizeDay("2026-11-20", [P(1, "in", "2026-11-20T01:34:00Z"), P(2, "out", "2026-11-20T10:31:00Z")], sd, "2026-11-21", "2026-11-01");
    assert.deepStrictEqual([okDay.status, okDay.in_hhmm, okDay.out_hhmm, okDay.late_minutes, okDay.worked_minutes], ["ok", "08:34", "17:31", 0, 537]);
    const late = R.summarizeDay("2026-11-20", [P(1, "in", "2026-11-20T01:42:00Z"), P(2, "out", "2026-11-20T10:30:00Z")], sd, "2026-11-21", "2026-11-01");
    assert.deepStrictEqual([late.status, late.late_minutes], ["late", 12]);
    const both = R.summarizeDay("2026-11-20", [P(1, "in", "2026-11-20T02:00:00Z"), P(2, "out", "2026-11-20T09:00:00Z")], sd, "2026-11-21", "2026-11-01");
    assert.deepStrictEqual([both.status, both.late_minutes, both.early_minutes], ["late_early", 30, 90]);
});
t("giờ vào = lần vào sớm nhất, giờ ra = lần ra muộn nhất; lần chấm đã huỷ bỏ qua", () => {
    const d = R.summarizeDay("2026-11-20", [
        P(3, "out", "2026-11-20T09:00:00Z"), P(1, "in", "2026-11-20T01:20:00Z"), P(4, "out", "2026-11-20T11:00:00Z"),
        P(5, "out", "2026-11-20T12:00:00Z", { voided: true }),
    ], sd, "2026-11-21", "2026-11-01");
    assert.deepStrictEqual([d.status, d.in_hhmm, d.out_hhmm, d.punch_count], ["ok", "08:20", "18:00", 3]);
});
t("thiếu đầu ra / vào, đang làm, chưa chấm, vắng, nghỉ, chưa tới, trước khi bắt đầu chấm công", () => {
    const inOnly = [P(1, "in", "2026-11-20T01:30:00Z")];
    assert.strictEqual(R.summarizeDay("2026-11-20", inOnly, sd, "2026-11-21", "2026-11-01").status, "missing_out");
    assert.strictEqual(R.summarizeDay("2026-11-20", inOnly, sd, "2026-11-20", "2026-11-01").status, "working");
    assert.strictEqual(R.summarizeDay("2026-11-20", [P(2, "out", "2026-11-20T10:30:00Z")], sd, "2026-11-21", "2026-11-01").status, "missing_in");
    assert.strictEqual(R.summarizeDay("2026-11-20", [], sd, "2026-11-20", "2026-11-01").status, "pending");
    assert.strictEqual(R.summarizeDay("2026-11-19", [], sd, "2026-11-20", "2026-11-01").status, "absent");
    assert.strictEqual(R.summarizeDay("2026-11-22", [], sd, "2026-11-20", "2026-11-01").status, "future");
    assert.strictEqual(R.summarizeDay("2026-11-15", [], sd, "2026-11-20", "2026-11-01").status, "off");   // Chủ nhật
    assert.strictEqual(R.summarizeDay("2026-11-02", [], sd, "2026-11-20", "2026-11-10").status, "untracked");
    assert.strictEqual(R.summarizeDay("2026-11-02", [], sd, "2026-11-20", null).status, "untracked");
    const sunday = R.summarizeDay("2026-11-15", [P(1, "in", "2026-11-15T03:00:00Z"), P(2, "out", "2026-11-15T06:00:00Z")], sd, "2026-11-20", "2026-11-01");
    assert.deepStrictEqual([sunday.status, sunday.late_minutes, sunday.worked_minutes], ["off_worked", 0, 180]);
});
t("tổng tháng: đếm ngày làm từ ngày bắt đầu, có mặt, muộn, thiếu, vắng", () => {
    const punches = [
        P(1, "in", "2026-11-16T01:30:00Z"), P(2, "out", "2026-11-16T10:30:00Z"),     // T2 đúng giờ
        P(3, "in", "2026-11-17T02:00:00Z"), P(4, "out", "2026-11-17T10:30:00Z"),     // T3 muộn 30'
        P(5, "in", "2026-11-18T01:30:00Z"),                                          // T4 thiếu ra
        // T5 19/11 vắng
        P(6, "in", "2026-11-20T01:40:00Z"),                                          // T6 hôm nay đang làm, muộn 10'
    ];
    const { days, totals } = R.summarizeMonth("2026-11", punches, sd, "2026-11-20", "2026-11-16");
    assert.strictEqual(days.length, 30);
    assert.deepStrictEqual(
        [totals.workdays, totals.present, totals.on_time, totals.late, totals.missing, totals.absent, totals.late_minutes],
        [5, 4, 1, 2, 1, 1, 40]);
    assert.strictEqual(days[0].status, "off");          // 01/11 Chủ nhật
    assert.strictEqual(days[1].status, "untracked");    // 02/11 trước ngày bắt đầu
});

console.log("── Thao tác ──");
t("đọc thao tác: check / punch / manual / void", () => {
    assert.deepStrictEqual(R.parseAttendanceAction({ action: "check", geo: { lat: 1, lng: 2 } }), { action: "check", geo: { lat: 1, lng: 2, accuracy_m: null } });
    assert.deepStrictEqual(R.parseAttendanceAction({ action: "punch", kind: "in" }), { action: "punch", kind: "in", geo: null });
    assert.ok("error" in R.parseAttendanceAction({ action: "punch", kind: "giua" }));
    assert.deepStrictEqual(
        R.parseAttendanceAction({ action: "manual", user_id: "u1", kind: "out", date: "2026-11-19", time: "17:30", note: " quên  chấm " }),
        { action: "manual", user_id: "u1", kind: "out", date: "2026-11-19", time: "17:30", note: "quên chấm" });
    assert.match(R.parseAttendanceAction({ action: "manual", user_id: "u1", kind: "out", date: "2026-11-19", time: "17:30" }).error, /lý do/);
    assert.ok("error" in R.parseAttendanceAction({ action: "manual", user_id: "u1", kind: "in", date: "2026-02-30", time: "08:00", note: "x" }));
    assert.deepStrictEqual(R.parseAttendanceAction({ action: "void", punch_id: "7", reason: "bấm nhầm" }), { action: "void", punch_id: 7, reason: "bấm nhầm" });
    assert.ok("error" in R.parseAttendanceAction({ action: "void", punch_id: 7 }));
    assert.ok("error" in R.parseAttendanceAction({ action: "xoa" }));
    assert.ok("error" in R.parseAttendanceAction(null));
});
t("vào / ra XEN KẼ: chấm ra rồi thì lần kế tiếp là chấm vào; lần vào đã huỷ thì vào lại được", () => {
    const vao = P(1, "in", "2026-11-20T01:30:00Z");
    const ra = P(2, "out", "2026-11-20T05:00:00Z");
    assert.ok(R.punchAllowed("in", [], TZ).ok);
    assert.match(R.punchAllowed("out", [], TZ).error, /chưa chấm vào/);
    assert.match(R.punchAllowed("in", [vao], TZ).error, /đang trong ca từ 08:30/);
    assert.ok(R.punchAllowed("out", [vao], TZ).ok);
    assert.ok(R.punchAllowed("in", [vao, ra], TZ).ok);                    // ca 2
    assert.match(R.punchAllowed("out", [ra, vao], TZ).error, /đã chấm ra lúc 12:00/);   // xếp theo giờ, không theo thứ tự mảng
    assert.ok(R.punchAllowed("out", [vao, ra, P(3, "in", "2026-11-20T06:00:00Z")], TZ).ok);
    assert.ok(R.punchAllowed("in", [{ ...vao, voided: true }], TZ).ok);
    assert.strictEqual(R.nextPunchKind({ open: true }), "out");
    assert.strictEqual(R.nextPunchKind({ open: false }), "in");
});
t("nhiều ca một ngày: giờ làm = tổng các ca đã đóng; đang trong ca thì giờ ra trống", () => {
    const ca = [
        P(1, "in", "2026-11-20T01:00:00Z"), P(2, "out", "2026-11-20T05:00:00Z"),     // 08:00–12:00
        P(3, "in", "2026-11-20T06:00:00Z"), P(4, "out", "2026-11-20T10:30:00Z"),     // 13:00–17:30
    ];
    const d = R.summarizeDay("2026-11-20", ca, sOff, "2026-11-21", "2026-11-01");
    assert.deepStrictEqual([d.status, d.in_hhmm, d.out_hhmm, d.worked_minutes, d.open], ["done", "08:00", "17:30", 510, false]);
    assert.deepStrictEqual(d.sessions.map((x) => [x.in_hhmm, x.out_hhmm, x.minutes]), [["08:00", "12:00", 240], ["13:00", "17:30", 270]]);
    const dangLam = R.summarizeDay("2026-11-20", ca.slice(0, 3), sOff, "2026-11-20", "2026-11-01");
    assert.deepStrictEqual([dangLam.status, dangLam.open, dangLam.open_since, dangLam.out_hhmm, dangLam.worked_minutes],
        ["working", true, "2026-11-20T06:00:00Z", null, 240]);
    // Quên chấm ra ca 2 → ngày đã qua là thiếu giờ ra, vẫn giữ 4 giờ của ca 1.
    const quen = R.summarizeDay("2026-11-20", ca.slice(0, 3), sOff, "2026-11-21", "2026-11-01");
    assert.deepStrictEqual([quen.status, quen.worked_minutes], ["missing_out", 240]);
});
t("không tính giờ làm: không muộn / sớm / vắng / ngày nghỉ — chỉ đủ vào – ra, đang làm, thiếu chấm, chưa chấm", () => {
    const muon = R.summarizeDay("2026-11-20", [P(1, "in", "2026-11-20T04:00:00Z"), P(2, "out", "2026-11-20T06:00:00Z")], sOff, "2026-11-21", "2026-11-01");
    assert.deepStrictEqual([muon.status, muon.late_minutes, muon.early_minutes], ["done", 0, 0]);
    assert.strictEqual(R.summarizeDay("2026-11-19", [], sOff, "2026-11-20", "2026-11-01").status, "none");
    assert.strictEqual(R.summarizeDay("2026-11-15", [], sOff, "2026-11-20", "2026-11-01").status, "none");      // Chủ nhật
    assert.strictEqual(R.summarizeDay("2026-11-20", [], sOff, "2026-11-20", "2026-11-01").status, "pending");
    const cn = R.summarizeDay("2026-11-15", [P(1, "in", "2026-11-15T03:00:00Z"), P(2, "out", "2026-11-15T06:00:00Z")], sOff, "2026-11-20", "2026-11-01");
    assert.strictEqual(cn.status, "done");
    const { totals } = R.summarizeMonth("2026-11", [
        P(1, "in", "2026-11-16T01:30:00Z"), P(2, "out", "2026-11-16T10:30:00Z"),
        P(3, "in", "2026-11-18T03:00:00Z"),
    ], sOff, "2026-11-20", "2026-11-16");
    assert.deepStrictEqual([totals.workdays, totals.present, totals.missing, totals.absent, totals.late, totals.worked_minutes], [0, 2, 1, 0, 0, 540]);
});

console.log(`\n${ok} phép thử chấm công qua`);
