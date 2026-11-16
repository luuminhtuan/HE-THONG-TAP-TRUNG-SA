import { formatVNDCompact, formatMoney, formatNumber, cn } from "../../utils";
import { ReportTable, DASH, type Column } from "../../report";
import { totalFees, formatDmy, pct, signed, profitClass } from "./helpers";
import type { Data, MarketResult, Tally } from "./types";

// ═══ Bảng theo nước ═══
type MarketRow = {
    key: string; ten: string; ghi?: string; doanh_so: number; doanh_thu: number | null; chac: number | null;
    gia_von: number | null; phi: number | null; ads: number; van_hanh: number; ln: number | null; ln_min: number | null;
};

export function MarketTable({ data }: { data: Data }) {
    const rows: MarketRow[] = data.nuoc.map((n) => ({
        key: n.code, ten: n.ten, ghi: n.loi ? "không đọc được kiện" : undefined,
        doanh_so: n.doanh_so,
        doanh_thu: n.loi ? null : n.du_kien.doanh_thu, chac: n.loi ? null : n.tk?.doanh_thu_chac ?? null,
        gia_von: n.loi ? null : n.du_kien.gia_von, phi: n.loi ? null : totalFees(n.du_kien.phi),
        ads: n.ads, van_hanh: n.van_hanh.rieng + n.van_hanh.chung,
        ln: n.loi_nhuan.du_kien, ln_min: n.loi_nhuan.toi_thieu,
    }));
    if (data.ngoai_nuoc) {
        rows.push({
            key: "_ngoai", ten: "Ngoài các nước đang bán", ghi: "camp nước chưa bán / chưa gán nước",
            doanh_so: data.ngoai_nuoc.doanh_so, doanh_thu: null, chac: null, gia_von: null, phi: null,
            ads: data.ngoai_nuoc.ads, van_hanh: 0, ln: null, ln_min: null,
        });
    }
    const otherOpex = data.van_hanh.chung_chua_chia + data.van_hanh.nuoc_khac;
    if (otherOpex > 0) {
        rows.push({
            key: "_vh", ten: "Vận hành chưa chia được", ghi: "kỳ không có doanh số / khoản thuộc nước đã dừng",
            doanh_so: 0, doanh_thu: null, chac: null, gia_von: null, phi: null, ads: 0, van_hanh: otherOpex, ln: null, ln_min: null,
        });
    }
    const t = data.tong;
    const money = (n: number | null) => (n == null ? DASH : formatMoney(n));
    const cols: Column<MarketRow>[] = [
        {
            key: "ten", label: "Thị trường", cellClassName: "font-medium text-foreground",
            render: (r) => <span className="flex flex-col">{r.ten}{r.ghi && <span className="text-[11px] font-normal text-amber-600 dark:text-amber-400">{r.ghi}</span>}</span>,
        },
        { key: "ds", label: "Doanh số", align: "right", render: (r) => money(r.doanh_so) },
        {
            key: "dt", label: "Doanh thu dự kiến", align: "right",
            render: (r) => r.doanh_thu == null ? DASH : <span className="flex flex-col">{formatMoney(r.doanh_thu)}<span className="text-[11px] text-muted-foreground">chắc {formatMoney(r.chac || 0)}</span></span>,
        },
        { key: "gv", label: "Giá vốn", align: "right", render: (r) => money(r.gia_von) },
        { key: "phi", label: "Chi phí 3PL", align: "right", render: (r) => money(r.phi) },
        { key: "ads", label: "Tiền ads", align: "right", render: (r) => money(r.ads) },
        { key: "vh", label: "Vận hành", align: "right", render: (r) => (r.van_hanh ? formatMoney(r.van_hanh) : DASH) },
        {
            key: "ln", label: "Lợi nhuận", align: "right",
            cellClassName: (r) => cn("font-semibold", profitClass(r.ln)),
            render: (r) => r.ln == null ? DASH : <span className="flex flex-col">{signed(r.ln)}<span className="text-[11px] font-normal text-muted-foreground">tối thiểu {signed(r.ln_min ?? 0)}</span></span>,
        },
        { key: "bien", label: "Biên", align: "right", render: (r) => (r.ln == null || r.doanh_thu == null ? DASH : pct(r.ln, r.doanh_thu)) },
    ];
    return (
        <ReportTable
            emoji="🌍" title="Theo thị trường"
            note="Biên = lợi nhuận dự kiến ÷ doanh thu dự kiến. Chi phí vận hành của nước = khoản riêng của nước + phần chung chia theo doanh số."
            columns={cols} rows={rows} rowKey={(r) => r.key} minWidth={900}
            footer={
                <tr className="border-t-2 border-amber-500/30 bg-amber-500/5 font-bold">
                    {["TỔNG", formatMoney(t.doanh_so), formatMoney(t.du_kien.doanh_thu), formatMoney(t.du_kien.gia_von), formatMoney(totalFees(t.du_kien.phi)),
                        formatMoney(t.ads), t.van_hanh ? formatMoney(t.van_hanh) : DASH, signed(t.loi_nhuan.du_kien), pct(t.loi_nhuan.du_kien, t.du_kien.doanh_thu)]
                        .map((c, i) => (
                            <td key={i} className={cn("px-3 py-2 tabular-nums", i === 0 ? "text-left" : "text-right", i === 7 && profitClass(t.loi_nhuan.du_kien))}>{c}</td>
                        ))}
                </tr>
            }
        />
    );
}

// ═══ Kiện trong kỳ ═══
export function ParcelTable({ data }: { data: Data }) {
    const rows = data.nuoc.filter((n) => n.tk);
    if (!rows.length) return null;
    const o = (d: Tally) => (d.n ? <span className="flex flex-col">{formatNumber(d.n)}<span className="text-[11px] text-muted-foreground">{formatVNDCompact(d.cod)}</span></span> : DASH);
    const cols: Column<MarketResult>[] = [
        { key: "ten", label: "Thị trường", cellClassName: "font-medium text-foreground", render: (n) => n.ten },
        { key: "tong", label: "Kiện lên 3PL", align: "right", render: (n) => o(n.tk!.kien.tong) },
        { key: "giao", label: "Giao xong", align: "right", cellClassName: "text-emerald-700 dark:text-emerald-400", render: (n) => o(n.tk!.kien.giao) },
        { key: "hoan", label: "Hoàn", align: "right", cellClassName: "text-rose-600 dark:text-rose-400", render: (n) => o(n.tk!.kien.hoan) },
        { key: "huy", label: "Huỷ", align: "right", render: (n) => o(n.tk!.kien.huy) },
        { key: "di", label: "Đang đi", align: "right", render: (n) => o(n.tk!.kien.dang_di) },
        { key: "cho", label: "Chờ gửi", align: "right", render: (n) => o(n.tk!.kien.cho_gui) },
        {
            key: "len", label: "Chưa lên 3PL", align: "right", title: `${data.cfg.await_3pl_days} ngày cuối kỳ: doanh số chưa thành kiện, ước như kiện đang đi`,
            render: (n) => (n.cho_len_3pl?.vnd ? formatVNDCompact(n.cho_len_3pl.vnd) : DASH),
        },
        {
            key: "tl", label: "Tỉ lệ giao dùng để ước", align: "right",
            render: (n) => n.ty_le?.r == null ? <span className="text-amber-600">chưa đo được</span> : (
                <span className="flex flex-col">
                    <span className={cn("font-semibold", n.ty_le.tam && "text-amber-600 dark:text-amber-400")}>{(n.ty_le.r * 100).toFixed(1)}%{n.ty_le.tam ? " (tạm)" : ""}</span>
                    <span className="text-[11px] text-muted-foreground">{n.ty_le.giao} giao / {n.ty_le.hoan} hoàn{n.ty_le.tu && n.ty_le.den ? ` · lên đơn ${formatDmy(n.ty_le.tu).slice(0, 5)}–${formatDmy(n.ty_le.den).slice(0, 5)}` : ""}</span>
                </span>
            ),
        },
    ];
    return (
        <ReportTable
            emoji="📦" title="Kiện trong kỳ — tiền đang ở đâu"
            note="Kiện lên đơn trong kỳ theo bảng 3PL (UAE: đơn POS + WeShip). Số nhỏ dưới mỗi ô là tiền COD. Tỉ lệ giao tính theo tiền COD trên kiện đã có kết quả."
            columns={cols} rows={rows} rowKey={(n) => n.code} minWidth={900}
        />
    );
}

// ═══ Chi phí 3PL chi tiết ═══
export function FeeTable({ data }: { data: Data }) {
    const rows = data.nuoc.filter((n) => n.tk);
    if (!rows.length) return null;
    const cols: Column<MarketResult>[] = [
        { key: "ten", label: "Thị trường", cellClassName: "font-medium text-foreground", render: (n) => n.ten },
        { key: "di", label: "Vận chuyển + thao tác", align: "right", title: "Mất dù giao hay hoàn", render: (n) => formatMoney(n.du_kien.phi.di) },
        { key: "giao", label: "Thu hộ · giao TC", align: "right", title: "Chỉ khi giao được: phí thu hộ COD, ship đơn thành công (UAE)", render: (n) => (n.du_kien.phi.giao ? formatMoney(n.du_kien.phi.giao) : DASH) },
        { key: "hoan", label: "Phí hàng hoàn", align: "right", render: (n) => (n.du_kien.phi.hoan ? formatMoney(n.du_kien.phi.hoan) : DASH) },
        {
            key: "fx", label: "Chênh tỷ giá", align: "right", title: "Tiền theo tỷ giá Doanh số − tiền 3PL thật quy ra. Âm = được lợi.",
            render: (n) => {
                const x = n.du_kien.phi.ty_gia;
                if (!x) return DASH;
                return x > 0 ? formatMoney(x) : <span className="text-emerald-600 dark:text-emerald-400">lợi {formatMoney(-x)}</span>;
            },
        },
        { key: "tong", label: "Tổng 3PL", align: "right", cellClassName: "font-semibold", render: (n) => formatMoney(totalFees(n.du_kien.phi)) },
        { key: "pct", label: "% doanh thu", align: "right", render: (n) => pct(totalFees(n.du_kien.phi), n.du_kien.doanh_thu) },
        {
            key: "nguon", label: "Phí thật / ước", align: "right",
            render: (n) => {
                const total = (n.tk!.kien.tong.n - n.tk!.kien.huy.n);
                return `${formatNumber(Math.max(0, total - n.tk!.phi_uoc))} / ${formatNumber(n.tk!.phi_uoc)}`;
            },
        },
    ];
    return (
        <ReportTable
            emoji="🚚" title="Chi phí 3PL"
            note="Phí thật = kiện đã có trong sao kê 3PL; ước = theo trung bình kiện đã có sao kê, hoặc bảng giá khi nước chưa có sao kê. Cơ sở từng nước ở chú thích cuối tab."
            columns={cols} rows={rows} rowKey={(n) => n.code} minWidth={860}
        />
    );
}
