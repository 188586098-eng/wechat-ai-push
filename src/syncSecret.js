// 续期成功后自动把 WEWE_TOKEN 同步到 GitHub Actions Secret，并触发云端 workflow 重推
// 凭据来源：config.json 的 githubToken，或环境变量 GH_TOKEN（gh CLI 已登录也可用）
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf-8'),
);

const REPO = config.githubRepo || '188586098-eng/wechat-ai-push';
const REF = config.githubRef || 'main';

function getGhToken() {
  return config.githubToken || process.env.GH_TOKEN || '';
}

function runGhSecretSet(token) {
  const ghToken = getGhToken();
  if (!ghToken) {
    console.log('[sync] 未配置 githubToken/GH_TOKEN，跳过 GitHub Secret 同步');
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const child = spawn('gh', ['secret', 'set', 'WEWE_TOKEN', '--repo', REPO], {
      env: { ...process.env, GH_TOKEN: ghToken },
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    child.on('error', (e) => {
      console.log(`[sync] gh CLI 不可用: ${e.message}`);
      resolve(false);
    });
    child.on('close', (code) => {
      if (code === 0) {
        console.log('[sync] WEWE_TOKEN 已同步到 GitHub Secret');
        resolve(true);
      } else {
        console.log(`[sync] gh secret set 失败 (exit ${code})`);
        resolve(false);
      }
    });
    child.stdin.write(token);
    child.stdin.end();
  });
}

async function dispatchWorkflow() {
  const ghToken = getGhToken();
  if (!ghToken) return false;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/actions/workflows/ai-news.yml/dispatches`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${ghToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: REF }),
        signal: AbortSignal.timeout(15000),
      },
    );
    if (res.ok) {
      console.log('[sync] 已触发云端 workflow 重新推送');
      return true;
    }
    console.log(`[sync] 触发 workflow 失败: HTTP ${res.status}`);
    return false;
  } catch (e) {
    console.log(`[sync] 触发 workflow 异常: ${e.message}`);
    return false;
  }
}

async function syncAfterRenew(token) {
  const ok = await runGhSecretSet(token);
  if (ok) await dispatchWorkflow();
  return ok;
}

module.exports = { syncAfterRenew };
