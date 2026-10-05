// 招聘采集配置：env > config.json 的 jobs 段 > 内置默认值
// 设计原则：所有站点开关、关键词、频率、限速都可配置，改渠道不必改代码。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

/** 监理方向：强词直接命中；弱词需配合行业词出现才算（避免“总监”误命中互联网岗位） */
const DEFAULT_SUPERVISION = {
  strong: [
    '水利工程监理', '水利水电监理', '水利监理', '水工监理', '水利监理工程师',
    '总监理工程师', '副总监理工程师', '总监代表', '监理工程师', '注册监理工程师',
    '监理资料员', '监理测量', '监理测量工程师', '监理员', '工程监理',
  ],
  weak: ['监理', '总监', '副总监', '监理部'],
};

/** 施工方向 */
const DEFAULT_CONSTRUCTION = {
  strong: [
    '水利项目经理', '水利水电项目经理', '项目副经理', '项目总工程师', '项目总工',
    '水利资料员', '水利水电资料员', '施工资料员', '工程项目资料员', '水利技术负责人',
  ],
  weak: ['施工员', '资料员', '测量员', '项目经理', '总工程师', '总工', '副经理', '技术负责人', '施工管理', '安全总监'],
};

/** 行业上下文词：弱词命中时至少要有一个，否则视为非水利岗位 */
const DEFAULT_INDUSTRY = [
  '水利', '水电', '水务', '水工', '水利水电', '堤防', '灌区', '泵站', '水库', '水文',
  '河道', '大坝', '水电站', '水环境', '水资源', '引水', '防洪', '水运', '港航', '勘察设计',
];

/** 排除词：命中即丢弃（销售/中介/无关行业的高频噪声） */
const DEFAULT_EXCLUDE = [
  '保险', '房产', '置业', '中介', '招生', '培训', '电商', '直播', '刷单', '兼职日结',
  '快递', '外卖', '保安', '司机', '客服', '催收', '贷款', '美容', '餐饮', '健身',
  '房产资料员', '保险资料员', '销售资料员', '汽车监理', '装修监理', '家装监理',
];

/** 公告渠道（政府/协会官网）：标题需命中招聘类词才收录 */
const DEFAULT_NOTICE_KEYWORDS = ['公开招聘', '招聘', '招录', '招考', '人才引进', '岗位需求', '选聘', '社会招聘', '校园招聘'];

/**
 * 省厅公告列表通用规则：先切出「含发布日期的 <li> 行」，再抽行内首个链接。
 * 用负向先行断言 (?:(?!<li)[\s\S])*? 防止跨行匹配，这样无日期的导航项不会被当成条目。
 * 已实测适用于安徽/山东/广东/四川/陕西/福建水利厅的列表页。
 */
const PROV_NOTICE_RULE = {
  type: 'list',
  segmentPattern: '<li[^>]*>(?:(?!<li)[\\s\\S])*?\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}(?:(?!<li)[\\s\\S])*?<\\/li>',
  // 上限放到 600：安徽的 <a> 与标题间有近 200 字符缩进空白，140 会漏匹配；
  // 尾部的 ? 是惰性量词，仍会停在最近的 </a>，不会跨条目。
  itemPattern: '<a[^>]+href="([^"]+)"[^>]*>([\\s\\S]{2,600}?)<\\/a>',
  titleGroup: 2,
  hrefGroup: 1,
};

/** 默认采集渠道。enabled: false 的渠道不会发起任何请求。 */
const DEFAULT_SITES = {
  zhaopin: {
    enabled: true,
    name: '智联招聘',
    // 已实测：游客可见服务端渲染列表，20 条/页；kw 为搜索词，p 为页码
    searchUrl: 'https://sou.zhaopin.com/?kw={kw}&p={page}',
    detailUrl: 'http://www.zhaopin.com/jobdetail/{id}.htm',
    maxPages: 3,
    detailEnrich: true, // 详情页取权威发布时间（较慢，仅对命中且未见过的新岗位触发）
    detailMaxPerRun: 15,
  },
  boss: {
    // 实测(2026-10)：首页/搜索页均被跳转到 passport/zp/verify.html「安全验证」滑块页，
    // 登录页直接 about:blank；属站点反自动化措施，本程序不绕过，已定案关闭。
    // 导入自己浏览器的会话也无效（仍会触发安全验证），故不必再试。
    enabled: false,
    name: 'BOSS直聘',
    searchUrl: 'https://www.zhipin.com/web/geek/job?query={kw}&page={page}',
    // 若要用自己的账号尝试：先在自己浏览器登录，再
    // `npm run jobs:login -- boss --cookie-file cookies.txt` 导入会话，然后把 enabled 改为 true
    requiresLogin: true,
    loginUrl: 'https://www.zhipin.com/web/user/?ka=header-login',
    storageState: 'auth/boss.json',
    maxPages: 2,
    selectors: {
      item: '.job-card-wrapper, li.job-card-box',
      title: '.job-name, .job-title',
      company: '.company-name a, .company-name',
      location: '.job-area, .job-card-left .job-area',
      salary: '.salary, .job-salary',
      link: 'a.job-card-left, a.job-name',
      publishedAt: '.job-info .time, .job-card-footer .time',
    },
  },
  '51job': {
    // 实测(2026-09)可用：列表页结构化数据完整（含发布时间），仅排序/结果受出口 IP 地域影响。
    // 注意：职位详情页需要人工滑块验证，因此详情链接只作为“给你点开看”的地址。
    enabled: true,
    name: '前程无忧',
    searchUrl: 'https://we.51job.com/pc/search?keyword={kw}&pageNum={page}',
    maxPages: 1,
    attrExtract: {
      itemSelector: '.joblist-item',
      attrSelector: '[sensorsname="JobShortExposure"], [sensorsname]',
      attrName: 'sensorsdata',
      map: {
        siteJobId: 'jobId',
        title: 'jobTitle',
        salary: 'jobSalary',
        location: 'jobArea',
        publishedText: 'jobTime',
      },
      fieldSelectors: { company: '.cname' },
      detailUrl: 'https://jobs.51job.com/all/{jobId}.html',
    },
    // 备用：结构化属性失效时可改回 DOM 选择器模式（删掉 attrExtract 即启用）
    selectors: {
      item: '.joblist-item',
      title: '.jname',
      company: '.cname',
      location: '.joblist-item-job .shrink-0, .area',
      salary: '.sal',
      link: 'a',
      publishedAt: '.time',
    },
  },
  liepin: {
    // 实测(2026-10-02) 双重拦截，已定案关闭：
    //   ① 首页/搜索页渲染约 2.5 秒后被站点脚本重置为 about:blank（反自动化，越过它需规避手段，本项目不做）；
    //   ② 出口 IP 被标记进 safe.liepin.com/intercept/ip/captcha，纯 HTTP 请求即被 302——
    //      与 Cookie、浏览器指纹无关，所以导入登录态同样无效（请求在读到 Cookie 前就被转走）。
    // 附注：猎聘还检测开发者工具，在自己 Chrome 里按 F12 也会跳 about:blank，故连手工复制 Cookie 都走不通。
    // 2026-10-03 复测：出口 IP 的验证码拦截已自行解除（纯 HTTP 恢复 200），但页面自毁与 F12 检测仍在，
    // 且搜索页 URL 命中 robots 的 Disallow: /*?*，故维持关闭（搁置，非永久定案）。
    enabled: false,
    name: '猎聘',
    searchUrl: 'https://www.liepin.com/zhaopin/?key={kw}&curPage={page}',
    requiresLogin: true,
    loginUrl: 'https://www.liepin.com/user/login/',
    storageState: 'auth/liepin.json',
    maxPages: 2,
    selectors: {
      item: '.job-list-box .job-card-pc-container, .job-card-pc-container',
      title: '.job-title-box .job-title, .job-title',
      company: '.company-name, .job-company-name',
      location: '.job-dq-box .ellipsis-1, .job-dq-box',
      salary: '.job-salary, .job-title-left .job-salary',
      link: 'a.job-card-pc-container, .job-title-box a',
      publishedAt: '.job-card-footer .time, .time',
    },
  },
  // 工程监理人才网：监理垂直站，与「监理」方向高度对口
  // 实测(2026-10-03)：robots.txt 允许抓取（空 Disallow）；纯服务端 HTML，列表页自带
  // 公司/地点/薪资/发布日期，`/jobs?page=N` 翻页有效，20 条/页，无需浏览器与登录。
  // 关键词搜索接口无效，故按整站列表抓取（适配器标 queryless），由本地关键词筛选挑水利岗。
  job2299: {
    enabled: true,
    name: '工程监理人才网',
    searchUrl: 'https://www.job2299.com/jobs?page={page}',
    maxPages: 3,
  },
  // 监理招聘网：纯监理垂直站，与「监理」方向最对口
  // 实测(2026-10-04)：robots 禁的均为简历/管理路径，公开职位页与关键词页允许抓取；
  // 纯服务端 HTML，无需浏览器与登录；关键词页 `/jobs/keys-{kw}.html`，翻页 `-p-{N}.html`；
  // 列表自带 职位名/薪资/发布日期/公司/地点。
  jianlihr: {
    enabled: true,
    name: '监理招聘网',
    searchUrl: 'https://www.jianlihr.com/jobs/keys-{kw}.html',
    maxPages: 2,
  },
  // 水利英才网（一览水利）：水利垂直站
  // 实测(2026-10-04)：robots 仅禁 4 个管理路径(/my/、/adminNew/ 等)，公开职位页允许；
  // 纯服务端 HTML(job1001 平台)；关键词搜索 `SearchResult.php?jtzw={kw}&page={N}` 有效；
  // 列表自带 职位名/经验/学历/地点/薪资/更新时间。注意：多加 showtype/sorttype 会返回空壳页。
  waterhr: {
    enabled: true,
    name: '水利英才网',
    searchUrl: 'https://www.waterhr.com/SearchResult.php?jtzw={kw}&page={page}',
    maxPages: 2,
  },
  // 中国水利人才网·招聘公告（水利部官方平台）
  // 实测(2026-10-04)：robots 取不到（无明确指令）；公告为表格行 <tr><td><a>标题</a></td><td>日期</td></tr>；
  // 由通用采集器解析：segmentPattern 先切「含发布日期的表格行」（负向先行断言避免跨行），
  // itemPattern 只认该 CMS 的公告链接形态（tYYYYMMDD_ID.html），从而排除导航链接。
  rencai: {
    enabled: true,
    name: '中国水利人才网·招聘公告',
    sourceType: 'notice',
    listUrl: 'http://rencai.mwr.cn/zpks/zpgg/',
    maxPages: 1,
    rule: {
      type: 'list',
      segmentPattern: '<tr[^>]*>(?:(?!<tr)[\\s\\S])*?\\d{4}-\\d{2}-\\d{2}(?:(?!<tr)[\\s\\S])*?<\\/tr>',
      itemPattern: '<a[^>]+href="([^"]*t\\d{6,}_\\d+\\.html)"[^>]*>([\\s\\S]{4,140}?)<\\/a>',
      titleGroup: 2,
      hrefGroup: 1,
    },
  },
  // 省级水利厅招聘公告（2026-10-04 实测：站点可达、列表服务端渲染、条目自带发布日期）
  // 说明：省厅「通知公告」多为资质公示/采购比选，招聘公告占比低；
  //   但一旦发布即属事业单位/国企正式岗位，属低频高价值兜底。
  //   · 未纳入：湖北(slt.hubei.gov.cn 返回 412，有 WAF)、云南(slt.yn.gov.cn 域名不可达)、
  //     浙江(zj 人事信息栏目仅 1.6KB，JS 渲染)、湖南(通知公告 JS 渲染；人事信息栏目只有任免/退休通知)；
  //   · 福建「人事信息」实测为党建/培训动态(75 行 0 招聘)，故用其「通知公告」栏目。
  anhui_tzgg: {
    enabled: true,
    name: '安徽省水利厅·通知公告',
    sourceType: 'notice',
    listUrl: 'https://slt.ah.gov.cn/xwzx/tzgg/index.html',
    maxPages: 1,
    rule: PROV_NOTICE_RULE,
  },
  shandong_zkly: {
    enabled: true,
    name: '山东省水利厅·招考录用',
    sourceType: 'notice',
    listUrl: 'http://wr.shandong.gov.cn/zwgk_319/fdzdgknr/rsxx/zkly/',
    maxPages: 1,
    rule: PROV_NOTICE_RULE,
  },
  guangdong_rsxx: {
    enabled: true,
    name: '广东省水利厅·人事信息',
    sourceType: 'notice',
    listUrl: 'http://slt.gd.gov.cn/rsxx8773/index.html',
    maxPages: 1,
    rule: PROV_NOTICE_RULE,
  },
  sichuan_gsgg: {
    enabled: true,
    name: '四川省水利厅·公示公告',
    sourceType: 'notice',
    listUrl: 'https://slt.sc.gov.cn/scsslt/gsgg/new_list.shtml',
    maxPages: 1,
    rule: PROV_NOTICE_RULE,
  },
  shaanxi_tzgg: {
    enabled: true,
    name: '陕西省水利厅·通知公告',
    sourceType: 'notice',
    listUrl: 'https://slt.shaanxi.gov.cn/sy/tzgg/',
    maxPages: 1,
    rule: PROV_NOTICE_RULE,
  },
  fujian_tzgg: {
    enabled: true,
    name: '福建省水利厅·通知公告',
    sourceType: 'notice',
    listUrl: 'http://slt.fujian.gov.cn/wzsy/tzgg/',
    maxPages: 1,
    rule: PROV_NOTICE_RULE,
  },
  // 水利行业公告渠道：政府/协会官网列表页，按标题关键词筛招聘公告
  // 由通用采集器解析：rule.itemPattern 抽取条目，rule.segmentPattern 用于定位含日期的列表行。
  // 注意：不同省份 CMS 差异大，下列为已实测可解析的渠道；其余省厅按同样格式在 config.json 里补充。
  //   · 已实测可访问但列表由 JS/AJAX 渲染（需改用浏览器渠道或找接口）：
  //     山东 wr.shandong.gov.cn / 四川 slt.sc.gov.cn / 广东 slt.gd.gov.cn / 浙江 slt.zj.gov.cn
  cweun: {
    enabled: true,
    name: '中国水利工程协会',
    sourceType: 'notice',
    encoding: 'gbk',
    listUrl: 'https://www.cweun.org/index.php?m=content&c=index&a=lists&catid={catid}&page={page}',
    catids: [16],
    maxPages: 1,
    rule: {
      type: 'list',
      itemPattern: '<a[^>]+href="(show\\.php\\?cid=\\d+&(?:amp;)?id=\\d+)"[^>]*>([\\s\\S]{4,120}?)</a>',
      urlTemplate: 'https://www.cweun.org/{href}',
      titleGroup: 2,
      hrefGroup: 1,
    },
  },
  jswater: {
    enabled: true,
    name: '江苏省水利厅·通知公示',
    sourceType: 'notice',
    listUrl: 'http://jswater.jiangsu.gov.cn/col/col42984/index.html',
    maxPages: 1,
    rule: {
      type: 'list',
      segmentPattern: '<li[^>]*>([\\s\\S]{0,500}?)</li>',
      itemPattern: '<a[^>]+href="([^"]+)"[^>]*>([\\s\\S]{4,120}?)</a>',
      urlTemplate: 'http://jswater.jiangsu.gov.cn{href}',
      titleGroup: 2,
      hrefGroup: 1,
    },
  },
};

/** 请求与限速：默认克制，避免触发目标站反爬 */
const DEFAULT_FETCH = {
  timeoutMs: 20000,
  retries: 2,           // 单个请求最多重试次数
  backoffMs: 1500,      // 指数退避基数
  minDelayMs: 2000,     // 请求间最小间隔
  maxDelayMs: 5000,     // 请求间最大间隔（随机取值，避免固定节奏）
  concurrency: 2,       // 同站点并发上限
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

const DEFAULT_SCHEDULE = {
  enabled: true,
  runOnStart: true,     // 常驻进程启动时先跑一轮
  mode: 'interval',     // 'interval' 间隔小时 | 'daily' 每日固定时刻
  intervalHours: 24,
  at: ['08:30'],        // mode='daily' 时的执行时刻（24 小时制，可多个）
};

/** 有效期：只保留“还可能在招”的岗位，过期信息推送出去等于浪费一次打扰 */
const DEFAULT_FRESH = {
  maxAgeDays: 180,      // 默认半年；要收紧到 3 个月改成 90（或设 JOBS_MAX_AGE_DAYS=90）
  keepUndated: true,    // 未提供发布时间的条目保留（部分公告/列表页不给日期）
};

const DEFAULT_OUTPUT = {
  maxSnapshot: 2000,    // 快照与表格保留条数
  keepRunLogs: 30,      // runs.jsonl 保留条数
  logRetentionDays: 14, // 按天日志保留天数
  csvBom: true,         // CSV 带 BOM，Excel 直接双击不乱码
};

/** 微信推送：只推本轮「新增」岗位，不重复推送历史条目 */
const DEFAULT_PUSH = {
  enabled: true,
  limit: 10, // 单条消息最多列出的岗位数，其余只记条数（微信对长文本会截断）
};

function loadRootConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf-8'));
  } catch {
    return {};
  }
}

function parseList(value) {
  if (!value) return null;
  const list = String(value)
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : null;
}

/** 关键词分组：env 覆盖 > config 覆盖 > 内置默认；覆盖是全量替换语义 */
function resolveKeywords(cfg) {
  const dirs = cfg.directions || {};
  const pick = (envName, dirKey, part, fallback) =>
    parseList(process.env[envName]) || parseList(dirs[dirKey] && dirs[dirKey][part]) || fallback;

  return {
    supervision: {
      strong: pick('JOBS_SUPERVISION_STRONG', 'supervision', 'strong', DEFAULT_SUPERVISION.strong),
      weak: pick('JOBS_SUPERVISION_WEAK', 'supervision', 'weak', DEFAULT_SUPERVISION.weak),
    },
    construction: {
      strong: pick('JOBS_CONSTRUCTION_STRONG', 'construction', 'strong', DEFAULT_CONSTRUCTION.strong),
      weak: pick('JOBS_CONSTRUCTION_WEAK', 'construction', 'weak', DEFAULT_CONSTRUCTION.weak),
    },
    industry: parseList(process.env.JOBS_INDUSTRY_WORDS) || parseList(cfg.industryWords) || DEFAULT_INDUSTRY,
    exclude: parseList(process.env.JOBS_EXCLUDE_KEYWORDS) || parseList(cfg.excludeKeywords) || DEFAULT_EXCLUDE,
    notice: parseList(process.env.JOBS_NOTICE_KEYWORDS) || parseList(cfg.noticeKeywords) || DEFAULT_NOTICE_KEYWORDS,
    // 弱词需命中的行业词数量；1 表示标题或标签里出现任一行业词即可
    minIndustryHits: Number(cfg.minIndustryHits) > 0 ? Number(cfg.minIndustryHits) : 1,
  };
}

function resolve() {
  const root = loadRootConfig();
  const cfg = root.jobs || {};

  const sites = {};
  const siteOverrides = cfg.sites || {};
  for (const [key, def] of Object.entries(DEFAULT_SITES)) {
    // key 写进站点对象：日志与登录态文件名都要用到
    sites[key] = { key, ...def, ...(siteOverrides[key] || {}) };
    if (siteOverrides[key] && siteOverrides[key].selectors) {
      sites[key].selectors = { ...def.selectors, ...siteOverrides[key].selectors };
    }
  }
  // 用户新增的自定义渠道（不在内置列表里的 key）
  for (const [key, val] of Object.entries(siteOverrides)) {
    if (!sites[key]) sites[key] = { key, sourceType: 'job', ...val };
  }
  if (process.env.JOBS_SITES) {
    const only = parseList(process.env.JOBS_SITES);
    if (only) for (const k of Object.keys(sites)) sites[k].enabled = only.includes(k);
  }
  // 全局页数上限：临时限流或试跑时用（JOBS_MAX_PAGES=1 各渠道最多只抓 1 页）
  const maxPagesCap = Number(process.env.JOBS_MAX_PAGES);
  if (maxPagesCap > 0) {
    for (const s of Object.values(sites)) {
      if (s.maxPages) s.maxPages = Math.min(s.maxPages, maxPagesCap);
    }
  }

  return {
    enabled: cfg.enabled !== false,
    sites,
    keywords: resolveKeywords(cfg),
    queries: parseList(process.env.JOBS_QUERIES) || parseList(cfg.queries) || ['水利监理', '水利工程监理', '总监理工程师', '水利项目经理', '水利资料员', '水利水电项目总工'],
    fetch: { ...DEFAULT_FETCH, ...(cfg.fetch || {}) },
    schedule: { ...DEFAULT_SCHEDULE, ...(cfg.schedule || {}) },
    fresh: {
      maxAgeDays:
        Number(process.env.JOBS_MAX_AGE_DAYS) > 0
          ? Number(process.env.JOBS_MAX_AGE_DAYS)
          : Number(cfg.maxAgeDays) > 0
            ? Number(cfg.maxAgeDays)
            : DEFAULT_FRESH.maxAgeDays,
      keepUndated: cfg.keepUndated !== false,
    },
    output: { ...DEFAULT_OUTPUT, ...(cfg.output || {}) },
    push: (() => {
      const p = cfg.push || {};
      const envLimit = Number(process.env.JOBS_PUSH_LIMIT);
      return {
        enabled: p.enabled !== false,
        // token 优先级：env > jobs.push.token > 顶层 pushplusToken（与其他模块共用同一个 token）
        token: process.env.PUSHPLUS_TOKEN || p.token || root.pushplusToken || '',
        limit: envLimit > 0 ? envLimit : Number(p.limit) > 0 ? Number(p.limit) : Number(root.pushLimitPerRun) > 0 ? Number(root.pushLimitPerRun) : DEFAULT_PUSH.limit,
      };
    })(),
    dir: path.join(ROOT, 'data', 'jobs'),
    root,
    raw: cfg,
  };
}

/** 登录态文件绝对路径（storageState 写相对路径时按 data/jobs/ 解析） */
function storageStatePath(site, cfg) {
  if (!site || !site.storageState) return '';
  return path.isAbsolute(site.storageState) ? site.storageState : path.join(cfg.dir, site.storageState);
}

module.exports = { resolve, storageStatePath, ROOT };
