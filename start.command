#!/bin/bash
# 最佳效率调度中心 — caffeinate 防睡眠启动
cd "$(dirname "$0")"

# 安装依赖（首次）
[ -d node_modules ] || npm install --no-fund --no-audit

# 扫描项目（无缓存时）
[ -f data/projects.json ] || node scripts/scan-projects.js &

echo "[效率调度中心] 启动中（caffeinate 防睡眠已开启）…"
caffeinate -is node server.js &
SERVER_PID=$!

sleep 1.5
open "http://localhost:3618"

echo "[效率调度中心] 面板 → http://localhost:3618 （Ctrl+C 退出）"
wait $SERVER_PID
