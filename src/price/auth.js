// 价格监控：慢慢买授权与会话管理
// 京东商品历史价查询需要先用「慢慢买 App」扫码完成京东授权，
// 授权成功后慢慢买会话 cookie 会持久化到 data/price-cookies.json 长期复用。
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const COOKIE_FILE = path.join(__dirname, '..', '..', 'data', 'price-cookies.json');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0 Safari/537.36';

function loadCookies() {
  try {
    const raw = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8'));
    return Array.isArray(raw) ? raw : null;
  } catch {
    return null;
  }
}

function saveCookies(cookies) {
  fs.mkdirSync(path.dirname(COOKIE_FILE), { recursive: true });
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));
  console.log(`[price-auth] cookie 已保存: ${COOKIE_FILE} (${cookies.length} 条)`);
}

async function checkJdAuth(page) {
  return page.evaluate(async () => {
    const res = await fetch('/HistoryLowest.aspx?action=checkJdAuth', {
      credentials: 'same-origin',
    });
    return res.json();
  });
}

/**
 * 授权引导：打开有头浏览器加载查询页，等待用户用慢慢买 App 扫码授权，
 * 轮询 checkJdAuth 直到 auth==true，随后保存 cookie。
 * @param {string} firstUrl 任一商品 URL（用于触发页面加载授权检查）
 * @param {number} timeoutMs 等待扫码的最大时长，默认 5 分钟
 */
async function authorize(firstUrl, timeoutMs = 5 * 60 * 1000) {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({
    userAgent: UA,
    locale: 'zh-CN',
    viewport: { width: 1280, height: 900 },
  });
  const existing = loadCookies();
  if (existing) {
    try {
      await ctx.addCookies(existing);
    } catch (e) {
      console.log(`[price-auth] 已有 cookie 失效，需重新授权: ${e.message}`);
    }
  }
  const page = await ctx.newPage();
  const queryUrl =
    'https://tool.manmanbuy.com/HistoryLowest.aspx?url=' +
    encodeURIComponent(firstUrl);
  console.log(`[price-auth] 正在打开 ${queryUrl}`);
  await page.goto(queryUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

  console.log('[price-auth] 请在打开的浏览器窗口中完成以下操作：');
  console.log('[price-auth]   1) 若页面弹出「京东授权」二维码，用【慢慢买 App】扫码并确认授权；');
  console.log('[price-auth]   2) 授权完成后页面会显示历史价格走势图，工具将自动保存会话。');
  console.log(`[price-auth] 等待授权（最长 ${Math.round(timeoutMs / 60000)} 分钟）...`);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);
    try {
      const ret = await checkJdAuth(page);
      if (ret && ret.data && ret.data.auth === true) {
        const cookies = await ctx.cookies();
        saveCookies(cookies);
        await browser.close();
        return true;
      }
      // login==0 或其它状态 => 尚未授权
    } catch (e) {
      console.log(`[price-auth] 授权检查异常: ${e.message}`);
    }
  }
  await browser.close();
  console.log('[price-auth] 授权超时，可重新运行 npm run price:auth 再试。');
  return false;
}

module.exports = { loadCookies, saveCookies, authorize, checkJdAuth };
