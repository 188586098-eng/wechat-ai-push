#!/usr/bin/env node
/**
 * 剪贴板归档：把「复制链接」这一个动作变成完整归档。
 *
 * 微信里打开文章 → 右上角「⋯」→「复制链接」→ 本机自动存成 Markdown + 本地图片。
 *
 * 为什么需要它：2026-07 微信封掉了公众号历史文章列表接口（appmsgpublish），
 * 所有「自动拉起订阅列表」的方案（wewe-rss / wechat-article-exporter 等）都已失效。
 * 剩下的可行路径里，短链直连是本机唯一稳定可用的形式，而短链只能人工从微信里复制。
 * 这个脚本把那一次复制之后的所有步骤自动化掉。
 *
 * 注意：短链必须是 /s/<id>（微信「复制链接」给的正是这种）。?__biz= 长链会被微信
 * 风控，只返回验证页，所以这里单独识别并提示。
 */
const { spawn, spawnSync } = require('child_process');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PS_SCRIPT = path.join(__dirname, 'clipboard-watch.ps1');
const ARCHIVER = path.join(__dirname, 'wechat-archive', 'index.js');
const DATA_DIR = path.join(ROOT, 'data');
const LOG_FILE = path.join(DATA_DIR, 'clipboard-archive.log');

// 短链形如 https://mp.weixin.qq.com/s/AbCdEf123，id 由字母数字和 - _ 组成
const SHORT_LINK_RE = /https?:\/\/mp\.weixin\.qq\.com\/s\/[A-Za-z0-9_-]+/;
// 长链形如 https://mp.weixin.qq.com/s?__biz=...，本机直连只会拿到验证页
const LONG_LINK_MARK = 'mp.weixin.qq.com/s?';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(msg) {
  const line = `[${new Date().toLocaleString('zh-CN', { hour12: false })}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {
    // 日志写不进去不该影响归档本身
  }
}

// 选 PowerShell 宿主：优先 pwsh（7+），退回系统自带的 powershell.exe（5.1）。
//
// 为什么不让更省内存的 5.1 优先：实测 5.1 确实省（工作集 63 MB vs 148 MB，空闲 CPU
// 两者都接近 0），但它在集成测试里不可靠 —— 同一个监听脚本、同样的调用方式，5.1 会
// 整个漏掉一次剪贴板变化（端到端日志里一行都没有），另一次则延迟 6.6 秒才输出。
// 漏掉一次就是静默少归档一篇，代价远大于省下的 85 MB，所以维持 pwsh 优先。
//
// 注意：clipboard-watch.ps1 必须以 UTF-8 BOM 保存。Windows PowerShell 5.1 会按 GBK
// 解码没有 BOM 的 UTF-8 文件，中文注释的字节会吃掉行尾换行，整个脚本解析失败，
// 这条兜底路径就会形同虚设。
function pickPowerShell() {
  for (const exe of ['pwsh', 'powershell.exe']) {
    const probe = spawnSync(exe, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], {
      encoding: 'utf8',
      timeout: 20000,
    });
    if (probe.status === 0) return exe;
  }
  return null;
}

// 归档是串行的：并发跑既没必要，也容易触发微信风控
let queue = Promise.resolve();
function enqueue(task) {
  queue = queue.then(task).catch((e) => log(`[错误] ${e.message}`));
  return queue;
}

function archiveLink(link) {
  return new Promise((resolve) => {
    log(`[归档] ${link}`);
    const child = spawn(process.execPath, [ARCHIVER, link], { cwd: ROOT });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', (e) => {
      log(`[失败] 无法启动归档进程: ${e.message}`);
      resolve();
    });
    child.on('close', (code) => {
      for (const line of out.split(/\r?\n/)) {
        if (line.trim()) log(`    ${line.trim()}`);
      }
      if (code === 0) log('[完成] 已处理（已归档过的会自动跳过）');
      else log(`[失败] 归档退出码 ${code}`);
      resolve();
    });
  });
}

function handleText(text) {
  const preview = text.length > 60 ? `${text.slice(0, 60)}…` : text;

  const hasShort = SHORT_LINK_RE.test(text);
  if (!hasShort && text.includes(LONG_LINK_MARK)) {
    log(`[跳过] 这是 ?__biz= 长链，微信风控只返回验证页。请在微信里用「⋯ → 复制链接」拿短链。(${preview})`);
    return;
  }

  const links = [...new Set([...text.matchAll(new RegExp(SHORT_LINK_RE.source, 'g'))].map((m) => m[0]))];
  if (!links.length) return; // 非公众号内容，静默忽略

  for (const link of links) enqueue(() => archiveLink(link));
}

function startWatcher(psExe) {
  const child = spawn(psExe, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS_SCRIPT], {
    cwd: ROOT,
  });

  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const b64 = line.trim();
    if (!b64) return;
    let text;
    try {
      text = Buffer.from(b64, 'base64').toString('utf8');
    } catch {
      return;
    }
    handleText(text);
  });

  child.stderr.on('data', (d) => {
    const s = String(d).trim();
    if (s) log(`[监听] ${s}`);
  });

  return child;
}

async function main() {
  if (process.argv.includes('-h') || process.argv.includes('--help')) {
    console.log(`用法: node src/wechat-clipboard.js

常驻监听剪贴板；在微信里对文章执行「⋯ → 复制链接」，本机自动归档为
Markdown + 本地图片，输出到 data/wechat-archive/<公众号>/。

日志: data/clipboard-archive.log
退出: Ctrl+C`);
    return;
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });

  const psExe = pickPowerShell();
  if (!psExe) {
    log('[退出] 找不到可用的 PowerShell（pwsh 或 powershell.exe），无法监听剪贴板。');
    process.exit(1);
  }

  log(`剪贴板归档已启动（${psExe}）。在微信里「⋯ → 复制链接」即可自动归档，Ctrl+C 退出。`);

  let rapidFailures = 0;
  for (;;) {
    const startedAt = Date.now();
    const child = startWatcher(psExe);
    const code = await new Promise((resolve) => {
      child.on('close', resolve);
      child.on('error', () => resolve(-1));
    });

    // 如果监听进程立刻反复退出，说明环境有问题，继续重启只会刷屏
    rapidFailures = Date.now() - startedAt < 2000 ? rapidFailures + 1 : 0;
    if (rapidFailures >= 5) {
      log(`[退出] 监听进程连续 ${rapidFailures} 次启动即退出（退出码 ${code}），已放弃。`);
      log(`        可手动运行 "${psExe} -NoProfile -File ${PS_SCRIPT}" 查看具体原因。`);
      process.exit(1);
    }

    log(`[监听] 进程退出（退出码 ${code}），2 秒后重启…`);
    await sleep(2000);
  }
}

main().catch((e) => {
  log(`[崩溃] ${e.stack || e.message}`);
  process.exit(1);
});
