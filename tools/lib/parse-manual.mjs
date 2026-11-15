/**
 * 手册 MD → 站点结构。
 *
 * 只做「读」：不改手册任何内容，也不要求手册为站点做特殊标记。
 * 站点需要的语义（模块编号、工时、优先级、环境、Gate 清单）都从既有写法里解析：
 *   ### M1.1 Transformer 数据流与维度推导　`14h`　`P0`　`L0`
 *   **精准资料映射**
 *   - [ ] Gate 勾选项
 */
import GithubSlugger from 'github-slugger';

const IDEOSPACE = '\u3000';

/** 按标题切成树 */
function buildTree(lines) {
  const root = { level: 0, title: '', lines: [], children: [] };
  const stack = [root];
  let headingStart = lines.findIndex((l) => /^#\s+/.test(l));

  const push = (node) => {
    while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  };

  if (headingStart > 0) {
    root.lines.push(...lines.slice(0, headingStart));
    lines = lines.slice(headingStart);
  }

  for (const line of lines) {
    const m = line.match(/^(#{1,3})\s+(.*)$/);
    if (m) {
      push({ level: m[1].length, title: m[2].trim(), lines: [], children: [] });
    } else {
      stack[stack.length - 1].lines.push(line);
    }
  }
  return root;
}

const trimBlank = (lines) => {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start += 1;
  while (end > start && !lines[end - 1].trim()) end -= 1;
  return lines.slice(start, end);
};

const slugText = (text = '') =>
  String(text)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[`*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const slugId = (slugger, text) => slugger.slug(slugText(text));

/** 把节点连同其子标题一起摊平成 markdown（用于概览页的说明段落） */
function flattenNode(node, depth = 2) {
  const out = [];
  const body = trimBlank(node.lines);
  if (body.length) out.push(body.join('\n'));
  for (const child of node.children) {
    out.push(`${'#'.repeat(Math.min(depth + 1, 5))} ${child.title}`);
    out.push(flattenNode(child, depth + 1));
  }
  return out.filter(Boolean).join('\n\n');
}

/* ------------------------------------------------------------- 模块解析 */

const MODULE_RE = /^(M\d\.\d)\s+(.+)$/;

function parseModule(node, slugger, phase) {
  const headingTokens = node.title.split(IDEOSPACE).map((t) => t.trim()).filter(Boolean);
  const first = headingTokens[0];
  const m = first.match(MODULE_RE);
  if (!m) return null;

  const id = m[1];
  const title = m[2].trim();
  const tags = headingTokens.slice(1).join(' ');
  const hours = Number(tags.match(/(\d+)\s*h/)?.[1] ?? 0);
  const priority = tags.match(/P[012]/)?.[0] ?? '';
  const env =
    tags
      .match(/L[012](?:\s*[／/]\s*(?:L[012]|选做[^\s　`]*))*/)?.[0]
      .replace(/\s+/g, '') ?? '';

  const blocks = [];
  let current = { label: '', lines: [] };
  for (const line of trimBlank(node.lines)) {
    const labelMatch = line.match(/^\s*\*\*([^*]+?)\*\*\s*[：:]?\s*$/);
    if (labelMatch) {
      if (current.lines.length || current.label) blocks.push(current);
      current = { label: labelMatch[1].trim(), lines: [] };
      continue;
    }
    current.lines.push(line);
  }
  if (current.lines.length || current.label) blocks.push(current);

  const byLabel = (needle) => blocks.find((b) => b.label.includes(needle));
  const goalsBlock = byLabel('学习目标');
  const pointsBlock = byLabel('核心知识点');
  const resourcesBlock = byLabel('精准资料映射');
  const tasksBlock = byLabel('动手练习');
  const known = new Set([goalsBlock, pointsBlock, resourcesBlock, tasksBlock]);
  const extraBlocks = blocks.filter((b) => !known.has(b));

  const tasks = [];
  const exerciseMd = [];
  for (const line of trimBlank(tasksBlock?.lines ?? [])) {
    const checkbox = line.match(/^\s*[-*]\s+\[[ xX]\]\s+(.+)$/);
    const ordered = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
    if (checkbox) {
      tasks.push({ index: tasks.length + 1, text: checkbox[1].trim() });
    } else if (ordered) {
      tasks.push({ index: Number(ordered[1]), text: ordered[2].trim() });
    } else {
      exerciseMd.push(line);
    }
  }

  return {
    id,
    slug: id.toLowerCase().replace('.', '-'),
    file: `${id.toLowerCase().replace('.', '-')}.html`,
    title,
    hours,
    priority,
    env,
    phaseId: phase.id,
    phaseTitle: phase.title,
    goalsMd: trimBlank(goalsBlock?.lines ?? []).join('\n'),
    pointsMd: trimBlank(pointsBlock?.lines ?? []).join('\n'),
    resourceLines: trimBlank(resourcesBlock?.lines ?? []),
    exerciseMd: trimBlank(exerciseMd).join('\n'),
    tasks,
    extraMd: extraBlocks
      .filter((b) => b.lines.join('').trim())
      .map((b) => ({ label: b.label, md: trimBlank(b.lines).join('\n') })),
    anchor: slugId(slugger, node.title.split(IDEOSPACE)[0])
  };
}

/* --------------------------------------------------------------- Gate 解析 */

function parseGate(node, slugger, phase) {
  const slugger2 = new GithubSlugger();
  const md = trimBlank(node.lines);
  const gate = { items: [], md: [] };
  for (const line of md) {
    if (/^\s*[-*]\s+\[[ xX]\]\s+/.test(line)) {
      gate.items.push({
        index: gate.items.length + 1,
        text: line.replace(/^\s*[-*]\s+\[[ xX]\]\s+/, '').trim()
      });
    } else {
      gate.md.push(line);
    }
  }
  return {
    id: phase.id,
    anchor: slugId(slugger, node.title),
    slugLocal: slugger2.slug(node.title),
    title: node.title.replace(/^✅\s*/, ''),
    md: trimBlank(gate.md).join('\n'),
    items: gate.items
  };
}

/* ------------------------------------------------------------------ 主入口 */

export function parseManual(mdText) {
  const lines = mdText.split(/\r?\n/);
  const tree = buildTree(lines);

  const titleNode = tree.children.find((n) => n.children.length === 0 && n.title.includes('学习手册')) ??
    tree.children[0];
  const frontMatter = trimBlank(titleNode?.lines ?? []);

  const pages = [];
  const nav = [];
  const modules = [];
  const phases = [];
  /** 标题原文 → 所在页面；同时提供 GitHub slug 索引，供手册里的 #锚点 跨页改写 */
  const anchorMap = new Map();
  const slugMap = new Map();

  /* 概览页：标题下的说明（如何使用、记号约定…）单独成节，不能丢 */
  const homeSlugger = new GithubSlugger();
  const homeSections = (titleNode?.children ?? []).map((child) => ({
    title: child.title,
    anchor: slugId(homeSlugger, child.title),
    md: flattenNode(child)
  }));
  for (const section of homeSections) anchorMap.set(section.title, { file: 'index.html', anchor: section.anchor });

  pages.push({
    key: 'index',
    file: 'index.html',
    kind: 'home',
    title: titleNode?.title ?? 'AI Infra 学习手册与路线图',
    frontMatterMd: frontMatter.join('\n'),
    homeSections
  });
  nav.push({
    label: '概览',
    file: 'index.html',
    anchor: '',
    children: homeSections.map((s) => ({ label: s.title, file: 'index.html', anchor: s.anchor }))
  });

  /* 顶层部分 */
  for (const node of tree.children) {
    if (node === titleNode) continue;
    const slugger = new GithubSlugger();
    const partTitle = node.title;
    const isAppendix = /^附录\s*([ABC])[：:]/.test(partTitle);
    const partNoMatch = partTitle.match(/^Part\s*(\d)[：:]/);
    const isPhasePart = /^Part\s*3[：:]/.test(partTitle);

    if (isAppendix) {
      const letter = partTitle.match(/^附录\s*([ABC])/)[1].toLowerCase();
      const key = `appendix-${letter}`;
      const sections = node.children.map((child) => ({
        title: child.title,
        anchor: slugId(slugger, child.title),
        md: trimBlank(child.lines).join('\n')
      }));
      for (const sec of sections) anchorMap.set(sec.title, { file: `${key}.html`, anchor: sec.anchor });
      anchorMap.set(partTitle, { file: `${key}.html`, anchor: '' });
      pages.push({
        key,
        file: `${key}.html`,
        kind: 'reference',
        title: partTitle,
        sections
      });
      nav.push({
        label: partTitle.replace(/^附录\s*([ABC])[：:]\s*/, '附录 $1 '),
        file: `${key}.html`,
        anchor: '',
        children: sections.map((s) => ({ label: s.title, file: `${key}.html`, anchor: s.anchor }))
      });
      continue;
    }

    if (isPhasePart) {
      const weekNav = [];
      let phaseIndex = 0;
      for (const child of node.children) {
        if (/^Phase\s*\d/.test(child.title)) {
          phaseIndex += 1;
          const phaseId = `phase-${phaseIndex}`;
          const phase = {
            id: phaseId,
            file: `${phaseId}.html`,
            index: phaseIndex,
            title: child.title,
            md: [],
            modules: [],
            gate: null,
            anchor: slugId(new GithubSlugger(), child.title),
            introMd: trimBlank(child.lines).join('\n')
          };
          const moduleSlugger = new GithubSlugger();
          for (const grandChild of child.children) {
            if (/^✅/.test(grandChild.title)) {
              phase.gate = parseGate(grandChild, moduleSlugger, phase);
              anchorMap.set(grandChild.title, { file: phase.file, anchor: phase.gate.anchor });
              continue;
            }
            const mod = parseModule(grandChild, moduleSlugger, phase);
            if (mod) {
              phase.modules.push(mod);
              modules.push(mod);
              anchorMap.set(mod.id, { file: mod.file, anchor: '' });
              anchorMap.set(grandChild.title, { file: mod.file, anchor: '' });
            } else {
              phase.md.push(`### ${grandChild.title}`, ...grandChild.lines);
            }
          }
          phases.push(phase);
          anchorMap.set(child.title, { file: phase.file, anchor: '' });
          pages.push({
            key: phaseId,
            file: phase.file,
            kind: 'phase',
            title: phase.title,
            phase
          });
          weekNav.push(null);
          continue;
        }

        // Phase 之前的总览（3.0 总览与工时总账）
        const sectionSlugger = new GithubSlugger();
        const sections = [{ title: child.title, anchor: slugId(sectionSlugger, child.title), md: trimBlank(child.lines).join('\n') }];
        for (const sec of sections) anchorMap.set(sec.title, { file: 'part-3.html', anchor: sec.anchor });
        pages.push({
          key: 'part-3',
          file: 'part-3.html',
          kind: 'reference',
          title: node.title,
          sections
        });
        weekNav.unshift(null);
      }

      nav.push({
        label: node.title,
        file: 'part-3.html',
        anchor: '',
        children: [
          { label: '3.0 总览与工时总账', file: 'part-3.html', anchor: '' },
          ...phases.map((p) => ({
            label: p.title.replace(/：.*$/, ''),
            file: p.file,
            anchor: '',
            children: [
              ...p.modules.map((m) => ({
                label: `${m.id} ${m.title}`,
                file: m.file,
                anchor: '',
                progressKey: `module:${m.id}`
              })),
              ...(p.gate ? [{ label: `✅ ${p.title.match(/^Phase\s*\d/)[0]} 阶段 Gate`, file: p.file, anchor: p.gate.anchor }] : [])
            ]
          }))
        ]
      });
      continue;
    }

    /* Part 1 / 2 / 4：整篇一页（含若干 h2） */
    if (partNoMatch) {
      const no = Number(partNoMatch[1]);
      const key = `part-${no}`;
      const slugger2 = new GithubSlugger();
      const sections = node.children.map((child) => ({
        title: child.title,
        anchor: slugId(slugger2, child.title),
        md: trimBlank(child.lines).join('\n')
      }));
      for (const sec of sections) anchorMap.set(sec.title, { file: `${key}.html`, anchor: sec.anchor });
      anchorMap.set(partTitle, { file: `${key}.html`, anchor: '' });
      pages.push({ key, file: `${key}.html`, kind: 'reference', title: partTitle, sections });
      nav.push({
        label: partTitle,
        file: `${key}.html`,
        anchor: '',
        children: sections.map((s) => ({ label: s.title, file: `${key}.html`, anchor: s.anchor }))
      });
    }
  }

  nav.push({ label: '资料目录站', file: 'resources.html', anchor: '' });

  for (const [title, loc] of anchorMap) {
    slugMap.set(slugId(new GithubSlugger(), title), loc);
  }

  return { pages, nav, modules, phases, anchorMap, slugMap, title: pages[0].title };
}
