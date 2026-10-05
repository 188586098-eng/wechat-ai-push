// 通用可配置采集器：给一份“列表页地址 + 抽取规则”即可新增渠道
//
// 适用于：水利厅/水利局/协会等官网的“招聘公告/通知公告”列表页，以及任何服务端渲染的
// 招聘列表页。页面改版时只需改 config.json 里的规则，不必改代码。
//
// 规则示例（config.json → jobs.sites.mySite）：
//   {
//     "enabled": true,
//     "name": "某省水利厅",
//     "sourceType": "notice",
//     "encoding": "gbk",
//     "listUrl": "http://example.gov.cn/tzgg/index_{page}.html",
//     "maxPages": 2,
//     "rule": {
//       "segmentPattern": "<li[\\s\\S]*?</li>",        // 可选：先按行切分
//       "itemPattern": "<a[^>]+href=\"([^\"]+)\"[^>]*>([\\s\\S]{4,120}?)</a>",
//       "urlTemplate": "http://example.gov.cn/{href}",   // 可选：补全相对链接
//       "hrefGroup": 1, "titleGroup": 2                  // 捕获组序号（从 1 开始）
//     }
//   }
const log = require('../log');
const { stripTags, parseDate, absolutize, matchAll } = require('../parse');

function buildUrl(site, page, kw) {
  const tpl = site.listUrl || site.searchUrl;
  const catid = (site.catids && site.catids[0]) || site.catid || '';
  return tpl
    .replace('{page}', String(page))
    .replace('{catid}', String(catid))
    .replace('{kw}', encodeURIComponent(kw || ''));
}

/** 按规则解析一页 HTML */
function parseByRule(html, site, pageUrl) {
  const rule = site.rule || {};
  const titleGroup = Number(rule.titleGroup) || 2;
  const hrefGroup = Number(rule.hrefGroup) || 1;
  const segments = rule.segmentPattern ? matchAll(html, rule.segmentPattern) .map((m) => m[0]) : [html];
  const items = [];
  for (const seg of segments) {
    for (const m of matchAll(seg, rule.itemPattern)) {
      const title = stripTags(m[titleGroup]);
      const href = m[hrefGroup];
      if (!title || !href) continue;
      const url = rule.urlTemplate
        ? rule.urlTemplate.replace('{href}', href.replace(/^\/+/, ''))
        : absolutize(href, pageUrl);
      // 列表行里通常带发布日期，尝试解析；解析不到留空（后续按首次发现时间记账）
      const publishedText = stripTags(seg).match(/\d{4}[-/年.]\d{1,2}[-/月.]\d{1,2}日?/) || '';
      items.push({
        site: site.key,
        siteName: site.name,
        sourceType: site.sourceType || 'notice',
        siteJobId: url,
        title,
        company: site.name,
        location: stripTags(site.location || ''),
        salary: '',
        publishedText: publishedText ? publishedText[0] : '',
        publishedAt: parseDate(publishedText ? publishedText[0] : ''),
        url,
        tags: [],
      });
    }
  }
  return items;
}

async function fetchSite({ client, site, queries }) {
  const rule = site.rule || {};
  if (!rule.itemPattern) throw new Error(`站点 ${site.key} 缺少 rule.itemPattern，无法解析`);

  const out = [];
  const maxPages = Number(site.maxPages) || 1;
  const kwList = site.sourceType === 'notice' ? [''] : queries;
  for (const kw of kwList) {
    for (let page = 1; page <= maxPages; page++) {
      const url = buildUrl(site, page, kw);
      let res;
      try {
        res = await client.getText(url, { encoding: site.encoding });
      } catch (e) {
        log.warn(`[${site.name}] 第${page}页抓取失败: ${e.message}`);
        break;
      }
      const items = parseByRule(res.text, site, url);
      log.debug(`[${site.name}] 第${page}页(${res.encoding}) 解析 ${items.length} 条 ← ${url}`);
      if (!items.length) {
        log.warn(`[${site.name}] 第${page}页未解析到条目，可能页面改版或该查询无结果: ${url}`);
        break;
      }
      out.push(...items);
      if (maxPages > 1) await client.sleep(client.conf.minDelayMs);
    }
  }
  return out;
}

module.exports = { key: 'generic', fetchSite, parseByRule };
