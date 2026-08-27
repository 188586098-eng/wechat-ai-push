// 晚间续期脚本：开机时段运行
// 1. 本地 token 副本验证平台有效性 → 有效则直接同步 Secret + 触发云端重推
// 2. 失效则生成二维码（终端显示 + pushplus 推手机）→ 轮询扫码 → 写库 → 同步 + 触发重推
// 支持全新 wewe-rss 数据库的首次登录（account.add），也支持已有账号续期（account.edit）
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const { syncAfterRenew } = require('./syncSecret');

const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf-8'),
);

const WEWE_URL = config.weweRssUrl || 'http://localhost:4000';
const AUTH_CODE = config.weweAuthCode || 'wewe-admin-2026';
const PLATFORM_URL = config.platformUrl || 'https://weread.111965.xyz';
const ACCOUNT_ID = config.weweAccountId || '431803268';
const TOKEN_COPY = path.join(__dirname, '..', 'data', 'local-token.json');
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_MS = 150000;

function loadLocalToken() {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_COPY, 'utf-8'));
  } catch {
    return null;
  }
}

function saveLocalToken(state) {
  fs.mkdirSync(path.dirname(TOKEN_COPY), { recursive: true });
  fs.writeFileSync(TOKEN_COPY, JSON.stringify(state, null, 2));
}

async function trpcQuery(trpcPath, input) {
  const url = `${WEWE_URL}/trpc/${trpcPath}?batch=1&input=${encodeURIComponent(JSON.stringify({ '0': input }))}`;
  const res = await fetch(url, {
    headers: { Authorization: AUTH_CODE },
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json();
  if (json[0] && json[0].error) throw new Error(json[0].error.message);
  return json[0].result.data;
}

async function trpcMutation(trpcPath, input) {
  const res = await fetch(`${WEWE_URL}/trpc/${trpcPath}?batch=1`, {
    method: 'POST',
    headers: { Authorization: AUTH_CODE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ '0': input }),
    signal: AbortSignal.timeout(30000),
  });
  const json = await res.json();
  if (json[0] && json[0].error) throw new Error(json[0].error.message);
  return json[0].result.data;
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

async function pushQrToWeChat(scanUrl) {
  if (!config.pushplusToken) {
    console.log('[推送] 未配置 pushplusToken，二维码仅在终端显示');
    return;
  }
  const dataUrl = await QRCode.toDataURL(scanUrl, { width: 320, margin: 1 });
  const html = `<div style="font-size:15px;line-height:1.8;text-align:center">
<h3>微信读书登录续期</h3>
<p>请用微信读书 App 扫描下方二维码（2 分钟内有效）</p>
<div><img src="${dataUrl}" alt="扫码登录" style="width:240px;height:240px;border:1px solid #eee;border-radius:8px"/></div>
</div>`;
  const res = await fetch('https://www.pushplus.plus/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: config.pushplusToken, title: '微信读书登录续期，请扫码', content: html, template: 'html' }),
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json();
  if (json.code !== 200) throw new Error(`pushplus error: ${JSON.stringify(json)}`);
  console.log('[推送] 二维码已推送至微信');
}

async function waitForLoginResult(uuid) {
  const deadline = Date.now() + MAX_POLL_MS;
  while (Date.now() < deadline) {
    try {
      const d = await trpcQuery('platform.getLoginResult', { id: uuid });
      if (d && d.message === 'success') return d;
      if (d && d.code === 406 && /过期|expire/i.test(d.message || '')) {
        throw new Error('二维码已过期');
      }
    } catch (e) {
      if (/过期|expire/i.test(e.message)) throw e;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error('等待扫码超时');
}

async function ensureLocalAccount(token, vid, username) {
  let existing = null;
  try {
    existing = await trpcQuery('account.byId', ACCOUNT_ID);
  } catch {
    // 全新库无此账号，走 account.add
  }
  if (existing && existing.id) {
    await trpcMutation('account.edit', { id: existing.id, data: { token, status: 1 } });
    console.log(`[登录] 已更新账号 ${existing.id} 的 token`);
  } else {
    const id = String(vid || ACCOUNT_ID);
    await trpcMutation('account.add', { id, name: username || 'wewe', token });
    console.log(`[登录] 已保存新账号 ${id}（${username || 'wewe'}）`);
  }
}

async function renewByScan() {
  const { uuid, scanUrl } = await trpcMutation('platform.createLoginUrl', {});
  if (!uuid || !scanUrl) throw new Error('createLoginUrl 返回异常');

  const qrText = await QRCode.toString(scanUrl, { type: 'terminal', small: true });
  console.log('\n===== 请用【微信读书 App】扫描下方二维码（2 分钟内有效）=====\n');
  console.log(qrText);
  console.log('或打开链接扫码:', scanUrl, '\n');
  try {
    await pushQrToWeChat(scanUrl);
  } catch (e) {
    console.log(`[推送] 手机推送失败（不影响终端扫码）: ${e.message}`);
  }

  const result = await waitForLoginResult(uuid);
  const token = result.token;
  const vid = result.vid || result.userId || '';
  const username = result.username || '';
  if (!token) throw new Error('扫码成功但未返回 token');

  await ensureLocalAccount(token, vid ? String(vid) : '', username);
  saveLocalToken({ token, xid: String(vid || ACCOUNT_ID), username, savedAt: new Date().toISOString() });
  const ok = await verifyToken(token, String(vid || ACCOUNT_ID));
  if (!ok) throw new Error('新 token 平台验证仍为 401');
  console.log('[验证] 新 token 平台验证通过');
  return { token, xid: String(vid || ACCOUNT_ID) };
}

async function main() {
  const local = loadLocalToken();
  if (local && local.token) {
    console.log('[检查] 发现本地 token 副本，验证平台有效性...');
    try {
      const valid = await verifyToken(local.token, local.xid || ACCOUNT_ID);
      if (valid) {
        console.log('[检查] token 仍有效，直接同步并触发云端重推');
        await syncAfterRenew(local.token);
        return;
      }
      console.log('[检查] token 已失效，需要扫码续期');
    } catch (e) {
      console.log(`[检查] 平台验证异常，按失效处理: ${e.message}`);
    }
  } else {
    console.log('[检查] 无本地 token 副本（首次运行），进入扫码登录');
  }

  const { token } = await renewByScan();
  await syncAfterRenew(token);
}

main()
  .then(() => {
    console.log('[完成] 晚间续期流程结束');
    process.exit(0);
  })
  .catch((e) => {
    console.error('[失败]', e.message);
    process.exit(1);
  });
