/**
 * 精准资料映射解析：把手册里「资料 › 章 › 小节（p页码）／小节2」这样的自由文本，
 * 解析成可点击的深链。
 *
 * 设计原则：
 *   1. 只认快照里真实存在的 URL（编号优先、标题兜底），绝不拼接猜测路径；
 *   2. 解析不出来就显式标记 unmapped，并在构建报告里列出，供 overrides 补齐；
 *   3. 展示文本永远保留手册原文，链接只是附加信息。
 */
import { compactTitle, normKey, titleHead } from './catalog.mjs';

/** 比对用文本：去掉「（collective-communication-primer）」这类英文 slug 提示，再去空白 */
const matchText = (input = '') =>
  compactTitle(String(input).replace(/[（(][^）)]*[A-Za-z][A-Za-z0-9_-]*[）)]/g, ' '));

const OPEN = '（(【[';
const CLOSE = '）)】]';

/** 按顶层分隔符切分：括号内的分隔符不算（避免拆散「（52 语料／53 数据加载器）」） */
export function splitTop(text, separators) {
  const out = [];
  let depth = 0;
  let buf = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (OPEN.includes(ch)) depth += 1;
    if (CLOSE.includes(ch)) depth = Math.max(0, depth - 1);
    const isSep =
      depth === 0 &&
      (separators.includes(ch) ||
        (ch === '/' && /\s/.test(text[i - 1] ?? '') && /\s/.test(text[i + 1] ?? '')));
    if (isSep) {
      out.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  out.push(buf);
  return out.map((s) => s.trim()).filter(Boolean);
}

const cleanInline = (s = '') =>
  s
    .replace(/\*\*/g, '')
    .replace(/　+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/* ------------------------------------------------------------------ 行解析 */

export function parseCitationLine(rawLine) {
  const m = rawLine.match(/^\s*[-*]\s+`\[(主读|补充)\]`\s*(.+)$/);
  if (!m) return null;
  const kind = m[1];
  let body = m[2];

  let annotation = '';
  const arrow = body.indexOf('←');
  if (arrow >= 0) {
    annotation = cleanInline(body.slice(arrow + 1));
    body = body.slice(0, arrow);
  }

  const groups = splitTop(cleanInline(body), '；;').map((group) => {
    const segments = splitTop(group, '›').map(cleanInline).filter(Boolean);
    return { resourceName: segments[0] ?? '', segments: segments.slice(1), raw: group };
  });

  return { kind, annotation, groups };
}

/* ---------------------------------------------------------------- 叶子抽取 */

/**
 * 从一个「最深层级」里抽出叶子条目。
 * 例：
 *   「8.1 推理请求的执行过程与资源需求（p327–329）／8.6 请求负载……」→ 两个叶子
 *   「第15篇 手写迷你推理引擎（117–125 讲）：117 总览／118 v0 …」→ 语境 + 两个叶子
 */
function leafParts(lastSegment) {
  const colon = splitTop(lastSegment, '：:');
  let prefix = '';
  let leaves = [];
  if (colon.length > 1 && /^\s*(第?\s*\d|[A-Z]\.\d)/.test(colon[1])) {
    prefix = colon[0];
    leaves = splitTop(colon.slice(1).join('：'), '／');
  } else {
    leaves = splitTop(lastSegment, '／');
  }
  return { prefix, leaves };
}

const NUMBER_START = /^\s*(?:第\s*)?(\d{1,3}(?:\.\d{1,3}){0,3}|[A-Z]\.\d{1,2})\b/;
const PAGE_RE =
  /[（(][^）)]{0,40}?\bp\s*(\d{1,3})(?:\s*[–\-~]\s*(\d{1,3}))?[^）)]*[）)]|[（(]\s*(\d{1,3})\s*页\s*[）)]/i;
const RANGE_RE = /(\d{1,3})\s*[–\-~]\s*(\d{1,3})/;
const CHAPTER_RE = /第\s*(\d{1,2})\s*章/;

export function parsePageRef(text) {
  const m = text.match(PAGE_RE);
  if (!m) return null;
  const start = Number(m[1] ?? m[3]);
  const end = Number(m[2] ?? m[4] ?? m[1] ?? m[3]);
  return { start, end, label: `p${start}${end && end !== start ? `–${end}` : ''}` };
}

/* ------------------------------------------------------------- 各资源解析器 */

function pickLectureRange(text) {
  const m = text.match(RANGE_RE);
  if (!m) return null;
  return { start: Number(m[1]), end: Number(m[2]) };
}

function handbookLeaf(leaf, catalog) {
  const data = catalog.catalogs.handbook;
  const partNo = Number(leaf.match(/第\s*(\d{1,2})\s*篇/)?.[1] ?? 0);
  const range = pickLectureRange(leaf);

  if (/讲/.test(leaf) && range) {
    if (partNo) {
      const part = data.parts.find((p) => p.no === partNo);
      if (part) return { url: part.url };
    }
    const lecture = data.lectures.find((l) => l.no === range.start);
    if (lecture) return { url: lecture.url };
  }

  const numMatch = leaf.match(NUMBER_START);
  if (numMatch && !/篇|讲/.test(leaf.slice(0, 8))) {
    const no = Number(numMatch[1].split('.')[0]);
    const lecture = data.lectures.find((l) => l.no === no);
    if (lecture) return { url: lecture.url };
    // 写了明确的讲号却查不到：宁可标未映射，也不要模糊匹配到别的讲
    if (no > 0 && no <= 200) return null;
  }

  if (partNo) {
    const part = data.parts.find((p) => p.no === partNo);
    if (part) return { url: part.url };
  }

  const head = titleHead(leaf);
  if (head.length >= 2) {
    const hit =
      data.lectures.find((l) => titleHead(l.title) === head) ??
      data.lectures.find((l) => titleHead(l.title).includes(head) || head.includes(titleHead(l.title)));
    if (hit) return { url: hit.url };
  }
  return null;
}

function yeasyLeaf(leaf, catalog) {
  const data = catalog.catalogs.yeasy;
  const num = leaf.match(NUMBER_START)?.[1];
  if (num) {
    const hits = data.pages.filter((p) => p.number === num.replace(/^第/, ''));
    if (hits.length) {
      const head = titleHead(leaf);
      const exact = hits.find((p) => titleHead(p.title) === head || head.includes(titleHead(p.title)));
      return { url: (exact ?? hits[0]).url };
    }
  }
  const chapter = leaf.match(CHAPTER_RE);
  if (chapter) {
    const hit = data.pages.find((p) => new RegExp(`^第\\s*${chapter[1]}\\s*章`).test(p.title));
    if (hit) return { url: hit.url };
  }
  // 「附录 A.2 PyTorch 实现示例」：先按 A.2 编号，再按标题双向包含
  const appendixNo = leaf.match(/\b([A-Z]\.\d{1,2})\b/)?.[1];
  if (appendixNo) {
    const hits = data.pages.filter((p) => p.number === appendixNo);
    if (hits.length) {
      const head = matchText(leaf);
      const exact = hits.find((p) => matchText(p.title).includes(head) || head.includes(matchText(p.title)));
      return { url: (exact ?? hits[0]).url };
    }
  }
  const headCompact = matchText(leaf);
  if (headCompact.length >= 3) {
    const hit = data.pages.find((p) => {
      const compact = matchText(p.title);
      return compact.length >= 3 && (compact.includes(headCompact) || headCompact.includes(compact));
    });
    if (hit) return { url: hit.url };
  }
  return null;
}

const GUIDE_MODULE_KEYS = [
  { key: 'prerequisites', re: /模块\s*一|前置知识|prerequisites/i },
  { key: 'cuda', re: /模块\s*二|cuda|cuda编程/i },
  { key: 'distributed', re: /模块\s*三|分布式训练|distributed/i },
  { key: 'inference', re: /模块\s*四|推理优化|inference/i }
];

function guideModule(segments, leaf) {
  const haystack = `${segments.join(' ')} ${leaf}`;
  for (const mod of GUIDE_MODULE_KEYS) if (mod.re.test(haystack)) return mod.key;
  return '';
}

function guideLeaf(leaf, ctx, catalog) {
  const data = catalog.catalogs.guide;
  const moduleKey = guideModule(ctx.segments, leaf);
  const mod = data.modules.find((m) => m.key === moduleKey);
  if (!mod) return null;

  // 「第4章 量化 4.1–4.6（4.1 …／4.2 …）」这类章级引用：整章优先，不要落到第一节
  const startsWithChapter = /^\s*第\s*\d{1,2}\s*章/.test(leaf);
  const chapterNo = Number(leaf.match(CHAPTER_RE)?.[1] ?? 0);
  if (startsWithChapter && chapterNo) {
    const chapter = mod.chapters.find((c) => c.no === chapterNo);
    if (chapter) return { url: chapter.url };
  }

  const num = leaf.match(/(\d{1,2}\.\d{1,2})/)?.[1];
  if (num) {
    const hit = mod.entries.find((e) => e.number === num);
    if (hit) return { url: hit.url };
  }

  if (chapterNo) {
    const chapter = mod.chapters.find((c) => c.no === chapterNo);
    if (chapter) return { url: chapter.url };
  }

  // 「52 CUDA Online Softmax 实现」这类：slug 前缀号 + 标题关键词
  const slugNo = leaf.match(NUMBER_START)?.[1]?.split('.')[0];
  const head = titleHead(leaf);
  const candidates = mod.entries;
  if (slugNo) {
    const bySlug = candidates.find((e) => (e.slug ?? '').startsWith(`${slugNo}-`));
    if (bySlug) return { url: bySlug.url };
  }
  const headCompact = matchText(leaf);
  if (headCompact.length >= 2) {
    const hit = candidates.find((e) => {
      const compact = matchText(e.title);
      return compact.length >= 2 && (compact.includes(headCompact) || headCompact.includes(compact));
    });
    if (hit) return { url: hit.url };
    const slugHit = candidates.find((e) => normKey(e.slug ?? '').includes(normKey(head)));
    if (slugHit) return { url: slugHit.url };
  }
  return null;
}

/** guide 的模块归属需要看上层 segments（模块一/二/三/四） */

function leetcodePart(dirHint, catalog) {
  const data = catalog.catalogs.leetcode;
  const m = dirHint.match(/Part\s*0*(\d)/i);
  if (!m) return null;
  return data.parts.find((p) => p.dir.startsWith(`0${m[1]}`)) ?? null;
}

function leetcodeGroup(part, segments) {
  if (!part) return null;
  for (const seg of [...segments].reverse()) {
    const direct = seg.match(/\b(\d_[0-9]{1,2}|\d[A-Z])\b/);
    if (direct) {
      const hit = part.groups.find((g) => g.id === direct[1]);
      if (hit) return hit;
    }
    const dotted = seg.match(/^(\d{1,2})\.(\d{1,2})\b/);
    if (dotted) {
      const id = `${dotted[1]}_${dotted[2]}`;
      const hit = part.groups.find((g) => g.id === id);
      if (hit) return hit;
    }
  }
  return null;
}

function leetcodeLeaf(leaf, ctx, catalog) {
  const partHint = ctx.segments.find((s) => /Part\s*0*\d/i.test(s)) ?? '';
  const part = leetcodePart(partHint, catalog);
  const group = leetcodeGroup(part, ctx.segments);
  const clean = leaf.replace(/^\s*(项目|专题|路线页)\s*/, '');

  // 纯语义编号页：INF-REQUEST-LIFECYCLE / ARCH-MLA / QUANT-QAT
  const semantic = clean.match(/^([A-Z][A-Z0-9]+(?:-[A-Z0-9]+)+)/)?.[1];
  if (semantic && part) {
    const hit = part.pages.find((p) => p.id.startsWith(`${semantic}_`));
    if (hit) return { url: hit.url };
  }

  const numRaw = clean.match(/^(\d{1,3})\s/)?.[1];
  if (numRaw && part) {
    const no = String(Number(numRaw));
    const pool = group ? group.items : part.pages;
    const hit = pool.find((p) => p.no === no) ?? part.pages.find((p) => p.no === no);
    if (hit) return { url: hit.url };
    // 站点上还没有这一页（例如手册前瞻提到 87，线上只到 86）：诚实标未映射
    return null;
  }

  const head = titleHead(clean);
  if (head.length >= 3 && part) {
    const pool = group ? group.items : part.pages;
    const hit =
      pool.find((p) => titleHead(p.title) === head) ??
      pool.find((p) => normKey(p.id).includes(normKey(head))) ??
      pool.find((p) => {
        const h = titleHead(p.title);
        return h.length >= 3 && (h.includes(head) || head.includes(h));
      });
    if (hit) return { url: hit.url };
  }

  // 「3.1 基础篇（5 节）」这类组级引用
  const dotted = clean.match(/^(\d{1,2})\.(\d{1,2})\b/);
  if (dotted && part) {
    const hit = part.groups.find((g) => g.id === `${dotted[1]}_${dotted[2]}`);
    if (hit) return { url: hit.url };
  }
  if (group) return { url: group.url };
  if (part) return { url: part.url };
  return null;
}

function aispeLeaf(leaf, catalog) {
  const data = catalog.catalogs.aispe;
  const no = Number(leaf.match(CHAPTER_RE)?.[1] ?? 0);
  if (no) {
    const hit = data.chapters.find((c) => c.no === no);
    if (hit) return { url: hit.url };
  }
  if (/附录/.test(leaf)) return { url: data.appendix.url };
  const head = titleHead(leaf);
  if (head.length >= 3) {
    const hit = data.chapters.find((c) => {
      const h = titleHead(c.title);
      return h.includes(head) || head.includes(h);
    });
    if (hit) return { url: hit.url };
  }
  return null;
}

function pdfLeaf(leaf, resource, catalog) {
  const data = catalog.catalogs[resource.id];
  if (!data) return null;
  const pageRef = parsePageRef(leaf);
  const entries = data.entries;

  if (pageRef) {
    return {
      url: `${resource.pdf}#page=${pageRef.start}`,
      page: pageRef.label
    };
  }

  const num = leaf.match(NUMBER_START)?.[1];
  if (num) {
    const hits = entries.filter((e) => e.number === num);
    if (hits.length) {
      const head = titleHead(leaf);
      const scored =
        hits.find((e) => titleHead(e.clean) === head) ??
        hits.reduce((best, cur) => (cur.level >= (best?.level ?? 9) ? cur : best), hits[0]);
      return { url: `${resource.pdf}#page=${scored.page}`, page: `p${scored.page}` };
    }
  }

  const chapter = Number(leaf.match(CHAPTER_RE)?.[1] ?? 0);
  if (chapter) {
    const hit = entries.find((e) => e.number === String(chapter) && e.level === 1);
    if (hit) return { url: `${resource.pdf}#page=${hit.page}`, page: `p${hit.page}` };
  }

  const headCompact = matchText(leaf);
  if (headCompact.length >= 2) {
    const hit = entries.find((e) => {
      const compact = matchText(e.clean);
      return compact.length >= 2 && (compact.includes(headCompact) || headCompact.includes(compact));
    });
    if (hit) return { url: `${resource.pdf}#page=${hit.page}`, page: `p${hit.page}` };
  }
  return null;
}

const LEAF_RESOLVERS = {
  handbook: (leaf, _ctx, catalog) => handbookLeaf(leaf, catalog),
  yeasy: (leaf, _ctx, catalog) => yeasyLeaf(leaf, catalog),
  guide: (leaf, ctx, catalog) => guideLeaf(leaf, ctx, catalog),
  leetcode: (leaf, ctx, catalog) => leetcodeLeaf(leaf, ctx, catalog),
  aispe: (leaf, _ctx, catalog) => aispeLeaf(leaf, catalog),
  'pdf-book': (leaf, _ctx, catalog) => pdfLeaf(leaf, catalog.byId.get('pdf-book'), catalog),
  'pdf-llm': (leaf, _ctx, catalog) => pdfLeaf(leaf, catalog.byId.get('pdf-llm'), catalog)
};

/* ------------------------------------------------------------------ 主流程 */

export function resolveCitationLine(parsed, catalog, overrides = {}, report = []) {
  const results = [];
  /** 一条映射行里，`；` 之后常省略资料名（隐式续写），沿用上一个资料 */
  let inherited = null;

  for (const group of parsed.groups) {
    let resource = catalog.resourceForName(group.resourceName);
    let segments = [...group.segments];
    if (!resource && inherited) {
      // 隐式续写：沿用上一个资料，并补回它的「Part / 模块」层级语境
      resource = inherited.resource;
      const ownScope = /模块\s*[一二三四]|Part\s*0*\d/.test(group.resourceName);
      segments = ownScope
        ? [group.resourceName, ...group.segments]
        : [...inherited.context, group.resourceName, ...group.segments];
    }

    if (!resource) {
      report.push({
        reason: 'unknown-resource',
        resource: group.resourceName,
        text: group.raw
      });
      results.push({
        resource: null,
        resourceName: group.resourceName,
        leaves: [{ text: group.raw, url: null, page: null, mapped: false }]
      });
      continue;
    }

    inherited = {
      resource,
      context: segments.filter((seg) => /Part\s*0*\d|模块\s*[一二三四]/.test(seg))
    };
    let prefixText = '';
    let leaves = [];
    if (segments.length) {
      const last = leafParts(segments[segments.length - 1]);
      prefixText = last.prefix;
      leaves = last.leaves;
      if (prefixText) segments[segments.length - 1] = prefixText;
    }
    if (!leaves.length) leaves = [prefixText || group.raw];

    const ctx = { resource, segments };
    const resolver = LEAF_RESOLVERS[resource.id];

    const resolvedLeaves = leaves.map((leafText) => {
      const text = cleanInline(leafText);
      const key = `${resource.id}|${normKey(text)}`;
      const override = overrides[key];
      let hit = null;
      try {
        hit = resolver ? resolver(text, ctx, catalog) : null;
      } catch (_err) {
        hit = null;
      }

      let url = hit?.url ?? null;
      let page = hit?.page ?? null;
      if (override?.url) {
        url = override.url;
        page = override.page ?? page;
      }

      if (!url) {
        const allow = (overrides.__allowUnmapped ?? []).includes(key);
        report.push({
          reason: allow ? 'allow-unmapped' : 'unmapped',
          resource: resource.id,
          text,
          segments,
          key
        });
      }

      return { text, url, page, mapped: Boolean(url), override: Boolean(override?.url) };
    });

    results.push({ resource, resourceName: resource.name, leaves: resolvedLeaves });
  }

  return { kind: parsed.kind, annotation: parsed.annotation, groups: results };
}

/**
 * 把「精准资料映射」整块 markdown 解析成结构化条目：
 *   输入：模块里 `**精准资料映射**` 之后的列表行
 *   输出：{ groups: [{resource, kind, leaves}] , stats }
 */
export function resolveCitationsBlock(markdownLines, catalog, overrides = {}, report = []) {
  const citations = [];
  for (const line of markdownLines) {
    const parsed = parseCitationLine(line);
    if (!parsed) continue;
    citations.push(resolveCitationLine(parsed, catalog, overrides, report));
  }

  const total = citations.reduce((n, c) => n + c.groups.reduce((k, g) => k + g.leaves.length, 0), 0);
  const mapped = citations.reduce(
    (n, c) => n + c.groups.reduce((k, g) => k + g.leaves.filter((l) => l.mapped).length, 0),
    0
  );

  return { citations, report, stats: { total, mapped } };
}
