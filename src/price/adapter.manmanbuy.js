// 价格监控：慢慢买历史价抓取适配器
// 通过 Playwright 渲染慢慢买查询页，在页面上下文内调用其 customRequest.ajaxPost
// 获取 getHistoryTrend 数据（含现价/历史最低/60日均价/价格序列），免去逆向签名。
const { chromium } = require('playwright');
const { loadCookies } = require('./auth');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0 Safari/537.36';

/**
 * 查询单个商品的历史价格数据
 * @param {string} productUrl 商品页 URL（京东/淘宝/拼多多等）
 * @returns {Promise<object>} data: { spName, spUrl, siteName, currentPrice,
 *   lowerPrice, lowerDate, avgPrice60, datePrice, haveTrend, ... }
 */
async function fetchTrend(productUrl) {
  const cookies = loadCookies();

  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({
      userAgent: UA,
      locale: 'zh-CN',
      viewport: { width: 1280, height: 900 },
    });
    if (cookies) {
      try {
        await ctx.addCookies(cookies);
      } catch (e) {
        throw new Error(`cookie 加载失败（可能已过期）: ${e.message}`);
      }
    }
    const page = await ctx.newPage();

    // 先加载页面拿 ticket 与 customRequest 环境
    await page.goto('https://tool.manmanbuy.com/HistoryLowest.aspx', {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    await page.waitForTimeout(3000);

    const ret = await page.evaluate(
      (keyUrl) =>
        new Promise((resolve) => {
          if (!window.customRequest) {
            resolve({ __error: 'customRequest 未加载' });
            return;
          }
          try {
            window.customRequest.ajaxPost(
              '/api.ashx',
              { method: 'getHistoryTrend', key: keyUrl },
              (r) => resolve(r)
            );
          } catch (e) {
            resolve({ __error: '调用异常: ' + e.message });
          }
        }),
      productUrl
    );

    if (ret && ret.code === 0 && ret.data) {
      return ret.data;
    }
    if (ret && ret.__error) {
      throw new Error(`慢慢买页面异常: ${ret.__error}`);
    }
    if (ret === 402) {
      throw new Error('需要京东授权，请重新运行 npm run price:auth 扫码授权。');
    }
    if (ret && ret.code === 4) {
      throw new Error('需要登录慢慢买账号（code=4），请在浏览器中手动登录后重试。');
    }
    if (ret && ret.code === 403) {
      throw new Error('慢慢买反爬拦截（code=403），请稍后重试或降低频率。');
    }
    if (ret && ret.code === 4030) {
      throw new Error('慢慢买检测到爬虫特征（code=4030），请稍后重试。');
    }
    throw new Error('查询失败: ' + JSON.stringify(ret).slice(0, 300));
  } finally {
    await browser.close();
  }
}

module.exports = { fetchTrend };
