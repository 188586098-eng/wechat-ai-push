const { loadSkill } = require('./skill');

// 兜底解析：「另存为网页」的页面常常缺少 skill 依赖的 var ct / d.ct，
// 会被判成 1001「无法获取文章信息」。这里直接从页面结构里补齐字段。
// 公众号页面上的 #publish_time 是「2026年5月10日 10:33」这种中文格式，
// new Date() 直接解析会得到 Invalid Date，必须自己拆
function parseChineseTime(text) {
  const m = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2})?\s*[:：]?\s*(\d{2})?/.exec(text);
  if (!m) return null;
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    m[4] ? Number(m[4]) : 0,
    m[5] ? Number(m[5]) : 0
  );
}

function pickPublishTime(html, $) {
  const patterns = [
    /var\s+ct\s*=\s*['"](\d{9,})['"]/,
    /d\.ct\s*=\s*['"](\d{9,})['"]/,
    /create_time\s*[:=]\s*['"]?(\d{9,})/,
    /"publish_time"\s*:\s*"?(\d{9,})/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return new Date(Number(m[1]) * 1000);
  }

  const meta = $("meta[property='article:published_time']").attr('content');
  if (meta && !Number.isNaN(new Date(meta).getTime())) return new Date(meta);

  const text = $('#publish_time').text().trim() || $('#post-date').text().trim()
    || $('.rich_media_meta_text').first().text().trim();
  if (text) {
    const cn = parseChineseTime(text);
    if (cn) return cn;
    if (!Number.isNaN(new Date(text).getTime())) return new Date(text);
  }

  return null;
}

function pickTitle(html, $) {
  const candidates = [
    $("meta[property='og:title']").attr('content'),
    $('.rich_media_title').text(),
    $('#activity-name').text(),
    (html.match(/var\s+msg_title\s*=\s*(['"])([\s\S]*?)\1/) || [])[2],
    $('title').text().replace(/\s*[-|]\s*微信公众平台\s*$/, ''),
  ];
  const found = candidates.find((c) => c && c.trim());
  return found ? found.trim() : '';
}

// JS 渲染型页面（原始 HTML 里没有 #js_content）的账号名、标题、时间
// 只存在于 cgiDataNew 变量里，DOM 上取不到。渲染时由 index.js 注入一个数据节点带出来。
function readArchiveMeta($) {
  const el = $('#__archive_meta__');
  if (!el.length) return {};
  return {
    account_name: el.attr('data-account') || '',
    msg_title: el.attr('data-title') || '',
    create_time: el.attr('data-create-time') || '',
  };
}

function parseMetaTime(text) {
  if (!text) return null;
  const d = new Date(text.replace(/-/g, '/'));
  return Number.isNaN(d.getTime()) ? null : d;
}

// JS 渲染变体的 #js_content 结构是 <div class="share_notice"><h1>标题</h1><p>全文</p></div>，
// 那个 <h1> 与文档开头的 H1 重复；标题不相等时原样保留
const normText = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

function stripLeadingTitle(content, title) {
  if (!content || !title) return content;
  const want = normText(title);

  const first = /^\s*<([a-z0-9]+)([^>]*)>([\s\S]*?)<\/\1>/i.exec(content);
  if (!first) return content;
  const [, tag, attrs, inner] = first;

  if (/^h[1-6]$/i.test(tag)) {
    return normText(inner) === want ? content.slice(first[0].length) : content;
  }

  // 首元素是容器时，只看它内部的第一个标题元素
  const heading = /^\s*<(h[1-6])(?:[^>]*)>([\s\S]*?)<\/\1>/i.exec(inner);
  if (!heading || normText(heading[2]) !== want) return content;
  return `<${tag}${attrs}>${inner.slice(heading[0].length)}</${tag}>${content.slice(first[0].length)}`;
}

function extractFromHtml(html) {
  const { cheerio } = loadSkill();
  const $ = cheerio.load(html || '', { decodeEntities: false });

  const data = {};

  const meta = readArchiveMeta($);

  data.msg_title = pickTitle(html, $) || meta.msg_title || '';
  data.msg_content = stripLeadingTitle($('#js_content').html() || '', data.msg_title) || null;

  data.account_name =
    $('.profile_nickname').text().trim()
    || $('#js_name').text().trim()
    || (html.match(/var\s+nickname\s*=\s*(['"])([\s\S]*?)\1/) || [])[2]
    || meta.account_name
    || '未知公众号';

  data.msg_author = $("meta[name='author']").attr('content') || $('#js_author_name').text().trim() || '';
  data.msg_cover = $("meta[property='og:image']").attr('content') || null;
  data.msg_link = (html.match(/var\s+msg_link\s*=\s*(['"])([\s\S]*?)\1/) || [])[2]
    || $("meta[property='og:url']").attr('content')
    || '';
  data.msg_type = 'post';
  data.msg_source_url = null;

  const time = pickPublishTime(html, $) || parseMetaTime(meta.create_time);
  if (time) {
    data.msg_publish_time = time;
    const p = (n) => String(n).padStart(2, '0');
    data.msg_publish_time_str =
      `${time.getFullYear()}/${p(time.getMonth() + 1)}/${p(time.getDate())} ${p(time.getHours())}:${p(time.getMinutes())}:${p(time.getSeconds())}`;
  }

  if (!data.msg_title || !data.msg_content) {
    return { done: false, code: 1001, msg: '页面里没有找到文章标题或正文' };
  }

  return { done: true, code: 0, data };
}

module.exports = { extractFromHtml, parseChineseTime };
