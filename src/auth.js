const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const push = require('./push');

const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf-8'),
);

const WEWE_URL = config.weweRssUrl || 'http://localhost:4000';
const AUTH_CODE = config.weweAuthCode || 'wewe-admin-2026';
const PLATFORM_URL = config.platformUrl || 'https://weread.111965.xyz';
const ACCOUNT_ID = config.weweAccountId || '431803268';

const QR_EXPIRE_MS = 115000;
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_MS = 120000;

async function trpcQuery(path, input) {
  const url = `${WEWE_URL}/trpc/${path}?batch=1&input=${encodeURIComponent(JSON.stringify({ '0': input }))}`;
  const res = await fetch(url, {
    headers: { Authorization: AUTH_CODE },
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json();
  if (json[0] && json[0].error) throw new Error(json[0].error.message);
  return json[0].result.data;
}

async function trpcMutation(path, input) {
  const res = await fetch(`${WEWE_URL}/trpc/${path}?batch=1`, {
    method: 'POST',
    headers: { Authorization: AUTH_CODE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ '0': input }),
    signal: AbortSignal.timeout(30000),
  });
  const json = await res.json();
  if (json[0] && json[0].error) throw new Error(json[0].error.message);
  return json[0].result.data;
}

async function getAccount() {
  return trpcQuery('account.byId', ACCOUNT_ID);
}

async function verifyToken(token, xid) {
  const res = await fetch(`${PLATFORM_URL}/api/v2/platform/mps/MP_WXS_3073282833/articles?page=1`, {
    headers: { xid, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 401) return false;
  if (res.ok) return true;
  const body = await res.text();
  throw new Error(`平台检测失败: HTTP ${res.status} ${body.slice(0, 120)}`);
}

async function createLoginUrl() {
  return trpcMutation('platform.createLoginUrl', {});
}

async function getLoginResult(uuid) {
  const url = `${WEWE_URL}/trpc/platform.getLoginResult?batch=1&input=${encodeURIComponent(JSON.stringify({ '0': { id: uuid } }))}`;
  const res = await fetch(url, {
    headers: { Authorization: AUTH_CODE },
    signal: AbortSignal.timeout(70000),
  });
  const json = await res.json();
  if (json[0] && json[0].error) throw new Error(json[0].error.message);
  return json[0].result.data;
}

async function updateAccount(token) {
  return trpcMutation('account.edit', { id: ACCOUNT_ID, data: { token, status: 1 } });
}

async function refreshAllFeeds() {
  return trpcMutation('feed.refreshArticles', {});
}

function checkStatus() {
  const now = Date.now();
  const age = now - (config.weweLastCheckedAt || 0);
  return age < 1000 * 60 * 60;
}

function saveLastChecked() {
  config.weweLastCheckedAt = Date.now();
  fs.writeFileSync(
    path.join(__dirname, '..', 'config.json'),
    JSON.stringify(config, null, 2) + '\n',
  );
}

function buildQrHtml(scanUrl, dataUrl) {
  const html = `<div style="font-size:15px;line-height:1.8;text-align:center">
<h3>微信读书登录已失效</h3>
<p>请用微信读书 App 扫描下方二维码（2 分钟内有效）</p>
<div><img src="${dataUrl}" alt="扫码登录" style="width:240px;height:240px;border:1px solid #eee;border-radius:8px"/></div>
<p style="color:#888">若二维码图片无法显示，请点击下方链接</p>
<p><a href="${scanUrl}">打开微信扫码确认</a></p>
</div>`;
  return html;
}

async function notifyLoginNeeded(scanUrl, uuid) {
  const dataUrl = await QRCode.toDataURL(scanUrl, { width: 320, margin: 1 });
  const html = buildQrHtml(scanUrl, dataUrl);
  const res = await push.send(config.pushplusToken, '微信读书登录失效，请扫码', html);
  console.log(`[登录] 二维码已推送至微信: ${JSON.stringify(res)}`);
  return { dataUrl };
}

async function waitForLogin(uuid, timeoutMs = MAX_POLL_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let d = null;
    try {
      d = await getLoginResult(uuid);
    } catch (e) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }
    if (d && d.message === 'success') {
      return { token: d.token, username: d.username };
    }
    if (d && d.code === 406 && /过期|expire/i.test(d.message || '')) {
      throw new Error('二维码已过期');
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error('等待扫码超时');
}

async function ensureLogin({ force = false } = {}) {
  let valid = false;
  if (!force) {
    const account = await getAccount();
    valid = account.status === 1;
    if (valid) {
      try {
        valid = await verifyToken(account.token, account.id);
      } catch (e) {
        console.log(`[登录] 平台检测失败，按需继续: ${e.message}`);
        valid = true;
      }
    }
  }

  if (valid) {
    console.log('[登录] 账号有效，无需扫码');
    return { ok: true, renewed: false };
  }

  console.log('[登录] 账号登录已失效，生成二维码...');
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { uuid, scanUrl } = await createLoginUrl();
      await notifyLoginNeeded(scanUrl, uuid);
      const result = await waitForLogin(uuid);
      await updateAccount(result.token);
      console.log(`[登录] 扫码成功（${result.username}），已更新 token`);
      await refreshAllFeeds();
      console.log('[登录] 全量刷新完成，文章已更新');
      saveLastChecked();
      return { ok: true, renewed: true };
    } catch (e) {
      lastErr = e;
      console.log(`[登录] 第 ${attempt} 次尝试失败: ${e.message}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw new Error(`登录续期失败: ${lastErr.message}`);
}

module.exports = { ensureLogin, checkStatus, saveLastChecked };
