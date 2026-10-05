const { loadSkill } = require('./skill');

// wechat2rss 免费号名 -> feed 地址的快照，便于直接按公众号名订阅
const FEEDS = require('./wechat2rss-feeds.json');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// 把「公众号名 / feed 地址」统一解析成 feed URL
function resolveFeed(spec) {
  if (/^https?:\/\//i.test(spec)) return spec;
  const key = String(spec).trim();
  if (FEEDS[key]) return FEEDS[key];
  const hits = Object.keys(FEEDS).filter((name) => name.includes(key));
  if (hits.length === 1) return FEEDS[hits[0]];
  if (!hits.length) throw new Error(`免费号列表里没有匹配「${key}」的公众号`);
  throw new Error(`「${key}」匹配到多个公众号：${hits.slice(0, 8).join('、')}`);
}

async function fetchFeed(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml,application/xml,text/xml,*/*' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  if (!/<item[\s>]/i.test(xml)) throw new Error('返回内容不是 RSS（没有 item）');
  return xml;
}

// 解析 RSS。用 cheerio 的 xmlMode，命名空间标签（content:encoded、dc:creator）
// 在 XML 模式下按字面 tagName 处理。
function parseFeed(xml) {
  const { cheerio } = loadSkill();
  const $ = cheerio.load(xml, { xmlMode: true });

  const channel = $('channel').first();
  const account = channel.children('title').first().text().trim();

  const pick = ($el, tags) => {
    for (const tag of tags) {
      const found = $el.children(tag).first();
      if (found.length) return found.text().trim();
    }
    return '';
  };

  const items = [];
  channel.find('item').each((_, el) => {
    const $el = $(el);
    items.push({
      title: pick($el, ['title']),
      link: pick($el, ['link', 'guid']),
      pubDate: pick($el, ['pubDate', 'dc\\:date']),
      author: pick($el, ['dc\\:creator', 'author']),
      // 正文在 content:encoded（选择器里的冒号必须转义），description 只是摘要
      content: pick($el, ['encoded', 'content\\:encoded', 'description']),
    });
  });

  return { account, items };
}

function formatTime(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}/${p(date.getMonth() + 1)}/${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

// 组装成和 skill 一致的数据结构，后续渲染/图片流程完全复用
function toArchiveData(entry, account) {
  const time = entry.pubDate ? new Date(entry.pubDate) : null;
  const valid = time && !Number.isNaN(time.getTime());
  return {
    msg_title: entry.title,
    msg_author: entry.author || account,
    account_name: account,
    msg_publish_time_str: valid ? formatTime(time) : '',
    msg_publish_time: valid ? time.toISOString() : '',
    msg_content: entry.content,
    msg_type: 'post',
    msg_link: entry.link,
  };
}

module.exports = { FEEDS, resolveFeed, fetchFeed, parseFeed, toArchiveData };
