// 专业线报(zhuanyes.com)适配器：Discuz 架构线报论坛（2026-09 实测），无公开 API。
// 首页线程流：<div class="thread bbs"> 内 <a class="xst"> 为线报帖(/xianbao/{tid}.html)，
// 相邻 <em class="xi1"><span title="YYYY-M-D HH:mm"> 为精确发布时间。
const SITE = 'https://www.zhuanyes.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  let text = buf.toString('utf-8');
  if (text.includes('\uFFFD')) text = new TextDecoder('gbk').decode(buf);
  return text;
}

function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/** 解析首页线程流为标准化条目（首页置顶帖不在 thread.bbs 内，自然忽略） */
function parseThreads(html) {
  const blocks = html.split('<div class="thread bbs">').slice(1);
  const out = [];
  for (const block of blocks) {
    const idM = block.match(/\/xianbao\/(\d+)\.html/);
    if (!idM) continue;
    const titleM =
      block.match(/<a[^>]*class="xst"[^>]*>([^<]+)</) ||
      block.match(/<a[^>]*href="[^"]*\/xianbao\/\d+\.html"[^>]*>([^<]+)</);
    if (!titleM) continue;
    const timeM = block.match(/<span title="(\d{4})-(\d{1,2})-(\d{1,2}) (\d{1,2}):(\d{2})"/);
    const title = decodeEntities(titleM[1]).replace(/<[^>]+>/g, '').trim();
    if (!title) continue;
    // 热度：首页线程流自带 “N 阅读 · M 评论”（浏览参与度直接决定是否值得优先推荐）
    const viewsM = block.match(/·\s*(\d+)\s*阅读/);
    const repliesM = block.match(/·\s*(\d+)\s*评论/);
    const views = viewsM ? +viewsM[1] : 0;
    const replies = repliesM ? +repliesM[1] : 0;
    out.push({
      id: 'zhuanyes-' + idM[1],
      source: 'zhuanyes',
      sourceName: '专业线报',
      title: title.slice(0, 80),
      priceText: '',
      merchant: '',
      views,
      replies,
      hot: views + replies * 20, // 参与度：评论权重远高于浏览
      timeText: timeM
        ? `${timeM[1]}-${timeM[2].padStart(2, '0')}-${timeM[3].padStart(2, '0')} ${timeM[4]}:${timeM[5]}`
        : '',
      time: timeM ? new Date(+timeM[1], +timeM[2] - 1, +timeM[3], +timeM[4], +timeM[5]) : null,
      url: `${SITE}/xianbao/${idM[1]}.html`,
      keyword: '线报',
    });
  }
  return out;
}

async function fetchZhuanyes() {
  const html = await fetchHtml(SITE + '/');
  const items = parseThreads(html);
  if (items.length < 5) throw new Error(`首页线报过少(${items.length})，站点结构可能已变化`);
  console.log(`[wool][专业线报] 样例: ${items[0].title.slice(0, 40)}`);
  return items.slice(0, 40);
}

module.exports = { fetchZhuanyes, parseThreads };
