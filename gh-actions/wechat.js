const { checkPlatformToken } = require('./health');

const PLATFORM_URL = process.env.PLATFORM_URL || 'https://weread.111965.xyz';
const WEWE_TOKEN = process.env.WEWE_TOKEN || '';
const WEWE_XID = process.env.WEWE_XID || '431803268';

const MP_SOURCES = [
  { mpId: 'MP_WXS_3073282833', name: '机器之心' },
  { mpId: 'MP_WXS_1432156401', name: '虎嗅' },
  { mpId: 'MP_WXS_3223096120', name: '数字生命卡兹克' },
  { mpId: 'MP_WXS_1304308441', name: '极客公园' },
  { mpId: 'MP_WXS_2398602260', name: '腾讯技术工程' },
  { mpId: 'MP_WXS_3516884134', name: '逛逛GitHub' },
  { mpId: 'MP_WXS_3226363426', name: 'Datawhale' },
  { mpId: 'MP_WXS_3264589119', name: '腾讯云开发者' },
];

function isPlatformEnabled() {
  return Boolean(WEWE_TOKEN);
}

function cleanTitle(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchMpArticles(mpId, name, seen) {
  const res = await fetch(`${PLATFORM_URL}/api/v2/platform/mps/${mpId}/articles?page=1`, {
    headers: { xid: WEWE_XID, Authorization: `Bearer ${WEWE_TOKEN}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const body = await res.text();
    let msg = `HTTP ${res.status}`;
    try {
      msg = JSON.parse(body).message || msg;
    } catch {
      // ignore parse error
    }
    throw new Error(msg);
  }
  const list = await res.json();
  if (!Array.isArray(list)) {
    throw new Error('平台返回非数组');
  }
  const fresh = [];
  for (const a of list) {
    if (!a || !a.title || !a.id) continue;
    const title = cleanTitle(a.title);
    if (title.length < 6) continue;
    const url = a.link || a.url || `https://mp.weixin.qq.com/s/${a.id}`;
    if (seen.has(url)) continue;
    seen.add(url);
    let pubTime = '';
    if (a.publishTime) {
      const d = new Date(Number(a.publishTime) > 1e12 ? Number(a.publishTime) : Number(a.publishTime) * 1000);
      if (!Number.isNaN(d.getTime())) pubTime = d.toISOString().slice(0, 10);
    }
    fresh.push({ source: name, title, url, pubTime });
  }
  return fresh;
}

async function fetchAllMpArticles(seen) {
  const all = [];
  for (const mp of MP_SOURCES) {
    try {
      const items = await fetchMpArticles(mp.mpId, mp.name, seen);
      console.log(`[抓取] ${mp.name}: ${items.length} 篇文章`);
      all.push(...items);
    } catch (e) {
      console.log(`[失败] ${mp.name}: ${e.message}`);
    }
  }
  return all;
}

module.exports = { fetchAllMpArticles, isPlatformEnabled, MP_SOURCES, checkPlatformToken };
