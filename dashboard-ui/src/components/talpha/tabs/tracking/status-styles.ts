export const STATUS_VI: Record<string, string> = {
    NotFound: "Chưa có thông tin", InfoReceived: "Đã tạo vận đơn", InTransit: "Đang vận chuyển",
    Expired: "Quá hạn theo dõi", AvailableForPickup: "Đã tới cửa hàng", OutForDelivery: "Đang giao",
    DeliveryFailure: "Giao hỏng", Delivered: "Đã giao", Exception: "Sự cố",
    // Ba trạng thái chỉ file đối tác mới có:
    Returned: "Đã hoàn về kho", Cancelled: "Đã huỷ", Destroyed: "Đã tiêu huỷ",
};
export const STATUS_STYLE: Record<string, string> = {
    AvailableForPickup: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
    Delivered: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
    DeliveryFailure: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
    Exception: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
    InTransit: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400",
    OutForDelivery: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400",
    Returned: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
    Cancelled: "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-400",
    Destroyed: "bg-slate-200 text-slate-700 dark:bg-slate-500/25 dark:text-slate-300",
};
export const LEVEL_STYLE = {
    gap: { bar: "bg-rose-500", chip: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400", label: "Gấp" },
    canh_bao: { bar: "bg-amber-500", chip: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400", label: "Cảnh báo" },
    nhac: { bar: "bg-slate-300 dark:bg-slate-600", chip: "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-400", label: "Nhắc" },
} as const;
