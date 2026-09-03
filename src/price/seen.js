// 好价推送跨次运行去重：记录已推送的爆料 id，TTL 过期自动清理
// 云端(GitHub Actions)通过 actions/cache 持久化 data/deals-seen.json；本地直接读写文件。
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'data', 'deals-seen.json');
const TTL_MS = 14 * 24 * 3600 * 1000; // 历史低价爆料 14 天后大概率已失效，无需再记

function load() {
  try {
    const db = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
    return db.items && typeof db.items === 'object' ? db : { items: {} };
  } catch {
    return { items: {} };
  }
}

function prune(db) {
  const now = Date.now();
  const items = {};
  for (const [id, ts] of Object.entries(db.items)) {
    if (now - ts < TTL_MS) items[id] = ts;
  }
  return { items };
}

/** 已登记的 id 集合（剔除过期项，不落盘） */
function knownIds() {
  return new Set(Object.keys(prune(load()).items));
}

/** 登记一批 id 并落盘 */
function mark(ids) {
  if (!ids.length) return;
  const db = prune(load());
  const now = Date.now();
  for (const id of ids) db.items[id] = now;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(db));
}

module.exports = { knownIds, mark, FILE };
