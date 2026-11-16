"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { setMarkets, type MarketPublic } from "./utils";

/*
 * Ba thị trường (Đài Loan · Singapore · UAE), nạp MỘT lần từ /api/talpha/markets.
 *
 * Tab nào đổi mã nước ra tên, dựng câu SQL tách chi tiêu theo nước, hay quy tiền về
 * VND thì đọc từ đây — không gõ bảng riêng. `loaded` để tab chờ có danh sách rồi mới
 * tính, khỏi hiện mã "SG" trần hay nhét chi tiêu Singapore vào nhóm lạ.
 */
type MarketsState = { loaded: boolean; primary: string | null; markets: MarketPublic[] };

const MarketsContext = createContext<MarketsState>({ loaded: false, primary: null, markets: [] });

export function MarketsProvider({ children }: { children: React.ReactNode }) {
    const [state, setState] = useState<MarketsState>({ loaded: false, primary: null, markets: [] });
    useEffect(() => {
        let cancelled = false;
        fetch("/api/talpha/markets")
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
            .then((d: { primary: string | null; markets: MarketPublic[] }) => {
                if (cancelled) return;
                setMarkets(d.markets || []);
                setState({ loaded: true, primary: d.primary ?? null, markets: d.markets || [] });
            })
            .catch(() => { if (!cancelled) setState((s) => ({ ...s, loaded: true })); });
        return () => { cancelled = true; };
    }, []);
    return <MarketsContext.Provider value={state}>{children}</MarketsContext.Provider>;
}

export function useMarkets(): MarketsState {
    return useContext(MarketsContext);
}
