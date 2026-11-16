"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, Download, Send, Trash2, AlertTriangle, CheckCircle2, FileSpreadsheet } from "lucide-react";
import TabSkeleton, { ErrorState } from "@/components/ui/tab-skeleton";
import { cn } from "../utils";
import { d6 } from "./ledger-shared";
import { VND, API, mergeFiles, SEV_BOX } from "./ads-recon/shared";
import { ResultTable } from "./ads-recon/result-table";
import { StorePanel } from "./ads-recon/store-panel";
import { ConclusionCard } from "./ads-recon/conclusion-card";
import type { Result, FileMeta, StoreSource, ImportStats, PeriodMeta } from "./ads-recon/types";

/* ═══════════════════════════════════════════════════════════════════
   ĐỐI SOÁT CHI PHÍ QUẢNG CÁO — việc của mỗi tuần khi có 2 file.

   Mỗi tuần có hai con số nói về cùng một khoản tiền: Facebook nói đã thu
   bao nhiêu, ngân hàng nói đã trừ bao nhiêu. Màn này trả lời đúng ba câu:
   LỆCH BAO NHIÊU TIỀN · LỆCH Ở DÒNG NÀO · PHẢI LÀM GÌ TIẾP.

   Đối soát COD ở tab kia là tiền VỀ. Màn này là tiền RA.
   ═══════════════════════════════════════════════════════════════════ */

export default function TALPHAAdsReconTab() {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
    const [list, setList] = useState<PeriodMeta[]>([]);
    const [res, setRes] = useState<Result | null>(null);
    const [fbFiles, setFbFiles] = useState<File[]>([]);
    const [bankFiles, setBankFiles] = useState<File[]>([]);
    const [busy, setBusy] = useState(false);
    const [hideInfo, setHideInfo] = useState(false);
    const [tab, setTab] = useState<"pairs" | "fb_unmatched" | "bank_unmatched" | "fb_failed" | "other_ads">("pairs");
    const [over, setOver] = useState<"fb" | "bank" | null>(null);
    const [swapped, setSwapped] = useState("");
    const [password, setPassword] = useState("");
    const [passwordNeeded, setPasswordNeeded] = useState<{ file: string; sai: boolean } | null>(null);
    const [store, setStore] = useState<{ kho: { fb: number; bank: number }; nguon: StoreSource[] } | null>(null);
    const [adAccountNames, setAdAccountNames] = useState<Record<string, string>>({});
    const fbRef = useRef<HTMLInputElement>(null);
    const bankRef = useRef<HTMLInputElement>(null);

    const openPeriod = useCallback(async (period: string) => {
        const r = await fetch(`${API}?ky=${encodeURIComponent(period)}`);
        const j = await r.json();
        if (!r.ok) { setError(j.error || "Không mở được kỳ"); return; }
        setRes(j);
        if (j.tkqc_ten) setAdAccountNames(j.tkqc_ten);
    }, []);

    const loadStore = useCallback(async () => {
        try {
            const r = await fetch(`${API}?kho=1`);
            if (!r.ok) return;
            const j = await r.json();
            setStore(j);
            if (j.tkqc_ten) setAdAccountNames(j.tkqc_ten);
        } catch { /* kho hỏng không được chặn phần còn lại */ }
    }, []);

    const refresh = useCallback(async (openLatest = false) => {
        try {
            const r = await fetch(API);
            const j = await r.json();
            if (!r.ok) throw new Error(j.error || "Không đọc được danh sách kỳ");
            setList(j.periods || []);
            if (openLatest && j.periods?.length) await openPeriod(j.periods[0].ky);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setLoading(false);
        }
    }, [openPeriod]);

    useEffect(() => { refresh(true); loadStore(); }, [refresh, loadStore]);

    // ── Chạy đối soát ────────────────────────────────────────────────────
    /**
     * Bỏ file vào ô nào cũng chạy được: máy vẫn tự nhận đâu là chi phí TKQC,
     * đâu là sao kê. Nhưng nếu nó phải đổi chỗ so với ô người dùng chọn thì
     * PHẢI nói ra — im lặng sửa hộ là lúc file thật sai định dạng, người dùng
     * không hiểu vì sao số ra lạ.
     */
    const run = async () => {
        if (!fbFiles.length && !bankFiles.length) return;
        setBusy(true); setNote({ text: "Đang đọc file và đối soát…" }); setSwapped("");
        try {
            const fd = new FormData();
            for (const f of [...fbFiles, ...bankFiles]) fd.append("file", f, f.name);
            if (password) fd.append("matkhau", password);
            const r = await fetch(API, { method: "POST", body: fd });
            const j = await r.json();
            if (!r.ok) {
                // PDF bị khoá thì đừng bắt người dùng tự đoán — bật thẳng ô
                // nhập mật khẩu và GIỮ NGUYÊN file đã chọn để bấm lại là chạy.
                if (j.can_mat_khau) setPasswordNeeded({ file: j.file || "", sai: !!j.mat_khau_sai });
                throw new Error(j.error || "Đối soát thất bại");
            }
            setPasswordNeeded(null); setPassword("");

            // Máy phân loại lại theo NỘI DUNG file. Khác với ô người dùng chọn
            // thì phải nói ra — im lặng sửa hộ là lúc file thật sai định dạng,
            // người dùng không hiểu vì sao số ra lạ.
            const selectedFbNames = new Set(fbFiles.map((f) => f.name));
            const detectedFbNames: string[] = (j.files?.fb || []).map((f: FileMeta) => f.ten);
            const mismatched = detectedFbNames.length !== selectedFbNames.size || detectedFbNames.some((n) => !selectedFbNames.has(n));
            if (mismatched) {
                setSwapped(
                    `Đã phân loại lại theo nội dung file — chi phí TKQC: ${detectedFbNames.join(", ") || "(không có)"} · ` +
                    `sao kê: ${(j.files?.bank || []).map((f: FileMeta) => f.ten).join(", ")}. Kết quả bên dưới vẫn đúng.`);
            }
            const n = j.nap as ImportStats | undefined;
            const addedCount = (n?.fb.them || 0) + (n?.bank.them || 0);
            const duplicateCount = (n?.fb.trung || 0) + (n?.bank.trung || 0);
            setNote({
                text: `Đã cất ${addedCount} dòng mới vào kho` +
                      (duplicateCount ? `, bỏ ${duplicateCount} dòng đã có sẵn` : "") +
                      (j.chua_du ? `. Còn thiếu file ${j.thieu} — bổ sung lúc nào cũng đối soát tiếp được.` : "."),
            });
            if (j.tkqc_ten) setAdAccountNames(j.tkqc_ten);
            if (!j.chua_du) setRes(j);
            setFbFiles([]); setBankFiles([]);
            if (fbRef.current) fbRef.current.value = "";
            if (bankRef.current) bankRef.current.value = "";
            await Promise.all([refresh(), loadStore()]);
        } catch (e) {
            setNote({ text: (e as Error).message, bad: true });
        } finally {
            setBusy(false);
        }
    };

    const notify = async () => {
        if (!res) return;
        setBusy(true);
        try {
            const r = await fetch(`${API}?action=notify&ky=${encodeURIComponent(res.ky)}`, { method: "POST" });
            const j = await r.json();
            setNote(j.sent?.length
                ? { text: "Đã gửi cảnh báo qua: " + j.sent.join(", ") }
                : { text: "Chưa gửi được — " + [...(j.errors || []), ...(j.skipped || [])].join(" · "), bad: true });
        } catch (e) {
            setNote({ text: (e as Error).message, bad: true });
        } finally { setBusy(false); }
    };

    /** Rút một file khỏi kho — tải nhầm thì gỡ ra, không phải xoá sạch làm lại. */
    const removeSource = async (fileName: string) => {
        if (!confirm(`Rút "${fileName}" khỏi kho? Mọi dòng đến từ file này sẽ bị bỏ.`)) return;
        await fetch(`${API}?nguon=${encodeURIComponent(fileName)}`, { method: "DELETE" });
        await loadStore();
        setNote({ text: `Đã rút "${fileName}" khỏi kho. Tải lại file bất kỳ để đối soát lại.` });
    };

    const deletePeriod = async () => {
        if (!res || !confirm(`Xoá kỳ ${res.ky}? Tải lại 2 file là dựng lại được.`)) return;
        await fetch(`${API}?ky=${encodeURIComponent(res.ky)}`, { method: "DELETE" });
        setRes(null); await refresh(true);
    };

    if (loading) return <TabSkeleton cards={4} rows={6} />;
    if (error) return <ErrorState message={error} onRetry={() => { setError(""); setLoading(true); refresh(true); }} />;

    const s = res?.summary;

    return (
        <div className="space-y-5">
            {/* ═══ Tải 2 file — MỖI NGUỒN MỘT Ô, có nhãn rõ ═══

                Bản đầu là một ô chọn nhiều tệp rồi để máy tự đoán. Gọn về code
                nhưng người dùng không biết mình đang bỏ cái gì vào đâu, và
                không thay riêng được một file. Nay hai ô có nhãn, phần tự nhận
                giữ lại làm lưới an toàn: bỏ nhầm chỗ vẫn ra đúng, và máy nói ra
                là nó đã đổi chỗ.                                            */}
            <div className="grid gap-3 md:grid-cols-2">
                {([
                    ["fb", "1 · Chi phí thanh toán từ TKQC Facebook",
                     "Xuất từ Trình quản lý quảng cáo → Thanh toán → Lịch sử thanh toán (.xlsx, .csv hoặc .pdf)",
                     fbFiles, setFbFiles, fbRef],
                    ["bank", "2 · Sao kê thẻ ngân hàng",
                     "Tải từ ngân hàng — .xlsx, .csv hoặc .pdf (bản PDF phải có lớp chữ, không đọc được ảnh scan)",
                     bankFiles, setBankFiles, bankRef],
                ] as const).map(([id, label, hint, files, setFiles, ref]) => (
                    <div
                        key={id}
                        onDragOver={(e) => { e.preventDefault(); setOver(id); }}
                        onDragLeave={() => setOver(null)}
                        onDrop={(e) => {
                            e.preventDefault(); setOver(null);
                            const fs = [...e.dataTransfer.files];
                            if (fs.length) setFiles((cur) => mergeFiles(cur, fs));
                        }}
                        className={cn("rounded-xl border-2 border-dashed p-4 transition-colors",
                            over === id ? "border-orange-400 bg-orange-50/50 dark:bg-orange-500/[0.06]"
                                        : files.length ? "border-emerald-300 bg-emerald-50/40 dark:border-emerald-500/30 dark:bg-emerald-500/[0.05]"
                                               : "border-border bg-card dark:bg-white/[0.03]")}
                    >
                        <div className="flex items-start gap-2">
                            {files.length ? <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                                          : <Upload className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                            <div className="min-w-0 flex-1">
                                <div className="text-sm font-semibold">
                                    {label}
                                    {files.length > 1 && <span className="ml-1.5 text-xs font-normal text-muted-foreground">({files.length} file)</span>}
                                </div>
                                <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>
                            </div>
                        </div>

                        {/* Nhiều thẻ thì nhiều sao kê, nhiều TKQC thì nhiều bản chi phí —
                            chọn hết vào một ô, máy gộp lại thành một lượt đối soát. */}
                        {files.length > 0 && (
                            <div className="mt-3 space-y-1.5">
                                {files.map((f, i) => (
                                    <div key={f.name + i} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs">
                                        <span className="truncate font-medium">{f.name}</span>
                                        <span className="ml-auto shrink-0 text-muted-foreground">{(f.size / 1024).toFixed(0)} KB</span>
                                        <button
                                            onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}
                                            className="shrink-0 text-muted-foreground hover:text-rose-600" title="Bỏ file này"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <input
                            ref={ref} type="file" multiple accept=".xlsx,.csv,.tsv,.txt,.pdf"
                            onChange={(e) => {
                                const fs = [...(e.target.files || [])];
                                if (fs.length) setFiles((cur) => mergeFiles(cur, fs));
                            }}
                            className="mt-3 w-full text-xs file:mr-2 file:rounded-md file:border file:border-border file:bg-muted file:px-3 file:py-1.5 file:text-xs"
                        />
                    </div>
                ))}
            </div>

            <div className="flex flex-wrap items-center gap-3">
                <button
                    onClick={run} disabled={(!fbFiles.length && !bankFiles.length) || busy}
                    className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-700 disabled:opacity-40"
                >
                    {busy ? "Đang chạy…" : "Chạy đối soát"}
                </button>
                <span className="text-xs text-muted-foreground">
                    {!fbFiles.length && !bankFiles.length
                        ? "Chọn file rồi bấm chạy. Mỗi ô nhiều file, và KHÔNG cần đủ hai phía cùng lúc — dữ liệu được cất vào kho."
                        : `Sẽ nạp ${fbFiles.length + bankFiles.length} file vào kho rồi đối soát lại toàn bộ. Bỏ nhầm ô cũng không sao — máy phân loại theo nội dung.`}
                </span>
            </div>

            {passwordNeeded && (
                <div className="rounded-xl border border-amber-300 bg-amber-50/70 p-4 dark:border-amber-500/30 dark:bg-amber-500/[0.07]">
                    <div className="text-sm font-semibold">
                        {passwordNeeded.sai ? "Mật khẩu chưa đúng" : "File PDF này bị khoá bằng mật khẩu"}
                        {passwordNeeded.file && <span className="ml-1 font-normal text-muted-foreground">— {passwordNeeded.file}</span>}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                        Sao kê ngân hàng gửi qua email gần như luôn bị khoá. Mật khẩu nằm trong chính email đó
                        (thường là số CCCD, số điện thoại hoặc ngày sinh chủ tài khoản).
                        Mật khẩu chỉ dùng cho lượt đọc này — không lưu lại ở đâu.
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <input
                            type="password" value={password} autoComplete="off"
                            onChange={(e) => setPassword(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter" && password && !busy) run(); }}
                            placeholder="Mật khẩu mở file"
                            className="w-56 rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
                        />
                        <button
                            onClick={run} disabled={!password || busy}
                            className="rounded-lg bg-orange-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-40"
                        >
                            {busy ? "Đang mở…" : "Mở và chạy lại"}
                        </button>
                    </div>
                </div>
            )}

            {swapped && (
                <div className="rounded-lg bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                    {swapped}
                </div>
            )}

            {note && (
                <div className={cn("rounded-lg px-4 py-2.5 text-sm",
                    note.bad ? "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
                             : "bg-muted/60 text-muted-foreground")}>
                    {note.text}
                </div>
            )}

            {/* ═══ Kho dữ liệu ═══
                Đây là chỗ trả lời câu "file nào thuộc TKQC nào". Bản kê thanh
                toán của Facebook là của ĐÚNG MỘT tài khoản, nên nhìn cột TKQC
                là biết ngay còn thiếu bản kê của ai.                        */}
            {store && store.nguon.length > 0 && (
                <StorePanel store={store} adAccountNames={adAccountNames} onRemove={removeSource} />
            )}

            {!res && (
                <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground dark:bg-white/[0.03]">
                    Chưa có kỳ nào. Tải 2 file của tuần này lên để bắt đầu.
                </div>
            )}

            {res && s && (
                <>
                    {/* ═══ Chọn kỳ + hành động ═══ */}
                    <div className="flex flex-wrap items-center gap-2">
                        <select
                            value={res.ky}
                            onChange={(e) => openPeriod(e.target.value)}
                            className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
                        >
                            {list.map((k) => (
                                <option key={k.ky} value={k.ky}>
                                    {k.ky} · {VND(k.summary?.bank_total ?? 0)}
                                </option>
                            ))}
                        </select>
                        <span className="text-xs text-muted-foreground">
                            sao kê {d6(s.period.bank_start)} → {d6(s.period.bank_end)} · chạy lúc{" "}
                            {new Date(res.chay_luc).toLocaleString("vi-VN")}
                            {[...(res.files?.fb || []), ...(res.files?.bank || [])]
                                .map((f) => ` · ${f.ten} (${f.so_dong} dòng)`).join("")}
                        </span>
                        <div className="ml-auto flex gap-2">
                            <a href={`${API}?ky=${encodeURIComponent(res.ky)}&csv=1`}
                               className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted">
                                <Download className="h-3.5 w-3.5" /> Xuất CSV
                            </a>
                            <button onClick={notify} disabled={busy}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-40">
                                <Send className="h-3.5 w-3.5" /> Gửi cảnh báo
                            </button>
                            <button onClick={deletePeriod}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10">
                                <Trash2 className="h-3.5 w-3.5" /> Xoá kỳ
                            </button>
                        </div>
                    </div>

                    {/* ═══ KẾT LUẬN — đứng trên mọi con số ═══
                        Câu hỏi thật sự mỗi tuần chỉ có một: số này có tin được
                        không, và phải làm gì. Sáu ô số với một chồng cảnh báo
                        không trả lời được câu đó, nên nó phải nằm ở đây.   */}
                    {s.ket_luan && <ConclusionCard conclusion={s.ket_luan} />}

                    {/* ═══ Số tổng ═══ */}
                    <div className={cn("grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6",
                        s.ket_luan?.muc === "khong_tin" && "opacity-55")}>
                        {([
                            ["TKQC ghi thu", VND(s.fb_total), ""],
                            ["Thẻ đã bị trừ", VND(s.bank_total), ""],
                            ["Chênh lệch", VND(s.gap), s.gap !== 0 ? "text-rose-600 dark:text-rose-400" : ""],
                            ["Cần đòi / làm rõ", VND(s.at_risk), s.at_risk > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"],
                            ["Khớp được", `${res.stats.matched}/${res.stats.fb_chargeable}`, res.stats.matched === res.stats.fb_chargeable ? "text-emerald-600 dark:text-emerald-400" : ""],
                            ["Phí ẩn ghi nhận", VND(s.fee_total), ""],
                        ] as [string, string, string][]).map(([lbl, val, cls]) => (
                            <div key={lbl} className="rounded-xl border border-border bg-card p-3.5 dark:bg-white/[0.03]">
                                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{lbl}</div>
                                <div className={cn("mt-1 text-lg font-bold tabular-nums", cls)}>{val}</div>
                            </div>
                        ))}
                    </div>

                    {/* ═══ Cảnh báo ═══ */}
                    <div className="rounded-xl border border-border bg-card p-4 dark:bg-white/[0.03]">
                        <div className="mb-3 flex flex-wrap items-center gap-3">
                            <h3 className="flex items-center gap-2 text-sm font-semibold">
                                {s.counts.critical > 0
                                    ? <AlertTriangle className="h-4 w-4 text-rose-500" />
                                    : <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                                Cảnh báo
                            </h3>
                            <span className="text-xs text-muted-foreground">
                                {s.counts.critical} nghiêm trọng · {s.counts.warn} cần xem · {s.counts.info} ghi nhận
                                {s.so_dong_canh_bao && s.so_dong_canh_bao > s.counts.critical + s.counts.warn + s.counts.info
                                    ? ` · gộp từ ${s.so_dong_canh_bao} dòng` : ""}
                            </span>
                            <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                                <input type="checkbox" checked={hideInfo} onChange={(e) => setHideInfo(e.target.checked)} />
                                ẩn mục ghi nhận
                            </label>
                        </div>

                        <div className="space-y-2">
                            {res.alerts.filter((a) => !hideInfo || a.severity !== "info").map((a, i) => (
                                <div key={i} className={cn("rounded-lg border-l-4 p-3", SEV_BOX[a.severity])}>
                                    <div className="flex items-start gap-2">
                                        <div className="flex-1 text-sm font-semibold">{a.title}</div>
                                        {a.count && a.count > 1 && (
                                            <span className="shrink-0 rounded-full bg-black/[0.06] px-2 py-0.5 text-[10px] font-semibold dark:bg-white/10">
                                                {a.count} khoản
                                            </span>
                                        )}
                                        <code className="shrink-0 text-[10px] text-muted-foreground">{a.code}</code>
                                    </div>
                                    {a.detail && <div className="mt-1 text-xs text-muted-foreground">{a.detail}</div>}
                                    {a.hint && (
                                        <div className="mt-2 border-t border-dashed border-border pt-2 text-xs">
                                            → {a.hint}
                                        </div>
                                    )}
                                </div>
                            ))}
                            {!res.alerts.length && (
                                <div className="py-6 text-center text-sm text-muted-foreground">Không có cảnh báo nào.</div>
                            )}
                        </div>
                    </div>

                    {/* ═══ Bảng chi tiết ═══ */}
                    <div className="rounded-xl border border-border bg-card p-4 dark:bg-white/[0.03]">
                        <div className="mb-3 inline-flex flex-wrap gap-1 rounded-xl border border-border bg-muted/40 p-1">
                            {([
                                ["pairs", "Cặp đã khớp", res.pairs.length],
                                ["fb_unmatched", "TKQC thu · thẻ không trừ", res.fb_unmatched.length],
                                ["bank_unmatched", "Thẻ trừ · không hoá đơn", res.bank_unmatched.length],
                                ["fb_failed", "Hoá đơn lỗi", res.fb_failed.length],
                                ["other_ads", "Ads kênh khác", res.other_ads.length],
                            ] as [typeof tab, string, number][]).map(([id, label, n]) => (
                                <button key={id} onClick={() => setTab(id)}
                                    className={cn("rounded-lg px-3 py-1.5 text-sm font-medium transition-all",
                                        tab === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                                    {label} <span className="text-xs opacity-60">{n}</span>
                                </button>
                            ))}
                        </div>
                        <div className="overflow-x-auto">
                            <ResultTable tab={tab} res={res} />
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
