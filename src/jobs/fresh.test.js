// 有效期过滤自测：node src/jobs/fresh.test.js
// 过期岗位一旦被推送就是纯噪声（岗位已招满/下线），边界与"无日期"处理必须固定下来。
const assert = require('assert');
const { isExpired, parseTime } = require('./index');

const DAY = 86400000;
const now = new Date('2026-10-01T00:00:00').getTime();
const ago = (days) => new Date(now - days * DAY);
const fmt = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

const fresh180 = { maxAgeDays: 180, keepUndated: true };
const cases = [
  ['5 天前', { publishedAt: ago(5).toISOString() }, fresh180, false],
  ['179 天前（边界内）', { publishedAt: ago(179).toISOString() }, fresh180, false],
  ['181 天前（越界）', { publishedAt: ago(181).toISOString() }, fresh180, true],
  ['本地格式时间串', { publishedAt: fmt(ago(10)) }, fresh180, false],
  ['仅日期（179 天前）', { publishedText: '2026-04-05' }, fresh180, false],
  ['仅日期（一年前）', { publishedText: '2025-01-01' }, fresh180, true],
  ['无法解析的时间', { publishedAt: 'recently' }, fresh180, false],
  ['无任何日期 → 保留', {}, fresh180, false],
  ['无日期且要求丢弃', {}, { maxAgeDays: 180, keepUndated: false }, true],
  ['收紧到 90 天：100 天前丢弃', { publishedAt: ago(100).toISOString() }, { maxAgeDays: 90 }, true],
  ['关闭过滤(maxAgeDays=0)', { publishedAt: ago(3000).toISOString() }, { maxAgeDays: 0 }, false],
];

let failed = 0;
for (const [name, item, rule, expect] of cases) {
  const got = isExpired(item, rule, now);
  try {
    assert.strictEqual(got, expect, `${name}: 期望 ${expect} 实得 ${got}`);
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`  ✗ ${e.message}`);
  }
}

// parseTime 兜底：绝不抛错
for (const v of [undefined, null, '', 'abc', 123, '2026-10-01T00:00:00Z']) {
  assert.doesNotThrow(() => parseTime(v), `parseTime(${JSON.stringify(v)}) 不应抛错`);
}
console.log('  ✓ parseTime 对异常输入不抛错');

console.log(`\n有效期过滤自测：${cases.length - failed}/${cases.length} 通过`);
if (failed) process.exitCode = 1;
