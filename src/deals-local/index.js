// ============================================================
//  历史低价 · 本地手动采集（供总控中心 unified-panel「🛒 历史低价」页展示）
// ------------------------------------------------------------
//  与云端的关系：**云端代码完全不动**。本模块只「读」复用云端的模块：
//    - ../price/deals            慢慢买爆料流抓取/解析（fetchSearchItems）
//    - ../price/adapter.manmanbuy 单品历史价（playwright，本地可覆盖需京东授权的商品）
//    - ../price/analyze          购买决策规则
//    - ../price/report           单品报告 HTML（推送复用）
//  本模块自带落盘与筛选，**绝不写 data/deals-seen.json**（那是云端跨次去重状态）。
//
//  用法：
//    node src/deals-local/index.js                   抓取(爆料流+单品历史价) → 落盘，不推微信
//    node src/deals-local/index.js --push            在上面基础上，额外推送微信
//    node src/deals-local/index.js --dry-run         纯预览：不落盘、不推送
//    node src/deals-local/index.js --deals-only      只跑爆料流（快，无需 playwright）
//    node src/deals-local/index.js --products-only   只跑单品历史价（需 playwright）
//
//  关键词：env DEAL_KEYWORDS（逗号分隔）> config.price.dealKeywords；两者都空则跳过爆料流
//  单品清单：config.price.products（name / url / targetPrice）
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'data');
const LAST_FILE = path.join(DATA_DIR, 'deals-local-last.json');
const RUNS_FILE = path.join(DATA_DIR, 'deals-local-runs.jsonl');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 下列两个常量云端 ../price/deals 未导出，这里本地各声明一份，
// 目的是「不改动云端文件」；筛选口径与云端保持一致。
const LOW_MARK_RE = /历史新低|历史最低|历史低价|新低|低于双11|低于双12|低于618|低价|次低/;
const MARK_WEIGHT = {
  历史最低: 3,
  历史新低: 2,
  历史低价: 2,
  低于双11: 1.5,
  低于双12: 1.5,
  低于618: 1.5,
  新低: 1,
  次低: 0.5,
};
function markWeight(mark) {
  for (const [k, v] of Object.entries(MARK_WEIGHT)) {
    if (String(mark || '').includes(k)) return v;
  }
  return 0;
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf-8'));
  } catch {
    return {};
  }
}

/** 关键词：env DEAL_KEYWORDS > config.price.dealKeywords；两者都空则返回空数组（不兜底） */
function resolveKeywords(priceCfg) {
  if (process.env.DEAL_KEYWORDS) {
    return process.env.DEAL_KEYWORDS.split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return (priceCfg.dealKeywords || []).slice();
}

function resolveToken(priceCfg, config) {
  return process.env.PUSHPLUS_TOKEN || priceCfg.pushplusToken || config.pushplusToken || '';
}

// ---------- 1) 爆料流：慢慢买「历史低位」 ----------
async function collectDeals(keywords, maxItems) {
  const { fetchSearchItems, unitPriceOf } = require('../price/deals');
  const out = [];
  const failures = [];
  for (const kw of keywords) {
    try {
      const items = await fetchSearchItems(kw);
      const low = items.filter((it) => LOW_MARK_RE.test(it.mark || ''));
      for (const it of low) {
        const u = unitPriceOf(it); // 云端已实现：整件价 → 折后单件价
        out.push({
          ...it,
          unitEach: u ? Number(u.each.toFixed(2)) : null,
          unitUnit: u ? u.unit : '',
          unitCount: u ? u.count : null,
        });
      }
      console.log(`  [爆料流] 「${kw}」共 ${items.length} 条，其中历史低位 ${low.length} 条`);
    } catch (e) {
      failures.push(`爆料流「${kw}」: ${e.message}`);
      console.log(`  [爆料流] 「${kw}」失败: ${e.message}`);
    }
    await sleep(1500); // 克制频率，避免触发慢慢买反爬
  }
  // 单次内按 id 去重 → 按标记强度排序 → 限量
  const seen = new Set();
  const uniq = [];
  for (const it of out) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    uniq.push(it);
  }
  uniq.sort((a, b) => markWeight(b.mark) - markWeight(a.mark));
  return { deals: uniq.slice(0, maxItems), total: uniq.length, failures };
}

// ---------- 2) 单品历史价（本地 playwright，可覆盖需京东授权的商品） ----------
async function collectProducts(products) {
  let fetchTrend, analyze;
  try {
    ({ fetchTrend } = require('../price/adapter.manmanbuy'));
    ({ analyze } = require('../price/analyze'));
  } catch (e) {
    return { results: [], failures: [`单品历史价需要 playwright（npx playwright install chromium）：${e.message}`] };
  }
  const results = [];
  const failures = [];
  for (const product of products) {
    console.log(`  [单品] 查询: ${product.name || product.url}`);
    try {
      const item = await fetchTrend(product.url);
      const analysis = analyze(item, product);
      results.push({ product, item, analysis });
      console.log(`    -> ${item.spName} 现价 ${item.currentPrice} 最低 ${item.lowerPrice} | ${analysis.verdict}`);
    } catch (e) {
      results.push({ product, error: e.message });
      failures.push(`单品「${product.name || product.url}」: ${e.message}`);
      console.log(`    -> 失败: ${e.message}`);
    }
    await sleep(2000);
  }
  return { results, failures };
}

// ---------- 落盘 / 运行记录 ----------
function toSavedDeal(it) {
  return {
    id: it.id,
    title: it.title,
    price: it.price,
    unitEach: it.unitEach,
    unitUnit: it.unitUnit,
    unitCount: it.unitCount,
    mark: it.mark,
    platform: it.platform,
    time: it.time,
    url: it.url,
    keyword: it.keyword,
  };
}

function toSavedProduct(r) {
  const url = r.product.url;
  if (r.error) return { name: r.product.name || url, url, targetPrice: r.product.targetPrice ?? null, error: r.error };
  const m = r.analysis.metrics;
  return {
    name: r.product.name || (r.item && r.item.spName) || url,
    url,
    targetPrice: m.target ?? null,
    currentPrice: m.current ?? null,
    lowerPrice: m.lower ?? null,
    lowerDate: (r.item && r.item.lowerDate) || '',
    avgPrice60: m.avg60 ?? null,
    level: r.analysis.level,
    verdict: r.analysis.verdict,
    reasons: r.analysis.reasons,
  };
}

function saveLast(payload) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(LAST_FILE, JSON.stringify(payload, null, 2));
  } catch (e) {
    console.log('[deals-local] 结果落盘失败（不影响其他流程）:', e.message);
  }
}

function appendRun(rec) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(RUNS_FILE, JSON.stringify({ ts: new Date().toISOString(), ...rec }) + '\n');
  } catch {
    // 运行记录落盘失败不影响主流程
  }
}

// ---------- 推送（复用云端 HTML 生成器） ----------
async function pushWechat(token, title, dealRows, productResults) {
  const push = require('../push');
  const parts = [];
  if (productResults.length) {
    const { buildReportHtml } = require('../price/report');
    parts.push(buildReportHtml(productResults));
  }
  if (dealRows.length) {
    const { buildDealsHtml } = require('../price/deals');
    parts.push(buildDealsHtml(dealRows));
  }
  await push.send(token, title, `<div style="font-size:14px;line-height:1.6">${parts.join('')}</div>`);
}

// ---------- 预览文本 ----------
function previewText(dealRows, productResults, total) {
  const lines = [];
  lines.push(`【爆料流·历史低位】命中 ${dealRows.length}/${total} 条`);
  for (const it of dealRows.slice(0, 20)) {
    const u = it.unitEach ? ` ≈¥${it.unitEach}/${it.unitUnit}` : '';
    lines.push(`  ${it.mark || '-'}  ¥${it.price}${u}  ${it.title.slice(0, 34)}  [${it.platform} ${it.time}]`);
  }
  lines.push('');
  lines.push(`【单品历史价】${productResults.filter((r) => !r.error).length}/${productResults.length} 个`);
  for (const r of productResults) {
    if (r.error) {
      lines.push(`  ⚠️ ${r.product.name || r.product.url}: ${r.error}`);
      continue;
    }
    const m = r.analysis.metrics;
    lines.push(`  ${r.analysis.verdict}  ${r.product.name}  现价 ¥${m.current} / 最低 ¥${m.lower}${m.target != null ? ` / 目标 ¥${m.target}` : ''}`);
    for (const reason of r.analysis.reasons) lines.push(`      · ${reason}`);
  }
  return lines.join('\n');
}

// ---------- 主流程 ----------
async function run() {
  const args = process.argv.slice(2);
  const preview = args.includes('--dry-run');
  const wantPush = args.includes('--push');
  const onlyDeals = args.includes('--deals-only');
  const onlyProducts = args.includes('--products-only');
  const t0 = Date.now();

  const config = loadConfig();
  const priceCfg = config.price || {};
  const keywords = resolveKeywords(priceCfg);
  const maxItems = priceCfg.dealMaxItems || priceCfg.dealTopN || 15;
  const products = priceCfg.products || [];

  const failures = [];
  let dealRows = [];
  let dealTotal = 0;
  let productResults = [];

  if (!onlyProducts) {
    if (!keywords.length) {
      console.log('[deals-local] 未配置关键词（DEAL_KEYWORDS / config.price.dealKeywords 均为空），跳过爆料流。');
    } else {
      console.log(`[deals-local] 爆料流关键词 ${keywords.length} 个：${keywords.join('、')}`);
      const r = await collectDeals(keywords, maxItems);
      dealRows = r.deals;
      dealTotal = r.total;
      failures.push(...r.failures);
    }
  }
  if (!onlyDeals) {
    if (!products.length) {
      console.log('[deals-local] config.price.products 为空，跳过单品历史价。');
    } else {
      console.log(`[deals-local] 单品历史价 ${products.length} 个`);
      const r = await collectProducts(products);
      productResults = r.results;
      failures.push(...r.failures);
    }
  }

  const elapsedSec = Math.round((Date.now() - t0) / 1000);
  const okProducts = productResults.filter((r) => !r.error).length;
  const title = `🛒 历史低价·本地采集 ${new Date().toLocaleDateString('zh-CN')}`;

  console.log(`\n[deals-local] 爆料流历史低位 ${dealRows.length}/${dealTotal} 条；单品历史价 ${okProducts}/${productResults.length} 个。`);
  if (failures.length) console.log('[deals-local] 失败:', failures.join(' | '));

  if (preview) {
    console.log('\n[deals-local][preview] 预览模式：不落盘、不推送。\n');
    console.log(previewText(dealRows, productResults, dealTotal));
    return { deals: dealRows.length, products: productResults.length, preview: true };
  }

  saveLast({
    title,
    time: new Date().toISOString(),
    stats: {
      dealsShown: dealRows.length,
      dealsTotal: dealTotal,
      productsTotal: productResults.length,
      productsOk: okProducts,
      failures,
    },
    deals: dealRows.map(toSavedDeal),
    products: productResults.map(toSavedProduct),
  });

  let wechat = false;
  if (wantPush) {
    const token = resolveToken(priceCfg, config);
    if (!token) {
      console.log('[deals-local] --push 已指定，但未配置 pushplusToken / PUSHPLUS_TOKEN，跳过推送。');
    } else if (!dealRows.length && !productResults.length) {
      console.log('[deals-local] 没有任何结果，跳过推送。');
    } else {
      await pushWechat(token, title, dealRows, productResults);
      wechat = true;
    }
  }
  appendRun({ deals: dealRows.length, products: okProducts, failures: failures.length, elapsedSec, wechat });

  console.log('[deals-local] 已写入本地数据（总控中心「🛒 历史低价」页可查看）。');
  console.log(wechat ? '[deals-local] 已推送微信。' : '[deals-local] 未推送微信（本地模式，如需推送加 --push）。');
  return { deals: dealRows.length, products: okProducts, wechat };
}

if (require.main === module) {
  run().catch((e) => {
    console.error('[deals-local] 运行失败:', e);
    process.exit(1);
  });
}

module.exports = { run };
