import { cn } from "../../utils";
import { d6 } from "../ledger-shared";
import { VND, CONF, TH, TD } from "./shared";
import type { FbRow, Result } from "./types";

export function ResultTable({ tab, res }: { tab: string; res: Result }) {
    if (tab === "pairs") {
        if (!res.pairs.length) return <NoRows />;
        return (
            <table className="w-full text-sm">
                <thead className="border-b border-border">
                    <tr>{["Ngày TKQC", "Mã GD", "Tài khoản QC", "Tiền TKQC", "Ngày thẻ", "Nội dung sao kê", "Tiền thẻ", "Lệch", "Ngày lệch", "Thẻ", "Tin cậy"]
                        .map((h) => <th key={h} className={TH}>{h}</th>)}</tr>
                </thead>
                <tbody>
                    {res.pairs.map((p, i) => (
                        <tr key={i} className={cn("border-b border-border/60", !p.exact && "bg-amber-50/40 dark:bg-amber-500/[0.04]")}>
                            <td className={TD}>{d6(p.fb.date)}</td>
                            <td className={TD}>{p.fb.txn_id}</td>
                            <td className="px-3 py-2 min-w-[160px]">{accountLabel(p.fb, res)}</td>
                            <td className={cn(TD, "text-right tabular-nums")}>{VND(p.fb.amount)}</td>
                            <td className={TD}>{d6(p.bank.date)}</td>
                            <td className="px-3 py-2 min-w-[200px] text-muted-foreground">{p.bank.desc}</td>
                            <td className={cn(TD, "text-right tabular-nums")}>{VND(p.bank.amount)}</td>
                            <td className={cn(TD, "text-right tabular-nums", p.amount_diff !== 0 && "font-semibold text-rose-600 dark:text-rose-400")}>
                                {p.amount_diff ? VND(p.amount_diff) : "—"}
                            </td>
                            <td className={cn(TD, "text-right tabular-nums")}>{p.date_diff}</td>
                            <td className={cn(TD, !p.card_ok && "font-semibold text-rose-600 dark:text-rose-400")}>
                                {p.bank.card4 || p.fb.card4 || "·"}
                            </td>
                            <td className={TD}>
                                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", CONF[p.confidence])}>
                                    {p.confidence}{p.ambiguous ? " ?" : ""}
                                </span>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        );
    }

    if (tab === "fb_unmatched" || tab === "fb_failed") {
        // Mới nhất lên đầu (15/11/2026).
        const rows = [...(tab === "fb_unmatched" ? res.fb_unmatched : res.fb_failed)]
            .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
        if (!rows.length) return <NoRows />;
        return (
            <table className="w-full text-sm">
                <thead className="border-b border-border">
                    <tr>{["Ngày", "Mã GD", "Tài khoản QC", "Số tiền", "Thẻ trên hoá đơn", "Trạng thái", "Dòng"]
                        .map((h) => <th key={h} className={TH}>{h}</th>)}</tr>
                </thead>
                <tbody>
                    {rows.map((r, i) => (
                        <tr key={i} className="border-b border-border/60">
                            <td className={TD}>{d6(r.date)}</td>
                            <td className={TD}>{r.txn_id}</td>
                            <td className="px-3 py-2 min-w-[160px]">{accountLabel(r, res)}</td>
                            <td className={cn(TD, "text-right tabular-nums font-semibold")}>{VND(r.amount)}</td>
                            <td className={TD}>{r.card4 || "·"}</td>
                            <td className={TD}>{r.status}</td>
                            <td className={cn(TD, "text-right text-muted-foreground")}>{r.line}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        );
    }

    // Mới nhất lên đầu (15/11/2026).
    const rows = [...(tab === "bank_unmatched" ? res.bank_unmatched : res.other_ads)]
        .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    if (!rows.length) return <NoRows />;
    return (
        <table className="w-full text-sm">
            <thead className="border-b border-border">
                <tr>{["Ngày", "Nội dung", "Số tiền", "Thẻ", "Tham chiếu", "Số dư sau", "Dòng"]
                    .map((h) => <th key={h} className={TH}>{h}</th>)}</tr>
            </thead>
            <tbody>
                {rows.map((r, i) => (
                    <tr key={i} className="border-b border-border/60">
                        <td className={TD}>{d6(r.date)}</td>
                        <td className="px-3 py-2 min-w-[220px]">{r.desc}</td>
                        <td className={cn(TD, "text-right tabular-nums font-semibold")}>{VND(r.amount)}</td>
                        <td className={TD}>{r.card4 || "·"}</td>
                        <td className={cn(TD, "text-muted-foreground")}>{r.ref}</td>
                        <td className={cn(TD, "text-right tabular-nums text-muted-foreground")}>
                            {r.balance != null ? VND(r.balance) : "·"}
                        </td>
                        <td className={cn(TD, "text-right text-muted-foreground")}>{r.line}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

const NoRows = () => <div className="py-8 text-center text-sm text-muted-foreground">Không có dòng nào.</div>;

/** Tên tài khoản quảng cáo cho dễ đọc; không tra được thì trả lại id. */
function accountLabel(r: FbRow, res: Result) {
    if (r.account_name) return r.account_name;
    const id = (r.account_id || "").replace(/^act_/, "");
    return (id && res.tkqc_ten?.[id]) || r.account_id || "—";
}
