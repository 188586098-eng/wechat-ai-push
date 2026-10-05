// 登录态助手：人工登录一次，把会话（Cookie/localStorage）保存成文件供采集复用
//
// 用法:
//   npm run jobs:login -- boss                       # 打开浏览器，扫码/账号登录后回到窗口按回车保存
//   npm run jobs:login -- liepin --cookie-file c.txt # 手工导入：在自己 Chrome 里登录后复制 Cookie 存成文件
//   npm run jobs:login -- boss --check               # 只校验已保存的登录态是否还有效（不重新登录）
//
// 说明:
//   · 登录态存到 data/jobs/auth/<site>.json，内含你的会话 Cookie，属敏感文件：
//     data/ 已被 .gitignore 忽略，请勿拷给他人或提交到任何仓库。
//   · BOSS 与猎聘 已实测定案不可用：BOSS 对自动化浏览器直接弹滑块验证/空白页；
//     猎聘除页面自毁外，出口 IP 还会被弹到验证码通道（与 Cookie 无关）。
//     两者均属站点反自动化与 IP 风控，本程序不绕过；本命令保留给未来新增的需登录渠道。
//   · Cookie 会过期或被风控失效，失效后重新执行本命令即可。
const fs = require('fs');
const path = require('path');
const config = require('./config');
const log = require('./log');
const browserAdapter = require('./adapters/browser');

const cfg = config.resolve();

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    console.error('未安装 playwright，请先执行: npm i -D playwright && npx playwright install chromium');
    process.exit(1);
  }
}

function parseArgs(argv) {
  const ci = argv.indexOf('--cookie');
  const fi = argv.indexOf('--cookie-file');
  // 选项的值本身不以 -- 开头，别把它误当成渠道名（注意：选项不存在时不能把 -1+1=0 也算进去）
  const skip = new Set();
  if (ci >= 0) skip.add(ci + 1);
  if (fi >= 0) skip.add(fi + 1);
  const site = argv.find((a, idx) => !a.startsWith('--') && !skip.has(idx));
  return {
    site,
    check: argv.includes('--check'),
    cookie: ci >= 0 ? argv[ci + 1] || '' : '',
    cookieFile: fi >= 0 ? argv[fi + 1] || '' : '',
  };
}

/** 解析 DevTools 里复制的 Cookie 字符串："a=b; c=d"（只取名字与值，值不回显） */
function parseCookieString(raw) {
  return String(raw || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const i = part.indexOf('=');
      if (i <= 0) return null;
      // 去掉可能被命令行带进来的包裹引号
      const name = part.slice(0, i).trim().replace(/^["']|["']$/g, '');
      const value = part.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      return name ? { name, value } : null;
    })
    .filter(Boolean);
}

/** 等待回车（用于人工登录完成后确认）；非交互环境下等待超时，避免挂死 */
function waitEnter(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(`${prompt}\n> `);
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      console.log('（当前非交互终端，5 秒后自动继续）');
      setTimeout(resolve, 5000);
      return;
    }
    stdin.setRawMode(false);
    stdin.resume();
    stdin.once('data', () => {
      stdin.pause();
      resolve();
    });
  });
}

/** 打开搜索页检查是否拿到职位元素，判断登录态是否有效 */
async function checkState({ ctx, site }) {
  const page = await ctx.newPage();
  try {
    const url = site.searchUrl.replace('{kw}', encodeURIComponent('水利')).replace('{page}', '1');
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const sel = site.attrExtract ? site.attrExtract.itemSelector : site.selectors && site.selectors.item;
    if (!sel) return { ok: false, note: '该渠道未配置选拔选择器，无法校验' };
    try {
      await page.waitForSelector(sel, { timeout: 15000 });
    } catch {
      const why = await browserAdapter.detectLoginWall(page);
      return { ok: false, note: why ? `${why}，登录态无效` : '未找到职位元素（可能是选择器失效）' };
    }
    const count = await page.evaluate((s) => document.querySelectorAll(s).length, sel);
    return { ok: count > 0, count, note: '' };
  } finally {
    await page.close().catch(() => {});
  }
}

async function main(argv = process.argv.slice(2)) {
  const { site: siteKey, check, cookie, cookieFile } = parseArgs(argv);
  if (!siteKey) {
    const browserSites = Object.values(cfg.sites).filter((s) => s.selectors || s.attrExtract).map((s) => s.key);
    console.log(
      `用法: npm run jobs:login -- <渠道> [--check] [--cookie-file <文件>]\n` +
        `可用渠道: ${browserSites.join(', ')}\n` +
        `  默认            弹出浏览器人工登录后保存\n` +
        `  --cookie-file   从文件导入 Cookie（在自己浏览器登录后复制，推荐：不受命令行转义影响）\n` +
        `  --cookie        直接传 Cookie 字符串（含分号时请改用 --cookie-file）\n` +
        `  --check         校验已保存的登录态是否有效`,
    );
    process.exit(1);
  }
  const site = cfg.sites[siteKey];
  if (!site) {
    console.error(`未知渠道 ${siteKey}`);
    process.exit(1);
  }
  const statePath = config.storageStatePath(site, cfg);
  if (!statePath) {
    console.error(`渠道 ${siteKey} 未配置 storageState，无法保存登录态（请在 config.json 的 jobs.sites.${siteKey} 中设置）`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(statePath), { recursive: true });

  // 手工导入 Cookie：不启动自动化浏览器（对自动化浏览器直接弹验证的站点才需要这种方式）
  if (cookie || cookieFile) {
    let raw = cookie;
    if (cookieFile) {
      try {
        raw = fs.readFileSync(cookieFile, 'utf-8');
      } catch (e) {
        console.error(`读取 Cookie 文件失败: ${e.message}`);
        process.exitCode = 1;
        return;
      }
    }
    const parsed = parseCookieString(raw);
    if (!parsed.length) {
      console.error('Cookie 解析为空，文件内容应形如: name1=value1; name2=value2');
      process.exitCode = 1;
      return;
    }
    const host = new URL(site.searchUrl.replace('{kw}', 'x').replace('{page}', '1')).hostname;
    // 存到主域（例如 .liepin.com），www 等子域请求都会带上
    const rootDomain = `.${host.split('.').slice(-2).join('.')}`;
    const state = {
      cookies: parsed.map(({ name, value }) => ({
        name,
        value,
        domain: rootDomain,
        path: '/',
        expires: -1, // 会话 Cookie，实际有效期由站点决定
        httpOnly: false,
        secure: true,
        sameSite: 'Lax',
      })),
      origins: [],
    };
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
    console.log(`已导入 ${parsed.length} 个 Cookie 到 ${statePath}`);
    console.log(`Cookie 名: ${parsed.map((c) => c.name).join(', ')}（值不回显）`);
    console.log(`校验是否可用: npm run jobs:login -- ${siteKey} --check`);
    return;
  }

  const { chromium } = loadPlaywright();
  // 登录必须可见（要人工扫码）；--check 只是校验，默认无头
  const headless = check && process.env.JOBS_HEADLESS !== 'false';
  const browser = await chromium.launch({ headless, args: ['--no-sandbox'] });

  try {
    if (check) {
      if (!fs.existsSync(statePath)) {
        console.error(`登录态文件不存在: ${statePath}，请先执行 npm run jobs:login -- ${siteKey}`);
        process.exitCode = 2;
        return;
      }
      const ctx = await browser.newContext({
        locale: 'zh-CN',
        viewport: { width: 1440, height: 900 },
        storageState: statePath,
      });
      const r = await checkState({ ctx, site });
      console.log(r.ok ? `[login] 登录态有效（抓到 ${r.count} 个职位条目）` : `[login] 登录态可能已失效：${r.note}`);
      await ctx.close();
      process.exitCode = r.ok ? 0 : 2;
      return;
    }

    // 复用已保存的登录态，避免重复登录
    const ctx = await browser.newContext({
      locale: 'zh-CN',
      viewport: { width: 1440, height: 900 },
      ...(fs.existsSync(statePath) ? { storageState: statePath } : {}),
    });
    const loginUrl = site.loginUrl || site.searchUrl.replace('{kw}', '水利').replace('{page}', '1');
    // 人工登录：入口用站点首页而不是 loginUrl —— BOSS 等站点的登录页在自动化浏览器里
    // 会被直接重置成 about:blank（你连界面都看不到），而首页会正常显示「安全验证」页。
    const homeUrl =
      site.homeUrl || `${new URL(site.searchUrl.replace('{kw}', 'x').replace('{page}', '1')).origin}/`;
    const page = await ctx.newPage();
    console.log(`\n即将打开 ${site.name}：${homeUrl}`);
    console.log('  1) 若页面出现「安全验证 / 滑块」，请在窗口里手动完成（本程序不代做、不绕过）');
    console.log(`  2) 然后在该站点登录你的账号（登录入口：${loginUrl}）`);
    console.log('  3) 确认页面右上角已显示你的账号名/头像后，回到本窗口按回车');
    await page.goto(homeUrl, { waitUntil: 'domcontentloaded' }).catch((e) => log.warn(`打开页面失败: ${e.message}`));

    // 落地 2.5 秒后报一次状态，让你在动手前就知道站点放不放行
    await page.waitForTimeout(2500);
    const landed = page.url();
    const landedTitle = await page.title().catch(() => '');
    console.log(`\n当前落地：${landed}${landedTitle ? `  title="${landedTitle}"` : ''}`);
    if (landed === 'about:blank') {
      console.log('  提示：页面已被重置为空白，该站点拒绝自动化浏览器访问。请改用 --cookie-file 手工导入（见文档）。');
    } else if (/verify|captcha/i.test(landed) || /安全验证/.test(landedTitle)) {
      console.log('  提示：当前是「安全验证」页，请手动完成滑块后继续登录。');
    }

    await waitEnter('登录/验证完成后按回车 → 保存登录态并立即校验');

    await ctx.storageState({ path: statePath });
    const size = fs.statSync(statePath).size;
    console.log(`\n已保存登录态: ${statePath}（${size} 字节）`);

    // 存完立刻在同一会话里校验一次，避免"存了个没用的会话还以为成功了"
    const r = await checkState({ ctx, site });
    if (r.ok) {
      console.log(`校验通过：抓到 ${r.count} 个职位条目，登录态可用，可把 config.json 里该渠道的 enabled 改为 true。`);
    } else {
      console.log(`校验未通过：${r.note}`);
      console.log('若原因是安全验证/页面空白：该站点仍拦截自动化访问，本程序不绕过，建议改用 --cookie-file 手工导入。');
    }
    process.exitCode = r.ok ? 0 : 2;
    await ctx.close();
  } finally {
    await browser.close().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`[login] 失败: ${e.stack || e.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
