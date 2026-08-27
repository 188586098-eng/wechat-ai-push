const fs = require('fs');
const path = require('path');
const { getHtml } = require('./fetch');
const { parseQbitai, parseZhidx, parseAiera, parse36kr, parseInfoq, parseNetEase } = require('./sources');
const { buildHtml } = require('./push');
const { summarize, isLlmEnabled } = require('./llm');
const { fetchAllMpArticles, isPlatformEnabled, checkPlatformToken } = require('./wechat');

const PUSHPLUS_TOKEN = process.env.PUSHPLUS_TOKEN;
if (!PUSHPLUS_TOKEN) {
  console.error('缺少环境变量 PUSHPLUS_TOKEN');
  process.exit(1);
}

const SOURCE_DEFS = [
  { key: 'qbitai', name: '量子位', url: 'https://www.qbitai.com/', parse: parseQbitai },
  { key: 'zhidx', name: '智东西', url: 'https://www.zhidx.com/', parse: parseZhidx },
  { key: 'aiera', name: '新智元', url: 'https://aiera.com.cn/', parse: parseAiera },
  { key: 'kr36', name: '36氪', url: 'https://gateway.36kr.com/api/mis/nav/home/nav/rank/hot', parse: parse36kr, post: true, body: { partner_id: 'wap', param: { siteId: 1, platformId: 2 } } },
  { key: 'infoq', name: 'InfoQ', url: 'https://www.infoq.cn/', parse: parseInfoq },
  { key: 'netease', name: '刘润', url: 'https://m.163.com/news/sub/T1466412414497.html', parse: parseNetEase },
];

const PER_SOURCE_LIMIT = 3;
const TOTAL_LIMIT = 12;

const DATA_DIR = path.join(__dirname, 'data');
const OUTPUT_DIR = path.join(__dirname, 'output');
const SENT_FILE = path.join(DATA_DIR, 'sent.json');
const WARN_FILE = path.join(DATA_DIR, 'last-warn.json');
const WARN_INTERVAL_MS = 3 * 24 * 3600 * 1000; // 同 token 失效状态 3 天内最多提醒一次

function loadLastWarn() {
  try {
    return JSON.parse(fs.readFileSync(WARN_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveLastWarn(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(WARN_FILE, JSON.stringify(state, null, 2));
}

// token 失效提醒去重：同一失效状态 3 天内不重复推送
function shouldWarn(state, now) {
  const last = state.warnAt || 0;
  if (now - last < WARN_INTERVAL_MS) return false;
  return true;
}

function loadSent() {
  try {
    return JSON.parse(fs.readFileSync(SENT_FILE, 'utf-8')).seenUrls || [];
  } catch {
    return [];
  }
}

function saveSent(seen) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SENT_FILE, JSON.stringify({ seenUrls: Array.from(seen) }, null, 2));
}

async function fetchWebSources(seen) {
  const fresh = [];
  const failures = [];
  for (const def of SOURCE_DEFS) {
    try {
      const html = await getHtml(def.url, {
        method: def.post ? 'POST' : 'GET',
        body: def.body,
      });
      const items = def.parse(html);
      console.log(`[抓取] ${def.name}: ${items.length} 篇文章`);
      for (const it of items) {
        const item = { source: def.name, ...it };
        if (!seen.has(item.url)) {
          fresh.push(item);
          seen.add(item.url);
        }
      }
    } catch (e) {
      failures.push(`${def.name}: ${e.message}`);
      console.log(`[失败] ${def.name}: ${e.message}`);
    }
  }
  return { fresh, failures };
}

async function fetchAll({ skipMp = false } = {}) {
  const seen = new Set(loadSent());
  const web = await fetchWebSources(seen);

  let mp = [];
  if (skipMp) {
    console.log('[抓取] 公众号 token 已失效，本次跳过公众号源');
  } else if (isPlatformEnabled()) {
    try {
      mp = await fetchAllMpArticles(seen);
    } catch (e) {
      console.log(`[失败] 公众号平台: ${e.message}`);
    }
  } else {
    console.log('[抓取] 未配置 WEWE_TOKEN，跳过公众号源');
  }

  saveSent(seen);
  return { fresh: web.fresh.concat(mp), failures: web.failures };
}

function pickArticles(fresh) {
  const bySource = {};
  for (const it of fresh) {
    if (!bySource[it.source]) bySource[it.source] = [];
    if (bySource[it.source].length >= PER_SOURCE_LIMIT) continue;
    bySource[it.source].push(it);
  }

  const picked = [];
  const keys = Object.keys(bySource);
  let guard = 0;
  while (picked.length < TOTAL_LIMIT && guard++ < keys.length * PER_SOURCE_LIMIT) {
    for (const key of keys) {
      if (picked.length >= TOTAL_LIMIT) break;
      const item = bySource[key].shift();
      if (item) picked.push(item);
    }
  }
  return picked;
}

function toMarkdown(items, summary) {
  const lines = [];
  lines.push(`# AI 资讯日报 ${new Date().toLocaleDateString('zh-CN')}`);
  lines.push('');
  if (summary) {
    lines.push(summary);
    lines.push('');
  }
  const groups = new Map();
  for (const it of items) {
    if (!groups.has(it.source)) groups.set(it.source, []);
    groups.get(it.source).push(it);
  }
  for (const [source, list] of groups) {
    lines.push(`## ${source}`);
    for (const it of list) {
      lines.push(`- [${it.title}](${it.url})`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function notifyTokenExpired(reason) {
  const html = `<div style="font-size:15px;line-height:1.8;text-align:center">
<h3>微信读书登录已失效</h3>
<p style="color:#888">原因：${reason}</p>
<p>公众号源已临时降级为官网源，日报继续推送</p>
<p>请在本机完成续期（约 1 分钟）：</p>
<p><code>1. 打开 http://localhost:4500 微信扫码</code></p>
<p><code>2. 运行 ./sync-secret.sh 同步 token</code></p>
<p><code>3. 手动 Run workflow 恢复公众号源</code></p>
</div>`;
  const res = await fetch('https://www.pushplus.plus/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: PUSHPLUS_TOKEN, title: '公众号登录失效，请续期', content: html, template: 'html' }),
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json();
  if (json.code !== 200) throw new Error(`pushplus error: ${JSON.stringify(json)}`);
  console.log(`[提醒] 失效提醒已推送: ${JSON.stringify(json)}`);
}

async function main() {
  const health = await checkPlatformToken();
  let skipMp = false;
  if (health.expired) {
    skipMp = true;
    const warn = loadLastWarn();
    const now = Date.now();
    if (shouldWarn(warn, now)) {
      console.log(`[健康] 公众号 token 已失效: ${health.reason}`);
      try {
        await notifyTokenExpired(health.reason);
        saveLastWarn({ warnAt: now });
      } catch (e) {
        console.log(`[提醒] 失效提醒发送失败: ${e.message}`);
      }
    } else {
      console.log(`[健康] 公众号 token 已失效（3 天内已提醒，本次跳过）: ${health.reason}`);
    }
  } else {
    console.log('[健康] 公众号 token 有效');
    saveLastWarn({ warnAt: 0 });
  }
  const { fresh, failures } = await fetchAll({ skipMp });

  if (!fresh.length) {
    console.log('本次无新文章，跳过推送。');
    if (failures.length) console.log('部分源失败:', failures.join('; '));
    return;
  }

  const picked = pickArticles(fresh);
  console.log(`[新文章] ${fresh.length} 篇, 本次推送 ${picked.length} 篇`);

  let summary = '';
  if (isLlmEnabled()) {
    try {
      summary = await summarize(picked);
      console.log('[LLM] 摘要生成完成');
    } catch (e) {
      console.log(`[LLM] 摘要失败，降级为标题列表: ${e.message}`);
      summary = '';
    }
  } else {
    console.log('[LLM] 未配置 USER_LLM_API_KEY，跳过摘要');
  }

  const groups = new Map();
  for (const it of picked) {
    if (!groups.has(it.source)) groups.set(it.source, []);
    groups.get(it.source).push(it);
  }

  const title = `AI 资讯日报 ${new Date().toLocaleDateString('zh-CN')}`;
  const html = buildHtml(groups, summary);

  const res = await fetch('https://www.pushplus.plus/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: PUSHPLUS_TOKEN, title, content: html, template: 'html' }),
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json();
  if (json.code !== 200) throw new Error(`pushplus error: ${JSON.stringify(json)}`);
  console.log(`[推送] 成功发送 ${picked.length} 篇: ${JSON.stringify(json)}`);

  const md = toMarkdown(picked, summary);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const mdFile = path.join(OUTPUT_DIR, `ai-news-${new Date().toISOString().slice(0, 10)}.md`);
  fs.writeFileSync(mdFile, md);
  console.log(`[输出] 日报已写入 ${mdFile}`);

  if (failures.length) console.log('部分源失败:', failures.join('; '));
}

main().catch((e) => {
  console.error('运行失败:', e);
  process.exit(1);
});
