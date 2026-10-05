// 监理招聘网(www.jianlihr.com)适配器
//
// 实测结论（2026-10-04）：
//   · robots.txt 禁止项均为简历/管理路径（/resume*、/allresume*、/corpmanage*、/rencaimanage*），
//     公开职位页与关键词页未被禁止 → 允许抓取
//   · 纯服务端渲染 HTML，无 JS 依赖、无验证码、无登录要求 → 走 HTTP，不用浏览器
//   · 关键词页 `/jobs/keys-{kw}.html` 有效（实测 keys-水利监理 → 25 条），
//     翻页 `/jobs/keys-{kw}-p-{N}.html`（N≥2）
//   · 列表页自带 职位名/详情链接/薪资/发布日期/公司/地点，无需进详情页
//
// 条目 HTML 结构：
//   <div class="topjob">
//     <div class="zwname">
//       <div class="zwbox"><a href="/job/365726.html" title="水利监理专监或总监（退休）">水利监理专监或总监（退休）</a>…</div>
//       <div class="xcbox"><strong>面议</strong><p><span>2026-10-04</span></p></div>
//     </div>
//     <div class="qyname">
//       <a href="/company/151623.html" title="公司名"><img …></a>
//       <p class="mt-15"><a href="/company/151623.html" title="公司名">公司名</a></p>
//       <p>黑龙江-哈尔滨</p>
//     </div>
//   </div>
const { stripTags, parseDate } = require('../parse');

const SITE = 'jianlihr';
const SITE_NAME = '监理招聘网';

/** 解析单个条目块（从 <div class="topjob"> 起切分后的片段） */
function parseBlock(chunk) {
  const titleM = chunk.match(/<div class="zwbox">\s*<a href="([^"]*\/job\/\d+\.html)"[^>]*>([\s\S]*?)<\/a>/);
  if (!titleM) return null;
  const url = titleM[1];
  const jobId = (url.match(/\/job\/(\d+)\.html/) || [])[1] || '';
  const title = stripTags(titleM[2]) || (chunk.match(/<div class="zwbox">\s*<a[^>]*title="([^"]+)"/) || [])[1] || '';
  if (!jobId || !title) return null;

  const salary = stripTags((chunk.match(/<div class="xcbox">\s*<strong>([\s\S]*?)<\/strong>/) || [])[1] || '');
  const dateM = chunk.match(/<div class="xcbox">[\s\S]*?<span>([\s\S]*?)<\/span>/);
  const publishedText = stripTags(dateM ? dateM[1] : '');

  const company =
    (chunk.match(/<div class="qyname">[\s\S]*?<p class="mt-15">\s*<a[^>]*title="([^"]+)"/) || [])[1] ||
    stripTags((chunk.match(/<p class="mt-15">\s*<a[^>]*>([\s\S]*?)<\/a>/) || [])[1] || '');
  const locM = chunk.match(/<p class="mt-15">[\s\S]*?<\/p>\s*<p>([\s\S]*?)<\/p>/);
  const location = stripTags(locM ? locM[1] : '');

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
    url: url.startsWith('http') ? url : `https://www.jianlihr.com${url}`,
    tags: [],
  };
}

/** 解析列表页：以条目容器为切分点 */
function parseList(html) {
  return String(html || '')
    .split('<div class="topjob">')
    .slice(1)
    .map(parseBlock)
    .filter(Boolean);
}

/** 关键词页按页抓取；空页/不足一页视为到底 */
async function fetchPages({ client, site, query }) {
  const out = [];
  const maxPages = Number(site.maxPages) || 1;
  const base = (site.searchUrl || '').replace('{kw}', encodeURIComponent(query || ''));
  for (let page = 1; page <= maxPages; page++) {
    const url = page === 1 ? base : base.replace(/\.html$/, `-p-${page}.html`);
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
