/**
 * Markdown → HTML。
 *
 * 在 marked 的输出上做三件手册特有的事：
 *   1. 标题生成 GitHub 风格 id（和 Obsidian/GitHub 里的锚点一致）；
 *   2. 手册里的 #锚点 链接按「标题 → 页面」映射改写成跨页链接；
 *   3. 正文里的 Mx.y 自动链到对应模块页（代码块与已有链接内不处理）。
 */
import { Marked } from 'marked';
import GithubSlugger from 'github-slugger';

const marked = new Marked({ gfm: true, breaks: false });

const escapeHtml = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const stripTags = (html = '') => html.replace(/<[^>]+>/g, '');
const slugText = (text = '') =>
  String(text)
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[`*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** `<h2>` 补 id，并返回本页目录 */
function annotateHeadings(html, slugger) {
  const headings = [];
  const out = html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (_m, level, inner) => {
    const text = stripTags(inner).trim();
    const id = slugger.slug(slugText(text));
    headings.push({ level: Number(level), text, id });
    return `<h${level} id="${id}">${inner}<a class="h-anchor" href="#${id}" aria-label="本节链接">#</a></h${level}>`;
  });
  return { html: out, headings };
}

/** 外部链接统一新窗口打开；#锚点按映射改写 */
function rewriteLinks(html, { slugMap, anchorMap, moduleIndex, pageFile }) {
  return html.replace(/<a\s+([^>]*?)href="([^"]+)"([^>]*)>/g, (whole, pre, href, post) => {
    if (href.startsWith('#')) {
      const raw = href.slice(1);
      let target = slugMap?.get(raw) ?? anchorMap?.get(raw);
      if (!target) {
        try {
          const decoded = decodeURIComponent(raw);
          target = slugMap?.get(decoded) ?? anchorMap?.get(decoded);
        } catch {
          target = null;
        }
      }
      if (target?.file) {
        const samePage = target.file === pageFile;
        const next = samePage ? `#${target.anchor || ''}` : `${target.file}${target.anchor ? `#${target.anchor}` : ''}`;
        return `<a ${pre}href="${next}"${post}>`;
      }
      return whole;
    }
    if (/^https?:\/\//.test(href)) {
      const hasTarget = /target=/.test(pre + post);
      const attrs = hasTarget ? '' : ' target="_blank" rel="noopener noreferrer"';
      const cls = /class="/.test(pre + post) ? '' : ' class="ext"';
      return `<a ${pre}href="${href}"${post}${cls}${attrs}>`;
    }
    return whole;
  });
}

/** 正文中的 Mx.y → 模块页链接 */
function linkifyModuleIds(html, moduleIndex) {
  const tokens = html.split(/(<[^>]+>)/);
  let skipDepth = 0;
  const skipTags = new Set(['code', 'pre', 'a', 'script', 'style']);
  const skipStack = [];

  return tokens
    .map((token) => {
      if (token.startsWith('<')) {
        const closing = token.match(/^<\/(\w+)/);
        const opening = token.match(/^<(\w+)/);
        if (closing && skipStack[skipStack.length - 1] === closing[1]) {
          skipStack.pop();
        } else if (opening && skipTags.has(opening[1]) && !token.endsWith('/>')) {
          skipStack.push(opening[1]);
        }
        return token;
      }
      skipDepth = skipStack.length;
      if (skipDepth > 0) return token;
      return token.replace(/(^|[^A-Za-z0-9.\-])(M[1-5]\.[0-9])(?![0-9.])/g, (whole, lead, id) => {
        const mod = moduleIndex.get(id);
        if (!mod) return whole;
        return `${lead}<a class="xref" href="${mod.file}" title="${escapeHtml(`${id} ${mod.title}`)}">${id}</a>`;
      });
    })
    .join('');
}

function wrapTables(html) {
  return html.replace(/<table>[\s\S]*?<\/table>/g, (table) => `<div class="table-wrap">${table}</div>`);
}

export function createMarkdownRenderer({ slugMap, anchorMap, moduleIndex, pageFile }) {
  const slugger = new GithubSlugger();

  return {
    render(md = '') {
      if (!md?.trim()) return { html: '', headings: [] };
      const raw = marked.parse(md);
      const linked = rewriteLinks(raw, { slugMap, anchorMap, moduleIndex, pageFile });
      const { html, headings } = annotateHeadings(linked, slugger);
      return {
        html: linkifyModuleIds(wrapTables(html), moduleIndex),
        headings
      };
    },
    /** 渲染单个段落/短语（不生成标题 id），用于卡片里的短文本 */
    inline(md = '') {
      const raw = marked.parseInline(md);
      return linkifyModuleIds(rewriteLinks(raw, { slugMap, anchorMap, moduleIndex, pageFile }), moduleIndex);
    },
    reset() {
      slugger.reset();
    }
  };
}

export { escapeHtml };
