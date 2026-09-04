// 新赚吧(v1.xianbao.net)适配器：Discuz 论坛（赚客吧同款架构，2026-09 实测）。
// 游客可读版块有限：forum-2 赚客大家谈 为活跃讨论/线报区（约 50 帖/页），https + utf-8。
const SITE = 'https://v1.xianbao.net';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

const DEFAULT_FORUMS = [{ fid: 2, name: '赚客大家谈' }];

async function fetchForum(forum) {
  const res = await fetch(`${SITE}/forum-${forum.fid}-1.html`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`新赚吧 HTTP ${res.status}`);
  const html = new TextDecoder('utf-8').decode(Buffer.from(await res.arrayBuffer()));
  const items = parseForum(html, forum);
  if (!items.length) throw new Error(`新赚吧·${forum.name} 解析为空，版块可能需登录或结构变化`);
  return items;
}

/** 解析版块帖子列表为标准化条目（Discuz normalthread 块） */
function parseForum(html, forum) {
  return html
    .split('<tbody id="normalthread_')
    .slice(1)
    .map((chunk) => {
      const end = chunk.indexOf('</tbody>');
      const b = end === -1 ? chunk : chunk.slice(0, end);
      const tidM = b.match(/^(\d+)/);
      if (!tidM) return null;
      const titleM = b.match(/class="s xst"[^>]*>([^<]+)</);
      if (!titleM) return null;
      const dateM = b.match(/(\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2})/);
      const tagM = b.match(/\[<a[^>]*(?:typeid=\d+)[^>]*>([^<]{2,10})<\/a>/);
      // 热度：Discuz 列表行 “回复数 / 浏览量” 两列
      const numM = b.match(/class="num"><a[^>]*>(\d+)<\/a><em>(\d+)<\/em>/);
      const replies = numM ? +numM[1] : 0;
      const views = numM ? +numM[2] : 0;
      const title = decodeEntities(titleM[1]).trim();
      if (!title) return null;
      return {
        id: 'xinzhuanba-' + tidM[1],
        source: 'xinzhuanba',
        sourceName: `新赚吧·${forum.name}`,
        title: title.slice(0, 80),
        priceText: '',
        merchant: tagM ? `[${tagM[1]}]` : '',
        views,
        replies,
        hot: Math.min(views, 3000) + replies * 30,
        timeText: dateM ? dateM[1] : '',
        time: dateM ? parseDashDate(dateM[1]) : null,
        url: `${SITE}/thread-${tidM[1]}-1-1.html`,
        keyword: forum.name,
      };
    })
    .filter(Boolean);
}

function parseDashDate(s) {
  const m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

module.exports = { fetchForum, parseForum, DEFAULT_FORUMS };
