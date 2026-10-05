// 关键词匹配回归自测：node src/jobs/keywords.test.js
// 匹配层是整套程序的质量核心（决定推给用户的是不是水利岗位），因此固定一批真实样本做回归。
const assert = require('assert');
const { match } = require('./keywords');
const config = require('./config');

const rules = config.resolve().keywords;

const CASES = [
  // [说明, 条目, 期望命中?, 期望方向]
  ['水利总监理工程师', { title: '水利总监理工程师', company: '某某建设工程公司', tags: [] }, true, 'supervision'],
  ['水利专业监理工程师', { title: '水利专业监理工程师', company: '某监理公司', tags: ['国企'] }, true, 'supervision'],
  ['专监理（水利项目）', { title: '专监理（水利项目地点：安徽省石台县）', company: '某建设集团' }, true, 'supervision'],
  ['注册水利监理工程师', { title: '注册水利监理工程师', company: '某工程管理公司' }, true, 'supervision'],
  ['水利水电资料员', { title: '水利水电资料员', company: '某建筑公司' }, true, 'construction'],
  ['水利项目经理', { title: '水利项目经理', company: '某城建集团' }, true, 'construction'],
  ['项目副经理(水利)', { title: '项目副经理（水利水电）', company: '某水利建设公司' }, true, 'construction'],
  ['弱词+行业标签命中', { title: '资料员', company: '某建筑公司', tags: ['水利工程'] }, true, 'construction'],
  ['河道治理施工员', { title: '河道治理施工员', company: '某建筑公司' }, true, 'construction'],
  // 反例：必须排除
  ['电力分类标签不得当行业依据', { title: '汽机监理师', company: '广东天安项目管理有限公司', tags: ['国企', '电力/水利/热力/燃气', '大专'] }, false, 'other'],
  ['电气监理师(同分类标签)', { title: '电气监理师', company: '某项目管理公司', tags: ['电力/水利/热力/燃气'] }, false, 'other'],
  ['装修监理(排除词)', { title: '装修监理', company: '某家装公司', tags: ['水利工程'] }, false, 'other'],
  ['房产资料员(排除词)', { title: '房产资料员', company: '某置业公司' }, false, 'other'],
  ['互联网总监(无关行业)', { title: '运营总监', company: '某科技有限公司', tags: ['互联网'] }, false, 'other'],
  ['保险销售(排除词)', { title: '保险代理人', company: '某保险公司', tags: [] }, false, 'other'],
  ['无行业上下文的资料员', { title: '资料员', company: '某建筑公司', tags: ['5-10年'] }, false, 'other'],
  ['纯土建监理缺行业上下文', { title: '土建监理工程师', company: '某建筑公司', tags: ['土建'] }, false, 'other'],
  // 公告类来源
  ['招聘公告', { title: '某某水利厅直属事业单位2026年公开招聘公告', company: '某省水利厅', sourceType: 'notice' }, true, 'other'],
  ['非招聘公告', { title: '关于公布水利行业招标投标典型案例的通知', company: '某省水利厅', sourceType: 'notice' }, false, 'other'],
];

let failed = 0;
for (const [name, item, expectOk, expectCat] of CASES) {
  const r = match(item, rules);
  try {
    assert.strictEqual(r.ok, expectOk, `${name}: ok 期望 ${expectOk} 实得 ${r.ok}（${r.reason}）`);
    if (expectOk && expectCat !== 'other') {
      assert.strictEqual(r.category, expectCat, `${name}: 方向期望 ${expectCat} 实得 ${r.category}`);
    }
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`  ✗ ${e.message}`);
  }
}

console.log(`\n关键词匹配自测：${CASES.length - failed}/${CASES.length} 通过`);
if (failed) process.exitCode = 1;
