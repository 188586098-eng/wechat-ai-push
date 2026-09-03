// 线报迷(xianbaomi.com)适配器：独立论坛讨论流（2026-09 实测）。
// 首页为 <li class="item"> 帖子卡片：<a class="main" href=".../xb/{id}.html">标题</a> +
// <span class="...time">MM-DD HH:mm</span>。含置顶外链广告(语雀/短链)，仅保留站内 /xb/ 帖子。
// 无年份，按当年补全；出现未来时间则视为去年。链接点开免登录。
const SITE = 'https://xianbaomi.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

async function fetchXianbaomi() {
  const res = await fetch(`${SITE}/`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`线报迷 HTTP ${res.status}`);
  const html = new TextDecoder('utf-8').decode(Buffer.from(await res.arrayBuffer()));
  const items = parseList(html);
  if (items.length < 5) throw new Error(`线报迷首页帖子过少(${items.length})，结构可能已变化`);
  return items.slice(0, 40);
}

/** 解析首页帖子卡片列表 */
function parseList(html) {
  const out = [];
  for (const block of html.split('<li class="item').slice(1)) {
    const idM = block.match(/\/xb\/(\d+)\.html/);
    if (!idM) continue;
    const titleM = block.match(/<a[^>]*class="main[^"]*"[^>]*>([\s\S]{0,120}?)<\/a>/);
    if (!titleM) continue;
    const timeM = block.match(/class="[^"]*time[^"]*"[^>]*>(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})</);
    const title = decodeEntities(titleM[1]).replace(/<[^>]+>/g, '').trim();
    if (!title) continue;
    out.push({
      id: 'xianbaomi-' + idM[1],
      source: 'xianbaomi',
      sourceName: '线报迷',
      title: title.slice(0, 80),
      priceText: '',
      merchant: '',
      timeText: timeM ? `${padYear(timeM)}-${timeM[1]}-${timeM[2]} ${timeM[3]}:${timeM[4]}` : '',
      time: timeM ? parseMdDate(timeM) : null,
      url: `${SITE}/xb/${idM[1]}.html`,
      keyword: '讨论',
    });
  }
  return out;
}

/** MM-DD HH:mm 补年份：超过当前时间 1 天视为去年 */
function parseMdDate(m) {
  const now = new Date();
  let y = now.getFullYear();
  const d = new Date(y, +m[1] - 1, +m[2], +m[3], +m[4]);
  if (d.getTime() - now.getTime() > 86400000) d.setFullYear(y - 1);
  return d;
}

function padYear(m) {
  return String(parseMdDate(m).getFullYear());
}

function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

module.exports = { fetchXianbaomi, parseList };
