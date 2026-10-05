// 水利行业招聘信息采集入口
//
// 用法:
//   node src/jobs/index.js                 # 采集一轮 → 关键词筛选 → 去重 → 落盘(JSONL/JSON/CSV/MD) → 微信推送新增
//   node src/jobs/index.js --dry-run       # 只采集与打印，不写文件、不登记去重状态、不推送
//   node src/jobs/index.js --no-push       # 真实采集落盘，但不推微信
//   node src/jobs/index.js --mock          # 内置样例数据跑通全链路（不发网络请求）
//   node src/jobs/index.js --site=zhaopin  # 只跑指定渠道
//   node src/jobs/index.js --stats         # 查看历史运行记录
//   node src/jobs/scheduler.js             # 常驻按计划定时执行
//
// 渠道：智联招聘(HTTP) / BOSS·51job·猎聘(Playwright) / 水利行业公告(通用配置采集)
const path = require('path');
const config = require('./config');
const log = require('./log');
const { createClient } = require('./net');
const keywords = require('./keywords');
const { State } = require('./state');
const store = require('./store');
const report = require('./report');
const notify = require('./notify');

function parseArgs(argv) {
  const args = { sites: [], flags: new Set() };
  for (const a of argv) {
    if (a.startsWith('--site=')) args.sites.push(a.slice(7));
    else args.flags.add(a.replace(/^--/, ''));
  }
  return args;
}

/** 选择渠道对应的适配器类型 */
/** HTTP 型适配器：按渠道 key 选模块（新增同类站点只需在此登记一行） */
const HTTP_ADAPTERS = {
  zhaopin: './adapters/zhaopin',
  job2299: './adapters/job2299',
  jianlihr: './adapters/jianlihr',
  waterhr: './adapters/waterhr',
};

/** 选择渠道对应的适配器类型 */
function adapterOf(key, site) {
  if (HTTP_ADAPTERS[key]) return 'http';
  if (site.rule && site.rule.itemPattern) return 'generic';
  if (site.selectors) return 'browser';
  return 'unknown';
}

/** 采集单个渠道；任何异常都在此收敛，返回已抓到的部分结果 */
async function collectSite({ key, site, adapter, client, cfg, dryRun }) {
  const result = { fetched: [], errors: [] };
  if (adapter === 'http') {
    const mod = require(HTTP_ADAPTERS[key]);
    // queryless 适配器（按整站列表抓取的垂直站）不按关键词重复抓同一批列表
    const queries = mod.queryless ? [null] : cfg.queries;
    for (const query of queries) {
      try {
        const items = await mod.fetchPages({ client, site, query });
        log.info(query ? `[${site.name}] 「${query}」抓到 ${items.length} 条` : `[${site.name}] 抓到 ${items.length} 条`);
        result.fetched.push(...items);
      } catch (e) {
        result.errors.push(query ? `「${query}」${e.message}` : e.message);
        if (e.partial) result.fetched.push(...e.partial);
      }
    }
  } else if (adapter === 'browser') {
    const mod = require('./adapters/browser');
    for (const query of cfg.queries) {
      try {
        const items = await mod.fetchPages({ client, site, query });
        log.info(`[${site.name}] 「${query}」抓到 ${items.length} 条`);
        result.fetched.push(...items);
      } catch (e) {
        if (e.skippable) {
          result.errors.push(e.message);
          break;
        }
        result.errors.push(`「${query}」${e.message}`);
      }
    }
  } else if (adapter === 'generic') {
    const mod = require('./adapters/generic');
    try {
      const items = await mod.fetchSite({ client, site, queries: cfg.queries });
      log.info(`[${site.name}] 抓到 ${items.length} 条公告/岗位`);
      result.fetched.push(...items);
    } catch (e) {
      result.errors.push(e.message);
    }
  } else {
    result.errors.push(`渠道 ${key} 既无 rule 也无 selectors，跳过`);
  }
  return result;
}

/** 归一化字段，生成稳定 id */
function normalize(raw, site, siteKey) {
  const siteJobId = String(raw.siteJobId || raw.url || '').trim();
  return {
    id: `${siteKey}-${siteJobId}`,
    site: siteKey,
    siteName: site.name || siteKey,
    sourceType: raw.sourceType || site.sourceType || 'job',
    category: 'other',
    title: String(raw.title || '').trim(),
    company: String(raw.company || '').trim(),
    location: String(raw.location || '').trim(),
    salary: String(raw.salary || '').trim(),
    publishedAt: raw.publishedAt || '',
    publishedText: raw.publishedText || '',
    url: raw.url || '',
    keyword: '',
    tags: Array.isArray(raw.tags) ? raw.tags.filter(Boolean) : [],
    query: raw.query || '',
    collectedAt: new Date().toISOString(),
    firstSeenAt: new Date().toISOString(),
    extra: raw.extra || undefined,
  };
}

/** 智联等支持详情页的渠道：为新命中的岗位补全权威发布时间 */
async function enrichDetails({ items, site, siteKey, client, maxPerRun }) {
  const mod = require('./adapters/zhaopin');
  if (siteKey !== 'zhaopin' || !site.detailEnrich) return { enriched: 0, failed: 0 };
  let enriched = 0;
  let failed = 0;
  for (const it of items.slice(0, maxPerRun)) {
    const url = (site.detailUrl || '').replace('{id}', it.id.replace(`${siteKey}-`, ''));
    if (!url) break;
    try {
      const res = await client.getText(url);
      const detail = mod.parseDetail(res.text, it.id.replace(`${siteKey}-`, ''));
      if (!detail) {
        failed += 1;
        continue;
      }
      if (detail.publishedAt) {
        it.publishedAt = detail.publishedAt;
        it.publishedText = detail.publishedText;
      }
      if (detail.salary) it.salary = detail.salary;
      if (detail.company) it.company = detail.company;
      // 详情页要求与列表页标签合并而非覆盖：标签是“为何命中关键词”的审计依据，不能丢
      if (detail.tags && detail.tags.length) it.tags = [...new Set([...it.tags, ...detail.tags])];
      enriched += 1;
    } catch (e) {
      failed += 1;
      log.warn(`详情页解析失败 ${it.url}: ${e.message}`);
    }
  }
  return { enriched, failed };
}

/** 解析时间：兼容 ISO、'YYYY-MM-DD HH:mm:ss'、'YYYY-MM-DD'；无法解析返回 0 */
function parseTime(v) {
  if (!v) return 0;
  const s = String(v).trim();
  const t = Date.parse(s.includes('T') || s.endsWith('Z') ? s : s.replace(' ', 'T'));
  return Number.isNaN(t) ? 0 : t;
}

/** 过期岗位不收录：公开招聘信息生命周期短，半年前的岗位基本已招满或下线 */
function isExpired(item, fresh, now = Date.now()) {
  if (!fresh || !(fresh.maxAgeDays > 0)) return false;
  const t = parseTime(item.publishedAt) || parseTime(item.publishedText);
  if (!t) return fresh.keepUndated === false; // 无日期：默认保留，配置为 false 时丢弃
  return now - t > fresh.maxAgeDays * 86400000;
}

/** 内置样例数据：验证“筛选→去重→落盘”全链路，不产生网络请求 */
function mockItems() {
  const now = new Date().toISOString();
  const base = [
    ['zhaopin', '智联招聘', 'CCL1001J1001', '水利工程监理工程师', '某水利工程监理有限公司', '成都·武侯区', '8000-12000元', '2026-09-29T09:12:00'],
    ['zhaopin', '智联招聘', 'CCL1002J1002', '总监理工程师（水利水电）', '某水利水电建设集团', '武汉·江岸区', '15000-20000元', '2026-09-28T14:37:57'],
    ['zhaopin', '智联招聘', 'CCL1003J1003', '水利工程项目副经理', '某水利建设有限公司', '合肥·蜀山区', '12000-18000元', '2026-09-28T10:03:00'],
    ['zhaopin', '智联招聘', 'CCL1004J1004', '水利水电资料员', '某建筑工程有限公司', '南充·仪陇县', '4000-7000元', '2026-09-27T08:30:00'],
    // 应被排除：非水利行业的监理岗（缺行业上下文）
    ['zhaopin', '智联招聘', 'CCL1005J1005', '装修监理', '某家装公司', '北京·朝阳区', '7000-9000元', '2026-09-27T08:30:00'],
    // 应被排除：命中排除词
    ['zhaopin', '智联招聘', 'CCL1006J1006', '保险资料员', '某保险公司', '广州·天河区', '5000-6000元', '2026-09-27T08:30:00'],
    // 公告类
    ['cweun', '中国水利工程协会', 'https://www.cweun.org/show.php?cid=16&id=9001', '中国水利工程协会2026年度公开招聘公告', '中国水利工程协会', '', '', '2026-09-26T00:00:00'],
  ];
  return base.map(([site, siteName, jobId, title, company, location, salary, publishedAt]) => ({
    site,
    siteName,
    sourceType: site === 'cweun' ? 'notice' : 'job',
    siteJobId: jobId,
    title,
    company,
    location,
    salary,
    publishedAt,
    publishedText: publishedAt.slice(0, 10),
    url: site === 'cweun' ? jobId : `http://www.zhaopin.com/jobdetail/${jobId}.htm`,
    tags: [],
    collectedAt: now,
  }));
}

/** 关闭浏览器实例：不引入适配器依赖（未启用时 require 也只是加载空壳） */
async function closeBrowserQuietly() {
  try {
    const { closeBrowser } = require('./adapters/browser');
    await closeBrowser();
  } catch {
    // 未安装 playwright 或未启用浏览器渠道时无需处理
  }
}

async function run(argv = process.argv.slice(2)) {
  // 无论成功失败都要回收 Chromium，否则常驻调度模式下进程会一直挂住不退出
  try {
    return await runImpl(argv);
  } finally {
    await closeBrowserQuietly();
  }
}

async function runImpl(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const cfg = config.resolve();
  const t0 = Date.now();
  const dryRun = args.flags.has('dry-run') || args.flags.has('mock');
  const mock = args.flags.has('mock');

  log.init({ dir: path.join(cfg.dir, 'logs'), retentionDays: cfg.output.logRetentionDays });

  if (args.flags.has('stats')) return printStats(cfg);

  if (!cfg.enabled) {
    log.warn('config.json 中 jobs.enabled=false，已跳过本次采集');
    return { skipped: true };
  }

  // 渠道列表日志与后续采集必须同源（--site= 时只跑指定渠道；未指定则只跑已启用渠道）
  const siteKeys = args.sites.length ? args.sites : Object.keys(cfg.sites).filter((k) => cfg.sites[k].enabled);
  log.info(`开始采集：渠道=${siteKeys.join(',')} 关键词=${cfg.queries.join('、')}`);

  const state = new State(path.join(cfg.dir, 'seen.json')).load();
  const client = createClient(cfg.fetch);

  const stats = {
    sites: {},
    dropped: [],
    totalFetched: 0,
    totalMatched: 0,
    totalAdded: 0,
  };
  const matchedAll = [];

  // 1) 采集 + 2) 关键词筛选
  let rawItems = [];
  if (mock) {
    rawItems = mockItems();
  } else {
    for (const key of siteKeys) {
      const site = cfg.sites[key];
      if (!site) {
        log.warn(`未知渠道 ${key}，跳过`);
        continue;
      }
      if (!site.enabled) {
        // 显式点名却未启用时要说出来，否则用户会以为跑过但没输出
        if (args.sites.length) log.warn(`渠道 ${key} 未启用（config.json 中 enabled 为 false），已跳过`);
        else log.debug(`渠道 ${key} 未启用，跳过`);
        continue;
      }
      const adapter = adapterOf(key, site);
      const res = await collectSite({ key, site, adapter, client, cfg, dryRun });
      const normalized = res.fetched.map((r) => normalize(r, { ...site, name: site.name }, key));
      stats.sites[key] = { fetched: normalized.length, matched: 0, added: 0, error: res.errors.join(' | ') || '' };
      stats.totalFetched += normalized.length;
      if (res.errors.length) log.warn(`[${site.name}] 部分失败: ${res.errors.join(' | ')}`);
      rawItems.push(...normalized);
    }
  }

  for (const it of rawItems) {
    const m = keywords.match(it, cfg.keywords);
    if (!m.ok) {
      stats.dropped.push({ title: it.title, reason: m.reason });
      continue;
    }
    // 关键词命中后还要过有效期：推已失效岗位等于制造噪声
    if (isExpired(it, cfg.fresh)) {
      stats.dropped.push({ title: it.title, reason: `过期(早于${cfg.fresh.maxAgeDays}天)` });
      continue;
    }
    it.category = m.category;
    it.keyword = m.hit;
    matchedAll.push(it);
    if (stats.sites[it.site]) stats.sites[it.site].matched += 1;
  }
  stats.totalMatched = matchedAll.length;
  log.info(`关键词筛选：${rawItems.length} 条 → 命中 ${matchedAll.length} 条`);

  // 3) 去重（同一 id 与同内容指纹只保留一次）
  const fresh = state.filterNew(matchedAll, !dryRun);
  log.info(`去重：命中 ${matchedAll.length} 条 → 新增 ${fresh.length} 条`);

  // 4) 详情页补全发布时间（限流，只对新命中条目）
  if (!mock && fresh.length) {
    const bySite = new Map();
    for (const it of fresh) {
      if (!bySite.has(it.site)) bySite.set(it.site, []);
      bySite.get(it.site).push(it);
    }
    for (const [key, list] of bySite) {
      const site = cfg.sites[key];
      const maxPerRun = Number(site.detailMaxPerRun) || 15;
      const r = await enrichDetails({ items: list, site: { ...site, detailEnrich: site.detailEnrich }, siteKey: key, client, maxPerRun });
      if (r.enriched || r.failed) log.info(`[${site.name}] 详情页补全 ${r.enriched} 条，失败 ${r.failed} 条`);
    }
  }

  for (const it of fresh) if (stats.sites[it.site]) stats.sites[it.site].added += 1;
  stats.totalAdded = fresh.length;

  // 5) 落盘
  let files = null;
  if (!dryRun) {
    try {
      files = store.persist(cfg, fresh, { queries: cfg.queries });
      state.save();
    } catch (e) {
      log.error(`结果落盘失败: ${e.message}`);
    }
  }

  // 5.5) 微信推送（只推本轮新增；先落盘再推送，推送失败不丢数据）
  let pushResult = null;
  if (!dryRun && !args.flags.has('no-push')) {
    try {
      pushResult = await notify.pushNewItems(cfg, fresh);
      if (pushResult.pushed) log.info(`已推送微信：列出 ${pushResult.pushed} 条（共 ${pushResult.total} 条新增）`);
    } catch (e) {
      log.error(`微信推送失败: ${e.message}`);
    }
  }

  // 6) 报告与运行记录
  stats.elapsedMs = Date.now() - t0;
  report.printSummary(stats);
  report.printItems(fresh);
  if (files) {
    console.log('');
    console.log(`  结果文件: ${path.relative(config.ROOT, files.csv)}（表格）/ ${path.relative(config.ROOT, files.md)}（阅读）/ ${path.relative(config.ROOT, files.jsonl)}（全量增量）`);
  } else if (dryRun) {
    console.log('  [dry-run] 未写入任何文件，也未登记去重状态。');
  }
  log.info(
    `本轮结束：抓取 ${stats.totalFetched} → 命中 ${stats.totalMatched} → 新增 ${stats.totalAdded}，耗时 ${(stats.elapsedMs / 1000).toFixed(1)}s`,
  );

  if (!dryRun) {
    store.appendRun(path.join(cfg.dir, 'runs.jsonl'), {
      fetched: stats.totalFetched,
      matched: stats.totalMatched,
      added: stats.totalAdded,
      pushed: pushResult ? pushResult.pushed : 0,
      elapsedSec: Math.round(stats.elapsedMs / 1000),
      bySite: Object.fromEntries(Object.entries(stats.sites).map(([k, v]) => [k, { f: v.fetched, m: v.matched, a: v.added, err: v.error || '' }])),
      mode: args.flags.has('mock') ? 'mock' : 'live',
    });
  }

  return { stats, added: fresh.length, files, pushed: pushResult ? pushResult.pushed : 0 };
}

/** 展示用：把 runs.jsonl 里存的 ISO(UTC) 时间转成本地时间，与日志保持一致 */
function fmtLocal(iso) {
  const t = parseTime(iso);
  if (!t) return String(iso || '').slice(0, 19);
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** --stats：查看最近若干轮运行的稳定性 */
function printStats(cfg) {
  const rows = store.readJsonl(path.join(cfg.dir, 'runs.jsonl'), cfg.output.keepRunLogs);
  if (!rows.length) {
    console.log('[jobs][stats] 暂无运行记录，先执行一次 node src/jobs/index.js');
    return { stats: true };
  }
  console.log(`\n[jobs][stats] 最近 ${rows.length} 轮运行\n`);
  console.log('时间                    抓取  命中  新增   耗时   各渠道(抓/命/新)');
  for (const r of rows) {
    const sites = Object.entries(r.bySite || {})
      .map(([k, v]) => `${k}:${v.f}/${v.m}/${v.a}${v.err ? '!' : ''}`)
      .join(' ');
    console.log(
      `${fmtLocal(r.ts)}  ${String(r.fetched).padStart(4)}  ${String(r.matched).padStart(4)}  ${String(r.added).padStart(4)}  ${String(r.elapsedSec).padStart(4)}s   ${sites}`,
    );
  }
  const zeroRuns = rows.filter((r) => r.fetched === 0).length;
  if (zeroRuns) console.log(`\n注意：有 ${zeroRuns} 轮抓取数为 0，可能是目标站改版或被限流，请检查 data/jobs/logs/ 下的日志。`);
  return { stats: true };
}

if (require.main === module) {
  // run() 内部已保证回收浏览器实例
  run()
    .then(() => {
      log.flush();
    })
    .catch((e) => {
      log.error(`运行失败: ${e.stack || e.message}`);
      log.flush();
      process.exitCode = 1;
    });
}

module.exports = { run, normalize, adapterOf, mockItems, printStats, parseArgs, parseTime, isExpired };
