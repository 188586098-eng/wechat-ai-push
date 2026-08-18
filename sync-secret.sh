#!/bin/bash
# 将本地 wewe-rss 数据库中的最新微信读书 token 同步到 GitHub Actions Secret
# 用法: ./sync-secret.sh
# 依赖: gh CLI 已登录(或环境变量 GH_TOKEN)、node >= 22(原生 sqlite)
set -euo pipefail

REPO="${1:-188586098-eng/wechat-ai-push}"
DB="/tmp/opencode/wewe-rss/apps/server/data/wewe-rss.db"
ACCOUNT_ID="${ACCOUNT_ID:-431803268}"

if [ ! -f "$DB" ]; then
  echo "错误: 数据库不存在: $DB" >&2
  exit 1
fi

echo "读取本地库 token..."
TOKEN=$(node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('$DB');
const row = db.prepare('SELECT token, status FROM accounts WHERE id=?').get('$ACCOUNT_ID');
db.close();
if (!row) { console.error('账号不存在: $ACCOUNT_ID'); process.exit(1); }
if (row.status !== 1) { console.error('账号状态异常 status=' + row.status); process.exit(1); }
process.stdout.write(row.token);
" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  echo "错误: 读取 token 失败或 token 为空" >&2
  exit 1
fi
echo "读取成功 (长度 ${#TOKEN})"

echo "更新 GitHub Secret WEWE_TOKEN -> $REPO..."
if printf '%s' "$TOKEN" | gh secret set WEWE_TOKEN --repo "$REPO"; then
  echo "同步完成: WEWE_TOKEN 已更新"
else
  echo "同步失败: 请确认 gh 已登录或 GH_TOKEN 环境变量已设置" >&2
  exit 1
fi
