// node commands.test.js   (không gọi mạng, không cần cài zca-js)
const assert = require("assert");
const { parseCommand, adsHelpMessage, dayBefore } = require("./commands");
const { toZalo } = require("./zalo_text");

const MARKETER_LIST = [
    { key: "Loc", ten: "Lộc" }, { key: "SAnh", ten: "Sỹ Anh" }, { key: "Thai", ten: "Thái" },
    { key: "Thuong", ten: "Thương" }, { key: "Quynh", ten: "Quỳnh" }, { key: "Thang", ten: "Thắng" },
];
const TODAY = "2026-09-15";
const parse = (text) => parseCommand(text, { today: TODAY, nguoi: MARKETER_LIST });

let ok = 0;
const t = (name, actual, expected) => { assert.deepStrictEqual(actual, expected, `${name}: ra ${JSON.stringify(actual)}`); ok++; };

// Không phải lệnh → bot im. Tin báo cáo của chính bot cũng đi qua bộ đọc này.
t("chữ thường không phải lệnh", parse("báo cáo cho anh với"), null);
t("tin báo cáo của bot", parse("🏆 TỔNG TEAM — 14/09\n💰 Tiền ads: 3.317.956đ"), null);
t("lệnh lạ", parse("/kho"), null);
t("/vandon", parse("/vandon"), { lenh: "vandon" });
t("/vd viết tắt, hoa thường", parse(" /VD "), { lenh: "vandon" });
t("/vận đơn có dấu", parse("/vậnđơn"), { lenh: "vandon" });
t("/vandon sg → chỉ Singapore", parse("/vandon sg"), { lenh: "vandon", nuoc: "SG" });
t("/vd Singapore có hoa", parse("/vd Singapore"), { lenh: "vandon", nuoc: "SG" });
t("/vandon đài loan có dấu", parse("/vandon Đài Loan"), { lenh: "vandon", nuoc: "TW" });
t("/vandon uae → chỉ UAE", parse("/vandon uae"), { lenh: "vandon", nuoc: "AE" });
t("/vd Dubai", parse("/vd Dubai"), { lenh: "vandon", nuoc: "AE" });
t("/vandon chữ lạ → lỗi nhưng vẫn là lệnh vận đơn", parse("/vandon abc").lenh, "vandon");
t("rỗng", parse(""), null);

t("/baocao = số hôm nay, đủ tin", parse("/baocao"), { lenh: "baocao", ngay: TODAY, homNay: true, loc: null });
t("/BaoCao hoa thường", parse("  /BaoCao "), { lenh: "baocao", ngay: TODAY, homNay: true, loc: null });
t("/bc viết tắt", parse("/bc"), { lenh: "baocao", ngay: TODAY, homNay: true, loc: null });
t("hôm qua có dấu", parse("/baocao hôm qua"), { lenh: "baocao", ngay: "2026-09-14", homNay: false, loc: null });
t("homqua không dấu", parse("/baocao homqua"), { lenh: "baocao", ngay: "2026-09-14", homNay: false, loc: null });
t("hôm nay ghi rõ", parse("/baocao hôm nay"), { lenh: "baocao", ngay: TODAY, homNay: true, loc: null });
t("ngày dd/mm", parse("/baocao 14/09"), { lenh: "baocao", ngay: "2026-09-14", homNay: false, loc: null });
t("ngày d/m", parse("/baocao 3/9"), { lenh: "baocao", ngay: "2026-09-03", homNay: false, loc: null });
t("ngày có năm", parse("/baocao 30/08/2026"), { lenh: "baocao", ngay: "2026-08-30", homNay: false, loc: null });
t("ngày = hôm nay thì là số đang chạy", parse("/baocao 15/09"), { lenh: "baocao", ngay: TODAY, homNay: true, loc: null });

t("một người, có dấu", parse("/baocao Lộc"), { lenh: "baocao", ngay: TODAY, homNay: true, loc: "Lộc" });
t("một người, không dấu", parse("/baocao thuong"), { lenh: "baocao", ngay: TODAY, homNay: true, loc: "Thương" });
t("Sỹ Anh viết S.Anh", parse("/baocao S.Anh"), { lenh: "baocao", ngay: TODAY, homNay: true, loc: "Sỹ Anh" });
t("Sỹ Anh viết sy anh", parse("/baocao sy anh"), { lenh: "baocao", ngay: TODAY, homNay: true, loc: "Sỹ Anh" });
t("ghép ngày + người", parse("/baocao homqua Thắng"), { lenh: "baocao", ngay: "2026-09-14", homNay: false, loc: "Thắng" });
t("ghép người + ngày", parse("/baocao quỳnh 14/09"), { lenh: "baocao", ngay: "2026-09-14", homNay: false, loc: "Quỳnh" });
t("chỉ TỔNG TEAM", parse("/baocao team"), { lenh: "baocao", ngay: TODAY, homNay: true, loc: "team" });
t("tổng không dấu", parse("/baocao tong homqua"), { lenh: "baocao", ngay: "2026-09-14", homNay: false, loc: "team" });

t("ngày chưa tới", parse("/baocao 16/09"), { loi: "Ngày 16/09 chưa tới — chưa có số." });
t("ngày không có thật", parse("/baocao 31/02"), { loi: "Ngày \"31/02\" không có thật. Viết kiểu /baocao 14/09." });
t("người lạ", parse("/baocao Hùng"), { loi: "Không hiểu \"Hùng\". Gõ /bot xem cách dùng." });

t("/canhbao", parse("/canhbao"), { lenh: "canhbao" });
t("/cảnh báo có dấu", parse("/cảnhbáo"), { lenh: "canhbao" });
t("/bot", parse("/bot"), { lenh: "trogiup" });

t("hôm qua của ngày đầu tháng", dayBefore("2026-10-01"), "2026-09-30");

const helpText = toZalo(adsHelpMessage({ at: "08:30", toi: "22:00", nguoi: MARKETER_LIST })).msg;
assert.ok(helpText.includes("Tự gửi 08:30 (kết quả hôm qua) và 22:00 (kết quả hôm nay)") && helpText.includes("/baocao homqua Lộc") && helpText.includes("/canhbao"), helpText);
ok++;

console.log(`commands.test.js: ${ok}/${ok} PASS`);
