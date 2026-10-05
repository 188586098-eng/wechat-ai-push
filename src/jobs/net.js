// 请求层：超时、重试、指数退避、随机间隔、按站点并发限制
// 目标是长期稳定：任何单次请求失败都不能让整轮采集崩掉。
const log = require('./log');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 简易信号量，限制同站点并发 */
function createSemaphore(max) {
  let active = 0;
  const queue = [];
  const release = () => {
    active -= 1;
    const next = queue.shift();
    if (next) next();
  };
  return async function acquire() {
    if (active < max) {
      active += 1;
      return release;
    }
    await new Promise((resolve) => queue.push(resolve));
    active += 1;
    return release;
  };
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return 'unknown';
  }
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function createClient(cfg = {}) {
  const conf = {
    timeoutMs: cfg.timeoutMs || 20000,
    retries: cfg.retries ?? 2,
    backoffMs: cfg.backoffMs || 1500,
    minDelayMs: cfg.minDelayMs ?? 2000,
    maxDelayMs: cfg.maxDelayMs ?? 5000,
    concurrency: cfg.concurrency || 2,
    userAgent: cfg.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0',
  };
  const sem = createSemaphore(conf.concurrency);
  const lastAt = new Map(); // host -> 上次请求时间

  /** 同一 host 的请求之间保持随机间隔，避免固定节奏被识别为爬虫 */
  async function throttle(host) {
    const span = Math.max(0, conf.maxDelayMs - conf.minDelayMs);
    const wait = conf.minDelayMs + Math.floor(Math.random() * (span + 1));
    const prev = lastAt.get(host) || 0;
    const gap = Date.now() - prev;
    if (gap < wait) await sleep(wait - gap);
    lastAt.set(host, Date.now());
  }

  /**
   * 抓取页面
   * @returns {Promise<{status:number, buffer:Buffer, url:string}>}
   */
  async function request(url, opts = {}) {
    const host = hostOf(url);
    const attempts = conf.retries + 1;
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      const release = await sem();
      try {
        await throttle(host);
        const res = await fetch(url, {
          headers: {
            'User-Agent': opts.userAgent || conf.userAgent,
            'Accept-Language': 'zh-CN,zh;q=0.9',
            Accept: opts.accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            ...(opts.headers || {}),
          },
          signal: AbortSignal.timeout(opts.timeoutMs || conf.timeoutMs),
          redirect: 'follow',
        });
        if (!res.ok) {
          const err = new Error(`HTTP ${res.status}`);
          err.status = res.status;
          if (RETRYABLE_STATUS.has(res.status)) throw err;
          // 403/404 等重试无意义，直接抛出不重试
          err.fatal = true;
          throw err;
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        return { status: res.status, buffer, url: res.url || url };
      } catch (e) {
        lastErr = e;
        if (e.fatal) break; // 4xx（403/404 等）重试无意义
        if (i < attempts - 1) {
          const backoff = conf.backoffMs * Math.pow(2, i) + Math.floor(Math.random() * 500);
          log.warn(`请求失败重试(${i + 1}/${attempts - 1}) ${url} :: ${e.message}，${backoff}ms 后重试`);
          await sleep(backoff);
        }
      } finally {
        release();
      }
    }
    throw lastErr;
  }

  /** 抓取并返回 {status, text, encoding} —— 自动识别 GBK 站点 */
  async function getText(url, opts = {}) {
    const { buffer, status, url: finalUrl } = await request(url, opts);
    const { decodeBuffer } = require('./parse');
    const { text, encoding } = decodeBuffer(buffer, opts.encoding);
    return { status, text, encoding, url: finalUrl, bytes: buffer.length };
  }

  /** 抓取 JSON（部分站点接口用），返回 {status, data} */
  async function getJson(url, opts = {}) {
    const { text, status } = await getText(url, { ...opts, accept: 'application/json,text/plain,*/*' });
    try {
      return { status, data: JSON.parse(text) };
    } catch (e) {
      throw new Error(`响应不是合法 JSON: ${url}`);
    }
  }

  return { request, getText, getJson, sleep, conf };
}

module.exports = { createClient, sleep, createSemaphore };
