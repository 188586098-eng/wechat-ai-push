const fs = require('fs');
const path = require('path');
const { main } = require('./index');

const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf-8'),
);

const STATE_FILE = path.join(__dirname, '..', 'data', 'lastrun.json');

const pushIntervalHours = config.pushIntervalHours || 24;
const checkIntervalMs = (config.checkIntervalHours || 1) * 3600 * 1000;
const pushIntervalMs = pushIntervalHours * 3600 * 1000;

function readLastRun() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')).ts || 0;
  } catch {
    return 0;
  }
}

function writeLastRun(ts) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({ ts }));
}

async function runIfDue() {
  const now = Date.now();
  const last = readLastRun();
  if (now - last >= pushIntervalMs) {
    console.log(`[scheduler] ${new Date().toISOString()} 距上次推送已超过 ${pushIntervalHours} 小时，开始运行`);
    await main();
    writeLastRun(now);
  } else {
    const hours = ((now - last) / 3600000).toFixed(1);
    console.log(`[scheduler] ${new Date().toISOString()} 距上次推送 ${hours} 小时，未到推送间隔，跳过`);
  }
}

async function loop() {
  for (;;) {
    try {
      await runIfDue();
    } catch (e) {
      console.error(`[scheduler] 运行失败: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, checkIntervalMs));
  }
}

loop();
