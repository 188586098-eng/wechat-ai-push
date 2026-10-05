// 控制台报告：每轮运行结束后的可读摘要（也要写进日志，便于无人值守时事后排查）
const { CATEGORY_LABEL } = require('./keywords');

function pad(s, n) {
  const str = String(s == null ? '' : s);
  let w = 0;
  for (const ch of str) w += /[\u4e00-\u9fa5\uff00-\uffef]/.test(ch) ? 2 : 1;
  if (w <= n) return str + ' '.repeat(n - w);
  // 超长截断，按显示宽度裁剪
  let out = '';
  let used = 0;
  for (const ch of str) {
    const cw = /[\u4e00-\u9fa5\uff00-\uffef]/.test(ch) ? 2 : 1;
    if (used + cw > n - 1) break;
    out += ch;
    used += cw;
  }
  return out + '…';
}

/** 打印岗位清单 */
function printItems(items, limit = 30) {
  if (!items.length) {
    console.log('  （本轮无新增）');
    return;
  }
  console.log(`  ${pad('方向', 10)}${pad('岗位名称', 30)}${pad('单位', 24)}${pad('地点', 16)}${pad('薪资', 14)}发布时间`);
  console.log('  ' + '-'.repeat(110));
  for (const it of items.slice(0, limit)) {
    console.log(
      `  ${pad(CATEGORY_LABEL[it.category] || '-', 10)}${pad(it.title, 30)}${pad(it.company, 24)}${pad(it.location, 16)}${pad(it.salary, 14)}${it.publishedText || it.publishedAt || '-'}`,
    );
  }
  if (items.length > limit) console.log(`  ... 其余 ${items.length - limit} 条见 data/jobs/jobs.md`);
}

/** 打印整轮统计 */
function printSummary(stats) {
  console.log('');
  console.log('===== 本轮采集摘要 =====');
  for (const [site, s] of Object.entries(stats.sites)) {
    const fail = s.error ? `  ERROR: ${s.error}` : '';
    console.log(`  [${site}] 抓取 ${s.fetched} 条 / 命中岗位 ${s.matched} 条 / 新增 ${s.added} 条${fail}`);
  }
  console.log(`  合计: 抓取 ${stats.totalFetched} → 命中 ${stats.totalMatched} → 去重后新增 ${stats.totalAdded}`);
  if (stats.dropped.length) {
    const top = {};
    for (const d of stats.dropped) top[d.reason] = (top[d.reason] || 0) + 1;
    console.log('  未收录原因分布: ' + Object.entries(top).map(([k, v]) => `${k}×${v}`).join('，'));
  }
  console.log(`  耗时 ${(stats.elapsedMs / 1000).toFixed(1)}s`);
}

module.exports = { printItems, printSummary, pad };
