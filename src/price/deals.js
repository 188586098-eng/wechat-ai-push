// 好价发现：慢慢买精选折扣/爆料搜索流 + 历史低位标记
// 搜索结果页(s.manmanbuy.com)免验证码，每条爆料自带历史低位标记：
//   历史新低 / 历史最低 / 低于双11 / N天次低 等
// 只推送带"最低/次低/新低/低于大促价"标记的商品，无需淘宝商品ID，无需授权。
const push = require('../push');
const { escapeHtml } = push;
const seenStore = require('./seen');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0 Safari/537.36';

const DEFAULT_KEYWORDS = [
  '蓝牙耳机',
  '智能手表',
  '扫地机器人',
  '垃圾袋',
  '纸巾',
  '洗发水',
  '保温杯',
  '行李箱',
  '机械键盘',
  '空气炸锅',
];

// 历史低位标记识别
const LOW_MARK_RE = /历史新低|历史最低|历史低价|新低|低于双11|低于双12|低于618|低价|次低/;

// 标记强度权重（排序用）
const MARK_WEIGHT = {
  '历史最低': 3,
  '历史新低': 2,
  '历史低价': 2,
  '低于双11': 1.5,
  '低于双12': 1.5,
  '低于618': 1.5,
  新低: 1,
  次低: 0.5,
};
function markWeight(mark) {
  for (const [k, v] of Object.entries(MARK_WEIGHT)) {
    if (mark.includes(k)) return v;
  }
  return 0;
}

/** 抓取并解析一个关键词的搜索结果 */
async function fetchSearchItems(keyword) {
  const res = await fetch('https://s.manmanbuy.com/pc/search/result?keyword=' + encodeURIComponent(keyword), {
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`搜索 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const latin = buf.toString('latin1');
  const m = latin.match(/charset=["']?([\w-]+)/i);
  const text = new TextDecoder(m && /gb/i.test(m[1]) ? 'gbk' : 'utf-8').decode(buf);
  return parseItems(text, keyword);
}

/** 解析搜索结果条目 */
function parseItems(html, keyword) {
  const parts = html.split('DiscountItemPC_discountItem__btTF1');
  const items = [];
  for (let i = 1; i < parts.length; i++) {
    const b = parts[i];
    const link = (b.match(/href="([^"]+discuxiao_\d+\.aspx[^"]*)"/) || [])[1];
    if (!link) continue;
    // 纯文本
    const txt = b.replace(/<[^>]+>/g, ' ').replace(/&yen;/g, '¥').replace(/\s+/g, ' ').trim();
    // 价格
    const priceM = txt.match(/(\d+\.?\d*)元/);
    const price = priceM ? priceM[1] : null;
    // 标题：价格之前的部分
    let title = priceM ? txt.slice(0, priceM.index).trim() : txt;
    title = title
      .replace(/DiscountItemPC_\w+/g, '')
      .replace(/^["'>\s]+/, '')
      .replace(/["']/g, '')
      .trim();
    // 标记
    const markM = txt.match(/(历史新低|历史最低|历史低价|新低|低于双11|低于双12|低于618|次低|\d+天(?:最低|次低))/);
    const mark = markM ? markM[1] : '';
    // 时间
    const timeM = txt.match(/(\d{2}-\d{2}\s*\d{2}:\d{2})/);
    // 平台：时间后的一段（拼多多/京东自营/京东商城 等）
    let platform = '';
    if (timeM) {
      const after = txt.slice(timeM.index + timeM[1].length);
      const pm = after.match(/(拼多多|京东自营|京东商城|京东|天猫|淘宝|唯品会|苏宁)/);
      if (pm) platform = pm[1];
    }
    const id = (link.match(/discuxiao_(\d+)\.aspx/) || [])[1];
    items.push({ id, title, price, mark, platform, time: timeM ? timeM[1] : '', url: link, keyword });
  }
  return items;
}

/** 关键词来源：环境变量 DEAL_KEYWORDS > config.dealKeywords > 默认列表 */
function resolveKeywords(config) {
  if (process.env.DEAL_KEYWORDS) {
    return process.env.DEAL_KEYWORDS.split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return config.dealKeywords && config.dealKeywords.length ? config.dealKeywords : DEFAULT_KEYWORDS;
}

/** 好价发现主流程 */
async function runDeals(config, { token } = {}) {
  const keywords = resolveKeywords(config);
  console.log(`[deals] 搜索 ${keywords.length} 个关键词: ${keywords.join('、')}`);

  const all = [];
  for (const kw of keywords) {
    try {
      const items = await fetchSearchItems(kw);
      const low = items.filter((it) => LOW_MARK_RE.test(it.mark || ''));
      console.log(`  [${kw}] 共 ${items.length} 条爆料，其中 ${low.length} 条带历史低位标记`);
      all.push(...low);
    } catch (e) {
      console.log(`  [${kw}] 抓取失败: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }

  // 单次运行内去重（同一爆料可能被多个关键词命中）
  const runSeen = new Set();
  const allGood = all.filter((it) => {
    if (runSeen.has(it.id)) return false;
    runSeen.add(it.id);
    return true;
  });
  // 跨次运行去重：只推未推送过的，按标记强度排序限量后再登记
  const known = seenStore.knownIds();
  const fresh = allGood.filter((it) => !known.has(it.id));
  const max = config.dealMaxItems || config.dealTopN || 15;
  const good = fresh.sort((a, b) => markWeight(b.mark) - markWeight(a.mark)).slice(0, max);
  seenStore.mark(good.map((it) => it.id));

  console.log(`\n[deals] 共发现 ${allGood.length} 条历史低位好价，新条目 ${fresh.length} 条，本次推送前 ${good.length} 条。`);
  if (!good.length) {
    console.log('[deals] 本次没有命中，不推送。');
    return { pushed: 0 };
  }

  const title = `🎯 历史低位好价 ${new Date().toLocaleDateString('zh-CN')}（${good.length} 件）`;
  const html = buildDealsHtml(good);
  if (!token) {
    console.log('\n[deals][dry-run] 未配置 pushplusToken，打印报告：\n');
    console.log(html);
    return { pushed: good.length };
  }
  await push.send(token, title, html);
  console.log(`[deals] 已推送 ${good.length} 件历史低位好价到微信。`);
  return { pushed: good.length };
}

function money(v) {
  return v == null ? '-' : `¥${v}`;
}

function buildDealsHtml(good) {
  const rows = good
    .map((it) => {
      return `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;vertical-align:top;max-width:260px">
          <a href="${escapeHtml(it.url)}" style="text-decoration:none;color:#111"><b>${escapeHtml(it.title.slice(0, 30))}</b></a>
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;white-space:nowrap">
          <b style="color:#e4393c;font-size:16px">${money(it.price)}</b>
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;white-space:nowrap">
          <span style="color:#1a8917;font-weight:bold">${escapeHtml(it.mark || '')}</span>
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;white-space:nowrap;font-size:12px;color:#999">
          ${escapeHtml(it.platform || '')}<br>${escapeHtml(it.time || '')}
        </td>
      </tr>`;
    })
    .join('');
  return `<div style="font-size:14px;line-height:1.6">
    <h3 style="margin:4px 0 10px">🎯 历史低位好价（慢慢买爆料实时筛选）</h3>
    <p style="font-size:12px;color:#999;margin:0 0 8px">只保留带「历史最低/新低/低于大促价」标记的爆料，点标题看详情</p>
    <table style="border-collapse:collapse;width:100%">
      <tr style="background:#f5f5f5;font-size:12px;color:#666">
        <th style="padding:6px 10px;text-align:left">商品</th>
        <th style="padding:6px 10px;text-align:left">价格</th>
        <th style="padding:6px 10px;text-align:left">历史低位</th>
        <th style="padding:6px 10px;text-align:left">平台/时间</th>
      </tr>
      ${rows}
    </table>
  </div>`;
}

module.exports = { runDeals, buildDealsHtml, fetchSearchItems, parseItems };
