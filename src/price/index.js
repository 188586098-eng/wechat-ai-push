// 价格监控入口
// 用法:
//   node src/price/index.js            # 检查监控清单价格并推送（需先授权）
//   node src/price/index.js --auth     # 打开慢慢买授权流程（京东商品需用慢慢买App扫码）
//   node src/price/index.js --mock     # 用内置模拟数据跑通分析+推送链路（无需网络/授权）
const fs = require('fs');
const path = require('path');
const auth = require('./auth');
const { fetchTrend } = require('./adapter.manmanbuy');
const { analyze } = require('./analyze');
const { sendReport } = require('./report');

function loadConfig() {
  try {
    const config = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', 'config.json'), 'utf-8'),
    );
    return config.price || { products: [] };
  } catch {
    return { products: [] };
  }
}

const MOCK_DATA = [
  {
    name: '模拟·某品牌手机',
    url: 'https://item.jd.com/100012043978.html',
    targetPrice: 2999,
  },
  {
    name: '模拟·无线耳机',
    url: 'https://item.jd.com/100000000001.html',
    targetPrice: 499,
  },
];

const MOCK_RESULTS = [
  {
    item: {
      spName: '某品牌旗舰手机 12GB+256GB',
      currentPrice: '2999.00',
      lowerPrice: '2799.00',
      lowerDate: '2026-06-18',
      avgPrice60: '3199.00',
      datePrice: Array.from({ length: 30 }, (_, i) => [
        new Date(Date.now() - (29 - i) * 86400000).toISOString().slice(0, 10),
        3100 + (i % 7) * 80,
      ]),
    },
  },
  {
    item: {
      spName: '无线降噪耳机 Pro',
      currentPrice: '429.00',
      lowerPrice: '399.00',
      lowerDate: '2026-08-01',
      avgPrice60: '455.00',
      datePrice: Array.from({ length: 20 }, (_, i) => [
        new Date(Date.now() - (19 - i) * 86400000).toISOString().slice(0, 10),
        450 + (i % 5) * 30,
      ]),
    },
  },
];

async function runMock() {
  const config = loadConfig();
  const products = (config.products && config.products.length) ? config.products : MOCK_DATA;
  const mockByUrl = new Map(MOCK_RESULTS.map((r, i) => [MOCK_DATA[i].url, r.item]));
  const results = [];
  for (const product of products) {
    const item = mockByUrl.get(product.url);
    if (!item) {
      results.push({ product, error: 'mock 数据中没有该商品' });
      continue;
    }
    const analysis = analyze(item, product);
    console.log(`[price] ${product.name}: 现价 ${item.currentPrice} → ${analysis.verdict}`);
    results.push({ product, item, analysis });
  }
  const token = (loadConfig() || {}).pushplusToken;
  await sendReport(token, `价格监控测试 ${new Date().toLocaleDateString('zh-CN')}`, results);
}

async function run() {
  const config = loadConfig();
  const products = config.products || [];
  if (!products.length) {
    console.error('[price] config.json 的 price.products 为空，请先配置监控清单。');
    process.exit(1);
  }

  const results = [];
  for (const product of products) {
    console.log(`[price] 查询: ${product.name || product.url}`);
    try {
      const item = await fetchTrend(product.url);
      const analysis = analyze(item, product);
      console.log(`  -> ${item.spName} 现价 ${item.currentPrice} 最低 ${item.lowerPrice} | ${analysis.verdict}`);
      results.push({ product, item, analysis });
    } catch (e) {
      console.error(`  -> 失败: ${e.message}`);
      results.push({ product, error: e.message });
    }
    // 克制频率，避免触发慢慢买限流
    await new Promise((r) => setTimeout(r, 2000));
  }

  const title = `价格监控 ${new Date().toLocaleDateString('zh-CN')}`;
  const token = config.pushplusToken;
  const ok = results.filter((r) => r.analysis && r.analysis.level !== 'hold').length;
  if (ok === 0 && results.every((r) => r.analysis)) {
    console.log('[price] 所有商品均不建议现在买，本次不推送（可在 config 中开启 alwaysPush 强制推送）。');
  }
  if (config.alwaysPush || ok > 0 || results.some((r) => r.error)) {
    await sendReport(token, title, results);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const config = loadConfig();
  const products = config.products || [];
  if (args.includes('--auth')) {
    const firstUrl = products.length ? products[0].url : null;
    if (!firstUrl) {
      console.error('[price] --auth 需要一个商品 URL 来触发授权页，请先在 config 配置 price.products。');
      process.exit(1);
    }
    const ok = await auth.authorize(firstUrl);
    process.exit(ok ? 0 : 1);
  }
  if (args.includes('--mock')) {
    await runMock();
    return;
  }
  if (args.includes('--deals')) {
    const { runDeals } = require('./deals');
    // 云端场景没有 config.json：token 与关键词从环境变量注入
    const token = process.env.PUSHPLUS_TOKEN || config.pushplusToken;
    await runDeals(config, { token });
    return;
  }
  await run();
}

if (require.main === module) {
  main().catch((e) => {
    console.error('[price] 运行失败:', e);
    process.exit(1);
  });
}

module.exports = { main };
