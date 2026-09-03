// 已推送去重状态：保证每条线报只推送一次
// 云端(GitHub Actions)通过 actions/cache 持久化 data/ 目录；本地直接读写文件。
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'data', 'wool-seen.json');
const TTL_MS = 7 * 24 * 3600 * 1000; // 条目状态保留 7 天，足够覆盖最长断档
const MAX_ENTRIES = 5000;

function load() {
  try {
    const db = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
    return typeof db.items === 'object' && db.items ? db : { items: {} };
  } catch {
    return { items: {} };
  }
}

function save(db) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
}

/** 清理过期/超量状态 */
function prune(db) {
  const now = Date.now();
  const entries = Object.entries(db.items)
    .filter(([, ts]) => now - ts < TTL_MS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_ENTRIES);
  return { items: Object.fromEntries(entries) };
}

/**
 * 过滤出未推送过的条目并登记
 * @param {Array<{id:string}>} items
 * @param {boolean} persist 是否登记落盘；dry-run/mock 传 false 只判断不登记，避免污染真实推送状态
 * @returns {Array} 新条目（原顺序）
 */
function filterNew(items, persist = true) {
  const db = prune(load());
  const fresh = items.filter((it) => !db.items[it.id]);
  if (persist) {
    for (const it of fresh) db.items[it.id] = Date.now();
    if (fresh.length) save(db);
    else save(db); // prune 结果也落盘，避免状态无限膨胀
  }
  return fresh;
}

module.exports = { load, save, filterNew, FILE };
