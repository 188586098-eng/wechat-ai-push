// 文本/HTML 解析工具：编码识别、实体解码、结构化状态提取、日期归一
// 页面结构变化是本类程序最主要的失效原因，因此解析全部做成“容错 + 可回归测试”。

/** 解码响应体：优先 UTF-8，替换字符过多时回退 GBK（大量政府/协会站点仍是 GBK） */
function decodeBuffer(buffer, encodingHint) {
  const hint = String(encodingHint || '').toLowerCase();
  if (hint === 'gbk' || hint === 'gb2312' || hint === 'gb18030') {
    return { text: new TextDecoder('gbk').decode(buffer), encoding: 'gbk' };
  }
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  const bad = (utf8.match(/\uFFFD/g) || []).length;
  if (bad > 20 || (bad > 0 && bad / Math.max(1, utf8.length) > 0.0005)) {
    return { text: new TextDecoder('gbk').decode(buffer), encoding: 'gbk' };
  }
  return { text: utf8, encoding: 'utf-8' };
}

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ldquo: '“', rdquo: '”',
  hellip: '…', mdash: '—', ndash: '–', middot: '·', times: '×',
};

function decodeEntities(s) {
  return String(s || '')
    .replace(/&([a-zA-Z]+);/g, (m, name) => (ENTITIES[name] != null ? ENTITIES[name] : m))
    .replace(/&#(\d+);/g, (m, code) => {
      const n = Number(code);
      return n > 0 && n < 1114112 ? String.fromCodePoint(n) : m;
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (m, code) => String.fromCodePoint(parseInt(code, 16)));
}

function stripTags(s) {
  return decodeEntities(
    String(s || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!---->/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[\u3000\s]+/g, ' ')
    .trim();
}

/** 从 `__INITIAL_STATE__={...}` 这类服务端注入状态中提取对象（花括号配平，跳过字符串） */
function extractJsonAfter(html, marker) {
  const start = html.indexOf(marker);
  if (start === -1) return null;
  const from = html.indexOf('{', start);
  if (from === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = from; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(from, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** 深度优先查找第一个满足条件的节点 */
function findNode(root, predicate) {
  if (!root || typeof root !== 'object') return null;
  if (predicate(root)) return root;
  for (const v of Object.values(root)) {
    if (v && typeof v === 'object') {
      const hit = findNode(v, predicate);
      if (hit) return hit;
    }
  }
  return null;
}

const DATE_PATTERNS = [
  // 2026-09-28 14:37:57 / 2026-09-28
  { re: /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/, full: true },
  // 2026年9月28日
  { re: /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*(\d{1,2}):(\d{2}))?/, full: true },
  // 09-28 / 9月28日（缺年份，按当前年补，跨年时回退到去年）
  { re: /^(\d{1,2})[-/](\d{1,2})$/, full: false },
  { re: /^(\d{1,2})\s*月\s*(\d{1,2})\s*日$/, full: false },
];

/**
 * 解析各种中文站点日期文本
 * @returns {string} ISO 字符串；无法解析返回 ''
 */
function parseDate(text, now = new Date()) {
  const s = stripTags(text);
  if (!s) return '';
  if (/刚刚|今天/.test(s)) return toIso(now);
  if (/昨天/.test(s)) return toIso(new Date(now.getTime() - 86400000));
  const rel = s.match(/(\d{1,2})\s*(分钟|小时|天)前/);
  if (rel) {
    const unit = { 分钟: 60000, 小时: 3600000, 天: 86400000 }[rel[2]];
    return toIso(new Date(now.getTime() - Number(rel[1]) * unit));
  }
  for (const p of DATE_PATTERNS) {
    const m = s.match(p.re);
    if (!m) continue;
    if (p.full) {
      const d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
      if (!Number.isNaN(d.getTime())) return toIso(d);
    } else {
      const d = new Date(now.getFullYear(), +m[1] - 1, +m[2], 0, 0, 0);
      if (d.getTime() - now.getTime() > 7 * 86400000) d.setFullYear(d.getFullYear() - 1); // 12-30 出现在 1 月 => 去年
      return toIso(d);
    }
  }
  return '';
}

function toIso(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 绝对地址补全 */
function absolutize(href, base) {
  try {
    return new URL(decodeEntities(href), base).toString();
  } catch {
    return '';
  }
}

/** 通用正则抽取：返回所有捕获组结果，正则非法或页面结构变化时返回空数组而不是抛错 */
function matchAll(html, pattern, flags = 'g') {
  try {
    const re = pattern instanceof RegExp ? pattern : new RegExp(pattern, flags);
    return [...String(html || '').matchAll(re)];
  } catch {
    return [];
  }
}

module.exports = {
  decodeBuffer,
  decodeEntities,
  stripTags,
  extractJsonAfter,
  findNode,
  parseDate,
  toIso,
  absolutize,
  matchAll,
};
