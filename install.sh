#!/bin/bash
# 最佳效率调度中心 — LaunchAgent 一键安装脚本（幂等，可重复执行）
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LABEL="com.moon.efficiency-scheduler"
PLIST_SRC="$DIR/launch/${LABEL}.plist"
PLIST_DST="$HOME/Library/LaunchAgents/${LABEL}.plist"

NODE_BIN="$(command -v node)"
[ -n "$NODE_BIN" ] || { echo "❌ 未找到 node，请先安装 Node.js"; exit 1; }

mkdir -p "$DIR/logs"

# 渲染占位符后写入 LaunchAgents 目录
sed -e "s|__PROJECT_DIR__|$DIR|g" -e "s|__NODE_BIN__|$NODE_BIN|g" "$PLIST_SRC" > "$PLIST_DST"
plutil -lint "$PLIST_DST" > /dev/null || { echo "❌ plist 校验失败"; exit 1; }

UID_N="$(id -u)"
# 幂等：先卸载旧实例再装载
launchctl bootout "gui/$UID_N/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID_N" "$PLIST_DST"
launchctl enable "gui/$UID_N/$LABEL"
launchctl kickstart -k "gui/$UID_N/$LABEL"

echo "✅ 已安装并启动：$LABEL"
echo "   状态检查：launchctl print gui/$UID_N/$LABEL | head -20"
echo "   服务验证：curl -s http://localhost:3618/api/state"
echo "   日志文件：$DIR/logs/launchd.{out,err}.log"
