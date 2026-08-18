function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function cleanTitle(s) {
  return decodeEntities(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseByPattern(html, pattern, build) {
  const seen = new Set();
  const out = [];
  for (const m of html.matchAll(pattern)) {
    const url = m[1];
    if (seen.has(url)) continue;
    const title = cleanTitle(m[2]);
    if (!title || title.length < 6) continue;
    seen.add(url);
    out.push(build(url, title, m));
  }
  return out;
}

function parseQbitai(html) {
  return parseByPattern(
    html,
    /<a[^>]*href="(https:\/\/www\.qbitai\.com\/\d{4}\/\d{2}\/\d+\.html)"[^>]*>(.*?)<\/a>/gs,
    (url, title) => {
      const d = url.match(/\/(\d{4})\/(\d{2})\//);
      return { title, url, pubTime: d ? `${d[1]}-${d[2]}` : '' };
    },
  );
}

function parseZhidx(html) {
  return parseByPattern(
    html,
    /<a[^>]*href="(https:\/\/www\.zhidx\.com\/p\/\d+\.html)"[^>]*>(.*?)<\/a>/gs,
    (url, title) => ({ title, url, pubTime: '' }),
  );
}

function parseAiera(html) {
  return parseByPattern(
    html,
    /<a[^>]*href="(https:\/\/aiera\.com\.cn\/\d{4}\/\d{2}\/\d{2}\/[^"]*\/\d+\/[^"]*\/)"[^>]*>(.*?)<\/a>/gs,
    (url, title) => {
      const d = url.match(/aiera\.com\.cn\/(\d{4})\/(\d{2})\/(\d{2})\//);
      return { title, url, pubTime: d ? `${d[1]}-${d[2]}-${d[3]}` : '' };
    },
  );
}

function parse36kr(html) {
  const out = [];
  const seen = new Set();
  let list = [];
  try {
    const data = JSON.parse(html);
    list = (data && data.data && data.data.hotRankList) || [];
  } catch {
    return [];
  }
  for (const it of list) {
    const tm = it && it.templateMaterial;
    const itemId = (tm && tm.itemId) || it.itemId;
    const title = tm && tm.widgetTitle;
    if (!itemId || !title || seen.has(itemId)) continue;
    const clean = cleanTitle(title);
    if (clean.length < 6) continue;
    seen.add(itemId);
    const author = (tm && tm.authorName && cleanTitle(tm.authorName)) || '';
    const t = (tm && tm.publishTime) || it.publishTime;
    out.push({
      title: author ? `${clean}（${author}）` : clean,
      url: `https://www.36kr.com/p/${itemId}`,
      pubTime: t ? new Date(Number(t)).toISOString().slice(0, 10) : '',
    });
  }
  return out;
}

function parseInfoq(html) {
  const seen = new Set();
  const out = [];
  const re = /<a[^>]*href="(https:\/\/www\.infoq\.cn\/(?:article|news)\/[A-Za-z0-9]{10,})"[^>]*>([\s\S]{0,200}?)<\/a>/g;
  for (const m of html.matchAll(re)) {
    const url = m[1].split('?')[0];
    const text = cleanTitle(m[2]);
    if (!text || text.length < 6 || seen.has(url)) continue;
    seen.add(url);
    out.push({ title: text, url, pubTime: '' });
  }
  return out.slice(0, 20);
}

function parseNetEase(html) {
  const re = /\{[^{}]*"docid":"[A-Za-z0-9]+"[^{}]*\}/g;
  const seen = new Set();
  const out = [];
  for (const m of html.matchAll(re)) {
    try {
      const o = JSON.parse(m[0]);
      const docid = o.docid;
      const title = o.title;
      if (!docid || !title || seen.has(docid)) continue;
      seen.add(docid);
      const mod = o.lmodify || '';
      out.push({
        title: cleanTitle(title),
        url: `https://www.163.com/dy/article/${docid}.html`,
        pubTime: mod.slice(0, 10),
      });
    } catch {
      // 忽略无法解析的对象
    }
  }
  return out;
}

function parsePanews(html) {
  const m = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>(.*?)<\/script>/s);
  if (!m) return [];

  const data = JSON.parse(m[1]);

  const resolve = (idx, depth = 0, active = new Set()) => {
    if (depth > 12) return null;
    if (!Number.isInteger(idx) || idx < 0 || idx >= data.length) return idx;
    if (active.has(idx)) return null;
    active.add(idx);
    let v = data[idx];
    if (Array.isArray(v) && v.length === 2 && v[0] === 'ShallowReactive') {
      v = resolve(v[1], depth + 1, active);
    }
    active.delete(idx);
    if (Array.isArray(v)) return v.map((x) => resolve(x, depth + 1, active));
    if (v !== null && typeof v === 'object') {
      const o = {};
      for (const [k, val] of Object.entries(v)) {
        if (
          Number.isInteger(val) &&
          val >= 0 &&
          val < data.length &&
          (typeof data[val] === 'string' ||
            (typeof data[val] === 'object' && data[val] !== null))
        ) {
          o[k] = resolve(val, depth + 1, active);
        } else {
          o[k] = val;
        }
      }
      return o;
    }
    return v;
  };

  const seen = new Set();
  const out = [];
  for (const raw of data) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    if (!('articleId' in raw) || !('title' in raw)) continue;
    const art = resolve(data.indexOf(raw));
    if (!art || !art.articleId || !art.title) continue;
    if (seen.has(art.articleId)) continue;
    seen.add(art.articleId);
    out.push({
      title: cleanTitle(art.title),
      url: `https://www.panewslab.com/zh-hant/articledetails/${art.articleId}.html`,
      pubTime: '',
    });
  }
  return out;
}

function parseTrending(html) {
  const out = [];
  const seen = new Set();
  const blocks = html.matchAll(/<article[^>]*class="[^"]*Box-row[^"]*"[^>]*>([\s\S]*?)<\/article>/g);
  for (const m of blocks) {
    const block = m[1];
    const nameM = block.match(/href="\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)"/);
    if (!nameM) continue;
    const name = nameM[1];
    if (seen.has(name)) continue;
    const descM = block.match(/<p[^>]*class="[^"]*col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/);
    const desc = descM ? cleanTitle(descM[1]) : '';
    seen.add(name);
    out.push({
      title: desc ? `${name} · ${desc}` : name,
      url: `https://github.com/${name}`,
      pubTime: '',
    });
  }
  return out;
}

function parseRss(html) {
  const out = [];
  const seen = new Set();
  const items = html.matchAll(/<item>([\s\S]*?)<\/item>/g);
  for (const m of items) {
    const block = m[1];
    const titleM = block.match(/<title>([\s\S]*?)<\/title>/);
    const linkM = block.match(/<link>([\s\S]*?)<\/link>/);
    const pubM = block.match(/<pubDate>([^<]+?)<\/pubDate>/);
    if (!titleM || !linkM) continue;
    const title = cleanTitle(titleM[1]);
    const url = cleanTitle(linkM[1]).replace(/&amp;/g, '&');
    if (!title || title.length < 6 || seen.has(url)) continue;
    seen.add(url);
    let pubTime = '';
    if (pubM) {
      const d = new Date(pubM[1]);
      if (!Number.isNaN(d.getTime())) pubTime = d.toISOString().slice(0, 10);
    }
    out.push({ title, url, pubTime });
  }
  return out;
}

module.exports = { parseQbitai, parseZhidx, parseAiera, parse36kr, parseInfoq, parseNetEase, parsePanews, parseTrending, parseRss };
