// 价格监控：购买决策规则
// 输入慢慢买 getHistoryTrend 的 data + 用户在 config 中的目标价，输出购买建议。

// 一年内主要大促（用于"是否建议等大促"）
const PROMOTIONS = [
  { name: '年货节', month: 1, day: 18 },
  { name: '618', month: 6, day: 18 },
  { name: '双11', month: 11, day: 11 },
  { name: '双12', month: 12, day: 12 },
];

function daysUntil(targetMonth, targetDay, now = new Date()) {
  const t = new Date(now.getFullYear(), targetMonth - 1, targetDay);
  let diff = Math.round((t - now) / 86400000);
  if (diff < 0) {
    // 今年已过，看明年
    t.setFullYear(t.getFullYear() + 1);
    diff = Math.round((t - now) / 86400000);
  }
  return diff;
}

function nearestPromotion(now = new Date()) {
  let best = null;
  for (const p of PROMOTIONS) {
    const d = daysUntil(p.month, p.day, now);
    if (!best || d < best.days) best = { name: p.name, days: d };
  }
  return best;
}

function toNumber(v) {
  const n = typeof v === 'string' ? parseFloat(v.replace(/[^\d.]/g, '')) : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 兼容解析 datePrice：可能是 [{date,price}] 或 [[ts, price]] 或 {date:price} */
function parseSeries(datePrice) {
  const points = [];
  if (!Array.isArray(datePrice)) return points;
  for (const p of datePrice) {
    if (Array.isArray(p)) {
      points.push({ date: String(p[0]).slice(0, 10), price: toNumber(p[1]) });
    } else if (p && typeof p === 'object') {
      const price = toNumber(p.price ?? p.y ?? p.value);
      const date = String(p.date ?? p.x ?? p.time ?? '').slice(0, 10);
      if (price != null) points.push({ date, price });
    }
  }
  return points;
}

/**
 * @param {object} item 慢慢买 data: { currentPrice, lowerPrice, lowerDate, avgPrice60, datePrice, spName }
 * @param {object} product config 商品项: { name, targetPrice, url }
 * @returns {{ level, verdict, reasons, metrics }}
 *   level: 'buy' | 'watch' | 'promo' | 'hold'
 */
function analyze(item, product, now = new Date()) {
  const current = toNumber(item.currentPrice);
  const lower = toNumber(item.lowerPrice);
  const avg60 = toNumber(item.avgPrice60);
  const target = toNumber(product.targetPrice);
  const reasons = [];
  let level = 'hold';

  if (current == null) {
    return {
      level: 'hold',
      verdict: '无有效现价',
      reasons: ['未获取到当前价格'],
      metrics: { current, lower, avg60, target },
    };
  }

  // 1. 达到目标价
  if (target != null && current <= target) {
    level = level === 'hold' ? 'buy' : level;
    reasons.push(`已达目标价 ¥${target}`);
  }
  // 2. 接近历史最低
  if (lower != null && current <= lower * 1.05) {
    level = level === 'hold' ? 'buy' : level;
    reasons.push(`逼近 13 个月历史最低 ¥${lower}（${item.lowerDate || '?'}）`);
  }
  // 3. 历史分位（当前价在序列中的位置）
  const series = parseSeries(item.datePrice).filter((p) => p.price != null);
  if (series.length >= 5 && current != null) {
    const prices = series.map((p) => p.price).sort((a, b) => a - b);
    const below = prices.filter((p) => p < current).length;
    const percentile = below / prices.length;
    if (percentile <= 0.2) {
      level = level === 'hold' ? 'watch' : level;
      reasons.push(`处于历史价格低分位（约 ${Math.round(percentile * 100)}%）`);
    } else if (percentile >= 0.8) {
      reasons.push(`处于历史价格高分位（约 ${Math.round(percentile * 100)}%）`);
    }
  }
  // 4. 大促临近
  const promo = nearestPromotion(now);
  if (promo && promo.days <= 30) {
    if (level === 'hold') {
      level = 'promo';
    }
    reasons.push(`距 ${promo.name} 还有 ${promo.days} 天，可观望大促`);
  }
  // 5. 与60日均价比
  if (avg60 != null) {
    const ratio = ((current - avg60) / avg60) * 100;
    if (ratio <= -5) reasons.push(`低于 60 日均价 ${avg60}（低 ${Math.round(Math.abs(ratio))}%）`);
    else if (ratio >= 5) reasons.push(`高于 60 日均价 ${avg60}（高 ${Math.round(ratio)}%）`);
  }

  const VERDICT = {
    buy: '🟢 建议购买',
    watch: '🟡 偏便宜，可考虑',
    promo: '🟠 建议等大促',
    hold: '🔴 再等等',
  };
  if (!reasons.length) reasons.push('当前价格无明显优势');

  return {
    level,
    verdict: VERDICT[level] || VERDICT.hold,
    reasons,
    metrics: { current, lower, avg60, target, percentile: null },
  };
}

module.exports = { analyze, parseSeries, nearestPromotion, toNumber };
