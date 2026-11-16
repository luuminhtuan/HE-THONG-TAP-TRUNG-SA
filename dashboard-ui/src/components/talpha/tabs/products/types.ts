import type {
    SkuRow, MarketOverview, StatusSummary,
    Transfer, Restock,
} from "../../data/inventory";

// Payload trả về từ /api/talpha/inventory (POS live; POS lỗi → snapshot dự phòng trong kho số)
export interface InventoryPayload {
    asOf: { label: string; note: string };
    marketOverview: MarketOverview[];
    statusSummary: StatusSummary[];
    skuMatrix: SkuRow[];
    transfers: Transfer[];
    restocks: Restock[];
    keyFindings: string[];
    sources?: {
        pos?: { ok: boolean; shops: number; skus: number; field?: string };
        images?: { configured: boolean; count: number; source?: string };
    };
    fetchedAt?: string;
    _source?: "pos-live" | "snapshot-fallback";
    _snapshotTime?: string;
}

export type SortKey = "total" | "perDay" | "days";
