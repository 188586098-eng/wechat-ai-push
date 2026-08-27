// 价格监控：报告生成与推送
const push = require('../push');
const { escapeHtml } = push;

function money(v) {
  return v == null ? '-' : `¥${v}`;
}

/** 生成推送 HTML */
function buildReportHtml(results) {
  const rows = results
    .map((r) => {
      const { product, item, analysis, error } = r;
      const name = escapeHtml(product.name || (item && item.spName) || '未知商品');
      const metrics = analysis ? analysis.metrics : null;
      const reasons = analysis
        ? analysis.reasons.map((x) => `<li>${escapeHtml(x)}</li>`).join('')
        : `<li style="color:#e43">抓取失败：${escapeHtml(error || '未知错误')}</li>`;
      return `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;vertical-align:top;max-width:220px">
          <b>${name}</b><br>
          <a href="${escapeHtml(product.url)}" style="font-size:12px;color:#666">商品链接</a>
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;white-space:nowrap">
          <b style="font-size:16px">${money(metrics ? metrics.current : null)}</b><br>
          <span style="font-size:12px;color:#999">目标 ${money(metrics ? metrics.target : null)}</span>
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;white-space:nowrap;font-size:12px">
          历史最低 ${money(metrics ? metrics.lower : null)}<br>
          60日均价 ${money(metrics ? metrics.avg60 : null)}
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:13px">
          <b>${analysis ? analysis.verdict : '⚠️ 失败'}</b>
          <ul style="margin:4px 0 0 18px;padding:0;font-size:12px;color:#555">${reasons}</ul>
        </td>
      </tr>`;
    })
    .join('');

  return `<div style="font-size:14px;line-height:1.6">
    <h3 style="margin:4px 0 10px">🛒 价格监控报告</h3>
    <table style="border-collapse:collapse;width:100%">
      <tr style="background:#f5f5f5;font-size:12px;color:#666">
        <th style="padding:6px 10px;text-align:left">商品</th>
        <th style="padding:6px 10px;text-align:left">现价</th>
        <th style="padding:6px 10px;text-align:left">历史参照</th>
        <th style="padding:6px 10px;text-align:left">结论</th>
      </tr>
      ${rows}
    </table>
  </div>`;
}

async function sendReport(token, title, results) {
  const html = buildReportHtml(results);
  if (!token) {
    console.log('[price][dry-run] 未配置 pushplusToken，打印报告：');
    console.log(html);
    return null;
  }
  return push.send(token, title, html);
}

module.exports = { buildReportHtml, sendReport };
