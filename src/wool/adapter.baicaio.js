// 白菜哦(baicaio.com)适配器：全网好价/羊毛聚合站，搜索接口免登录、无验证码。
// 条目结构（2026-08 实测）：每个爆料是 <li class="item"> 块，含标题链接/价格行/日期/商城名。
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

/** 抓取一个关键词的搜索结果 */
async function fetchBaicaio(keyword) {
  const res = await fetch('https://www.baicaio.com/search-index?q=' + encodeURIComponent(keyword), {
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`白菜哦 HTTP ${res.status}`);
  return parseBaicaio(await res.text(), keyword);
}

/** 解析搜索结果页为标准化条目 */
function parseBaicaio(html, keyword) {
  return html.split('<li class="item">').slice(1).map(parseBlock.bind(null, keyword)).filter(Boolean);
}

function parseBlock(keyword, b) {
  const idM = b.match(/\/item\/(\d+)\.html/);
  if (!idM) return null;
  const titleM =
    b.match(/class="font-14 title">\s*<a[^>]*title="([^"]+)"/) ||
    b.match(/<a[^>]*href="[^"]*\/item\/\d+\.html"[^>]*title="([^"]+)"/);
  if (!titleM || !titleM[1]) return null;
  const priceM = b.match(/class="fc-red price[^"]*">([^<]+)</);
  const dateM = b.match(/(\d{4}\.\d{2}\.\d{2})/);
  const mallM = b.match(/orig-show-id-\d+"[^>]*>([^<]{2,16})</);
  return {
    id: 'baicaio-' + idM[1],
    source: 'baicaio',
    sourceName: '白菜哦',
    title: decodeEntities(titleM[1]).trim(),
    priceText: priceM ? priceM[1].trim() : '',
    merchant: mallM ? mallM[1].trim() : '',
    timeText: dateM ? dateM[1] : '',
    time: dateM ? parseDotDate(dateM[1]) : null,
    url: `https://www.baicaio.com/item/${idM[1]}.html`,
    keyword,
  };
}

function parseDotDate(s) {
  const m = s.match(/(\d{4})\.(\d{2})\.(\d{2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]);
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

module.exports = { fetchBaicaio, parseBaicaio };
