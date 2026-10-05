// 岗位关键词匹配与方向分类
//
// 分层策略（与 wool 模块同思路）：强词自带行业属性，单独命中即可；弱词（监理/总监/资料员…）
// 必须与行业词同现，否则“互联网总监”“房产资料员”会被误收。
const SUPER_STRONG_RE = /水利|水电|水务|水工|水中|堤防|灌区|泵站|水库|河道|大坝/;

function normalize(s) {
  return String(s || '')
    .replace(/[\u3000\s]+/g, '')
    .replace(/[（(]/g, '(')
    .replace(/[）)]/g, ')')
    .toLowerCase();
}

function countHits(text, words) {
  const out = [];
  for (const w of words) {
    if (!w) continue;
    if (text.includes(normalize(w))) out.push(w);
  }
  return out;
}

/**
 * 判定单个条目是否命中目标岗位
 * @param {{title:string, company?:string, tags?:string|string[], sourceType?:string}} item
 * @param {object} rules config.resolve().keywords
 * @returns {{ok:boolean, hit:string, category:string, direction:{supervision:string[],construction:string[]}, reason:string}}
 */
function match(item, rules) {
  const title = normalize(item.title);
  const tagList = Array.isArray(item.tags) ? item.tags : [item.tags || ''];
  const tags = normalize(tagList.join(' '));
  const company = normalize(item.company);
  const text = `${title} ${tags}`; // 用于强/弱词命中
  // 行业词判定：可放宽到招聘单位名，但必须排除“电力/水利/热力/燃气”这类多行业合并分类标签
  // （它表示平台分类而非岗位内容，否则电力、市政岗位会被误收）
  const industryTags = normalize(tagList.filter((t) => !String(t).includes('/')).join(' '));
  const context = `${title} ${industryTags} ${company}`;

  const reject = countHits(title, rules.exclude);
  if (reject.length) {
    return { ok: false, hit: '', category: 'other', direction: { supervision: [], construction: [] }, reason: `排除词:${reject.join('/')}` };
  }

  const industry = countHits(context, rules.industry);
  const industryOk = industry.length >= (rules.minIndustryHits || 1);

  const supStrong = countHits(text, rules.supervision.strong);
  const conStrong = countHits(text, rules.construction.strong);
  const supWeak = countHits(text, rules.supervision.weak);
  const conWeak = countHits(text, rules.construction.weak);

  // 公告类来源（政府/协会）：标题命中招聘类词 + 行业词即可收录，方向词可有可无
  if (item.sourceType === 'notice') {
    const noticeHit = countHits(text, rules.notice);
    if (!noticeHit.length || !industryOk) {
      return { ok: false, hit: '', category: 'other', direction: { supervision: [], construction: [] }, reason: '公告未命中招聘/行业词' };
    }
    const category = supStrong.length || supWeak.length
      ? (conStrong.length || conWeak.length ? 'both' : 'supervision')
      : (conStrong.length || conWeak.length ? 'construction' : 'other');
    return {
      ok: true,
      hit: [...noticeHit, ...industry].slice(0, 4).join('、'),
      category,
      direction: { supervision: [...supStrong, ...supWeak], construction: [...conStrong, ...conWeak] },
      reason: '公告命中',
    };
  }

  // 岗位类来源：强词自带行业属性可直接命中；否则需行业上下文
  const strongSelfContained = (words) => words.some((w) => SUPER_STRONG_RE.test(w));
  const supStrongOk = supStrong.length && (strongSelfContained(supStrong) || industryOk);
  const conStrongOk = conStrong.length && (strongSelfContained(conStrong) || industryOk);
  const supWeakOk = supWeak.length && industryOk;
  const conWeakOk = conWeak.length && industryOk;

  if (!supStrongOk && !conStrongOk && !supWeakOk && !conWeakOk) {
    const miss = [...supStrong, ...conStrong, ...supWeak, ...conWeak];
    return {
      ok: false,
      hit: '',
      category: 'other',
      direction: { supervision: [], construction: [] },
      reason: miss.length ? `命中岗位词但缺水利行业上下文(${miss.slice(0, 2).join('/')})` : '未命中岗位词',
    };
  }

  const sup = [...supStrong, ...(supWeakOk ? supWeak : [])];
  const con = [...conStrong, ...(conWeakOk ? conWeak : [])];
  const category = sup.length && con.length ? 'both' : sup.length ? 'supervision' : 'construction';
  return {
    ok: true,
    hit: [...new Set([...sup, ...con, ...(industryOk ? industry.slice(0, 1) : [])])].slice(0, 4).join('、'),
    category,
    direction: { supervision: sup, construction: con },
    reason: '岗位命中',
  };
}

const CATEGORY_LABEL = { supervision: '监理', construction: '施工', both: '监理+施工', other: '其他' };

module.exports = { match, normalize, countHits, CATEGORY_LABEL };
