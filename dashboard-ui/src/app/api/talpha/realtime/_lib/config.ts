import * as fs from "fs";
import * as yaml from "js-yaml";

// ═══ CONFIG ═══
// Danh sách TKQC Meta + shop POS: config/projects/talpha.yaml ở gốc repo.
// Đường dẫn do config-path.ts giữ — MỘT chỗ duy nhất biết cấu hình nằm ở đâu.
import { TALPHA_YAML } from "@/lib/talpha/config-path";
import { getCredential } from "@/lib/talpha/credentials";
const YAML_PATH = TALPHA_YAML();

export interface YamlConfig {
    meta_ads: { access_token: string };
    poscake: { shops: Array<{ name: string; api_url: string; api_key: string; shop_id: string }> };
}

// Resolve ${ENV_VAR} placeholders in the YAML so secrets (Meta token, Poscake keys) stay out
// of the YAML. getCredential(): khoá nhập ở /admin → Khoá kết nối trước, rồi .env.local.
function resolveEnvPlaceholders(raw: string): string {
    return raw.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name) => {
        const val = getCredential(name);
        if (val === undefined || val === "") {
            console.warn(`talpha.yaml: env var ${name} is not set`);
            return "";
        }
        return val;
    });
}

export function loadConfig(): YamlConfig {
    const raw = fs.readFileSync(YAML_PATH, "utf-8");
    return yaml.load(resolveEnvPlaceholders(raw)) as YamlConfig;
}
