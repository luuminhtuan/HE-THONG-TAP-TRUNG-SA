// Chữ đậm/nghiêng và chia tin dài cho Zalo.
//
// Zalo không đọc markdown: gửi "*Tiền ads*" là cả nhóm thấy nguyên hai dấu sao. Chữ đậm
// phải đi thành DẢI STYLE riêng — vị trí bắt đầu + độ dài — kèm theo chữ trơn.
//
// Bản tin dựng bằng B("...") và I("..."): hai hàm này bọc chữ bằng ký tự vùng Unicode
// dùng riêng (không bàn phím nào gõ ra), rồi toZalo() đổi thành chữ trơn + dải style.
// KHÔNG dùng * và _ làm cờ như bản WhatsApp: tên campaign, tên trang có dấu gạch dưới
// là cả đoạn phía sau nghiêng loạn.
//
// Vị trí tính theo đơn vị UTF-16 (chính là String.length của JS) — cùng cách zca-js tính
// vị trí @nhắc tên. Emoji chiếm 2 đơn vị.

const BO = "", BC = "", IO = "", IC = "";
// Nhắc tên (@Thương): MO + uid + MS + chữ hiện ra + MC. Viết bằng mã \u để khỏi lẫn với
// bốn cờ chữ đậm/nghiêng ở trên (ký tự vùng riêng, không hiện trên màn hình).
const MO = "\uE004", MS = "\uE005", MC = "\uE006";
const MARKER_RE = /[\uE000-\uE006]/g;

// TextStyle.Bold = "b", TextStyle.Italic = "i" trong zca-js. Ghi thẳng chữ để file này
// test được mà không cần cài zca-js.
const ST = { [BO]: "b", [IO]: "i" };
const CLOSE_TO_OPEN = { [BC]: BO, [IC]: IO };

const clean = (s) => String(s ?? "").replace(MARKER_RE, "");
const B = (s) => BO + clean(s) + BC;
const I = (s) => IO + clean(s) + IC;
/** Nhắc tên người trong nhóm — điện thoại người đó báo. Không có uid thì chỉ là chữ thường. */
const M = (name, uid) => {
    const label = "@" + clean(name).replace(/^@/, "");
    return uid ? MO + String(uid).replace(/\D/g, "") + MS + label + MC : label;
};

/**
 * Chuỗi có cờ B()/I()/M() → { msg: chữ trơn, styles: [{start, len, st}],
 * mentions: [{pos, len, uid}] }.
 */
function toZalo(text) {
    let msg = "";
    const styles = [];
    const mentions = [];
    const openAt = {};                                   // cờ mở → vị trí bắt đầu
    let uid = null, readingUid = false, mentionStart = null;
    for (const ch of String(text ?? "")) {
        if (ch === MO) { readingUid = true; uid = ""; continue; }
        if (readingUid) {
            if (ch === MS) { readingUid = false; mentionStart = msg.length; } else uid += ch;
            continue;
        }
        if (ch === MC) {
            if (mentionStart != null && uid && msg.length > mentionStart) mentions.push({ pos: mentionStart, len: msg.length - mentionStart, uid });
            mentionStart = null; uid = null;
            continue;
        }
        if (ch in ST) { openAt[ch] = msg.length; continue; }
        if (ch in CLOSE_TO_OPEN) {
            const opener = CLOSE_TO_OPEN[ch];
            if (openAt[opener] != null && msg.length > openAt[opener]) {
                styles.push({ start: openAt[opener], len: msg.length - openAt[opener], st: ST[opener] });
            }
            openAt[opener] = null;
            continue;
        }
        msg += ch;
    }
    styles.sort((a, b) => a.start - b.start);
    // Không nhắc ai thì không có khoá mentions — giữ nguyên hình dạng cũ cho tin ads.
    return mentions.length ? { msg, styles, mentions } : { msg, styles };
}

// Cắt ở dòng trống gần nhất trước giới hạn; không có thì ở xuống dòng; không có nữa thì
// cắt cứng nhưng không xẻ đôi một emoji (cặp surrogate).
function findCutPoint(msg, offset, max) {
    const chunk = msg.slice(offset, offset + max);
    let cut = chunk.lastIndexOf("\n\n");
    if (cut < max / 2) cut = chunk.lastIndexOf("\n");
    if (cut <= 0) {
        cut = max;
        const c = msg.charCodeAt(offset + cut - 1);
        if (c >= 0xd800 && c <= 0xdbff) cut--;
    }
    return offset + cut;
}

/** { msg, styles, mentions } dài quá max → nhiều tin, mỗi tin mang đúng phần style/nhắc tên của nó. */
function splitMessage({ msg, styles, mentions = [] }, max = 1800) {
    if (msg.length <= max) return [{ msg, styles, mentions }];
    const ranges = [];
    let offset = 0;
    while (msg.length - offset > max) {
        const cutAt = findCutPoint(msg, offset, max);
        ranges.push([offset, cutAt]);
        offset = cutAt;
        while (msg[offset] === "\n") offset++;
    }
    if (offset < msg.length) ranges.push([offset, msg.length]);

    return ranges.map(([a, z]) => {
        const part = msg.slice(a, z).replace(/\s+$/, "");
        const partEnd = a + part.length;
        const st = [];
        for (const s of styles) {
            const overlapStart = Math.max(s.start, a), overlapEnd = Math.min(s.start + s.len, partEnd);
            if (overlapEnd > overlapStart) st.push({ start: overlapStart - a, len: overlapEnd - overlapStart, st: s.st });
        }
        // Nhắc tên không xẻ đôi được: chỉ giữ cái nằm trọn trong phần này.
        const mt = mentions.filter((x) => x.pos >= a && x.pos + x.len <= partEnd).map((x) => ({ ...x, pos: x.pos - a }));
        return { msg: part, styles: st, mentions: mt };
    });
}

module.exports = { B, I, M, clean, toZalo, splitMessage };
