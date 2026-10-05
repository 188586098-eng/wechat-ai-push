const { loadSkill } = require('./skill');

// 行内标签：原样拼接，不产生空行
const INLINE_TAGS = new Set([
  'span', 'a', 'strong', 'b', 'em', 'i', 'code', 'u', 'sub', 'sup',
  'font', 'label', 'mark', 'small', 'big', 's', 'del', 'strike', 'li',
]);

const DROPPED_TAGS = new Set([
  'script', 'style', 'iframe', 'mpvoice', 'mp-common-videosnap', 'svg',
]);

// 把公众号正文 HTML 转成 Markdown；resolveImage 用于把图片地址换成本地路径，
// resolveLink 用于还原被代理包装的链接，onImage 会收到每一个真正写进 Markdown 的图片原始地址
function htmlToMarkdown(html, options = {}) {
  const resolveImage = options.resolveImage || ((src) => src);
  const resolveLink = options.resolveLink || ((href) => href);
  const onImage = options.onImage;
  const { cheerio } = loadSkill();
  const $ = cheerio.load(html || '', { decodeEntities: false });

  const rawText = (node) => $(node).text();
  const contents = (node) => $(node).contents().toArray();

  function renderChildren(node) {
    return contents(node).map(render).join('');
  }

  function renderList(node, ordered) {
    // 代码块的行号栏是 <ul class="code-snippet__line-index"><li></li></ul>，
    // 空条目要丢掉，否则会渲染出孤立的 "-"
    const items = $(node).children('li').toArray()
      .map((li) => renderChildren(li).trim().replace(/\n{2,}/g, '\n'))
      .filter((body) => body);
    if (!items.length) return '';
    const lines = items.map((body, i) => `${ordered ? `${i + 1}.` : '-'} ${body.replace(/\n/g, '\n  ')}`);
    return `\n\n${lines.join('\n')}\n\n`;
  }

  function renderTable(node) {
    const rows = $(node).find('tr').toArray().map((tr) =>
      $(tr).find('th,td').toArray().map((cell) =>
        renderChildren(cell).trim().replace(/\|/g, '\\|').replace(/\n+/g, ' ')
      )
    ).filter((r) => r.length);
    if (!rows.length) return '';

    const width = Math.max(...rows.map((r) => r.length));
    const pad = (r) => { while (r.length < width) r.push(''); return r; };
    const head = pad(rows[0].slice());
    const lines = [
      `| ${head.join(' | ')} |`,
      `| ${head.map(() => '---').join(' | ')} |`,
      ...rows.slice(1).map((r) => `| ${pad(r.slice()).join(' | ')} |`),
    ];
    return `\n\n${lines.join('\n')}\n\n`;
  }

  function render(node) {
    if (!node) return '';
    if (node.type === 'text') {
      const data = node.data || '';
      return /^\s+$/.test(data) ? '' : data.replace(/\s+/g, ' ');
    }
    if (node.type !== 'tag') return '';

    const $n = $(node);
    const tag = (node.tagName || '').toLowerCase();
    if (DROPPED_TAGS.has(tag)) return '';

    switch (tag) {
      case 'br':
        return '\n';

      case 'img': {
        const raw = $n.attr('data-src') || $n.attr('src') || $n.attr('data-original');
        if (!raw) return '';
        const src = resolveImage(raw);
        if (!src) return '';
        if (onImage) onImage(raw);
        return `\n\n![${($n.attr('alt') || '').trim()}](${src})\n\n`;
      }

      case 'strong':
      case 'b': {
        // 公众号常见 <strong> 嵌套，先拍平再包一层，避免出现 **a**b****
        const t = renderChildren(node).replace(/\*\*/g, '').trim();
        return t ? `**${t}**` : '';
      }

      case 'em':
      case 'i': {
        const t = renderChildren(node).trim();
        return t ? `*${t}*` : '';
      }

      case 'code': {
        const t = rawText(node);
        return t.includes('\n') || !t.trim() ? t : `\`${t.trim()}\``;
      }

      case 'pre': {
        const t = rawText(node).replace(/\n+$/, '');
        return t.trim() ? `\n\n\`\`\`\n${t}\n\`\`\`\n\n` : '';
      }

      case 'a': {
        const href = resolveLink(($n.attr('href') || '').trim());
        const text = renderChildren(node).trim();
        if (!text) return '';
        return /^https?:\/\//i.test(href) ? `[${text}](${href})` : text;
      }

      case 'hr':
        return '\n\n---\n\n';

      case 'blockquote': {
        const t = renderChildren(node).trim().replace(/\n{2,}/g, '\n');
        return t ? `\n\n> ${t.replace(/\n/g, '\n> ')}\n\n` : '';
      }

      case 'ul':
        return renderList(node, false);

      case 'ol':
        return renderList(node, true);

      case 'table':
        return renderTable(node);

      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
        const t = renderChildren(node).trim();
        if (!t) return '';
        // 正文标题降一级：文档顶层已用 # 放文章标题
        return `\n\n${'#'.repeat(Math.min(Number(tag[1]) + 1, 6))} ${t}\n\n`;
      }

      default: {
        const inner = renderChildren(node);
        if (!inner.trim()) return '';
        return INLINE_TAGS.has(tag) ? inner : `\n\n${inner.trim()}\n\n`;
      }
    }
  }

  return renderChildren($('body'))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { htmlToMarkdown };
