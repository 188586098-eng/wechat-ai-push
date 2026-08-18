function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function buildHtml(groups, summary = '') {
  const parts = [];
  if (summary) {
    parts.push(`<div style="background:#f6f6f6;padding:12px;border-radius:8px;font-size:14px;line-height:1.8">${summary}</div>`);
  }
  for (const [source, items] of groups) {
    const lis = items
      .map((it) => `<li><a href="${it.url}">${escapeHtml(it.title)}</a></li>`)
      .join('');
    parts.push(`<h3>${escapeHtml(source)}</h3><ul>${lis}</ul>`);
  }
  return `<div style="font-size:15px;line-height:1.7">${parts.join('')}</div>`;
}

module.exports = { buildHtml, escapeHtml };
