// 关键词引擎：订阅词命中（任一）+ 排除词过滤 + 词来源解析
// 来源优先级：环境变量 > config.json wool.keywords > 内置默认
// 注意：内置默认即云端(无 config.json)生效的关键词，通用羊毛 + 快递/银行活动主题均需在此覆盖

// 关键词引擎：订阅词命中（任一）+ 排除词过滤 + 词来源解析
// 来源优先级：环境变量 > config.json wool.keywords > 内置默认
// 注意：内置默认即云端(无 config.json)生效的关键词，通用羊毛 + 快递/银行活动主题均需在此覆盖
// 强弱分层：强词 = 主题明确(快递/银行/话费/免单…)，命中 1 个即推；
//          弱词 = 泛促销词(免费/红包/会员…)，只命中弱词需 ≥2 个(config.wool.minWeakHits)才推，
//          抑制“标题含个红包就推”的低信息量推送。白菜哦商品流走搜索词，不参与分层。

/** 强词：明确羊毛主题，命中即推 */
const STRONG_KEYWORDS = [
  // 通用明确羊毛
  '免费',
  '白嫖',
  '0元',
  '零元',
  '免单',
  '返现',
  '大额券',
  '神券',
  '话费',
  '礼品卡',
  '赠品',
  '立减金',
  '还款券',
  '云闪付',
  '银联',
  '体检',
  '洁牙',
  '洗牙',
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
  '信用卡',
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
  // 调研补充：外卖/打车/生活类羊毛（全网高关注）
  '美团',
  '外卖',
  '饿了么',
  '打车',
  '滴滴',
  '瑞幸',
  '星巴克',
  '翼支付',
  '数字人民币',
  '数币',
  'E卡',
  // 全网调研补充二：加油/充电/缴费/出行/换新 高频银行活动场景
  '加油',
  '充电',
  '缴费',
  '火车票',
  '地铁',
  '国补',
  '盒马',
];

/** 弱词：泛促销词，单命中信息密度低，需凑够 minWeakHits 才推 */
const WEAK_KEYWORDS = [
  '红包',
  '会员',
  '领券',
  '试用',
  '抽奖',
  '积分',
  '半价',
  '五折',
  '银行',
];

/** 订阅关键词默认清单（强词在前）：通用羊毛/促销 + 快递优惠活动 + 银行羊毛活动，可按需增删 */
const DEFAULT_KEYWORDS = [...STRONG_KEYWORDS, ...WEAK_KEYWORDS];

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

const WEAK_SET = new Set(WEAK_KEYWORDS);

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

/** 词分层：内置弱词按弱词；其余(含用户/内置强词、用户自加词)按强词 */
function tierOf(word) {
  return WEAK_SET.has(word) ? 'weak' : 'strong';
}

/**
 * 解析配置 → { includes, excludes, queries, strong, weak, weakOnlyMin }
 * - includes: 订阅关键词（空数组表示不过滤、收全部线报）
 * - strong/weak: 订阅词按强弱分层后的集合
 * - weakOnlyMin: 仅命中弱词时需达到的最小弱词命中数
 * - excludes: 排除关键词
 * - queries: 白菜哦搜索关键词
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
  const strong = new Set(includes.filter((w) => tierOf(w) === 'strong'));
  const weak = new Set(includes.filter((w) => tierOf(w) === 'weak'));
  return {
    includes,
    excludes,
    queries,
    strong,
    weak,
    weakOnlyMin: wool.minWeakHits != null ? wool.minWeakHits : 2,
  };
}

/**
 * 判断条目是否命中订阅规则
 * 来源差异：
 *  - baicaio 是商品好价搜索流，搜索词即价值标签，这里只做排除词过滤，
 *    不做 include 匹配，避免“顺丰包邮/京东快递发货”等商品描述被误标为快递/银行活动；
 *  - zhuanyes / zuanke8 等论坛活动流：命中任一强词即推；仅命中弱词需 ≥weakOnlyMin 个。
 * @returns {{ok:boolean, hit?:string, strongCount?:number, weakCount?:number, reason?:string}}
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
  const strongHits = [];
  const weakHits = [];
  for (const k of rules.includes) {
    if (!hay.includes(k.toLowerCase())) continue;
    if (rules.strong.has(k)) strongHits.push(k);
    else weakHits.push(k);
  }
  const ok = strongHits.length > 0 || weakHits.length >= rules.weakOnlyMin;
  if (!ok) return { ok: false, reason: weakHits.length ? 'weak-only' : 'no-hit' };
  const hit = [...strongHits, ...weakHits].join('、');
  return { ok: true, hit: hit || item.keyword, strongCount: strongHits.length, weakCount: weakHits.length };
}

/**
 * 判断标题是否为“讨论/观点/求助帖”而非即时线报（仅用于论坛讨论流源过滤）。
 * 特征：疑问句、闲聊观点动词、吐槽词。保守词表，避免误伤活动标题。
 */
const DISCUSS_RE =
  /[?？]|吗|么|怎么样|怎么看|咋|什么情况|值不值|该不该|能不能|可不可以|要不要|有没有|吧友|求问|求教|请教|求助|请教|大家觉得|你们觉得|我感觉|来聊聊|吐槽|避雷|翻车|无语|离谱|真坑|太坑|暴露了|都(涨价|没了|关了|暴露)/;

function isForumDiscussion(title) {
  return DISCUSS_RE.test(String(title || ''));
}

module.exports = { resolve, match, isForumDiscussion, STRONG_KEYWORDS, WEAK_KEYWORDS, DEFAULT_KEYWORDS, DEFAULT_EXCLUDE };