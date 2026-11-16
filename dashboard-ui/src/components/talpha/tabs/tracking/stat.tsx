import { cn } from "../../utils";

export function Stat({ icon, label, value, sub, tone }: {
    icon: React.ReactNode; label: string; value: string; sub?: string; tone?: "warn" | "bad";
}) {
    return (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                {icon}{label}
            </div>
            <div className={cn("mt-1 text-2xl font-semibold tabular-nums",
                tone === "warn" && "text-amber-600 dark:text-amber-400",
                tone === "bad" && "text-rose-600 dark:text-rose-400")}>{value}</div>
            {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
        </div>
    );
}
