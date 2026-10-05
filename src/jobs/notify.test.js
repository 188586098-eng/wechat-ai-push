// 微信推送内容自测：node src/jobs/notify.test.js
// 推送内容是用户唯一看到的东西，且一旦发错无法撤回，格式与转义必须固定下来。
const assert = require('assert');
const { buildContent } = require('./notify');
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

const ITEMS = [
  { category: 'supervision', title: '水利监理工程师', company: 'A 监理公司', location: '山东-济南', salary: '8-12K', publishedText: '2026-10-05', url: 'https://example.com/1' },
  { category: 'supervision', title: '总监理工程师', company: 'B 监理公司', location: '江苏-南京', salary: '', publishedAt: '2026-10-04T00:00:00', url: 'https://example.com/2' },
  { category: 'construction', title: '水利资料员', company: 'C 建筑公司', location: '', salary: '', publishedText: '', url: 'https://example.com/3' },
];

check('按方向分组并统计条数', () => {
  const html = buildContent(ITEMS);
  assert.ok(html.includes('监理（2）'), '应出现「监理（2）」分组标题');
  assert.ok(html.includes('施工（1）'), '应出现「施工（1）」分组标题');
});

check('每条都带可点击链接与标题', () => {
  const html = buildContent(ITEMS);
  for (const it of ITEMS) {
    assert.ok(html.includes(`<a href="${it.url}">`), `缺少链接: ${it.url}`);
    assert.ok(html.includes(it.title), `缺少标题: ${it.title}`);
  }
});

check('公司/地点/薪资/日期拼接，空字段不产生多余分隔符', () => {
  const html = buildContent([ITEMS[2]]);
  assert.ok(html.includes('C 建筑公司'), '应含公司');
  assert.ok(!html.includes('C 建筑公司 · '), '地点薪资为空时不应留下悬空分隔符');
});

check('publishedAt 兜底取日期部分', () => {
  const html = buildContent([ITEMS[1]]);
  assert.ok(html.includes('2026-10-04'), 'publishedText 为空时应回退到 publishedAt 的日期');
});

check('标题与 URL 中的 HTML 特殊字符被转义', () => {
  const html = buildContent([
    { category: 'other', title: '<script>alert(1)</script>', company: 'A&B', location: '', salary: '', publishedText: '', url: 'https://example.com/?a=1&b=2' },
  ]);
  assert.ok(!html.includes('<script>'), '标题不得注入原始标签');
  assert.ok(html.includes('&lt;script&gt;'), '标题应被转义');
  assert.ok(html.includes('https://example.com/?a=1&amp;b=2'), 'URL 中的 & 应转义为 &amp;');
  assert.ok(html.includes('A&amp;B'), '公司名中的 & 应转义');
});

check('push 配置能解析出 token 与条数上限', () => {
  const cfg = config.resolve();
  assert.ok('enabled' in cfg.push, 'push.enabled 应存在');
  assert.ok(Number(cfg.push.limit) > 0, 'push.limit 应为正数');
  assert.strictEqual(typeof cfg.push.token, 'string');
});

console.log(`\n推送内容自测：${failed ? '有失败' : '全部通过'}`);
if (failed) process.exitCode = 1;
