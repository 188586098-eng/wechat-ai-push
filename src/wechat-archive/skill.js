const fs = require('fs');
const os = require('os');
const path = require('path');

// 复用用户级 skill wechat-article-extractor 的抓取逻辑（含失效页/迁移/删除等判断），
// 避免在项目里重复实现公众号页面解析。
const SKILL_DIR = process.env.WECHAT_SKILL_DIR
  || path.join(os.homedir(), '.agents', 'skills', 'wechat-article-extractor');

let cached = null;

function loadSkill() {
  if (cached) return cached;

  const entry = path.join(SKILL_DIR, 'scripts', 'extract.js');
  if (!fs.existsSync(entry)) {
    throw new Error(
      `未找到 wechat-article-extractor skill：${entry}\n` +
      '请先安装该 skill，或用环境变量 WECHAT_SKILL_DIR 指定其目录'
    );
  }

  cached = {
    extract: require(entry).extract,
    cheerio: require(require.resolve('cheerio', { paths: [SKILL_DIR] })),
  };
  return cached;
}

module.exports = { loadSkill, SKILL_DIR };
