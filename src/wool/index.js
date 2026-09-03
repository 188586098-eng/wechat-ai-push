// 羊毛线报聚合推送入口
// 用法:
//   node src/wool/index.js             # 抓取→关键词过滤→去重→推送到微信
//   node src/wool/index.js --dry-run   # 不发送，打印报告
//   node src/wool/index.js --mock      # 内置模拟数据跑通全链路（无网络）
//
// 数据源: 白菜哦(全网好价/羊毛聚合) + 专业线报(zhuanyes.com) + 赚客吧(免费赠品/有奖活动等线报版块)
// 关键词: env WOOL_KEYWORDS / WOOL_EXCLUDE_KEYWORDS > config.json wool 段 > 内置默认
const fs = require('fs');
const path = require('path');

const config = loadConfig();
const keywords = require('./keywords');
const state = require('./state');
const report = require('./report');

/** 每次真实推送的条目明细落盘，供追溯“这条为什么推给我” */
function saveLastPush(title, items) {
  try {
    const file = path.join(__dirname, '..', '..', 'data', 'wool-last-push.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          title,
          time: new Date().toISOString(),
          items: items.map((it) => ({
            source: it.source,
            sourceName: it.sourceName,
            title: it.title,
            hit: it.hit,
            priceText: it.priceText || '',
            merchant: it.merchant || '',
            timeText: it.timeText || '',
            url: it.url,
          })),
        },
        null,
        2,
      ),
    );
  } catch {
    // 记录失败不影响推送
  }
}

function loadConfig() {
  try {
    return JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'config.json'), 'utf-8'));
  } catch {
    return {};
  }
}

function resolveToken() {
  if (process.env.PUSHPLUS_TOKEN) return process.env.PUSHPLUS_TOKEN;
  if (config.wool && config.wool.pushplusToken) return config.wool.pushplusToken;
  return config.pushplusToken || '';
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 白菜哦：按订阅关键词搜索 */
async function gatherBaicaio(rules, out, failures) {
  const baicaio = require('./adapter.baicaio');
  for (const q of rules.queries.slice(0, 30)) {
    try {
      const items = await baicaio.fetchBaicaio(q);
      console.log(`[wool][白菜哦] 「${q}」 ${items.length} 条`);
      out.push(...items);
    } catch (e) {
      failures.push(`白菜哦「${q}」: ${e.message}`);
    }
    await sleep(1000); // 克制频率，避免触发反爬
  }
}

/** 专业线报(zhuanyes.com)：首页线报流 */
async function gatherZhuanyes(out, failures) {
  const { fetchZhuanyes } = require('./adapter.zhuanyes');
  try {
    const items = await fetchZhuanyes();
    console.log(`[wool][专业线报] ${items.length} 条`);
    out.push(...items);
  } catch (e) {
    failures.push(`专业线报: ${e.message}`);
  }
}

/** 赚客吧：轮询线报版块帖子列表 */
async function gatherZuanke8(out, failures) {
  const { fetchZuanke8, DEFAULT_FORUMS } = require('./adapter.zuanke8');
  const rawForums = (config.wool && config.wool.zuanke8 && config.wool.zuanke8.forums) || DEFAULT_FORUMS;
  // 兼容两种配置写法：数字数组 [2,13]（config.example 风格）或 {fid,name} 对象数组
  const nameByFid = new Map(DEFAULT_FORUMS.map((f) => [f.fid, f.name]));
  const forums = rawForums.map((f) =>
    typeof f === 'number' ? { fid: f, name: nameByFid.get(f) || `版块${f}` } : f,
  );
  for (const forum of forums) {
    try {
      const items = await fetchZuanke8(forum);
      console.log(`[wool][赚客吧] ${forum.name} ${items.length} 帖`);
      out.push(...items);
    } catch (e) {
      failures.push(`赚客吧·${forum.name}: ${e.message}`);
    }
    await sleep(800);
  }
}

/** 新赚吧(v1.xianbao.net)：游客可读版块帖子列表 */
async function gatherXinzhuanba(out, failures) {
  const { fetchForum, DEFAULT_FORUMS } = require('./adapter.xinzhuanba');
  const cfg = (config.wool && config.wool.xinzhuanba) || {};
  if (cfg.enabled === false) return;
  const rawForums = cfg.forums || DEFAULT_FORUMS;
  const nameByFid = new Map(DEFAULT_FORUMS.map((f) => [f.fid, f.name]));
  const forums = rawForums.map((f) =>
    typeof f === 'number' ? { fid: f, name: nameByFid.get(f) || `版块${f}` } : f,
  );
  for (const forum of forums) {
    try {
      const items = await fetchForum(forum);
      console.log(`[wool][新赚吧] ${forum.name} ${items.length} 帖`);
      out.push(...items);
    } catch (e) {
      failures.push(`新赚吧·${forum.name}: ${e.message}`);
    }
    await sleep(800);
  }
}

/** 线报迷(xianbaomi.com)：首页讨论帖流 */
async function gatherXianbaomi(out, failures) {
  const cfg = (config.wool && config.wool.xianbaomi) || {};
  if (cfg.enabled === false) return;
  const { fetchXianbaomi } = require('./adapter.xianbaomi');
  try {
    const items = await fetchXianbaomi();
    console.log(`[wool][线报迷] ${items.length} 帖`);
    out.push(...items);
  } catch (e) {
    failures.push(`线报迷: ${e.message}`);
  }
}

async function run() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('--mock');
  const token = resolveToken();

  let all;
  const failures = [];
  if (args.includes('--mock')) {
    all = mockItems();
  } else {
    const rules = keywords.resolve(config);
    console.log(
      `[wool] 订阅词 ${rules.includes.length} 个、排除词 ${rules.excludes.length} 个；白菜哦搜索词: ${rules.queries.join('、')}`,
    );
    all = [];
    await gatherBaicaio(rules, all, failures);
    await gatherZhuanyes(all, failures);
    await gatherZuanke8(all, failures);
    await gatherXinzhuanba(all, failures);
    await gatherXianbaomi(all, failures);
  }

  // 1) 时效过滤默认关闭：白菜哦搜索按热度返回历史帖、赚客吧老帖常被顶起，
  //    时间过滤会误杀全部结果；去重层已保证不重复推送。需要时配置 wool.maxAgeHours 开启。
  const maxAgeHours = config.wool && config.wool.maxAgeHours;
  const fresh = maxAgeHours
    ? all.filter((it) => !it.time || Date.now() - it.time.getTime() <= maxAgeHours * 3600 * 1000)
    : all;

  // 2) 关键词匹配；论坛源附加时效过滤（Discuz 置顶老帖常被顶到列表前排，剔除超龄帖）
  const rules = keywords.resolve(config);
  const forumMaxAge = ((config.wool && config.wool.forumMaxAgeDays) || 45) * 86400000;
  const matched = [];
  for (const it of fresh) {
    if (it.source !== 'baicaio' && it.time && Date.now() - it.time.getTime() > forumMaxAge) continue;
    const r = keywords.match(it, rules);
    if (!r.ok) continue;
    matched.push({ ...it, hit: r.hit || '' });
  }

  // 3) 单次运行内按 id 合并（同一商品命中多个搜索词会重复出现，命中词拼接），
  //    再跨次运行去重（每条只推一次），最后排序限量
  const merged = new Map();
  for (const it of matched) {
    const prev = merged.get(it.id);
    if (!prev) merged.set(it.id, it);
    else if (it.hit && !prev.hit.includes(it.hit)) prev.hit = `${prev.hit}、${it.hit}`;
  }
  const unseen = state.filterNew([...merged.values()], !dryRun);
  const maxItems = (config.wool && config.wool.maxItems) || 20;
  seenFirst(all.length, matched.length, unseen.length);

  // 按来源配额限量：白菜哦商品好价易刷屏，论坛活动线报(快递/银行/通用羊毛)需保底名额，
  // 否则按全局时间排序时商品源会占满 maxItems。配额可用 config.wool.quotas 覆盖。
  const items = assignQuotas(unseen, maxItems);
  if (failures.length) console.log('[wool] 来源失败:', failures.join(' | '));

  if (!items.length) {
    console.log('[wool] 本次没有新命中，不推送。');
    return { pushed: 0 };
  }

  if (dryRun || !token) {
    console.log('\n[wool][dry-run] ' + (dryRun && token ? '--dry-run 模式，不发送。' : '未配置 token，打印报告:') + '\n');
    console.log(report.buildHtml(items));
    return { pushed: items.length };
  }

  const title = await report.send(token, items);
  saveLastPush(title, items);
  console.log(`[wool] 已推送 ${items.length} 条 → ${title}`);
  return { pushed: items.length };
}

function timeOf(it) {
  return it.time ? it.time.getTime() : 0;
}

/** 来源默认配额比例（推送名额按来源切分，商品好价源占比小，论坛活动线报源保底） */
const QUOTA_RATIO = { baicaio: 0.2, zhuanyes: 0.25, xinzhuanba: 0.2, zuanke8: 0.2, xianbaomi: 0.15 };

/** 按来源分组 → 组内时间倒序 → 按配额截断，合并返回（总额不超过 maxItems） */
function assignQuotas(items, maxItems) {
  const wool = config.wool || {};
  const bySource = new Map();
  for (const it of items) {
    if (!bySource.has(it.source)) bySource.set(it.source, []);
    bySource.get(it.source).push(it);
  }
  // 先 floor 分配，余额按顺序补给剩余来源
  const quotas = {};
  let used = 0;
  const keys = [...bySource.keys()].filter((s) => wool.quotas?.[s] != null || QUOTA_RATIO[s] != null);
  for (const s of keys) {
    const q = wool.quotas?.[s] ?? Math.floor(maxItems * QUOTA_RATIO[s]);
    quotas[s] = q;
    used += q;
  }
  let rest = maxItems - used;
  while (rest > 0) {
    for (const s of keys) {
      if (rest <= 0) break;
      quotas[s] += 1;
      rest -= 1;
    }
  }
  const out = [];
  for (const [s, list] of bySource) {
    if (!quotas[s] || quotas[s] <= 0) continue;
    out.push(...list.sort((a, b) => timeOf(b) - timeOf(a)).slice(0, quotas[s]));
  }
  return out;
}
function seenFirst(total, afterMatch, afterDedupe) {
  console.log(`[wool] 共抓取 ${total} 条 → 关键词命中 ${afterMatch} 条 → 新条目 ${afterDedupe} 条`);
}

function mockItems() {
  const h = 3600 * 1000;
  return [
    { id: 'mock-1', source: 'baicaio', sourceName: '白菜哦', title: '某品牌蓝牙耳机 大额券后 9.9 元包邮', priceText: '9.9元包邮', merchant: '京东商城', keyword: '蓝牙耳机', url: 'https://example.com/1' },
    { id: 'mock-2', source: 'baicaio', sourceName: '白菜哦', title: '视频会员年卡 免费领(限新用户)', priceText: '0元', merchant: '淘宝网', keyword: '会员', url: 'https://example.com/2' },
    { id: 'mock-3', source: 'zuanke8', sourceName: '赚客吧·有奖活动', title: '农行 APP 签到领话费券 薅羊毛', merchant: '[重点参与]', keyword: '有奖活动', url: 'https://example.com/3' },
    { id: 'mock-4', source: 'zuanke8', sourceName: '赚客吧·免费赠品', title: '各大平台外卖红包汇总 可叠加', merchant: '', keyword: '免费赠品', url: 'https://example.com/4' },
    { id: 'mock-5', source: 'zuanke8', sourceName: '赚客吧·区域活动', title: '刷单兼职日结(测试排除词生效)', merchant: '', keyword: '区域活动', url: 'https://example.com/5' },
  ];
}

if (require.main === module) {
  run().catch((e) => {
    console.error('[wool] 运行失败:', e);
    process.exit(1);
  });
}

module.exports = { run };
