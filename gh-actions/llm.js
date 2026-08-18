const API_KEY = process.env.USER_LLM_API_KEY || '';
const BASE_URL = process.env.USER_LLM_BASE_URL || 'https://api.deepseek.com/v1';
const MODEL = process.env.USER_LLM_MODEL || 'deepseek-chat';

function isLlmEnabled() {
  return Boolean(API_KEY);
}

function buildPrompt(items) {
  const list = items
    .map((it, i) => `${i + 1}. [${it.source}] ${it.title}\n   ${it.url}`)
    .join('\n');
  return `你是 AI 科技资讯编辑。请基于下面的今日文章清单，生成一份中文日报摘要，包含：
1. 今日概览：用 2-3 句话概括今日 AI 领域动态（聚焦最值得关注的主题）
2. 重点推荐：从清单中挑选 3-5 条最重要的文章，逐条给出：文章标题 + 一句话核心观点 + 推荐理由（每条 40 字以内）
3. 用纯文本输出，不要 markdown 符号，段落之间空行分隔。

文章清单：
${list}`;
}

async function summarize(items) {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: buildPrompt(items) }],
      temperature: 0.6,
      max_tokens: 800,
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LLM API HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  const content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  if (!content) throw new Error('LLM 返回内容为空');
  return content.trim();
}

module.exports = { summarize, isLlmEnabled };
