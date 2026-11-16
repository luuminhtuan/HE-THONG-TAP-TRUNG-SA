#!/bin/bash
# Canh máy chủ TỪ MÁY MAC (13/11/2026).
#
# Vì sao: bot Zalo nằm cùng máy chủ với dashboard — máy chủ đứng là bot câm theo, không ai được
# báo. 13/10/2026 máy chủ đứng 19:24 → 08:55 hôm sau mới có người thấy. Script này chạy ở nơi
# khác (máy Mac, launchd 5 phút một lần), gọi trang đăng nhập; hỏng 2 lượt liền (~10 phút) thì
# bật hộp thoại + thông báo trên Mac. Lên lại thì báo một lần nữa.
#
# Giới hạn: Mac tắt / ngủ thì không canh. Mac mất mạng thì bỏ lượt, không kêu oan.
# Cài:  bash ops/mac-watch/install.sh        Gỡ:  bash ops/mac-watch/install.sh --uninstall
URL="${TALPHA_WATCH_URL:-https://139.180.131.21/login}"
DIR="$HOME/.talpha-watch"; mkdir -p "$DIR"
FAIL_COUNT_FILE="$DIR/fail_count"; ALERTED_FILE="$DIR/alerted"; LOG="$DIR/watch.log"
THRESHOLD=2
now_vn() { date '+%d/%m %H:%M'; }
notify() {   # $1 tiêu đề, $2 nội dung, $3 = "dialog" thì thêm hộp thoại nằm lại tới khi bấm
    /usr/bin/osascript -e "display notification \"$2\" with title \"$1\" sound name \"Sosumi\"" >/dev/null 2>&1
    [ "$3" = "dialog" ] && (/usr/bin/osascript -e "display alert \"$1\" message \"$2\" as critical" >/dev/null 2>&1 &)
}
code=$(/usr/bin/curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$URL" 2>/dev/null); code=${code:-000}
if [ "$code" = "200" ]; then
    if [ -f "$ALERTED_FILE" ]; then
        notify "Dashboard ANTALO đã lên lại" "Máy chủ trả lời lại lúc $(now_vn). Đứng từ $(cat "$ALERTED_FILE")."
        echo "$(now_vn) UP AGAIN (down since $(cat "$ALERTED_FILE"))" >> "$LOG"; rm -f "$ALERTED_FILE"
    fi
    rm -f "$FAIL_COUNT_FILE"; exit 0
fi
# Mac mất mạng thì không kết luận gì về máy chủ.
/usr/bin/curl -s -o /dev/null --max-time 10 https://www.apple.com/library/test/success.html 2>/dev/null \
    || { echo "$(now_vn) skipped: Mac offline" >> "$LOG"; exit 0; }
n=$(( $(cat "$FAIL_COUNT_FILE" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$FAIL_COUNT_FILE"
echo "$(now_vn) DOWN attempt $n (HTTP $code)" >> "$LOG"
if [ "$n" -ge "$THRESHOLD" ] && [ ! -f "$ALERTED_FILE" ]; then
    now_vn > "$ALERTED_FILE"
    notify "MÁY CHỦ ANTALO KHÔNG TRẢ LỜI" "Dashboard không vào được từ $(now_vn) (HTTP $code). Bot Zalo cùng máy nên cũng đang câm. Vào Vultr xem máy chủ, hoặc mở Claude bảo kiểm." dialog
fi
tail -n 500 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
