// 常驻调度器：按配置定时执行采集，异常不退出（长期无人值守运行）
//
// 用法:
//   node src/jobs/scheduler.js                 # 前台常驻，按 config.json 的 jobs.schedule 执行
//   node src/jobs/scheduler.js --run-now       # 常驻并立即先跑一轮（覆盖 runOnStart=false）
//   node src/jobs/scheduler.js --once          # 只跑一轮后退出（配合“任务计划程序”最省资源）
//
// 调度参数（config.json → jobs.schedule）:
//   mode: 'interval'  间隔小时执行（intervalHours，默认 24）
//   mode: 'daily'     每日固定时刻执行（at: ['08:30','20:00']）
//   runOnStart        启动时是否立即执行一轮
const fs = require('fs');
const path = require('path');
const config = require('./config');
const log = require('./log');
const { run } = require('./index');

const cfg = config.resolve();
const LOCK_FILE = path.join(cfg.dir, '.scheduler.lock');
const STATE_FILE = path.join(cfg.dir, 'scheduler-state.json');

/** 单实例锁：避免多个调度进程重复跑（记录 pid，进程已死则视为过期） */
function acquireLock() {
  try {
    const raw = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8'));
    if (raw && raw.pid && raw.pid !== process.pid) {
      try {
        process.kill(raw.pid, 0); // 探测进程是否存活
        return { ok: false, pid: raw.pid };
      } catch {
        // 进程不存在，锁已过期
      }
    }
  } catch {
    // 无锁文件
  }
  fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true });
  fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  return { ok: true };
}

function releaseLock() {
  try {
    const raw = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8'));
    if (raw && raw.pid === process.pid) fs.unlinkSync(LOCK_FILE);
  } catch {
    // 忽略
  }
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return { lastRunAt: 0 };
  }
}

function writeState(patch) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ...readState(), ...patch }, null, 2));
  } catch (e) {
    log.warn(`调度状态写入失败: ${e.message}`);
  }
}

/** 计算下一次执行时间 */
function nextRunAt(schedule, from = new Date()) {
  if (schedule.mode === 'daily') {
    const times = (schedule.at || ['08:30']).map((t) => {
      const m = String(t).match(/^(\d{1,2}):(\d{2})$/);
      return m ? { h: +m[1], min: +m[2] } : null;
    }).filter(Boolean).sort((a, b) => a.h - b.h || a.min - b.min);
    if (!times.length) return from.getTime() + 24 * 3600 * 1000;
    for (const t of times) {
      const d = new Date(from.getFullYear(), from.getMonth(), from.getDate(), t.h, t.min, 0, 0);
      if (d.getTime() > from.getTime()) return d.getTime();
    }
    const first = times[0];
    return new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1, first.h, first.min, 0, 0).getTime();
  }
  const hours = Number(schedule.intervalHours) > 0 ? Number(schedule.intervalHours) : 24;
  return from.getTime() + hours * 3600 * 1000;
}

function describe(schedule) {
  if (schedule.mode === 'daily') return `每日 ${(schedule.at || []).join('、')} 执行`;
  return `每 ${schedule.intervalHours || 24} 小时执行`;
}

/** 计划时刻按本地时间展示（用 toISOString 会显示 UTC，与配置的本地时刻对不上） */
function fmtLocal(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 执行一轮，异常全部吞掉只记日志，保证调度循环永不中断 */
async function runOnce(tag) {
  log.info(`[scheduler] ${tag} 开始采集`);
  try {
    await run([]);
  } catch (e) {
    log.error(`[scheduler] 本轮采集异常: ${e.stack || e.message}`);
  } finally {
    writeState({ lastRunAt: Date.now(), lastRunTag: tag });
  }
}

async function main(argv = process.argv.slice(2)) {
  const schedule = cfg.schedule;
  log.init({ dir: path.join(cfg.dir, 'logs'), retentionDays: cfg.output.logRetentionDays });

  if (argv.includes('--once')) {
    log.info('[scheduler] --once 模式，执行一轮后退出');
    await runOnce('once');
    log.flush();
    return;
  }

  if (schedule.enabled === false) {
    log.warn('[scheduler] jobs.schedule.enabled=false，调度已关闭；如需单次执行请运行 node src/jobs/index.js');
    return;
  }

  const lock = acquireLock();
  if (!lock.ok) {
    log.error(`[scheduler] 已有调度进程在运行(pid=${lock.pid})，本次退出，避免重复采集`);
    return;
  }
  process.on('exit', releaseLock);
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      log.info(`[scheduler] 收到 ${sig}，退出`);
      releaseLock();
      log.flush();
      process.exit(0);
    });
  }

  log.info(`[scheduler] 启动：${describe(schedule)}，runOnStart=${schedule.runOnStart !== false}`);

  if (schedule.runOnStart !== false || argv.includes('--run-now')) await runOnce('startup');

  for (;;) {
    const next = nextRunAt(schedule, new Date());
    const waitMs = Math.max(1000, next - Date.now());
    log.info(`[scheduler] 下次执行：${fmtLocal(next)}（${Math.round(waitMs / 60000)} 分钟后）`);
    // 分片睡眠，避免长时间 sleep 在系统休眠后直接跳过整点
    const chunk = Math.min(waitMs, 5 * 60 * 1000);
    let remain = waitMs;
    while (remain > 0) {
      const t = Math.min(chunk, remain);
      await new Promise((r) => setTimeout(r, t));
      remain -= t;
      // 系统休眠/时间跳变后，若已越过计划点则立即执行
      if (Date.now() >= next) break;
    }
    await runOnce('scheduled');
  }
}

if (require.main === module) {
  main().catch((e) => {
    log.error(`[scheduler] 致命错误: ${e.stack || e.message}`);
    log.flush();
    process.exitCode = 1;
  });
}

module.exports = { main, nextRunAt, describe };
