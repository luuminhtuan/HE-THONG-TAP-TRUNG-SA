// Mã sản phẩm trong tên campaign — hàm thuần, tách khỏi rules.ts (16/11/2026). KHÔNG đọc RULES và
// không nhập rules.ts (rules.ts re-export nguyên tên — nơi khác vẫn nhập từ "./rules").

// ═══════════════════════════════════════════════════════════════════
// MÃ SẢN PHẨM trong tên campaign
//
// Ô thứ tư theo chuẩn, dạng "042-BLACK" hay "040 - VONGVANG1" — ba số đầu là mã
// SKU, phần sau là biến thể. Bóc được mã này thì nối được CHI PHÍ QUẢNG CÁO với
// GIÁ VỐN của chính sản phẩm đó, tức là tính được lãi lỗ tới từng mã hàng chứ
// không chỉ tổng.
//
// Nhận bằng HÌNH DẠNG (ba số rồi tới ký tự không phải số) chứ không bằng vị trí,
// nên đọc được cả tên cũ đặt khác thứ tự. Ngày kiểu "2808" bốn số liền không bị
// bắt nhầm vì sau ba số đầu vẫn là số.
// ═══════════════════════════════════════════════════════════════════
const SKU_RE = /^(\d{3})(?![0-9])/;

/** Ô sản phẩm → mã SKU ba số. Không thấy thì null, KHÔNG đoán. */
export function parseProductCode(cn?: string | null): string | null {
    for (const seg of String(cn || "").split("/")) {
        const m = seg.trim().match(SKU_RE);
        if (m) return m[1];
    }
    return null;
}

/**
 * Ô mã sản phẩm ghi "TEST" — đang thử sản phẩm, CHƯA CÓ mã.
 *
 * Khác hẳn với "quên ghi mã". Sản phẩm test chưa nhập hàng nên chưa có SKU; win
 * rồi thì thay đúng ô đó bằng mã thật, số ô không đổi. Còn "quên ghi mã" là lỗi
 * đặt tên cần sửa. Gộp hai thứ vào một rổ là không biết chỗ nào đáng đi nhắc.
 */
export function isProductTesting(cn?: string | null): boolean {
    return String(cn || "")
        .split("/")
        .some((seg) => seg.trim().toUpperCase() === "TEST");
}
