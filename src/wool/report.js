// 推送报告构建与发送
const push = require('../push');
const { escapeHtml } = push;

/** 来源展示顺序（微信排版：论坛活动线报在前，商品好价殿后） */
const SOURCE_ORDER = { zhuanyes: 0, xinzhuanba: 1, zuanke8: 2, xianbaomi: 3, baicaio: 4 };

function fmtTime(item) {
  if (!item.timeText) return '';
  return item.timeText.replace(/\./g, '-');
}

/** 统一标题：本地落盘与微信推送共用，避免两处文案漂移 */
function buildTitle(items) {
  const dateStr = new Date().toLocaleDateString('zh-CN');
  return `🐑 羊毛线报速递 ${dateStr}（${items.length} 条）`;
}

/**
 * 纯文本报告：本地终端与总控中心日志阅读用（HTML 在控制台里不可读）
 */
function buildText(items) {
  if (!items.length) return '（无新条目）';
  const groups = new Map();
  for (const it of items) {
    if (!groups.has(it.source)) groups.set(it.source, []);
    groups.get(it.source).push(it);
  }
  const sorted = [...groups.entries()].sort((a, b) => (SOURCE_ORDER[a[0]] ?? 9) - (SOURCE_ORDER[b[0]] ?? 9));
  const lines = [];
  for (const [source, list] of sorted) {
    lines.push(`📡 ${list[0].sourceName || source}（${list.length} 条）`);
    for (const it of list) {
      lines.push(`  - ${it.hit ? `[${it.hit}] ` : ''}${it.title.slice(0, 70)}`);
      const meta = [it.priceText, it.merchant, fmtTime(it)].filter(Boolean).join(' · ');
      if (meta) lines.push(`      ${meta}`);
      lines.push(`      ${it.url}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

/** 按来源分组构建 HTML 报告 */
function buildHtml(items) {
  const groups = new Map();
  for (const it of items) {
    if (!groups.has(it.source)) groups.set(it.source, []);
    groups.get(it.source).push(it);
  }
  const sorted = [...groups.entries()].sort((a, b) => (SOURCE_ORDER[a[0]] ?? 9) - (SOURCE_ORDER[b[0]] ?? 9));

  const parts = sorted.map(([source, list]) => {
    const rows = list
      .map((it) => {
        const price = it.priceText
          ? `<b style="color:#e4393c">${escapeHtml(it.priceText)}</b>`
          : '<span style="color:#999">-</span>';
        const meta = [it.merchant, it.keyword, fmtTime(it)].filter(Boolean).map(escapeHtml).join(' · ');
        const hit = it.hit ? `<span style="background:#fff3cd;color:#856404;padding:0 4px;border-radius:3px;font-size:12px">命中:${escapeHtml(it.hit)}</span> ` : '';
        return `<li style="margin:6px 0">
          ${hit}<a href="${escapeHtml(it.url)}" style="color:#111;text-decoration:none"><b>${escapeHtml(it.title.slice(0, 60))}</b></a><br>
          <span style="font-size:12px;color:#666">${price}${meta ? '｜' + meta : ''}</span>
        </li>`;
      })
      .join('');
    const name = escapeHtml(list[0].sourceName || source);
    return `<h3 style="margin:10px 0 4px;font-size:15px">📡 ${name}（${list.length} 条）</h3><ul style="padding-left:18px;margin:0">${rows}</ul>`;
  });

  return `<div style="font-size:14px;line-height:1.7">
    <p style="font-size:12px;color:#999;margin:0 0 6px">按订阅关键词实时聚合，每条仅推送一次；点标题直达详情/购买页</p>
    ${parts.join('')}
    <p style="font-size:11px;color:#aaa;margin:8px 0 0">提示：微信内部分链接无法直接打开（白菜哦/赚客吧等），请复制链接到浏览器访问；赚客吧帖子需登录查看。</p>
  </div>`;
}

async function send(token, items) {
  const title = buildTitle(items);
  await push.send(token, title, buildHtml(items));
  return title;
}

module.exports = { buildHtml, buildText, buildTitle, send };
