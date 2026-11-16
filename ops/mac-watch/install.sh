#!/bin/bash
# Cài / gỡ việc canh máy chủ trên máy Mac — xem watch-server.sh.
# Script được CHÉP ra ~/.talpha-watch: launchd không được đọc thư mục Desktop (macOS chặn).
#   Cài: bash ops/mac-watch/install.sh        Gỡ: bash ops/mac-watch/install.sh --uninstall
set -euo pipefail
LABEL=vn.antalo.watch-server
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DIR="$HOME/.talpha-watch"
# Bản cài trước 16/11/2026 mang tên cũ (vn.antalo.canh-may-chu, canh-may-chu.sh) — gỡ luôn để không chạy hai bản.
OLD_LABEL=vn.antalo.canh-may-chu
launchctl bootout "gui/$(id -u)/$OLD_LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$OLD_LABEL.plist" "$DIR/canh-may-chu.sh"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
if [ "${1:-}" = "--uninstall" ] || [ "${1:-}" = "--go" ]; then rm -f "$PLIST"; echo "Đã gỡ. (Nhật ký còn ở $DIR)"; exit 0; fi
mkdir -p "$DIR" "$HOME/Library/LaunchAgents"
cp "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/watch-server.sh" "$DIR/watch-server.sh"
chmod +x "$DIR/watch-server.sh"
cat > "$PLIST" <<P
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$DIR/watch-server.sh</string></array>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><true/>
</dict></plist>
P
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Đã cài: 5 phút gọi máy chủ một lần. Nhật ký: $DIR/watch.log"
