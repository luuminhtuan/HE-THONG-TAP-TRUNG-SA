// ═══════════════════════════════════════════════════════════════════
// AI Chatbot — đọc JSON model trả về + kiểm schema (THUẦN, có test). Model hay bọc ```json … ```, thêm câu dẫn,
// thiếu trường, sai kiểu — mọi chỗ dùng kết quả model PHẢI qua đây, không JSON.parse thẳng.
// ═══════════════════════════════════════════════════════════════════

/** Lấy object JSON đầu tiên trong chữ model trả (bỏ rào ```, câu dẫn). Không đọc được → null. */
export function parseModelJson(text: string): unknown {
    const s = String(text || "").trim();
    if (!s) return null;
    const unfenced = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    try { return JSON.parse(unfenced); } catch { /* thử tìm khối {…} cân ngoặc */ }
    const start = unfenced.indexOf("{");
    if (start < 0) return null;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < unfenced.length; i++) {
        const c = unfenced[i];
        if (inStr) {
            if (esc) esc = false;
            else if (c === "\\") esc = true;
            else if (c === "\"") inStr = false;
            continue;
        }
        if (c === "\"") inStr = true;
        else if (c === "{") depth++;
        else if (c === "}" && --depth === 0) {
            try { return JSON.parse(unfenced.slice(start, i + 1)); } catch { return null; }
        }
    }
    return null;
}

export type FieldSchema =
    | { type: "string"; enum?: readonly string[]; maxLength?: number; optional?: boolean }
    | { type: "number"; min?: number; max?: number; optional?: boolean }
    | { type: "boolean"; optional?: boolean }
    | { type: "array"; items: FieldSchema; maxItems?: number; optional?: boolean }
    | { type: "object"; properties: Record<string, FieldSchema>; optional?: boolean };

export type ValidateResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

function check(v: unknown, s: FieldSchema, path: string, errors: string[]): unknown {
    if (v === undefined || v === null) {
        if (!s.optional) errors.push(`${path}: thiếu`);
        return undefined;
    }
    switch (s.type) {
        case "string": {
            if (typeof v !== "string") { errors.push(`${path}: phải là chuỗi`); return undefined; }
            if (s.enum && !s.enum.includes(v)) { errors.push(`${path}: "${v}" không thuộc ${s.enum.join("|")}`); return undefined; }
            return s.maxLength ? v.slice(0, s.maxLength) : v;
        }
        case "number": {
            const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
            if (!Number.isFinite(n)) { errors.push(`${path}: phải là số`); return undefined; }
            if ((s.min !== undefined && n < s.min) || (s.max !== undefined && n > s.max)) {
                errors.push(`${path}: ${n} ngoài khoảng ${s.min ?? "-∞"}..${s.max ?? "∞"}`);
                return undefined;
            }
            return n;
        }
        case "boolean": {
            if (typeof v === "boolean") return v;
            if (v === "true" || v === "false") return v === "true";
            errors.push(`${path}: phải là true/false`);
            return undefined;
        }
        case "array": {
            if (!Array.isArray(v)) { errors.push(`${path}: phải là mảng`); return undefined; }
            const arr = s.maxItems ? v.slice(0, s.maxItems) : v;
            return arr.map((x, i) => check(x, s.items, `${path}[${i}]`, errors));
        }
        case "object": {
            if (typeof v !== "object" || Array.isArray(v)) { errors.push(`${path}: phải là object`); return undefined; }
            const out: Record<string, unknown> = {};
            for (const [k, fs] of Object.entries(s.properties)) {
                const r = check((v as Record<string, unknown>)[k], fs, path ? `${path}.${k}` : k, errors);
                if (r !== undefined) out[k] = r;
            }
            return out;
        }
    }
}

/** Kiểm + chuẩn hoá theo schema (bỏ trường lạ, cắt chuỗi dài, số dạng chuỗi → số). */
export function validate<T>(value: unknown, schema: FieldSchema): ValidateResult<T> {
    const errors: string[] = [];
    const out = check(value, schema, "", errors);
    return errors.length ? { ok: false, errors } : { ok: true, value: out as T };
}
