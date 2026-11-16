// ═══ META API — múi giờ từng TKQC + insights từng ad ═══

// account_id → IANA timezone name (Meta reports insights in the account's own tz).
// Cached across requests — an account's timezone is effectively static.
const accountTzCache: Record<string, string> = {};
export async function fetchAccountTimezones(tokenFor: (accId: string) => string, accountIds: string[]): Promise<Record<string, string>> {
    await Promise.all(accountIds.map(async (accId) => {
        if (accountTzCache[accId]) return;
        try {
            const url = `https://graph.facebook.com/v21.0/${accId}?fields=timezone_name&access_token=${tokenFor(accId)}`;
            const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
            if (!res.ok) { console.error(`Meta tz ${accId}: ${res.status}`); return; }
            const j = await res.json();
            if (j.timezone_name) accountTzCache[accId] = j.timezone_name;
        } catch (e: any) {
            console.error(`Meta tz ${accId} error:`, e.message);
        }
    }));
    return accountTzCache;
}

// TALPHA ad accounts use VND currency — Meta API 'spend' is already in VND
// No USD→VND conversion needed for ads data

// ═══ META API: Fetch insights per ad for date range (with pagination) ═══
export async function fetchMetaAds(tokenFor: (accId: string) => string, accountIds: string[], accountNames: Record<string, string>, activeOnly: boolean, fromDate: string, toDate: string, warnings: string[]) {
    // inline_link_clicks = lượt bấm vào Messenger của camp tin nhắn. Ở Nhật Meta không báo số mess
    // nên tin Zalo mỗi giờ dùng nó để so camp với nhau (Sỹ Anh yêu cầu 12/10/2026).
    const fields = "campaign_name,campaign_id,adset_name,ad_name,ad_id,spend,impressions,inline_link_clicks,cpm,cpc,ctr,actions";
    const allAds: any[] = [];
    // Filter to ACTIVE campaigns only if requested
    const filtering = activeOnly
        ? `&filtering=${encodeURIComponent(JSON.stringify([{ "field": "campaign.effective_status", "operator": "IN", "value": ["ACTIVE"] }]))}`
        : '';
    // Use time_range for custom dates — NO time_increment=1 so Meta aggregates per ad_id
    const timeRange = `&time_range=${encodeURIComponent(JSON.stringify({ since: fromDate, until: toDate }))}`;

    await Promise.all(accountIds.map(async (accId) => {
        const accName = accountNames[accId] || accId;
        let realError = "";   // lỗi gọi Meta — khác HẲN "chạm cap phân trang"
        try {
            let url: string | null = `https://graph.facebook.com/v21.0/${accId}/insights?fields=${fields}&level=ad${timeRange}&limit=500${filtering}&access_token=${tokenFor(accId)}`;
            let pageCount = 0;
            const MAX_PAGES = 10; // safety limit: 10 pages × 500 = 5000 ads max per account

            while (url && pageCount < MAX_PAGES) {
                const res: Response = await fetch(url, { signal: AbortSignal.timeout(15000) });
                if (!res.ok) {
                    // Đọc lấy error.code/message của Meta rồi mới thoát. `break` trơn để lại
                    // `url` nguyên giá trị, và khối cảnh báo bên dưới hiểu nhầm thành "chạm cap".
                    realError = `HTTP ${res.status}`;
                    try {
                        const j: any = await res.json();
                        if (j?.error) realError = `code ${j.error.code}: ${String(j.error.message || "").slice(0, 130)}`;
                    } catch { /* body không phải JSON — giữ nguyên HTTP status */ }
                    break;
                }
                const data: any = await res.json();
                const rows = data.data || [];

                for (const row of rows) {
                    const actions = row.actions || [];
                    const messages = actions.find((a: any) => a.action_type === "onsite_conversion.messaging_conversation_started_7d")?.value || 0;
                    const purchases = actions.find((a: any) => a.action_type === "purchase" || a.action_type === "omni_purchase")?.value || 0;
                    allAds.push({
                        account_id: accId,
                        account_name: accountNames[accId] || accId,
                        campaign_id: row.campaign_id,
                        campaign_name: row.campaign_name,
                        adset_name: row.adset_name || "",
                        ad_name: row.ad_name || "",
                        ad_id: row.ad_id,
                        spend_vnd: parseFloat(row.spend || "0"), // Already VND (accounts are VND-billed)
                        impressions: parseInt(row.impressions || "0"),
                        link_clicks: parseInt(row.inline_link_clicks || "0"),
                        cpm_vnd: parseFloat(row.cpm || "0"),
                        cpc_vnd: parseFloat(row.cpc || "0"),
                        ctr: parseFloat(row.ctr || "0"),
                        messages: parseInt(messages),
                        purchases: parseInt(purchases),
                        // Will be filled by mapping
                        orders: 0,
                        revenue_vnd: 0,
                        revenue_delivered_vnd: 0, // doanh số của đơn GIAO THÀNH CÔNG (GTC thật)
                        order_details: [] as any[],
                    });
                }

                // Follow pagination
                url = data.paging?.next || null;
                pageCount++;
            }
            if (pageCount > 1) console.log(`Meta ${accId}: fetched ${pageCount} pages`);
            // Cảnh báo phải nói ĐÚNG chuyện đã xảy ra. Trước đây lỗi HTTP `break` mà để
            // nguyên `url`, nên khối này báo "chạm cap 10 trang" cho một account chưa lấy
            // nổi MỘT trang. Token dashboard chết từ 02/09/2026 (code 190, session
            // invalidated) mà cả 15 account đều kêu "chạm cap" — lỗi thật chỉ nằm trong
            // console.error của server, không ai lần ra, báo cáo mất sạch phần campaign
            // suốt nhiều ngày mà nhìn vẫn như bình thường.
            if (realError) {
                const msg = `Meta ${accName}: KHÔNG lấy được số — ${realError}`;
                console.error(msg);
                warnings.push(msg);
            } else if (url) {
                // A3-P2: cap không được im lặng — còn trang sau MAX_PAGES nghĩa là spend bị đếm thiếu
                const msg = `Meta ${accName}: chạm cap ${MAX_PAGES} trang (${MAX_PAGES * 500} ads) — dữ liệu bị cắt, spend có thể thiếu`;
                console.warn(msg);
                warnings.push(msg);
            }
        } catch (e: any) {
            const msg = `Meta ${accName}: KHÔNG lấy được số — ${e.message}`;
            console.error(msg);
            warnings.push(msg);
        }
    }));

    return allAds;
}
