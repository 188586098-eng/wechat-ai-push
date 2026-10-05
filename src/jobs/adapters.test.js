// 渠道解析自测：node src/jobs/adapters.test.js
// 页面结构变化是本类程序最主要的失效原因。这里用「实测抓到的真实 HTML 片段」作为固定样本，
// 网站改版导致解析失效时，这个测试会先于线上采集报警。
const assert = require('assert');
const jianlihr = require('./adapters/jianlihr');
const waterhr = require('./adapters/waterhr');
const generic = require('./adapters/generic');
const config = require('./config');

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`  ✗ ${name}: ${e.message}`);
  }
}

// ---------- 监理招聘网 jianlihr ----------
// 结构取自 2026-10-04 实测列表（keys-水利监理）
const JIANLIR_HTML = `
<div class="wrap">
<div class="topjob">
  <div class="zwname">
    <div class="zwbox"><a href="/job/365726.html" target="_blank" title="水利监理专监或总监（退休）"> 水利监理专监或总监（退休） </a> <i class="icon_zd"> </i> </div>
    <div class="xcbox"> <strong>面议</strong> <p><span>2026-10-04</span></p> </div>
  </div>
  <div class="qyname">
    <a href="/company/151623.html" title="重庆蓝宫工程项目管理咨询有限公司"><img src="x.gif" class="cinfo_logo" alt="重庆蓝宫工程项目管理咨询有限公司" /></a>
    <p class="mt-15"><a href="/company/151623.html" target="_blank" title="重庆蓝宫工程项目管理咨询有限公司">重庆蓝宫工程项目管理咨询有限公司</a></p>
    <p>黑龙江-哈尔滨</p>
  </div>
</div>
<div class="topjob">
  <div class="zwname">
    <div class="zwbox"><a href="/job/242958.html" target="_blank" title="注册监理工程师"> 注册监理工程师 </a><i class="icon_zd"><img src="jipin.png"></i></div>
    <div class="xcbox"> <strong>6000~12000元/月</strong> <p><span>2026-10-03</span></p> </div>
  </div>
  <div class="qyname">
    <a href="/company/138003.html" title="江苏雨田工程咨询集团有限公司"><img src="y.gif" class="cinfo_logo" alt="江苏雨田工程咨询集团有限公司" /></a>
    <p class="mt-15"><a href="/company/138003.html" target="_blank" title="江苏雨田工程咨询集团有限公司">江苏雨田工程咨询集团有限公司</a></p>
    <p>新疆-阿勒泰地区-阿勒泰</p>
  </div>
</div>
</div>`;

check('jianlihr 列表解析出 2 条', () => {
  assert.strictEqual(jianlihr.parseList(JIANLIR_HTML).length, 2);
});

check('jianlihr 字段完整（标题/薪资/日期/公司/地点）', () => {
  const [a, b] = jianlihr.parseList(JIANLIR_HTML);
  assert.strictEqual(a.siteJobId, '365726');
  assert.strictEqual(a.title, '水利监理专监或总监（退休）');
  assert.strictEqual(a.salary, '面议');
  assert.strictEqual(a.publishedText, '2026-10-04');
  assert.strictEqual(a.publishedAt, '2026-10-04T00:00:00');
  assert.strictEqual(a.company, '重庆蓝宫工程项目管理咨询有限公司');
  assert.strictEqual(a.location, '黑龙江-哈尔滨');
  assert.strictEqual(a.url, 'https://www.jianlihr.com/job/365726.html');
  assert.strictEqual(b.salary, '6000~12000元/月');
  assert.strictEqual(b.location, '新疆-阿勒泰地区-阿勒泰');
});

check('jianlihr 结构变化时返回空数组而非抛错', () => {
  assert.deepStrictEqual(jianlihr.parseList('<html>改版了</html>'), []);
});

// ---------- 水利英才网 waterhr ----------
// 结构取自 2026-10-04 实测搜索页（jtzw=水利监理）
const WATERHR_HTML = `
<div class="search_list">
<div class="item_l">
  <div class="item_l_A"><a href='/jobs/53620735.html' title="水利监理总监" flag="53620735" target="_blank">水利监理总监</a> </div>
  <div class="item_l_B"> 3-5 年经验&nbsp; <span class="h_gray">|</span>&nbsp; 大专&nbsp; <span class="h_gray">|</span>&nbsp;清新县&nbsp; <span class="h_gray">|</span>&nbsp; <span class="top_c_page">9-15K/月</span> </div>
  <div class="item_l_C">更新于：2026-10-04</div>
</div>
<div class="item_r"> <div class="clearfix" > <div class="item_r_A fl"> <a href="/company/cm1306230237100/" title="清远市信源项目管理有限公司" target="_blank">清远市信源项目管理有限..</a> </div> </div> </div>
</div>`;

check('waterhr 列表解析出 1 条', () => {
  assert.strictEqual(waterhr.parseList(WATERHR_HTML).length, 1);
});

check('waterhr 字段完整（标题/薪资/地点/经验学历/日期/公司）', () => {
  const [a] = waterhr.parseList(WATERHR_HTML);
  assert.strictEqual(a.siteJobId, '53620735');
  assert.strictEqual(a.title, '水利监理总监');
  assert.strictEqual(a.salary, '9-15K/月');
  assert.strictEqual(a.location, '清新县');
  assert.deepStrictEqual(a.tags, ['3-5 年经验', '大专']);
  assert.strictEqual(a.publishedText, '2026-10-04');
  assert.strictEqual(a.company, '清远市信源项目管理有限公司');
  assert.strictEqual(a.url, 'https://www.waterhr.com/jobs/53620735.html');
});

check('waterhr 结构变化时返回空数组而非抛错', () => {
  assert.deepStrictEqual(waterhr.parseList('<html>改版了</html>'), []);
});

// ---------- 中国水利人才网 rencai（通用公告规则） ----------
// 结构取自 2026-10-04 实测公告列表：导航行无日期、公告行为「表格行 + 发布日期」
const rencaiSite = config.resolve().sites.rencai;
const RENCAI_HTML = `
<table>
  <tr><td><a href="../../rcpj/">人才评价</a></td></tr>
  <tr><td><a href="../">招聘考试</a></td></tr>
  <tr><td><a href="./202605/t20260512_2110214.html">中国水利水电出版社有限公司2026年公开招聘复试公告</a></td>
      <td width="100" align="center" style="BORDER-BOTTOM: #787063 1px dashed;">2026-05-12</td></tr>
</table>`;

check('rencai 只解析公告行（排除无日期的导航行）', () => {
  const items = generic.parseByRule(RENCAI_HTML, rencaiSite, 'http://rencai.mwr.cn/zpks/zpgg/');
  assert.strictEqual(items.length, 1, `期望 1 条公告，实得 ${items.length} 条`);
  const it = items[0];
  assert.strictEqual(it.title, '中国水利水电出版社有限公司2026年公开招聘复试公告');
  assert.strictEqual(it.publishedText, '2026-05-12');
  assert.strictEqual(it.url, 'http://rencai.mwr.cn/zpks/zpgg/202605/t20260512_2110214.html');
  assert.strictEqual(it.sourceType, 'notice');
});

check('rencai 纯导航页解析出 0 条', () => {
  const navOnly = '<table><tr><td><a href="../">招聘考试</a></td></tr></table>';
  assert.deepStrictEqual(generic.parseByRule(navOnly, rencaiSite, 'http://rencai.mwr.cn/zpks/zpgg/'), []);
});

// ---------- 省级水利厅公告（PROV_NOTICE_RULE） ----------
// 结构取自 2026-10-04 实测。安徽这行特意保留 <a> 与标题之间近 200 字符的缩进空白：
// 早期标题长度上限设成 140 时，正则会够不到 </a>，整站被解析成 0 条（已修为 600）。
const anhuiSite = config.resolve().sites.anhui_tzgg;
const INDENT = ' '.repeat(150);
const ANHUI_HTML = `<li class="odd">
            <a href="https://slt.ah.gov.cn/xwzx/tzgg/123512091.html" target="_blank" title="安徽省水利厅关于二级造价工程师（水利工程）注册合格人员名单的公告" class="left">
${INDENT}<span style='color:;'>安徽省水利厅关于二级造价工程师（水利工程）注册合格人员名单的公告</span>
            </a>
                                    <span class="right date">2026-09-24</span>        </li>`;

check('省级公告：忽略 <a> 与标题间的超长缩进（140 上限回归）', () => {
  const items = generic.parseByRule(ANHUI_HTML, anhuiSite, 'https://slt.ah.gov.cn/xwzx/tzgg/index.html');
  assert.strictEqual(items.length, 1, `期望 1 条，实得 ${items.length} 条`);
  assert.strictEqual(items[0].title, '安徽省水利厅关于二级造价工程师（水利工程）注册合格人员名单的公告');
  assert.strictEqual(items[0].publishedText, '2026-09-24');
  assert.strictEqual(items[0].url, 'https://slt.ah.gov.cn/xwzx/tzgg/123512091.html');
  assert.strictEqual(items[0].sourceType, 'notice');
});

check('省级公告：跳过无日期的导航行', () => {
  const nav = '<ul><li><a href="/index.html">首页</a></li><li><a href="/tzgg/">通知公告</a></li></ul>';
  assert.deepStrictEqual(generic.parseByRule(nav, anhuiSite, 'https://slt.ah.gov.cn/xwzx/tzgg/index.html'), []);
});

// 山东的列表是嵌套 <a>（外层带 &middot; 前缀），必须只产出 1 条、且相对链接转绝对
const shandongSite = config.resolve().sites.shandong_zkly;
const SHANDONG_HTML = `<li><span class="newstxt"><a href="./202609/t20260908_4990752.html">&middot;&nbsp;<a href="./202609/t20260908_4990752.html">山东省水利厅所属山东省水利综合事业服务中心2026...</a></a></span><span class="date">2026-09-08</span></li>`;

check('省级公告：嵌套 <a> 只产出 1 条且链接转绝对', () => {
  const items = generic.parseByRule(SHANDONG_HTML, shandongSite, 'http://wr.shandong.gov.cn/zwgk_319/fdzdgknr/rsxx/zkly/');
  assert.strictEqual(items.length, 1, `期望 1 条，实得 ${items.length} 条`);
  assert.strictEqual(items[0].url, 'http://wr.shandong.gov.cn/zwgk_319/fdzdgknr/rsxx/zkly/202609/t20260908_4990752.html');
  assert.strictEqual(items[0].publishedText, '2026-09-08');
  assert.ok(items[0].title.includes('山东省水利综合事业服务中心'), `标题异常: ${items[0].title}`);
});

console.log(`\n渠道解析自测：${failed ? '有失败' : '全部通过'}`);
if (failed) process.exitCode = 1;
