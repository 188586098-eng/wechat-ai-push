// 工程监理人才网(www.job2299.com)适配器
//
// 实测结论（2026-10-03）：
//   · robots.txt 为 `User-agent: *` + 空 `Disallow:` → 允许抓取
//   · 纯服务端渲染 HTML，无 JS 依赖、无验证码、无登录要求 → 走 HTTP，不用浏览器
//   · 列表 `/jobs?page=N` 翻页有效（实测 1/2/3 页内容各不相同），20 条/页
//   · 列表页即可拿到 职位名/详情链接/公司/地点/类别/经验/薪资/发布日期（无需进详情页）
//   · 关键词搜索接口（GET/POST 传 keyword）实测不生效，返回固定结果集；
//     但本站就是监理垂直站，全站列表 + 本地关键词筛选已足够，故不做搜索（queryless）
//
// 条目 HTML 结构：
//   <div class="c">
//     <div class="tz"><a href=".../job2332961668.html" class="namew1">职位名</a></div>
//     <div class="cmoney"><a class="cmoney">面议</a></div>
//     <div class="n">
//       <a class="at" title="浙江-衢州、浙江-丽水">地点</a> |
//       <a class="at" title="道路/桥梁/隧道类">类别</a> |
//       <a class="at" title="五年以上">经验</a> |
//       <a class="at">2026-10-01</a>          ← 发布日期（无 title 属性）
//     </div>
//     <div class="k"><a href=".../ent2417730163.html" title="公司名">公司名</a></div>
//   </div>
const { stripTags, parseDate } = require('../parse');

const SITE = 'job2299';
const SITE_NAME = '工程监理人才网';
const DATE_RE = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/;

/** 解析单个条目块（从 <div class="c"> 起切分后的片段） */
function parseBlock(chunk) {
  const titleM = chunk.match(/<a[^>]*href="([^"]+)"[^>]*class="namew1"[^>]*>([\s\S]*?)<\/a>/);
  if (!titleM) return null;
  const url = titleM[1];
  const jobId = (url.match(/job(\d+)\.html/) || [])[1] || '';
  const title = stripTags(titleM[2]);
  if (!jobId || !title) return null;

  const salary = stripTags((chunk.match(/<div class="cmoney">\s*<a[^>]*>([\s\S]*?)<\/a>/) || [])[1] || '');
  const company = (chunk.match(/<div class="k">\s*<a[^>]*title="([^"]+)"/) || [])[1] || '';
  const companyUrl = (chunk.match(/<div class="k">\s*<a[^>]*href="([^"]+)"/) || [])[1] || '';

  // <a class="at"> 依次是：地点 | 类别 | 经验 | 发布日期（顺序可能变化，故按“是否日期”分类）
  const ats = [...chunk.matchAll(/<a class="at"[^>]*>([\s\S]*?)<\/a>/g)]
    .map((m) => stripTags(m[1]))
    .filter(Boolean);
  const dateText = ats.find((t) => DATE_RE.test(t)) || '';
  const rest = ats.filter((t) => !DATE_RE.test(t));

  return {
    site: SITE,
    siteName: SITE_NAME,
    sourceType: 'job',
    siteJobId: jobId,
    title,
    company: stripTags(company),
    location: rest[0] || '',
    // 其余为类别、经验等要求，统一放 tags 便于查阅
    tags: rest.slice(1),
    salary,
    publishedText: dateText,
    publishedAt: parseDate(dateText),
    url,
    extra: { companyUrl },
  };
}

/** 解析列表页：以条目容器为切分点 */
function parseList(html) {
  const chunks = String(html || '').split('<div class="c">').slice(1);
  const items = [];
  for (const raw of chunks) {
    const it = parseBlock(raw);
    if (it) items.push(it);
  }
  return items;
}

/** 列表页按页抓取（本站列表与关键词无关，query 仅为接口兼容） */
async function fetchPages({ client, site, query }) {
  const out = [];
  const maxPages = Number(site.maxPages) || 1;
  for (let page = 1; page <= maxPages; page++) {
    const url = site.searchUrl.replace('{page}', String(page));
    let res;
    try {
      res = await client.getText(url);
    } catch (e) {
      const err = new Error(`${SITE_NAME} 第${page}页: ${e.message}`);
      err.partial = out;
      throw err;
    }
    const items = parseList(res.text);
    if (!items.length) break; // 到底或结构变化，停止翻页
    for (const it of items) {
      it.query = query;
      out.push(it);
    }
    if (items.length < 10) break; // 不足一页说明到底了
  }
  return out;
}

module.exports = { key: SITE, queryless: true, parseList, parseBlock, fetchPages };
