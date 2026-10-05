// 刷新内置的 wechat2rss 免费公众号名单（号名 -> feed 地址）
// 用法: node src/wechat-archive/refresh-feeds.js
const fs = require('fs');
const path = require('path');

const LIST_URL = 'https://wechat2rss.xlab.app/list/all';
const OUT = path.join(__dirname, 'wechat2rss-feeds.json');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

(async () => {
  const res = await fetch(LIST_URL, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  // 列表页每个号是一个 <a>，里面带 feed 链接；取链接里的可见文本作为号名
  const map = {};
  const re = /href="(https:\/\/wechat2rss\.xlab\.app\/feed\/[0-9a-f]+\.xml)"[^>]*>([\s\S]{0,400}?)<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const name = m[2].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    if (name && !map[name]) map[name] = m[1];
  }

  const count = Object.keys(map).length;
  if (count < 100) throw new Error(`只解析到 ${count} 个号，列表页结构可能变了，先不写入`);
  fs.writeFileSync(OUT, `${JSON.stringify(map, null, 1)}\n`, 'utf8');
  console.log(`已写入 ${count} 个号 -> ${OUT}`);
})().catch((e) => {
  console.error(`刷新失败: ${e.message}`);
  process.exitCode = 1;
});
