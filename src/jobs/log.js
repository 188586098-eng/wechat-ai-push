// 运行日志：按天落盘 data/jobs/logs/jobs-YYYY-MM-DD.log，同时输出到控制台
// 长期无人值守运行时，日志是唯一的事后依据，因此所有异常路径都必须记录。
const fs = require('fs');
const path = require('path');

let dir = null;
let retentionDays = 14;
let stream = null;
let streamDate = '';

function levelEnabled(level) {
  const min = (process.env.JOBS_LOG_LEVEL || 'info').toLowerCase();
  const order = { debug: 10, info: 20, warn: 30, error: 40 };
  return (order[level] || 20) >= (order[min] || 20);
}

const pad = (n) => String(n).padStart(2, '0');

// 日志时间与按天文件名统一用本地时间：否则本地凌晨前的日志会落到“前一天”文件里，
// 且与配置里的计划时刻（本地时间）对不上，排查定时问题时极易误判。
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function stamp() {
  const d = new Date();
  return `${today()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function ensureStream() {
  if (!dir) return null;
  const day = today();
  if (stream && streamDate === day) return stream;
  try {
    if (stream) stream.end();
    fs.mkdirSync(dir, { recursive: true });
    stream = fs.createWriteStream(path.join(dir, `jobs-${day}.log`), { flags: 'a' });
    streamDate = day;
    pruneOldLogs();
    return stream;
  } catch {
    return null; // 日志目录不可写时不影响主流程
  }
}

/** 清理超过保留期的日志文件 */
function pruneOldLogs() {
  try {
    const cutoff = Date.now() - retentionDays * 86400000;
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(/^jobs-(\d{4})-(\d{2})-(\d{2})\.log$/);
      if (!m) continue;
      const ts = new Date(+m[1], +m[2] - 1, +m[3]).getTime();
      if (ts < cutoff) fs.unlinkSync(path.join(dir, f));
    }
  } catch {
    // 清理失败无关紧要
  }
}

function write(level, msg) {
  if (!levelEnabled(level)) return;
  const line = `[${stamp()}] [${level.toUpperCase()}] ${msg}`;
  const s = ensureStream();
  if (s) {
    try { s.write(line + '\n'); } catch { /* 忽略写入失败 */ }
  }
  const sink = level === 'error' || level === 'warn' ? console.error : console.log;
  sink(line);
}

function init(opts = {}) {
  dir = opts.dir || null;
  retentionDays = opts.retentionDays || 14;
  stream = null;
  streamDate = '';
}

module.exports = {
  init,
  debug: (m) => write('debug', m),
  info: (m) => write('info', m),
  warn: (m) => write('warn', m),
  error: (m) => write('error', m),
  flush: () => { try { if (stream) stream.end(); } catch { /* noop */ } },
};
