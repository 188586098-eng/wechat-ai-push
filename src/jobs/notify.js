// 微信推送：把本轮「新增」岗位汇总成一条消息推到微信
//
// 设计取舍：
//   · 只推新增（去重后的），历史岗位不重复推送——否则每天都是同一批岗位，等于制造噪声；
//   · 单条消息列出条数受 push.limit 限制（默认 10），超出部分只报总数，
//     因为微信对长文本会截断，且推 100 条和推 10 条的阅读价值差不多；
//   · 推送失败只记日志，不影响已落盘的结果。
const log = require('./log');
const { CATEGORY_LABEL } = require('./keywords');
const { send, escapeHtml } = require('../push');

function metaLine(it) {
  const parts = [it.company, it.location, it.salary].filter(Boolean).map((s) => escapeHtml(s));
  const date = it.publishedText || String(it.publishedAt || '').slice(0, 10);
  return `${parts.join(' · ')}${date ? ` · ${escapeHtml(date)}` : ''}`;
}

/** 按方向分组生成 HTML（与 jobs.md 的分组口径一致） */
function buildContent(items) {
  const groups = new Map();
  for (const it of items) {
    const key = CATEGORY_LABEL[it.category] || '其他';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  const parts = [];
  for (const [label, list] of groups) {
    const lis = list
      .map(
        (it) =>
          `<li><a href="${escapeHtml(it.url)}">${escapeHtml(it.title)}</a>` +
          `<br/><span style="color:#888;font-size:13px">${metaLine(it)}</span></li>`,
      )
      .join('');
    parts.push(`<h3>${escapeHtml(label)}（${list.length}）</h3><ul>${lis}</ul>`);
  }
  return `<div style="font-size:15px;line-height:1.7">${parts.join('')}</div>`;
}

function localMd(now) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/**
 * 推送本轮新增岗位。
 * @returns {{pushed:number,total:number,skipped?:string}}
 */
async function pushNewItems(cfg, items) {
  const { enabled, token, limit } = cfg.push;
  if (!enabled) {
    log.info('jobs.push.enabled=false，跳过微信推送');
    return { pushed: 0, total: 0, skipped: 'disabled' };
  }
  if (!items.length) {
    log.info('本轮无新增岗位，跳过微信推送');
    return { pushed: 0, total: 0, skipped: 'empty' };
  }
  if (!token) {
    log.warn('未配置 pushplusToken（config.json 顶层或 jobs.push.token），跳过微信推送');
    return { pushed: 0, total: items.length, skipped: 'no-token' };
  }

  const shown = items.slice(0, limit);
  let content = buildContent(shown);
  const rest = items.length - shown.length;
  if (rest > 0) content += `<p style="color:#888">另有 ${rest} 条，见 data/jobs/jobs.md</p>`;

  const title = `水利招聘 ${items.length} 条新增（${localMd(new Date())}）`;
  await send(token, title, content);
  return { pushed: shown.length, total: items.length };
}

module.exports = { pushNewItems, buildContent };
