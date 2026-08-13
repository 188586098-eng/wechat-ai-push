const PUSH_URL = 'https://www.pushplus.plus/send';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function buildHtml(groups) {
  const parts = [];
  for (const [source, items] of groups) {
    const lis = items
      .map((it) => `<li><a href="${it.url}">${escapeHtml(it.title)}</a></li>`)
      .join('');
    parts.push(`<h3>${escapeHtml(source)}</h3><ul>${lis}</ul>`);
  }
  return `<div style="font-size:15px;line-height:1.7">${parts.join('')}</div>`;
}

async function send(token, title, contentHtml) {
  const res = await fetch(PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, title, content: contentHtml, template: 'html' }),
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json();
  if (json.code !== 200) {
    throw new Error(`pushplus error: ${JSON.stringify(json)}`);
  }
  return json;
}

module.exports = { send, buildHtml, escapeHtml };
