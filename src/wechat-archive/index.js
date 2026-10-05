#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { loadSkill } = require('./skill');
const { htmlToMarkdown } = require('./html-to-md');
const { extractFromHtml } = require('./local-extract');
const { resolveFeed, fetchFeed, parseFeed, toArchiveData, FEEDS } = require('./rss');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const DEFAULT_OUT = path.join('data', 'wechat-archive');
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
// 记录「链接 -> 已归档文件」，让定时/重复跑 RSS 不会反复归档同一篇
const STATE_FILE = '.archive-state.json';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function usage() {
  console.log(`用法:
  node src/wechat-archive/index.js --rss <公众号名|feed地址> [--limit 5]
  node src/wechat-archive/index.js --html <网页.html | 目录>
  node src/wechat-archive/index.js [选项] <文章链接...>
  node src/wechat-archive/index.js --list-feeds [关键词]

把微信公众号文章存到本地，保存为 Markdown + 本地图片。
每篇按公众号建目录：<out>/<公众号>/<日期>-<标题>.md

三种来源:
  --rss  走 RSS 全文（适合按公众号批量订阅，无需逐篇操作）。
  链接   直连文章链接。必须用 /s/<短链>（微信里「⋯ → 复制链接」得到的就是这种），
         本机能直接抓到正文和图片；?__biz= 长链会被微信风控，只拿到验证页。
  --html 浏览器「另存为网页（全部）」后的文件，作为兜底。

选项:
  --rss <名|地址> 公众号名（查免费号列表）或完整 feed 地址，可重复
  --limit <n>     每个 feed 取最新几篇，默认 5
  --dry-run       只列出会归档哪些文章，不下载不写盘
  --list-feeds [关键词]  列出内置的免费公众号名单
  --html <路径>   本地保存的网页 HTML，单个文件或目录（*.html）
  --in <文件>     从文本文件读链接（每行一条，# 开头为注释）
  --out <目录>    输出目录，默认 ${DEFAULT_OUT}
  --delay <毫秒>  两篇之间的间隔，默认 1500
  --force         忽略去重记录，重新归档已归档过的链接
  --no-images     不下载图片，Markdown 中保留原始地址
  -h, --help      显示帮助`);
}

function parseArgs(argv) {
  const opts = {
    urls: [], rss: [], out: DEFAULT_OUT, delay: 1500, images: true,
    inFile: null, html: null, limit: 5, dryRun: false, force: false, listFeeds: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--in') opts.inFile = argv[++i];
    else if (arg === '--html') opts.html = argv[++i];
    else if (arg === '--out') opts.out = argv[++i];
    else if (arg === '--rss') opts.rss.push(argv[++i]);
    else if (arg === '--limit') opts.limit = Math.max(1, Number(argv[++i]) || 5);
    else if (arg === '--delay') opts.delay = Math.max(0, Number(argv[++i]) || 0);
    else if (arg === '--list-feeds') {
      const next = argv[i + 1];
      opts.listFeeds = next && !next.startsWith('-') ? argv[++i] : '';
    } else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--force') opts.force = true;
    else if (arg === '--no-images') opts.images = false;
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else if (/^https?:\/\//i.test(arg)) opts.urls.push(arg);
    else console.warn(`忽略无法识别的参数: ${arg}`);
  }
  return opts;
}

function listFeeds(keyword) {
  const names = Object.keys(FEEDS).filter((n) => !keyword || n.includes(keyword)).sort();
  console.log(`内置免费公众号 ${names.length} 个${keyword ? `（匹配「${keyword}」）` : ''}：`);
  for (const n of names) console.log(`  ${n}`);
  if (!names.length) console.log('  (无匹配。任意公众号需 wechat2rss 私有部署或自建 wewe-rss)');
}

function safeName(value, maxLength) {
  const cleaned = String(value || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.\s]+$/, '');
  const cut = cleaned.slice(0, maxLength).trim() || 'untitled';
  return RESERVED.test(cut) ? `_${cut}` : cut;
}

function yamlString(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ').trim();
}

// wechat2rss 把图片和正文里的链接都包了一层自己的代理（直连会 403），
// 这里按 u= 参数还原成原始地址
function unwrapProxyUrl(url) {
  if (!/^https?:\/\/wechat2rss\.xlab\.app\//i.test(url)) return url;
  const m = /[?&]u=([^&]+)/i.exec(url);
  if (!m) return url;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return url;
  }
}

function normalizeImgUrl(src) {
  if (!src) return '';
  let url = String(src).trim().replace(/&amp;/g, '&');
  if (url.startsWith('//')) url = `https:${url}`;
  if (!/^https?:\/\//i.test(url)) return '';
  return unwrapProxyUrl(url);
}

// 浏览器另存时，图片文件名取自 URL 末段，常常没有扩展名（如 640、0），
// 只能靠文件头判断真实格式。返回 null 说明不是图片。
function sniffExt(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.slice(0, 4).toString('latin1') === 'GIF8') return 'gif';
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'bmp';
  if (buf.slice(4, 8).toString('latin1') === 'ftyp') {
    const brand = buf.slice(8, 12).toString('latin1');
    if (brand.startsWith('avif') || brand.startsWith('avis')) return 'avif';
    if (brand.startsWith('heic') || brand.startsWith('heix') || brand.startsWith('mif1')) return 'heic';
  }
  return null;
}

async function downloadImage(url, dir, name) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Referer: 'https://mp.weixin.qq.com/',
      Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('空响应');

  // 微信有时对图片请求返回 HTML 错误页（状态码仍是 200），
  // 只认文件头，避免把 HTML 当成图片存下来
  const contentType = res.headers.get('content-type') || '';
  const ext = sniffExt(buf) || (/image\/svg/i.test(contentType) ? 'svg' : null);
  if (!ext) throw new Error(`响应不是图片 (${contentType || '未知类型'})`);

  const file = `${name}.${ext}`;
  fs.writeFileSync(path.join(dir, file), buf);
  return file;
}

// 网页另存为「完整网页」时，图片落在同名的 _files 目录里，这里直接复制过去
function copyLocalImage(src, baseDir, imgDir, name) {
  const root = path.resolve(baseDir);
  const abs = path.resolve(root, decodeURIComponent(String(src).split(/[?#]/)[0]));
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;

  const buf = fs.readFileSync(abs);
  const ext = sniffExt(buf) || path.extname(abs).slice(1).toLowerCase() || 'jpg';
  const file = `${name}.${ext}`;
  fs.writeFileSync(path.join(imgDir, file), buf);
  return file;
}

// 正文里会混进一些指向文章自身的 <img>（关注卡片之类），
// 它们不是图片，直接丢弃比留一条死图引用好
function isImageCandidate(url) {
  if (!url) return false;
  if (/^https?:\/\/mmbiz\.(qpic|qlogo)\.cn\//i.test(url)) return true;
  return /\.(jpe?g|png|gif|webp|bmp|svg)(?:$|[?#])/i.test(url) || /[?&]wx_fmt=/i.test(url);
}

// 下载正文图片，返回 原始 src 属性值 -> 本地相对路径 的映射。
// 值为空字符串表示“确定不是图片，应从 Markdown 里剔除”；没有条目则是下载失败，保留远程地址。
async function downloadImages(contentHtml, articleDir, options = {}) {
  const { localBaseDir, only } = options;
  const { cheerio } = loadSkill();
  const $ = cheerio.load(contentHtml || '', { decodeEntities: false });

  const sources = [];
  $('img').each((_, el) => {
    const src = $(el).attr('data-src') || $(el).attr('src') || $(el).attr('data-original');
    if (src && !sources.includes(src)) sources.push(src);
  });
  // 只处理正文里真正会渲染出来的图（公众号头像卡片之类会被排除）
  const targets = only ? sources.filter((s) => only.has(s)) : sources;
  if (!targets.length) return new Map();

  const imgDir = path.join(articleDir, 'images');
  fs.mkdirSync(imgDir, { recursive: true });

  const map = new Map();
  for (let i = 0; i < targets.length; i++) {
    const src = targets[i];
    const url = normalizeImgUrl(src);
    const name = `img-${String(i + 1).padStart(3, '0')}-${crypto.createHash('sha1').update(url || src).digest('hex').slice(0, 8)}`;
    try {
      if (!url) {
        const file = localBaseDir ? copyLocalImage(src, localBaseDir, imgDir, name) : null;
        map.set(src, file ? `images/${file}` : '');
      } else if (!isImageCandidate(url)) {
        map.set(src, '');
      } else {
        map.set(src, `images/${await downloadImage(url, imgDir, name)}`);
      }
    } catch (e) {
      console.warn(`    图片失败(${e.message})，保留原始地址: ${src}`);
    }
  }
  return map;
}

function renderDoc(data, body, sourceUrl) {
  const frontMatter = [
    '---',
    `title: "${yamlString(data.msg_title)}"`,
    `author: "${yamlString(data.msg_author || data.account_name)}"`,
    `account: "${yamlString(data.account_name)}"`,
    `publish_time: "${yamlString(data.msg_publish_time_str)}"`,
    `source_url: "${yamlString(sourceUrl)}"`,
    '---',
    '',
  ].join('\n');

  const header = [
    `# ${data.msg_title || '无标题'}`,
    '',
    `> 公众号：${data.account_name || '-'}  `,
    `> 作者：${data.msg_author || data.account_name || '-'}  `,
    `> 发布时间：${data.msg_publish_time_str || '-'}`,
    ...(data.msg_source_url ? [`> [阅读原文](${data.msg_source_url})`] : []),
    ...(sourceUrl ? ['', `原文链接：${sourceUrl}`] : []),
    '',
    '---',
    '',
  ].join('\n');

  return `${frontMatter}\n${header}\n${body}\n`;
}

function uniquePath(dir, base, ext) {
  let target = path.join(dir, `${base}${ext}`);
  let n = 2;
  while (fs.existsSync(target)) target = path.join(dir, `${base}-${n++}${ext}`);
  return target;
}

function isBadTime(data) {
  const time = data && data.msg_publish_time;
  if (!time) return true;
  return Number.isNaN(new Date(time).getTime());
}

// 直连短链（https://mp.weixin.qq.com/s/<id>）时，本机取回的就是完整文章页；
// 但长链（?__biz=...）会被风控，这里提前抦住给出明确报错
// 另有部分文章的正文由 JS 注入，原始 HTML 里没有 #js_content，需真实浏览器渲染
async function renderPage(url) {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (e) {
    return null;
  }

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ userAgent: USER_AGENT });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // 正文是异步注入的，等它出现再取 HTML
    await page.waitForSelector('#js_content', { timeout: 25000 }).catch(() => {});
    if (!(await page.$('#js_content'))) return null;

    // 这类页面的账号名/标题/发布时间只在 cgiDataNew 变量里，DOM 上没有，
    // 注入一个数据节点把它们带出去，供 extractFromHtml 读取
    await page.evaluate(() => {
      const d = window.cgiDataNew || {};
      const el = document.createElement('div');
      el.id = '__archive_meta__';
      el.setAttribute('data-account', d.nick_name || '');
      el.setAttribute('data-title', d.title || '');
      el.setAttribute('data-create-time', d.create_time || '');
      document.body.appendChild(el);
    });
    return await page.content();
  } finally {
    await browser.close();
  }
}

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Referer: 'https://mp.weixin.qq.com/',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    },
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const { cheerio } = loadSkill();
  if (cheerio.load(html, { decodeEntities: false })('#js_content').length) return html;

  const rendered = await renderPage(url);
  if (rendered) return rendered;

  throw new Error('页面里没有正文，可能被风控拦截；请确认用的是 /s/<短链> 而不是 ?__biz= 长链');
}

// skill 对部分页面会直接抛错（如「脚本解析失败」），或缺 var ct 而误判 1001，
// 这两种情况都退到本地结构解析
async function extractWithFallback(extract, html) {
  let result = null;
  try {
    result = await extract(html, {});
  } catch (e) {
    result = { done: false, msg: e.message };
  }

  const fallback = extractFromHtml(html);
  const skillOk = !!(result && result.done && result.data && result.data.msg_content);

  if (!skillOk) {
    if (fallback.done) return { result: fallback, via: ' 兜底解析' };
    throw new Error((result && result.msg) || fallback.msg || '提取失败');
  }

  if (isBadTime(result.data) && !isBadTime(fallback.data)) {
    const type = result.data.msg_type;
    result = fallback;
    // 保留 skill 识别出的文章类型（video/repost 等）
    if (type && type !== 'post') result.data.msg_type = type;
    return { result, via: ' 兜底解析' };
  }

  return { result, via: '' };
}

async function archiveOne(extract, item, outRoot, opts) {
  let result;
  let via = '';
  let sourceUrl = '';
  let localBaseDir = null;

  if (item.kind === 'rss') {
    // RSS 已经是解析好的正文，不再走 skill 提取
    result = { done: true, data: item.value };
    sourceUrl = item.value.msg_link || '';
  } else if (item.kind === 'html') {
    const html = fs.readFileSync(item.value, 'utf8');
    ({ result, via } = await extractWithFallback(extract, html));
    sourceUrl = (result && result.data && result.data.msg_link) || '';
    localBaseDir = path.dirname(item.value);
  } else {
    const html = await fetchPage(item.value);
    ({ result, via } = await extractWithFallback(extract, html));
    sourceUrl = item.value;
  }

  if (!result || !result.done) throw new Error((result && result.msg) || '提取失败');

  const data = result.data || {};
  const accountDir = path.join(outRoot, safeName(data.account_name || '未知公众号', 60));
  fs.mkdirSync(accountDir, { recursive: true });

  const date = (data.msg_publish_time_str || '').slice(0, 10).replace(/\//g, '-');
  const fallbackTitle = item.kind === 'html' ? path.basename(item.value, path.extname(item.value)) : '无标题';
  const base = safeName(`${date ? `${date}-` : ''}${data.msg_title || fallbackTitle}`, 90);

  const content = data.msg_content || '';

  // 第一遍只收集正文真正会渲染的图，避免把头像卡片等无关图白下载一份
  const usedImages = new Set();
  htmlToMarkdown(content, { resolveImage: (src) => src, onImage: (src) => usedImages.add(src) });

  const images = opts.images
    ? await downloadImages(content, accountDir, { localBaseDir, only: usedImages })
    : new Map();

  const body = htmlToMarkdown(content, {
    // 本地图复制失败时不要回退成原始路径（会指向错误位置），直接丢掉这张图
    resolveImage: (src) => {
      if (images.has(src)) return images.get(src);
      return normalizeImgUrl(src) || '';
    },
    resolveLink: (href) => unwrapProxyUrl(href.replace(/&amp;/g, '&')),
  });

  const file = uniquePath(accountDir, base, '.md');
  fs.writeFileSync(file, renderDoc(data, body, sourceUrl), 'utf8');
  const saved = [...images.values()].filter(Boolean).length;
  return { relPath: path.relative(outRoot, file), images: saved, type: data.msg_type, via };
}

function itemLink(item) {
  if (!item) return '';
  if (item.kind === 'rss') return item.value.msg_link || '';
  if (item.kind === 'url') return item.value;
  return '';
}

function loadState(outRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(outRoot, STATE_FILE), 'utf8'));
  } catch {
    return {};
  }
}

function saveState(outRoot, state) {
  fs.writeFileSync(path.join(outRoot, STATE_FILE), `${JSON.stringify(state, null, 1)}\n`, 'utf8');
}

async function collectItems(opts) {
  const items = [];

  for (const raw of opts.urls) {
    const url = raw.replace(/&amp;/g, '&');
    if (/^https?:\/\/mp\.weixin\.qq\.com\//i.test(url)) items.push({ kind: 'url', value: url });
    else console.warn(`跳过非公众号链接: ${raw}`);
  }

  if (opts.inFile) {
    const file = path.resolve(opts.inFile);
    if (!fs.existsSync(file)) throw new Error(`链接文件不存在: ${file}`);
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const url = trimmed.replace(/&amp;/g, '&');
      if (/^https?:\/\/mp\.weixin\.qq\.com\//i.test(url)) items.push({ kind: 'url', value: url });
      else console.warn(`跳过非公众号链接: ${trimmed}`);
    }
  }

  if (opts.html) {
    const target = path.resolve(opts.html);
    if (!fs.existsSync(target)) throw new Error(`HTML 路径不存在: ${target}`);
    const files = fs.statSync(target).isDirectory()
      ? fs.readdirSync(target).filter((f) => /\.html?$/i.test(f)).sort().map((f) => path.join(target, f))
      : [target];
    if (!files.length) {
      const mht = fs.statSync(target).isDirectory()
        ? fs.readdirSync(target).filter((f) => /\.mht(ml)?$/i.test(f))
        : [];
      if (mht.length) {
        throw new Error(
          `目录里只有 ${mht.length} 个 .mht/.mhtml 单文件网页，暂不支持。\n` +
          '请在浏览器另存时把「保存类型」改成「网页，全部 (*.htm;*.html)」后重试'
        );
      }
      throw new Error(`未找到 .html 文件: ${target}`);
    }
    for (const f of files) items.push({ kind: 'html', value: f });
  }

  if (opts.rss.length) {
    for (const spec of opts.rss) {
      const { account, items: entries } = parseFeed(await fetchFeed(resolveFeed(spec)));
      const name = account || spec;
      const newest = entries
        .slice()
        .sort((a, b) => (new Date(b.pubDate).getTime() || 0) - (new Date(a.pubDate).getTime() || 0))
        .slice(0, opts.limit);

      let usable = 0;
      for (const entry of newest) {
        // 没有 content:encoded 时只剩下几十字的 description 摘要，存下来等于空文章
        if (!entry.content || entry.content.length < 200) continue;
        const data = toArchiveData(entry, name);
        items.push({ kind: 'rss', value: data, label: `${name} / ${data.msg_title}` });
        usable++;
      }
      console.log(`  ${name}: 取最新 ${newest.length} 篇，可用 ${usable} 篇（feed 共 ${entries.length} 篇）`);
    }
  }

  const seen = new Set();
  return items.filter((it) => {
    const key = itemLink(it);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return usage();
  if (opts.listFeeds !== null) return listFeeds(opts.listFeeds);

  if (opts.rss.length) console.log('读取 feed:');
  const items = await collectItems(opts);
  if (!items.length) {
    usage();
    process.exitCode = 1;
    return;
  }

  const outRoot = path.resolve(opts.out);
  const state = opts.force ? {} : loadState(outRoot);
  const fresh = items.filter((it) => {
    const link = itemLink(it);
    return !(link && state[link]);
  });
  if (fresh.length < items.length) {
    console.log(`跳过已归档 ${items.length - fresh.length} 篇（要重跑加 --force）`);
  }

  if (opts.dryRun) {
    console.log(`\n[dry-run] 将归档 ${fresh.length} 篇到 ${outRoot}`);
    for (const it of fresh) console.log(`  ${it.label || (it.kind === 'html' ? path.basename(it.value) : it.value)}`);
    return;
  }
  if (!fresh.length) return;

  fs.mkdirSync(outRoot, { recursive: true });
  const { extract } = loadSkill();
  console.log(`共 ${fresh.length} 篇，输出到 ${outRoot}\n`);

  const ok = [];
  const failed = [];
  for (let i = 0; i < fresh.length; i++) {
    const item = fresh[i];
    const label = item.label || (item.kind === 'html' ? path.basename(item.value) : item.value);
    process.stdout.write(`[${i + 1}/${fresh.length}] `);
    try {
      const saved = await archiveOne(extract, item, outRoot, opts);
      ok.push(saved);
      const link = itemLink(item);
      if (link) {
        // 每篇落盘后就记一次，中途出错重跑不会重复归档
        state[link] = saved.relPath;
        saveState(outRoot, state);
      }
      console.log(`OK   ${saved.relPath} (${saved.images} 张图, ${saved.type}${saved.via})`);
    } catch (e) {
      failed.push({ label, reason: e.message });
      console.log(`失败 ${e.message}`);
    }
    if (i < fresh.length - 1) await sleep(opts.delay + Math.floor(Math.random() * 500));
  }

  console.log(`\n完成：成功 ${ok.length} 篇，失败 ${failed.length} 篇，输出目录 ${outRoot}`);
  for (const f of failed) console.log(`  失败 ${f.reason} -> ${f.label}`);
  if (failed.length === fresh.length) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`运行失败: ${e.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  safeName, sniffExt, isImageCandidate, normalizeImgUrl, unwrapProxyUrl,
  renderDoc, archiveOne, collectItems, itemLink, fetchPage,
};
