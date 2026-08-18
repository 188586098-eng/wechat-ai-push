const PLATFORM_URL = process.env.PLATFORM_URL || 'https://weread.111965.xyz';
const WEWE_TOKEN = process.env.WEWE_TOKEN || '';
const WEWE_XID = process.env.WEWE_XID || '431803268';

const PROBE_MP_ID = 'MP_WXS_3073282833';

async function checkPlatformToken() {
  const PLATFORM_URL = process.env.PLATFORM_URL || 'https://weread.111965.xyz';
  const WEWE_TOKEN = process.env.WEWE_TOKEN || '';
  const WEWE_XID = process.env.WEWE_XID || '431803268';
  if (!WEWE_TOKEN) {
    return { ok: false, expired: true, reason: '未配置 WEWE_TOKEN' };
  }
  try {
    const res = await fetch(`${PLATFORM_URL}/api/v2/platform/mps/${PROBE_MP_ID}/articles?page=1`, {
      headers: { xid: WEWE_XID, Authorization: `Bearer ${WEWE_TOKEN}` },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 401) {
      return { ok: false, expired: true, reason: 'HTTP 401 登录失效' };
    }
    if (res.ok) {
      return { ok: true, expired: false };
    }
    return { ok: false, expired: false, reason: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, expired: false, reason: e.message };
  }
}

module.exports = { checkPlatformToken };
