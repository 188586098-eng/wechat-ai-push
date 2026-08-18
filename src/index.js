const fs = require('fs');
const path = require('path');
const { getHtml } = require('./fetch');
const { parseQbitai, parseZhidx, parseAiera, parse36kr, parseInfoq, parseNetEase, parseTrending, parseRss } = require('./sources');
const store = require('./store');
const push = require('./push');
const auth = require('./auth');

const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf-8'),
);

const SOURCE_DEFS = [
  { key: 'qbitai', url: 'https://www.qbitai.com/', parse: parseQbitai },
  { key: 'zhidx', url: 'https://www.zhidx.com/', parse: parseZhidx },
  { key: 'aiera', url: 'https://aiera.com.cn/', parse: parseAiera },
  { key: 'kr36', url: 'https://gateway.36kr.com/api/mis/nav/home/nav/rank/hot', parse: parse36kr, post: true, body: { partner_id: 'wap', param: { siteId: 1, platformId: 2 } } },
  { key: 'infoq', url: 'https://www.infoq.cn/', parse: parseInfoq },
  { key: 'netease', url: 'https://m.163.com/news/sub/T1466412414497.html', parse: parseNetEase },
  { key: 'panews', url: 'http://localhost:4000/feeds/MP_WXS_3223096120.rss', parse: parseRss },
  { key: 'trending', url: 'https://github.com/trending?since=daily&spoken_language_code=zh', parse: parseTrending },
  { key: 'geekpark', url: 'http://localhost:4000/feeds/MP_WXS_1304308441.rss', parse: parseRss },
  { key: 'jiqizhixin', url: 'http://localhost:4000/feeds/MP_WXS_3073282833.rss', parse: parseRss },
  { key: 'huxiu', url: 'http://localhost:4000/feeds/MP_WXS_1432156401.rss', parse: parseRss },
  { key: 'tencent-tech', url: 'http://localhost:4000/feeds/MP_WXS_2398602260.rss', parse: parseRss },
  { key: 'guanggu-github', url: 'http://localhost:4000/feeds/MP_WXS_3516884134.rss', parse: parseRss },
  { key: 'datawhale', url: 'http://localhost:4000/feeds/MP_WXS_3226363426.rss', parse: parseRss },
  { key: 'tencent-cloud', url: 'http://localhost:4000/feeds/MP_WXS_3264589119.rss', parse: parseRss },
];

async function main() {
  const needsLogin = SOURCE_DEFS.some((def) => def.url.includes('/feeds/MP_WXS_'));
  if (needsLogin) {
    try {
      await auth.ensureLogin();
    } catch (e) {
      console.error(`[登录] 自检失败，中止本轮推送: ${e.message}`);
      return;
    }
  }

  const db = store.load();
  const seen = new Set(db.seenUrls);
  const fresh = [];
  const failures = [];

  for (const def of SOURCE_DEFS) {
    const cfg = config.sources && config.sources[def.key];
    if (cfg && cfg.enabled === false) continue;
    const name = (cfg && cfg.name) || def.key;
    const url = (cfg && cfg.url) || def.url;
    try {
      const html = await getHtml(url, {
        method: def.post ? 'POST' : 'GET',
        body: def.body,
      });
      const items = def.parse(html);
      console.log(`[抓取] ${name}: ${items.length} 篇文章`);
      for (const it of items) {
        const item = { source: name, ...it };
        if (!seen.has(item.url)) fresh.push(item);
        seen.add(item.url);
      }
    } catch (e) {
      failures.push(`${name}: ${e.message}`);
      console.log(`[失败] ${name}: ${e.message}`);
    }
  }

  db.seenUrls = Array.from(seen);

  if (!fresh.length) {
    store.save(db);
    console.log('本次无新文章，跳过推送。');
    if (failures.length) console.log('部分源失败:', failures.join('; '));
    return;
  }

  const perSourceLimit = config.perSourceLimit || 5;
  const totalLimit = config.pushLimitPerRun || 15;
  const freshBySource = {};
  for (const it of fresh) {
    if (!freshBySource[it.source]) freshBySource[it.source] = [];
    if (freshBySource[it.source].length >= perSourceLimit) continue;
    freshBySource[it.source].push(it);
  }
  const sourceKeys = Object.keys(freshBySource);
  const toPush = [];
  let guard = 0;
  while (toPush.length < totalLimit && guard++ < sourceKeys.length * perSourceLimit) {
    for (const key of sourceKeys) {
      if (toPush.length >= totalLimit) break;
      const item = freshBySource[key].shift();
      if (item) toPush.push(item);
    }
  }
  console.log(`[新文章] ${fresh.length} 篇, 本次推送 ${toPush.length} 篇`);

  const groups = new Map();
  for (const it of toPush) {
    if (!groups.has(it.source)) groups.set(it.source, []);
    groups.get(it.source).push(it);
  }

  const title = `AI 资讯精选 ${new Date().toLocaleDateString('zh-CN')}`;
  const html = push.buildHtml(groups);

  if (!config.pushplusToken) {
    console.log('[dry-run] 未配置 pushplusToken，仅打印待推送内容：');
    for (const [source, items] of groups) {
      console.log(`\n== ${source} ==`);
      for (const it of items) console.log(`- ${it.title}\n  ${it.url}`);
    }
  } else {
    const res = await push.send(config.pushplusToken, title, html);
    console.log(`[推送] 成功发送 ${toPush.length} 篇: ${JSON.stringify(res)}`);
  }

  store.save(db);
  if (failures.length) console.log('部分源失败:', failures.join('; '));
}

if (require.main === module) {
  main().catch((e) => {
    console.error('运行失败:', e);
    process.exit(1);
  });
}

module.exports = { main };
