// 调度时间计算回归自测：node src/jobs/scheduler.test.js
// 定时逻辑一旦算错，程序会"看起来在跑但从不采集"，因此固定样例做回归。
const assert = require('assert');
const { nextRunAt, describe } = require('./scheduler');

const fmt = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

// daily：今天 08:30 已过 → 落到次日 08:30
let from = new Date(2026, 8, 30, 12, 0, 0);
let next = nextRunAt({ mode: 'daily', at: ['08:30'] }, from);
assert.strictEqual(new Date(next).getDate(), 1, `期望 10-01，实得 ${fmt(next)}`);
assert.strictEqual(new Date(next).getHours(), 8);
assert.strictEqual(new Date(next).getMinutes(), 30);
console.log('  ✓ daily 今日时刻已过 → 次日', fmt(next));

// daily：今天 08:30 未到 → 今天 08:30
from = new Date(2026, 8, 30, 6, 0, 0);
next = nextRunAt({ mode: 'daily', at: ['08:30', '20:00'] }, from);
assert.strictEqual(new Date(next).getDate(), 30, `期望 09-30，实得 ${fmt(next)}`);
assert.strictEqual(new Date(next).getHours(), 8);
console.log('  ✓ daily 多时刻取最近一次', fmt(next));

// daily：全部时刻已过 → 次日最早时刻
from = new Date(2026, 8, 30, 21, 0, 0);
next = nextRunAt({ mode: 'daily', at: ['08:30', '20:00'] }, from);
assert.strictEqual(new Date(next).getDate(), 1);
assert.strictEqual(new Date(next).getHours(), 8);
console.log('  ✓ daily 全部已过 → 次日最早', fmt(next));

// interval：固定间隔
from = new Date(2026, 8, 30, 12, 0, 0);
next = nextRunAt({ mode: 'interval', intervalHours: 6 }, from);
assert.strictEqual(next - from.getTime(), 6 * 3600 * 1000);
console.log('  ✓ interval 6 小时 →', fmt(next));

// 非法/缺失配置兜底：不得抛错，且必须在未来
next = nextRunAt({ mode: 'daily', at: [] }, from);
assert.ok(next > from.getTime());
assert.ok(next - from.getTime() <= 24 * 3600 * 1000 + 1000);
console.log('  ✓ daily 无有效时刻 → 兜底 24 小时内', fmt(next));

console.log('\n调度时间计算自测通过');
