// 关键词引擎：订阅词命中（任一）+ 排除词过滤 + 词来源解析
// 来源优先级：环境变量 > config.json wool.keywords > 内置默认
// 注意：内置默认即云端(无 config.json)生效的关键词，通用羊毛 + 快递/银行活动主题均需在此覆盖

/** 订阅关键词默认清单：通用羊毛/促销 + 快递优惠活动 + 银行羊毛活动，可按需增删 */
const DEFAULT_KEYWORDS = [
  // 通用羊毛/促销
  '免费',
  '白嫖',
  '0元',
  '零元',
  '免单',
  '返现',
  '大额券',
  '神券',
  '红包',
  '抽奖',
  '话费',
  '会员',
  '礼品卡',
  '半价',
  '五折',
  '领券',
  '试用',
  '赠品',
  // 快递优惠活动（京东/顺丰寄件券、免单、助力等）
  '京东快递',
  '顺丰',
  '寄件',
  '运费',
  '快递券',
  '寄件券',
  '运费券',
  '寄快递',
  // 银行羊毛活动（红包、立减金、还款券、积分、权益、任务）
  '立减金',
  '还款券',
  '云闪付',
  '银联',
  '信用卡',
  '银行',
  '积分',
  '体检',
  '洁牙',
  '洗牙',
  '中行',
  '农行',
  '工行',
  '建行',
  '交行',
  '招行',
  '光大',
  '民生',
  '浦发',
  '中信',
  '兴业',
  '广发',
  '邮储',
  '平安',
  '华夏',
  '浙商',
];

/** 排除关键词默认清单：灰产/违法/纯拉新噪音 */
const DEFAULT_EXCLUDE = [
  '赌博',
  '博彩',
  '六合彩',
  '刷单',
  '代刷',
  '兼职',
  '招聘',
  '贷款',
  '借贷',
  '招嫖',
  '约炮',
  '外挂',
  '私服',
  '跑分',
  '加微信',
  '加qq',
  '扫码进群',
];

function splitList(s) {
  return String(s)
    .split(/[,，\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function fromEnvOrConfig(envVal, cfgArr, fallback) {
  if (envVal) return splitList(envVal);
  return Array.isArray(cfgArr) && cfgArr.length ? cfgArr : fallback;
}

/**
 * 解析配置 → { includes, excludes, queries }
 * - includes: 订阅关键词（空数组表示不过滤、收全部线报）
 * - excludes: 排除关键词
 * - baicaioQueries: 白菜哦搜索关键词
 */
function resolve(config) {
  const wool = config.wool || {};
  const includes = fromEnvOrConfig(process.env.WOOL_KEYWORDS, wool.keywords, DEFAULT_KEYWORDS);
  const excludes = fromEnvOrConfig(process.env.WOOL_EXCLUDE_KEYWORDS, wool.excludeKeywords, DEFAULT_EXCLUDE);
  let queries = fromEnvOrConfig(
    process.env.WOOL_BAICAIO_QUERIES,
    (wool.baicaio && wool.baicaio.queries) || config.dealKeywords || (config.price && config.price.dealKeywords),
    [],
  );
  // 白菜哦搜索词与订阅词独立：未配置时回退订阅词（避免重复维护两套清单）
  if (!queries.length) queries = includes;
  return { includes, excludes, queries };
}

/**
 * 判断条目是否命中订阅规则
 * 来源差异：
 *  - baicaio 是商品好价搜索流，搜索词即价值标签，这里只做排除词过滤，
 *    不做 include 匹配，避免“顺丰包邮/京东快递发货”等商品描述被误标为快递/银行活动；
 *  - zhuanyes / zuanke8 是论坛活动流，标题命中的主题词才推（快递/银行/通用羊毛）。
 * @returns {{ok:boolean, hit?:string, reason?:string}}
 */
function match(item, rules) {
  const hay = `${item.title} ${item.merchant || ''}`.toLowerCase();
  for (const k of rules.excludes) {
    if (hay.includes(k.toLowerCase())) return { ok: false, reason: 'excluded:' + k };
  }
  if (item.source === 'baicaio') {
    return { ok: true, hit: item.keyword || '好价' };
  }
  if (!rules.includes.length) return { ok: true };
  for (const k of rules.includes) {
    if (hay.toLowerCase().includes(k.toLowerCase())) return { ok: true, hit: k };
  }
  return { ok: false, reason: 'no-hit' };
}

module.exports = { resolve, match, DEFAULT_KEYWORDS, DEFAULT_EXCLUDE };
