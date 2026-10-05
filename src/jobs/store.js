// 结果持久化：JSONL 增量 / JSON 快照 / CSV 表格 / Markdown 表格
// 四种格式各司其职：jsonl 永不丢历史，json 便于程序消费，csv 便于 Excel 整理，md 便于直接阅读。
const fs = require('fs');
const path = require('path');
const log = require('./log');
const { CATEGORY_LABEL } = require('./keywords');

const HEADERS = ['方向', '岗位名称', '招聘单位', '工作地点', '薪资待遇', '发布时间', '首次发现', '来源', '命中关键词', '详情链接'];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/** 追加写入 JSONL（每行一个条目），失败只记日志不中断 */
function appendJsonl(file, items) {
  if (!items.length) return;
  ensureDir(path.dirname(file));
  const lines = items.map((it) => JSON.stringify(it)).join('\n') + '\n';
  fs.appendFileSync(file, lines, 'utf-8');
}

/** 读取 JSONL 全量历史（用于生成快照/表格） */
function readJsonl(file, limit) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf-8');
  } catch {
    return [];
  }
  const lines = text.split('\n').filter(Boolean);
  const slice = limit ? lines.slice(-limit) : lines;
  const items = [];
  for (const line of slice) {
    try {
      items.push(JSON.parse(line));
    } catch {
      // 跳过损坏行（例如上次写入被中断）
    }
  }
  return items;
}

function sortItems(items) {
  const ts = (it) => Date.parse(it.publishedAt || '') || Date.parse(it.firstSeenAt || '') || 0;
  return [...items].sort((a, b) => ts(b) - ts(a));
}

function writeSnapshot(file, items) {
  ensureDir(path.dirname(file));
  const payload = {
    updatedAt: new Date().toISOString(),
    count: items.length,
    items,
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf-8');
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCsv(file, items, { bom = true } = {}) {
  ensureDir(path.dirname(file));
  const rows = [HEADERS.join(',')];
  items.forEach((it, i) => {
    rows.push(
      [
        CATEGORY_LABEL[it.category] || it.category || '',
        it.title,
        it.company,
        it.location,
        it.salary,
        it.publishedText || it.publishedAt,
        it.firstSeenAt,
        it.siteName || it.site,
        it.keyword,
        it.url,
      ].map(csvCell).join(','),
    );
  });
  fs.writeFileSync(file, (bom ? '\ufeff' : '') + rows.join('\r\n') + '\r\n', 'utf-8');
}

function mdCell(v) {
  return String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ').trim();
}

function writeMarkdown(file, items, meta = {}) {
  ensureDir(path.dirname(file));
  const groups = [
    ['supervision', '监理方向'],
    ['construction', '施工方向'],
    ['both', '监理+施工'],
    ['other', '其他/公告'],
  ];
  const out = [];
  out.push('# 水利行业招聘信息汇总');
  out.push('');
  out.push(`> 更新时间：${meta.updatedAt || new Date().toISOString()} ｜ 共 ${items.length} 条 ｜ 本轮新增 ${meta.newCount ?? '-'} 条`);
  out.push('');
  for (const [key, label] of groups) {
    const list = items.filter((it) => (key === 'other' ? !['supervision', 'construction', 'both'].includes(it.category) : it.category === key));
    if (!list.length) continue;
    out.push(`## ${label}（${list.length}）`);
    out.push('');
    out.push(`| ${HEADERS.join(' | ')} |`);
    out.push(`| ${HEADERS.map(() => '---').join(' | ')} |`);
    for (const it of list) {
      out.push(
        `| ${[
          CATEGORY_LABEL[it.category] || '-',
          it.title,
          it.company,
          it.location,
          it.salary,
          it.publishedText || it.publishedAt,
          it.firstSeenAt,
          it.siteName || it.site,
          it.keyword,
          it.url ? `[链接](${it.url})` : '',
        ].map(mdCell).join(' | ')} |`,
      );
    }
    out.push('');
  }
  fs.writeFileSync(file, out.join('\n'), 'utf-8');
}

/** 运行摘要追加（每次运行一行，便于长期观察稳定性） */
function appendRun(file, record) {
  try {
    ensureDir(path.dirname(file));
    fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n', 'utf-8');
  } catch (e) {
    log.warn(`运行摘要写入失败: ${e.message}`);
  }
}

/**
 * 落盘本轮新增条目，并重建快照/表格
 * @returns {{jsonl:string, json:string, csv:string, md:string, total:number}}
 */
function persist(cfg, newItems, meta = {}) {
  const dir = cfg.dir;
  ensureDir(dir);
  const files = {
    jsonl: path.join(dir, 'jobs.jsonl'),
    json: path.join(dir, 'jobs.json'),
    csv: path.join(dir, 'jobs.csv'),
    md: path.join(dir, 'jobs.md'),
    runs: path.join(dir, 'runs.jsonl'),
  };

  if (newItems.length) appendJsonl(files.jsonl, newItems);

  const all = readJsonl(files.jsonl);
  const sorted = sortItems(all);
  const limited = sorted.slice(0, cfg.output.maxSnapshot);

  writeSnapshot(files.json, limited);
  writeCsv(files.csv, limited, { bom: cfg.output.csvBom });
  writeMarkdown(files.md, limited, { ...meta, newCount: newItems.length, updatedAt: new Date().toISOString() });

  return { ...files, total: all.length, snapshot: limited.length };
}

module.exports = { persist, appendRun, readJsonl, sortItems, HEADERS, ensureDir };
