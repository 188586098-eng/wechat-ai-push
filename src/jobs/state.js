// 去重状态：两级去重
//   1) 主键 id（站点+岗位号）—— 同一岗位重复出现只记一次
//   2) 内容指纹（单位+岗位+地点）—— 同一岗位在多个站点/多个搜索词下出现时合并
const fs = require('fs');
const path = require('path');

const TTL_MS = 180 * 86400000; // 岗位信息保留 180 天，覆盖较长断档期
const MAX_ENTRIES = 20000;

function fingerprintOf(item) {
  const norm = (s) => String(s || '').replace(/[\s\u3000（）()【】\[\]·,，、-]/g, '').toLowerCase();
  const key = [norm(item.company), norm(item.title), norm(item.location)].join('|');
  // 单位与岗位都缺失时指纹不可靠，退化为按 id 去重
  if (!norm(item.company) && !norm(item.title)) return '';
  return key;
}

class State {
  constructor(file) {
    this.file = file;
    this.db = { items: {}, fingerprints: {} };
    this.dirty = false;
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf-8'));
      this.db = {
        items: (raw && raw.items) || {},
        fingerprints: (raw && raw.fingerprints) || {},
      };
    } catch {
      this.db = { items: {}, fingerprints: {} };
    }
    this.prune();
    return this;
  }

  prune() {
    const now = Date.now();
    const trim = (obj) => {
      const entries = Object.entries(obj)
        .filter(([, ts]) => now - ts < TTL_MS)
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_ENTRIES);
      return Object.fromEntries(entries);
    };
    this.db.items = trim(this.db.items);
    this.db.fingerprints = trim(this.db.fingerprints);
  }

  /**
   * 过滤出全新条目
   * @param {Array} items 已命中关键词的条目
   * @param {boolean} persist 是否登记（dry-run 只判断不登记）
   * @returns {Array} 新条目
   */
  filterNew(items, persist = true) {
    const fresh = [];
    const newFp = new Set();
    for (const it of items) {
      if (this.db.items[it.id]) continue;
      const fp = fingerprintOf(it);
      if (fp && (this.db.fingerprints[fp] || newFp.has(fp))) {
        it.duplicateOf = 'fingerprint';
        continue;
      }
      if (persist) {
        this.db.items[it.id] = Date.now();
        if (fp) {
          this.db.fingerprints[fp] = Date.now();
          newFp.add(fp);
        }
        this.dirty = true;
      }
      fresh.push(it);
    }
    return fresh;
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.db, null, 2));
      this.dirty = false;
    } catch (e) {
      throw new Error(`去重状态写入失败: ${e.message}`);
    }
  }

  stats() {
    return { items: Object.keys(this.db.items).length, fingerprints: Object.keys(this.db.fingerprints).length };
  }
}

module.exports = { State, fingerprintOf, TTL_MS, MAX_ENTRIES };
