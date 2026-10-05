// 水利英才网 / 一览水利(www.waterhr.com)适配器
//
// 实测结论（2026-10-04）：
//   · robots.txt 仅禁 4 个管理路径（/myNew/、/my/、/adminNew/、/webdev/），公开职位页未被禁止
//   · 纯服务端渲染 HTML（job1001.com 平台），无验证码、无登录要求 → 走 HTTP，不用浏览器
//   · 关键词搜索 `/SearchResult.php?jtzw={kw}` 有效（实测 jtzw=水利监理 → 30 条，含「水利监理总监」）
//   · 翻页 `&page={N}`；列表页自带 职位名/详情链接/经验/学历/地点/薪资/更新时间，无需进详情页
//   · 注意：额外加 showtype/sorttype 等参数会返回空壳页（实测 11KB），只用 jtzw + page 两个参数
//
// 条目 HTML 结构（item_l 与 item_r 相邻，按 item_l 切分后公司仍在同一片段内）：
//   <div class="item_l">
//     <div class="item_l_A"><a href='/jobs/53620735.html' title="水利监理总监">水利监理总监</a></div>
//     <div class="item_l_B"> 3-5 年经验&nbsp;|&nbsp;大专&nbsp;|&nbsp;清新县&nbsp;|&nbsp;<span class="top_c_page">9-15K/月</span></div>
//     <div class="item_l_C">更新于：2026-10-04</div>
//   </div>
//   <div class="item_r"><div class="item_r_A fl"><a href="/company/xxx/" title="公司名">公司名</a>…</div></div>
const { stripTags, parseDate } = require('../parse');

const SITE = 'waterhr';
const SITE_NAME = '水利英才网';
const SALARY_RE = /\/月|\/年|面议|K\/|万\/|元\/|^\d+[Kk]$/;

/** 解析单个条目块（从 <div class="item_l"> 起切分后的片段） */
function parseBlock(chunk) {
  const titleM = chunk.match(/<div class="item_l_A">\s*<a href=['"]([^'"]*\/jobs\/\d+\.html)['"][^>]*title="([^"]*)"/);
  if (!titleM) return null;
  const url = titleM[1];
  const jobId = (url.match(/\/jobs\/(\d+)\.html/) || [])[1] || '';
  const title = stripTags(titleM[2]);
  if (!jobId || !title) return null;

  // item_l_B：经验 | 学历 | 地点 | 薪资（薪资在 span.top_c_page 内）
  const salary = stripTags((chunk.match(/<span class="top_c_page">([\s\S]*?)<\/span>/) || [])[1] || '');
  const bText = stripTags((chunk.match(/<div class="item_l_B">([\s\S]*?)<\/div>/) || [])[1] || '');
  const parts = bText
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s && !SALARY_RE.test(s));
  const location = parts.length ? parts[parts.length - 1] : '';
  const tags = parts.slice(0, Math.max(0, parts.length - 1));

  const publishedText = stripTags((chunk.match(/<div class="item_l_C">[^<]*?(\d{4}-\d{2}-\d{2})/) || [])[1] || '');
  const company =
    (chunk.match(/<div class="item_r_A[^"]*">\s*<a href="[^"]*"[^>]*title="([^"]+)"/) || [])[1] ||
    stripTags((chunk.match(/<div class="item_r_A[^"]*">\s*<a[^>]*>([\s\S]*?)<\/a>/) || [])[1] || '');

  return {
    site: SITE,
    siteName: SITE_NAME,
    sourceType: 'job',
    siteJobId: jobId,
    title,
    company: stripTags(company),
    location,
    salary,
    publishedText,
    publishedAt: parseDate(publishedText),
    url: url.startsWith('http') ? url : `https://www.waterhr.com${url}`,
    tags,
  };
}

/** 解析列表页：以条目容器为切分点 */
function parseList(html) {
  return String(html || '')
    .split('<div class="item_l">')
    .slice(1)
    .map(parseBlock)
    .filter(Boolean);
}

/** 关键词页按页抓取；空页/不足一页视为到底 */
async function fetchPages({ client, site, query }) {
  const out = [];
  const maxPages = Number(site.maxPages) || 1;
  const base = site.searchUrl || '';
  for (let page = 1; page <= maxPages; page++) {
    const url = base.replace('{kw}', encodeURIComponent(query || '')).replace('{page}', String(page));
    let res;
    try {
      res = await client.getText(url);
    } catch (e) {
      const err = new Error(`${SITE_NAME} 第${page}页: ${e.message}`);
      err.partial = out;
      throw err;
    }
    const items = parseList(res.text);
    if (!items.length) break;
    for (const it of items) {
      it.query = query;
      out.push(it);
    }
    if (items.length < 10) break;
    await client.sleep(client.conf.minDelayMs);
  }
  return out;
}

module.exports = { key: SITE, parseList, parseBlock, fetchPages };
