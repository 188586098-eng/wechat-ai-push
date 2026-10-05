// 浏览器渲染适配器（Playwright）：用于必须执行 JS 才能看到职位列表的站点
// 适配 BOSS直聘 / 前程无忧 / 猎聘 等；选择器全部来自站点配置，改版时改配置即可。
//
// 重要说明：
//   1) 本适配器不使用任何反检测/验证码绕过手段，遇到登录墙或验证码时只记录日志并跳过；
//   2) 这些站点风控敏感，默认 enabled:false，需要显式开启；
//   3) 选择器可能随站点改版失效——日志会打印实际抓到的条目数，为 0 时会输出页面标题辅助排查。
const fs = require('fs');
const path = require('path');
const log = require('../log');
const config = require('../config');
const { stripTags } = require('../parse');

// 配置在进程内是静态的，解析一次即可
const jobsCfg = config.resolve();

let playwright = null;
let browser = null;
/** 每个渠道独立的浏览器上下文：登录态不同，不能共用一个 context */
const contexts = new Map();

function loadPlaywright() {
  if (playwright) return playwright;
  try {
    playwright = require('playwright');
  } catch {
    const err = new Error('未安装 playwright，浏览器渲染渠道已跳过。请执行: npm i -D playwright && npx playwright install chromium');
    err.skippable = true;
    throw err;
  }
  return playwright;
}

async function getBrowser(fetchCfg = {}) {
  if (browser && browser.isConnected()) return browser;
  const { chromium } = loadPlaywright();
  browser = await chromium.launch({
    headless: process.env.JOBS_HEADLESS !== 'false',
    // 只用无沙箱参数（容器/受限环境需要），不带任何隐藏自动化特征的伪装参数：
    // 伪装属规避站点检测，本项目不做；实测它对 BOSS 也无效（照样跳验证页/空白页）。
    args: ['--no-sandbox'],
  });
  return browser;
}

/**
 * 取得渠道专属上下文；若配置了 storageState（登录态文件）则加载。
 * 登录态文件由 `npm run jobs:login -- <渠道>` 生成；文件缺失或过期时退回游客态并在日志提示。
 */
async function getContext(site, fetchCfg = {}) {
  const key = site.key || site.name;
  if (contexts.has(key)) return contexts.get(key);
  const b = await getBrowser(fetchCfg);
  const opts = {
    userAgent: fetchCfg.userAgent,
    locale: 'zh-CN',
    viewport: { width: 1440, height: 900 },
  };
  const statePath = config.storageStatePath(site, jobsCfg);
  if (statePath) {
    if (fs.existsSync(statePath)) {
      opts.storageState = statePath;
      log.info(`[${site.name}] 使用已保存的登录态（${path.relative(config.ROOT, statePath)}）`);
    } else {
      log.warn(`[${site.name}] 未找到登录态文件 ${statePath}，本次以游客态访问；需要登录时请运行 npm run jobs:login -- ${key}`);
    }
  }
  const ctx = await b.newContext(opts);
  contexts.set(key, ctx);
  return ctx;
}

async function closeBrowser() {
  try {
    for (const ctx of contexts.values()) await ctx.close().catch(() => {});
    contexts.clear();
    if (browser) await browser.close();
  } catch {
    // 关闭失败不影响进程
  } finally {
    browser = null;
  }
}

/** 在页面上下文中按选择器抽取字段 */async function extractOnPage(page, selectors, linkBase) {
  return page.evaluate(
    ({ sel, base }) => {
      const textOf = (el, s) => {
        if (!s) return '';
        const n = el.querySelector(s);
        return n ? (n.textContent || '').replace(/\s+/g, ' ').trim() : '';
      };
      const abs = (href) => {
        try {
          return new URL(href || '', base).toString();
        } catch {
          return href || '';
        }
      };
      const nodes = [...document.querySelectorAll(sel.item)];
      return nodes.map((el) => {
        const linkEl = sel.link ? el.querySelector(sel.link) : null;
        const anchor = linkEl || el.querySelector('a[href]');
        return {
          title: textOf(el, sel.title) || (anchor ? (anchor.textContent || '').replace(/\s+/g, ' ').trim() : ''),
          company: textOf(el, sel.company),
          location: textOf(el, sel.location),
          salary: textOf(el, sel.salary),
          publishedText: textOf(el, sel.publishedAt),
          url: anchor ? abs(anchor.getAttribute('href')) : '',
        };
      });
    },
    { sel: selectors, base: linkBase },
  );
}

/**
 * 抽取模式二：站点把结构化数据写在元素属性里（如前程无忧的 sensorsdata JSON）
 * 比按文案选择器稳得多，站点改版时通常仍可用。
 */
async function extractByAttr(page, spec) {
  return page.evaluate(
    ({ spec: s }) => {
      const attrName = s.attrName || 'sensorsdata';
      const nodes = [...document.querySelectorAll(s.itemSelector)];
      return nodes.map((el) => {
        const holder = s.attrSelector ? el.querySelector(s.attrSelector) : el;
        let data = {};
        if (holder && holder.getAttribute(attrName)) {
          try {
            data = JSON.parse(holder.getAttribute(attrName));
          } catch {
            data = {};
          }
        }
        const fields = {};
        for (const [k, sel] of Object.entries(s.fieldSelectors || {})) {
          const n = el.querySelector(sel);
          fields[k] = n ? (n.textContent || '').replace(/\s+/g, ' ').trim() : '';
        }
        return { data, fields };
      });
    },
    { spec },
  );
}

/**
 * 粗判页面为何抓不到职位：安全验证 / 登录墙 / 空白页（风控） / 未命中。
 * 返回字符串而非布尔：日志里能直接告诉用户下一步该做什么。空串表示未发现问题。
 */
async function detectLoginWall(page) {
  try {
    const url = page.url();
    // 站点检测到自动化后直接把页面重置为空白，此时连 title 都读不到
    if (url === 'about:blank') return '页面被站点重置为空白(反自动化)';
    const title = await page.title().catch(() => '');
    if (/verify|captcha/i.test(url) || /安全验证|验证码/.test(title)) {
      return '触发安全验证(滑块)，本程序不绕过，已跳过';
    }
    if (/login|signin|passport|user\/account/i.test(url)) return '登录页';
    const txt = await page.evaluate(() => (document.body ? document.body.innerText.trim() : ''));
    if (/登录后查看|请先登录|立即登录|扫码登录|验证码|安全验证|拖动滑块/.test(txt)) return '登录墙/验证码';
    if (txt.length < 50) return '页面内容为空(疑风控/登录态不足)';
    return '';
  } catch {
    return '';
  }
}

async function fetchPages({ client, site, query }) {
  const b = await getBrowser(client.conf);
  const ctx = await getContext(site, client.conf);
  const out = [];
  const maxPages = Number(site.maxPages) || 1;
  const page = await ctx.newPage();
  page.setDefaultTimeout(client.conf.timeoutMs);

  try {
    for (let p = 1; p <= maxPages; p++) {
      const url = site.searchUrl.replace('{kw}', encodeURIComponent(query)).replace('{page}', String(p));
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      const waitSel = site.attrExtract ? site.attrExtract.itemSelector : site.selectors.item;
      try {
        await page.waitForSelector(waitSel, { timeout: 12000 });
      } catch {
        const title = await page.title().catch(() => '');
        const wallReason = await detectLoginWall(page);
        log.warn(
          `[${site.name}] 「${query}」第${p}页未等到职位元素${wallReason ? `：${wallReason}` : '（可能是选择器失效）'}，title="${title}" url=${url}`,
        );
        if (wallReason && site.requiresLogin) {
          log.warn(`[${site.name}] 登录态可能已失效，请重新执行: npm run jobs:login -- ${site.key}`);
        }
        break;
      }
      // 触底加载，兼容懒加载列表
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await client.sleep(1200);

      const items = site.attrExtract
        ? await mapAttrRows(page, site, query, url)
        : await mapSelectorRows(page, site, query, url);
      log.debug(`[${site.name}] 「${query}」第${p}页 抽取 ${items.length} 条`);
      out.push(...items);
      // 浏览器渲染的页面之间同样保持间隔，降低被封概率
      await client.sleep(client.conf.minDelayMs + Math.floor(Math.random() * 1500));
    }
    if (!out.length) {
      log.warn(`[${site.name}] 「${query}」未采集到任何职位，请检查站点选择器配置或访问限制`);
    }
  } finally {
    await page.close().catch(() => {});
  }
  return out;
}

function makeItem(site, query, { siteJobId, title, company, location, salary, publishedText, url }) {
  return {
    site: site.key,
    siteName: site.name,
    sourceType: 'job',
    siteJobId: siteJobId || url,
    title: stripTags(title),
    company: stripTags(company),
    location: stripTags(location),
    salary: stripTags(salary),
    publishedText: stripTags(publishedText),
    publishedAt: '',
    url,
    tags: [],
    query,
  };
}

async function mapAttrRows(page, site, query, pageUrl) {
  const spec = site.attrExtract;
  const rows = await extractByAttr(page, spec);
  return rows
    .map(({ data, fields }) => {
      const pick = (key) => (spec.map && spec.map[key] ? data[spec.map[key]] : '') || fields[key] || '';
      const jobId = data[spec.map && spec.map.siteJobId ? spec.map.siteJobId : 'jobId'] || '';
      const url = spec.detailUrl && jobId
        ? spec.detailUrl.replace('{jobId}', String(jobId))
        : pageUrl;
      return makeItem(site, query, {
        siteJobId: String(jobId || url),
        title: pick('title'),
        company: pick('company'),
        location: pick('location'),
        salary: pick('salary'),
        publishedText: pick('publishedText'),
        url,
      });
    })
    .filter((it) => it.title);
}

async function mapSelectorRows(page, site, query, pageUrl) {
  const rows = await extractOnPage(page, site.selectors, pageUrl);
  return rows
    .filter((r) => r.title && r.url)
    .map((r) =>
      makeItem(site, query, {
        siteJobId: (r.url.match(/([A-Za-z0-9_-]{6,})(?:\.html?|$)/) || [])[1] || r.url,
        title: r.title,
        company: r.company,
        location: r.location,
        salary: r.salary,
        publishedText: r.publishedText,
        url: r.url,
      }),
    );
}

module.exports = { key: 'browser', fetchPages, closeBrowser, getBrowser, getContext, detectLoginWall };
