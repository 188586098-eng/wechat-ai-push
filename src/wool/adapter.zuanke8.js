// 赚客吧(zuanke8.com)适配器：经典线报论坛（Discuz 架构），版块列表页免登录可读。
// 默认监控版块：免费赠品(2)/有奖活动(13)/有奖调查(14)/区域活动(29)。
// 注意：该站 https 证书链不完整且 https 常握手失败，统一走 http。
const SITE = 'http://www.zuanke8.com';
const DEFAULT_FORUMS = [
  { fid: 2, name: '免费赠品' },
  { fid: 13, name: '有奖活动' },
  { fid: 14, name: '有奖调查' },
  { fid: 29, name: '区域活动' },
];

async function fetchZuanke8(forum) {
  const res = await fetch(`${SITE}/forum-${forum.fid}-1.html`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0', 'Accept-Language': 'zh-CN,zh;q=0.9' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`赚客吧 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const html = new TextDecoder('gbk').decode(buf);
  return parseZuanke8(html, forum);
}

/** 解析版块帖子列表为标准化条目 */
function parseZuanke8(html, forum) {
  return html.split('<tbody id="normalthread_').slice(1).map(parseBlock.bind(null, forum)).filter(Boolean);
}

function parseBlock(forum, chunk) {
  const end = chunk.indexOf('</tbody>');
  const b = end === -1 ? chunk : chunk.slice(0, end);
  const tidM = b.match(/^(\d+)/) || [];
  if (!tidM[1]) return null;
  const titleM = b.match(/class="s xst"[^>]*>([^<]+)</);
  if (!titleM) return null;
  const dateM = b.match(/(\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2})/);
  const tagM = b.match(/\[<a[^>]*(?:typeid=\d+)[^>]*>([^<]{2,10})<\/a>/);
  return {
    id: 'zuanke8-' + tidM[1],
    source: 'zuanke8',
    sourceName: `赚客吧·${forum.name}`,
    title: decodeGbkEntities(titleM[1]).trim(),
    priceText: '',
    merchant: tagM ? `[${tagM[1]}]` : '',
    timeText: dateM ? dateM[1] : '',
    time: dateM ? parseDashDate(dateM[1]) : null,
    url: `${SITE}/thread-${tidM[1]}-1-1.html`,
    keyword: forum.name,
  };
}

function parseDashDate(s) {
  const m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}

function decodeGbkEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

module.exports = { fetchZuanke8, parseZuanke8, DEFAULT_FORUMS };
