const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function getHtml(url, { retries = 2, method = 'GET', body, headers } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': body ? '*/*' : 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      return res.text();
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }
  throw lastErr;
}

module.exports = { getHtml };
