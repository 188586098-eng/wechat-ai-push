// 智联招聘(sou.zhaopin.com)适配器
//
// 实测结论（2026-09）：
//   · 游客身份即可拿到服务端渲染的职位列表，20 条/页，`&p=` 翻页有效
//   · 列表页字段：职位名/详情链接/薪资/标签/地点/经验/学历/公司名，但【无发布时间】
//   · 详情页内嵌 `__INITIAL_STATE__`，jobDetail.detailedPosition.positionPublishTime 为权威发布时间
// 因此：列表页负责发现，详情页只对“命中且未见过”的新岗位做补全（较慢，受 detailMaxPerRun 限制）。
const { stripTags, extractJsonAfter, parseDate } = require('../parse');

const SITE = 'zhaopin';

/** 解析列表页：以职位信息容器为切分点，比依赖整串 class 更抗改版 */
function parseList(html) {
  const chunks = String(html || '').split('joblist-box__iteminfo').slice(1);
  const items = [];
  for (const raw of chunks) {
    const it = parseBlock(raw);
    if (it) items.push(it);
  }
  return items;
}

function parseBlock(chunk) {
  const titleM = chunk.match(/<a\b(?=[^>]*class="jobinfo__name")[^>]*>([\s\S]*?)<\/a>/);
  if (!titleM) return null;
  const hrefM = titleM[0].match(/href="([^"]+)"/);
  const href = hrefM ? hrefM[1] : '';
  const url = href ? href.replace(/^https?:\/\/(?:www\.)?zhaopin\.com/, 'http://www.zhaopin.com') : '';
  const jobId = (url.match(/jobdetail\/([A-Za-z0-9]+)\.htm/) || [])[1] || '';
  if (!jobId) return null;

  const title = stripTags(titleM[1]);
  if (!title) return null;

  const salary = stripTags((chunk.match(/<p class="jobinfo__salary">([\s\S]*?)<\/p>/) || [])[1] || '');
  const tags = [...chunk.matchAll(/<div class="joblist-box__item-tag">([\s\S]*?)<\/div>/g)]
    .map((m) => stripTags(m[1]))
    .filter(Boolean);
  const otherInfo = [...chunk.matchAll(/<div class="jobinfo__other-info-item">([\s\S]*?)<\/div>/g)]
    .map((m) => stripTags(m[1]))
    .filter(Boolean);
  const companyM = chunk.match(/<a\b(?=[^>]*class="companyinfo__name")[^>]*>([\s\S]*?)<\/a>/)
    || chunk.match(/title="([^"]+)"\s+href="https:\/\/www\.zhaopin\.com\/companydetail/);

  return {
    site: SITE,
    siteName: '智联招聘',
    sourceType: 'job',
    siteJobId: jobId,
    title,
    company: stripTags(companyM ? companyM[1] : ''),
    location: otherInfo[0] || '',
    // 其余 other-info 依次为经验、学历等要求，统一放进 tags 便于查阅
    tags: [...tags, ...otherInfo.slice(1)],
    salary,
    publishedAt: '',
    publishedText: '',
    url,
    extra: { requirements: otherInfo.slice(1) },
  };
}

/** 详情页补全：只取已实测确认的字段 */
function parseDetail(html, jobId) {
  const state = extractJsonAfter(html, '__INITIAL_STATE__');
  const pos = state && state.jobDetail && state.jobDetail.detailedPosition;
  if (pos && (!pos.positionNumber || pos.positionNumber === jobId)) {
    const published = pos.positionPublishTime || pos.publishTime || '';
    return {
      publishedText: published,
      publishedAt: parseDate(published),
      salary: pos.salary || '',
      title: pos.positionName || '',
      tags: [pos.positionWorkingExp, pos.education, pos.workType].filter(Boolean),
      company: (state.jobDetail.detailedCompany && state.jobDetail.detailedCompany.companyName) || '',
    };
  }
  // 结构变化兜底：直接从原文本里找本岗位的发布时间
  const re = new RegExp(`"positionPublishTime"\\s*:\\s*"([^"]+)"`);
  const m = html.match(re);
  if (m) return { publishedText: m[1], publishedAt: parseDate(m[1]) };
  return null;
}

async function fetchPages({ client, site, query }) {
  const out = [];
  const maxPages = Number(site.maxPages) || 1;
  for (let page = 1; page <= maxPages; page++) {
    const url = site.searchUrl.replace('{kw}', encodeURIComponent(query)).replace('{page}', String(page));
    let res;
    try {
      res = await client.getText(url);
    } catch (e) {
      // 单页失败不放弃该关键词的其余页
      const err = new Error(`智联「${query}」第${page}页: ${e.message}`);
      err.partial = out;
      throw err;
    }
    const items = parseList(res.text);
    if (!items.length) break; // 无结果或页面结构变化，停止翻页
    for (const it of items) {
      it.query = query;
      out.push(it);
    }
    if (items.length < 10) break; // 不足一页说明到底了
  }
  return out;
}

module.exports = { key: SITE, parseList, parseBlock, parseDetail, fetchPages };
