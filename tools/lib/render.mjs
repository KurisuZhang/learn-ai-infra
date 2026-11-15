/**
 * 页面渲染层：把解析结果拼成静态 HTML。
 *
 * 站点是「扁平目录 + 纯相对链接」：所有页面在根目录，PDF 在 pdf/，
 * 这样挂在 /learn-ai-infra/ 这类子路径下也不需要任何绝对路径。
 */
import { createMarkdownRenderer, escapeHtml } from './markdown.mjs';

const SITE_TITLE = 'AI Infra 学习手册';
const SITE_TAGLINE = '12 周 / 480 小时的推理系统路线图';

const KIND_LABEL = { web: '站点', pdf: 'PDF' };

const fmtHours = (hours) => (hours ? `${hours}h` : '');

/* --------------------------------------------------------------- 页面骨架 */

const navLabel = (text = '') => {
  const cleaned = String(text)
    .replace(/[`*]/g, '')
    .replace(/（\s*https?:\/\/[^）]*）/g, '')
    .replace(/\(\s*https?:\/\/[^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 42 ? `${cleaned.slice(0, 41)}…` : cleaned;
};

function sidebarLink(label, href, { active = false, dot = '' } = {}) {
  const current = active ? ' aria-current="page"' : '';
  const dotAttr = dot ? ` data-progress-dot="${escapeHtml(dot)}"` : '';
  return `<a class="nav-link${active ? ' is-active' : ''}" href="${href}"${current}${dotAttr}>${escapeHtml(navLabel(label))}</a>`;
}

function renderNavItem(item, activeFile) {
  const active = item.file === activeFile && !item.anchor;
  if (!item.children?.length) {
    return `<li>${sidebarLink(item.label, item.file, { active, dot: item.progressKey })}</li>`;
  }
  const href = item.anchor ? `${item.file}#${item.anchor}` : item.file;
  return `<li class="nav-group">
  <details class="nav-details"${active ? ' open' : ''}>
    <summary class="nav-summary"><a class="nav-group-link${active ? ' is-active' : ''}" href="${href}">${escapeHtml(navLabel(item.label))}</a></summary>
    <ul class="nav-sub">
      ${item.children
        .map((child) => {
          return `<li>${sidebarLink(
            child.label,
            child.anchor ? `${child.file}#${child.anchor}` : child.file,
            { active: child.file === activeFile && !child.anchor, dot: child.progressKey }
          )}</li>`;
        })
        .join('\n      ')}
    </ul>
  </details>
</li>`;
}

export function renderSidebar(nav, activeFile) {
  return `<nav class="nav" aria-label="站点目录">
  <ul class="nav-root">
    ${nav.map((item) => renderNavItem(item, activeFile)).join('\n    ')}
  </ul>
</nav>`;
}

export function renderShell({ title, description, pageFile, nav, content, scripts = '' }) {
  const pageTitle = title ? `${title} · ${SITE_TITLE}` : `${SITE_TITLE} · ${SITE_TAGLINE}`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(pageTitle)}</title>
<meta name="description" content="${escapeHtml(description ?? SITE_TAGLINE)}"/>
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml"/>
<link rel="stylesheet" href="assets/styles.css"/>
<script>try{var t=localStorage.getItem('ai-infra-theme');if(t){document.documentElement.dataset.theme=t}}catch(e){}</script>
</head>
<body>
<a class="skip-link" href="#main">跳到正文</a>
<header class="topbar">
  <button class="icon-btn nav-toggle" type="button" data-nav-toggle aria-label="打开目录" aria-expanded="false">☰</button>
  <a class="brand" href="index.html"><span class="brand-mark">AI</span><span class="brand-text">${SITE_TITLE}</span></a>
  <span class="topbar-spacer"></span>
  <button class="mini-progress" type="button" data-mini-progress hidden aria-label="学习进度"><span class="mini-ring"></span><span class="mini-text">0/27</span></button>
  <button class="icon-btn" type="button" data-search-open aria-label="搜索（⌘K）" title="搜索（⌘K）">🔍</button>
  <button class="icon-btn" type="button" data-theme-toggle aria-label="切换深浅色" title="切换深浅色">◐</button>
</header>
<div class="shell">
  <aside class="sidebar" data-sidebar>${renderSidebar(nav, pageFile)}</aside>
  <main id="main" class="main">
${content}
  </main>
</div>
<dialog class="search-dialog" data-search aria-label="站内搜索">
  <form class="search-form" role="search" data-search-form>
    <input type="search" name="q" placeholder="搜索模块、知识点、资料…" autocomplete="off" data-search-input aria-label="搜索关键词"/>
    <kbd>Esc</kbd>
  </form>
  <div class="search-filters" data-search-filters></div>
  <ul class="search-results" data-search-results></ul>
  <p class="search-hint">↑↓ 选择 · Enter 打开 · 支持模块号（如 M3.2）、资料名、知识点关键词</p>
</dialog>
<script src="assets/app.js" defer></script>
${scripts}
</body>
</html>
`;
}

/* -------------------------------------------------------------- 通用组件 */

function chip(text, variant = '') {
  if (!text) return '';
  return `<span class="chip${variant ? ` chip--${variant}` : ''}">${escapeHtml(text)}</span>`;
}

function progressToggle(key, label = '标记完成', hint = '') {
  return `<label class="complete-toggle" title="${escapeHtml(hint || label)}">
  <input type="checkbox" data-progress="${escapeHtml(key)}"/>
  <span class="complete-toggle-box" aria-hidden="true"></span>
  <span class="complete-toggle-text">${escapeHtml(label)}</span>
</label>`;
}

function breadcrumb(items) {
  return `<nav class="breadcrumb" aria-label="面包屑">${items
    .map((item, i) =>
      item.href
        ? `<a href="${item.href}">${escapeHtml(item.label)}</a>${i < items.length - 1 ? '<span class="sep">/</span>' : ''}`
        : `<span>${escapeHtml(item.label)}</span>`
    )
    .join('')}</nav>`;
}

/* ---------------------------------------------------------- 资料映射卡片 */

function renderCitationGroups(citations, pdfAvailable = {}) {
  const groups = new Map();
  for (const citation of citations) {
    for (const group of citation.groups) {
      const key = group.resource?.id ?? `unknown:${group.resourceName}`;
      if (!groups.has(key)) {
        groups.set(key, {
          resource: group.resource,
          name: group.resource?.name ?? group.resourceName,
          citations: []
        });
      }
      groups.get(key).citations.push({ kind: citation.kind, leaves: group.leaves });
    }
  }

  const legend = `<div class="cite-legend">
    <span class="cite-kind">主读</span><span class="cite-legend-text">本模块主要资料</span>
    <span class="cite-kind cite-kind--supp">补充</span><span class="cite-legend-text">源码 / 图解 / 延伸</span>
  </div>`;

  const blocks = [...groups.values()]
    .map((entry) => {
      const res = entry.resource;
      const accent = res?.accent ?? '#64748b';
      const kindBadge = res ? `<span class="badge badge--${res.kind}">${KIND_LABEL[res.kind] ?? '资料'}</span>` : '<span class="badge">未识别资料</span>';
      const pdfPublished = res?.kind === 'pdf' ? pdfAvailable[res.id] !== false : true;
      const rootLink = res
        ? res.kind === 'pdf'
          ? pdfPublished
            ? `<a class="res-root" href="${res.pdf}" target="_blank" rel="noopener">打开 PDF ↗</a>`
            : `<span class="res-root muted">PDF 未随站点发布</span>`
          : `<a class="res-root" href="${res.root}" target="_blank" rel="noopener">打开站点 ↗</a>`
        : '';

      const items = entry.citations
        .flatMap((c) => c.leaves.map((leaf) => ({ kind: c.kind, ...leaf })))
        .map((leaf) => {
          const kindClass = leaf.kind === '主读' ? '' : ' cite-kind--supp';
          const pageBadge = leaf.page ? `<span class="cite-page">${escapeHtml(leaf.page)}</span>` : '';
          if (leaf.url && !(res?.kind === 'pdf' && !pdfPublished)) {
            return `<li class="cite"><span class="cite-kind${kindClass}">${leaf.kind}</span><a class="cite-link" href="${escapeHtml(leaf.url)}" target="_blank" rel="noopener" title="${escapeHtml(leaf.text)}">${escapeHtml(leaf.text)}</a>${pageBadge}</li>`;
          }
          if (leaf.url && res?.kind === 'pdf' && !pdfPublished) {
            return `<li class="cite cite--unmapped"><span class="cite-kind${kindClass}">${leaf.kind}</span><span class="cite-text" title="本地 PDF 未发布，请在仓库根目录打开 ${escapeHtml(res.root)}${leaf.page ? ` 第 ${leaf.page.slice(1)} 页` : ''}">${escapeHtml(leaf.text)}</span>${pageBadge}</li>`;
          }
          return `<li class="cite cite--unmapped"><span class="cite-kind${kindClass}">${leaf.kind}</span><span class="cite-text" title="未找到对应链接">${escapeHtml(leaf.text)}</span><span class="cite-flag">未映射</span></li>`;
        })
        .join('\n        ');

      return `<section class="res-block" style="--accent:${accent}">
    <header class="res-head">
      <span class="res-dot" aria-hidden="true"></span>
      <h3 class="res-name">${escapeHtml(entry.name)}</h3>
      ${kindBadge}
      ${res?.role ? `<span class="res-role">${escapeHtml(res.role)}</span>` : ''}
      ${rootLink}
    </header>
    <ul class="cite-list">
        ${items}
    </ul>
  </section>`;
    })
    .join('\n  ');

  return `<div class="cite-toolbar">
    ${legend}
    <button class="btn btn--ghost" type="button" data-copy-links>复制本模块全部链接</button>
  </div>
  ${blocks}`;
}

/* ------------------------------------------------------------------ 首页 */

function phaseMeta(phase) {
  const quote = phase.introMd.match(/^>\s*\*\*([^*]+)\*\*/m)?.[1] ?? '';
  const hours = Number(quote.match(/(\d+)\s*h/)?.[1] ?? 0);
  const weeks = quote.match(/W\d+\s*[–-]\s*W\d+/)?.[0] ?? quote.match(/W\d+/)?.[0] ?? '';
  const purpose = quote.split('｜').slice(2).join('｜').trim();
  const modules = phase.modules.reduce((n, m) => n + m.hours, 0);
  return { quote, hours, weeks, purpose, moduleHours: modules };
}

function phaseCard(phase, meta) {
  const moduleLinks = phase.modules
    .map(
      (mod) =>
        `<a class="mod-chip" href="${mod.file}" data-phase-module="${mod.id}"><span class="mod-id">${mod.id}</span><span class="mod-name">${escapeHtml(mod.title)}</span><span class="mod-hours">${fmtHours(mod.hours)}</span><span class="mod-prio">${escapeHtml(mod.priority)}</span></a>`
    )
    .join('\n      ');
  return `<article class="phase-card">
      <header class="phase-card-head">
        <a class="phase-card-title" href="${phase.file}">${escapeHtml(phase.title.replace(/：.*$/, ''))}<span class="phase-card-sub">${escapeHtml(phase.title.split('：').slice(1).join('：'))}</span></a>
        <div class="phase-card-meta">${chip(`${meta.hours}h`)}${meta.weeks ? chip(meta.weeks) : ''}<span class="phase-progress" data-phase-progress="${phase.id}"></span></div>
      </header>
      <div class="mod-chips">
      ${moduleLinks}
      </div>
      <footer class="phase-card-foot">
        <a href="${phase.file}">阶段说明</a>
        ${
          phase.gate
            ? `<a href="${phase.file}#${phase.gate.anchor}">Gate 清单（${phase.gate.items.length} 项）</a>`
            : ''
        }
      </footer>
    </article>`;
}

export function renderHome({ manual, resources, coverage, renderer }) {
  const frontHtml = renderer.render(manual.pages[0].frontMatterMd).html;
  const metas = manual.phases.map((p) => phaseMeta(p));
  const totalHours = metas.reduce((n, m) => n + m.hours, 0);

  const content = `<section class="hero">
    <p class="eyebrow">AI Infra · 推理系统 · 学习路线</p>
    <h1>AI Infra 学习手册</h1>
    <p class="hero-sub">${SITE_TAGLINE}，每一条资料映射都直接跳到对应讲 / 小节 / PDF 页码。</p>
    <div class="hero-actions">
      <a class="btn btn--primary" href="phase-1.html">从 Phase 1 开始</a>
      <a class="btn" href="resources.html">资料目录（7 份）</a>
      <a class="btn" href="part-4.html#41-十二周周历每周-40h">12 周周历</a>
    </div>
    <dl class="hero-stats">
      <div><dt>阶段</dt><dd>${manual.phases.length}</dd></div>
      <div><dt>模块</dt><dd>${manual.modules.length}</dd></div>
      <div><dt>Gate 验收项</dt><dd>${manual.phases.reduce((n, p) => n + (p.gate?.items.length ?? 0), 0)}</dd></div>
      <div><dt>模块工时</dt><dd>${totalHours}h</dd></div>
    </dl>
  </section>

  <section class="progress-panel" aria-labelledby="progress-title">
    <div class="progress-ring-wrap">
      <div class="progress-ring" data-progress-ring><span data-progress-percent>0%</span></div>
      <p class="progress-caption">模块完成度</p>
    </div>
    <div class="progress-detail">
      <h2 id="progress-title">学习进度</h2>
      <p data-progress-summary class="muted">正在读取本地进度…</p>
      <ul class="phase-bars" data-phase-bars>
        ${manual.phases
          .map(
            (p) =>
              `<li><span class="phase-bar-label">${escapeHtml(p.title.replace(/：.*$/, ''))}</span><span class="phase-bar"><i data-phase-bar="${p.id}"></i></span><span class="phase-bar-value" data-phase-bar-value="${p.id}">0/${p.modules.length}</span></li>`
          )
          .join('\n        ')}
      </ul>
      <div class="progress-actions">
        <button class="btn btn--ghost" type="button" data-progress-export>导出进度 JSON</button>
        <span data-progress-import-slot></span>
        <button class="btn btn--ghost" type="button" data-progress-reset>重置进度</button>
      </div>
      <p class="muted small">进度保存在本机浏览器（localStorage），不会上传；换设备时可用导出的 JSON 迁移。</p>
    </div>
  </section>

  <section class="phase-section" aria-labelledby="phases-title">
    <h2 id="phases-title">五阶段路线</h2>
    <div class="phase-grid">
      ${manual.phases.map((p, i) => phaseCard(p, metas[i])).join('\n      ')}
    </div>
  </section>

  <section class="resource-teaser" aria-labelledby="res-title">
    <h2 id="res-title">七份资料</h2>
    <ul class="res-teaser-list">
      ${resources
        .map(
          (r) => `<li><a href="${r.kind === 'pdf' ? r.pdf : r.root}" target="_blank" rel="noopener"><strong>${escapeHtml(r.name)}</strong><span class="muted">${escapeHtml(r.role)} · ${escapeHtml(r.scale)}</span></a></li>`
        )
        .join('\n      ')}
    </ul>
    <p class="muted small">引用解析覆盖：${coverage.mapped}/${coverage.total} 条资料条目已生成深链（${coverage.percent}%）。<a href="resources.html">查看资料目录与覆盖明细</a></p>
  </section>

  <section class="front-matter" aria-labelledby="howto-title">
    <h2 id="howto-title">手册说明</h2>
    ${frontHtml}
  </section>

  ${(manual.pages[0].homeSections ?? [])
    .map(
      (section) => `<section class="ref-section" id="${section.anchor}">
    <h2>${escapeHtml(section.title)}</h2>
    <div class="prose">${renderer.render(section.md).html}</div>
  </section>`
    )
    .join('\n  ')}`;

  return renderShell({
    title: '',
    description: `${SITE_TAGLINE}：阶段、模块、Gate 与全部资料深链。`,
    pageFile: 'index.html',
    nav: manual.nav,
    content
  });
}

/* ------------------------------------------------------------- Phase 页面 */

export function renderPhasePage({ phase, renderer, prevPhase, nextPhase, nav }) {
  const meta = phaseMeta(phase);
  const modules = phase.modules
    .map((mod) => {
      const tasks = mod.tasks.length ? `<span class="muted small">${mod.tasks.length} 项练习</span>` : '';
      return `<li class="module-row">
        <a class="module-row-main" href="${mod.file}">
          <span class="mod-id">${mod.id}</span>
          <span class="module-row-title">${escapeHtml(mod.title)}</span>
          <span class="module-row-meta">${chip(fmtHours(mod.hours))}${chip(mod.priority, 'prio')}${mod.env ? chip(mod.env, 'env') : ''}</span>
        </a>
        <span class="module-row-side">${tasks}${progressToggle(`module:${mod.id}`, '完成')}</span>
      </li>`;
    })
    .join('\n      ');

  const gateSection = phase.gate
    ? `<section class="gate" id="${phase.gate.anchor}">
      <header class="gate-head">
        <h2>${escapeHtml(phase.gate.title)}</h2>
        <span class="gate-count" data-gate-count="${phase.gate.id}">0/${phase.gate.items.length}</span>
      </header>
      ${phase.gate.md ? renderer.render(phase.gate.md).html : ''}
      <ul class="check-list">
        ${phase.gate.items
          .map(
            (item) =>
              `<li><label class="check"><input type="checkbox" data-progress="${phase.gate.id}:item:${item.index}"/><span class="check-box" aria-hidden="true"></span><span class="check-text">${renderer.inline(item.text)}</span></label></li>`
          )
          .join('\n        ')}
      </ul>
    </section>`
    : '';

  const pager = `<nav class="pager" aria-label="阶段导航">
    ${prevPhase ? `<a class="pager-prev" href="${prevPhase.file}">← ${escapeHtml(prevPhase.title.replace(/：.*$/, ''))}</a>` : '<span></span>'}
    ${nextPhase ? `<a class="pager-next" href="${nextPhase.file}">${escapeHtml(nextPhase.title.replace(/：.*$/, ''))} →</a>` : '<a class="pager-next" href="resources.html">资料目录 →</a>'}
  </nav>`;

  const content = `${breadcrumb([{ label: '概览', href: 'index.html' }, { label: phase.title.replace(/：.*$/, '') }])}
  <header class="page-head">
    <h1>${escapeHtml(phase.title)}</h1>
    <div class="page-head-meta">${chip(`${meta.hours}h`)}${meta.weeks ? chip(meta.weeks) : ''}${chip(`${phase.modules.length} 个模块`)}</div>
  </header>
  <div class="prose prose--lead">
    ${renderer.render(phase.introMd).html}
    ${renderer.render(phase.md.join('\n')).html}
  </div>
  <section class="module-list" aria-labelledby="module-list-title">
    <h2 id="module-list-title">本阶段模块</h2>
    <ul>
      ${modules}
    </ul>
  </section>
  ${gateSection}
  ${pager}`;

  return renderShell({
    title: phase.title.replace(/：.*$/, ''),
    description: `${phase.title}：${phase.modules.map((m) => `${m.id} ${m.title}`).join('、')}`,
    pageFile: phase.file,
    nav,
    content
  });
}

/* ------------------------------------------------------------- 模块页面 */

export function renderModulePage({ module: mod, citations, renderer, prev, next, nav, pdfAvailable = {} }) {
  const sectionLinks = [
    mod.goalsMd.trim() && ['学习目标', '#goals'],
    mod.pointsMd.trim() && ['核心知识点', '#points'],
    ['精准资料映射', '#resources'],
    (mod.exerciseMd.trim() || mod.tasks.length) && ['动手练习', '#practice']
  ].filter(Boolean);

  const taskList = mod.tasks.length
    ? `<ul class="check-list">
        ${mod.tasks
          .map(
            (task) =>
              `<li><label class="check"><input type="checkbox" data-progress="task:${mod.id}:${task.index}"/><span class="check-box" aria-hidden="true"></span><span class="check-text"><span class="task-index">${task.index}</span>${renderer.inline(task.text)}</span></label></li>`
          )
          .join('\n        ')}
      </ul>`
    : '';

  const extra = mod.extraMd
    .map((block) => `<section class="module-section"><h2>${escapeHtml(block.label)}</h2>${renderer.render(block.md).html}</section>`)
    .join('\n');

  const content = `${breadcrumb([
    { label: '概览', href: 'index.html' },
    { label: mod.phaseTitle.replace(/：.*$/, ''), href: `${mod.phaseId}.html` },
    { label: mod.id }
  ])}
  <header class="page-head module-head">
    <p class="eyebrow">${escapeHtml(mod.phaseTitle.replace(/：.*$/, ''))} · ${escapeHtml(mod.id)}</p>
    <h1>${escapeHtml(mod.title)}</h1>
    <div class="page-head-meta">
      ${chip(mod.id, 'id')}
      ${chip(fmtHours(mod.hours), 'hours')}
      ${chip(mod.priority, 'prio')}
      ${mod.env ? chip(mod.env, 'env') : ''}
      ${progressToggle(`module:${mod.id}`, '标记本模块完成', '仅保存在本机浏览器')}
    </div>
    <nav class="module-toc" aria-label="本页小节">${sectionLinks
      .map(([label, href]) => `<a href="${href}">${label}</a>`)
      .join('')}</nav>
  </header>

  ${
    mod.goalsMd.trim()
      ? `<section class="module-section" id="goals">
    <h2>学习目标</h2>
    <div class="prose">${renderer.render(mod.goalsMd).html}</div>
  </section>`
      : ''
  }

  ${
    mod.pointsMd.trim()
      ? `<section class="module-section" id="points">
    <h2>核心知识点清单</h2>
    <div class="prose">${renderer.render(mod.pointsMd).html}</div>
  </section>`
      : ''
  }

  <section class="module-section module-section--resources" id="resources">
    <h2>精准资料映射<span class="h-note">点标题直接跳到对应讲 / 小节 / PDF 页</span></h2>
    ${renderCitationGroups(citations, pdfAvailable)}
  </section>

  ${
    mod.exerciseMd.trim() || mod.tasks.length
      ? `<section class="module-section" id="practice">
    <h2>动手练习与验收标准</h2>
    ${mod.exerciseMd.trim() ? `<div class="prose">${renderer.render(mod.exerciseMd).html}</div>` : ''}
    ${taskList}
  </section>`
      : ''
  }
  ${extra}

  <nav class="pager" aria-label="模块导航">
    ${prev ? `<a class="pager-prev" href="${prev.file}">← ${escapeHtml(`${prev.id} ${prev.title}`)}</a>` : '<span></span>'}
    ${next ? `<a class="pager-next" href="${next.file}">${escapeHtml(`${next.id} ${next.title}`)} →</a>` : '<a class="pager-next" href="resources.html">资料目录 →</a>'}
  </nav>`;

  return renderShell({
    title: `${mod.id} ${mod.title}`,
    description: `${mod.id} ${mod.title}：${fmtHours(mod.hours)} ${mod.priority} ${mod.env}｜学习目标、知识点、资料深链与验收标准。`,
    pageFile: mod.file,
    nav,
    content
  });
}

/* --------------------------------------------------------- 参考页 / 附录页 */

export function renderReferencePage({ page, renderer, nav, extraHtml = '' }) {
  const toc =
    page.sections.length > 2
      ? `<nav class="page-toc" aria-label="本页目录">
      <span class="page-toc-label">本页目录</span>
      ${page.sections.map((s) => `<a href="#${s.anchor}">${escapeHtml(s.title)}</a>`).join('')}
    </nav>`
      : '';

  const content = `${breadcrumb([{ label: '概览', href: 'index.html' }, { label: page.title }])}
  <header class="page-head">
    <h1>${escapeHtml(page.title)}</h1>
  </header>
  ${toc}
  ${page.sections
    .map(
      (section) => `<section class="ref-section" id="${section.anchor}">
    <h2>${escapeHtml(section.title)}</h2>
    <div class="prose">${renderer.render(section.md).html}</div>
  </section>`
    )
    .join('\n  ')}
  ${extraHtml}`;

  return renderShell({
    title: page.title,
    description: `${page.title}（AI Infra 学习手册）`,
    pageFile: page.file,
    nav,
    content
  });
}

/* ------------------------------------------------------------ 资料目录页 */

/** Part 3 页底部：五个阶段的入口，避免读完总览表就没路可走 */
export function renderPhaseIndex(phases) {
  const metas = phases.map((p) => phaseMeta(p));
  const rows = phases
    .map((phase, i) => {
      const meta = metas[i];
      return `<li class="module-row">
        <a class="module-row-main" href="${phase.file}">
          <span class="mod-id">${escapeHtml(phase.title.match(/^Phase\s*\d/)?.[0] ?? '')}</span>
          <span class="module-row-title">${escapeHtml(phase.title.split('：').slice(1).join('：'))}</span>
          <span class="module-row-meta">${chip(`${meta.hours}h`)}${meta.weeks ? chip(meta.weeks) : ''}${chip(`${phase.modules.length} 个模块`)}</span>
        </a>
        <span class="module-row-side">${phase.gate ? `<a href="${phase.file}#${phase.gate.anchor}">Gate ${phase.gate.items.length} 项</a>` : ''}</span>
      </li>`;
    })
    .join('\n      ');
  return `<section class="module-list" aria-labelledby="phase-index-title">
    <h2 id="phase-index-title">五个阶段</h2>
    <ul>
      ${rows}
    </ul>
  </section>`;
}

export function renderResourcesPage({ resources, coverage, catalog, nav, pdfAvailable = {} }) {
  const cards = resources
    .map((r) => {
      const stat = coverage.perResource[r.id] ?? { total: 0, mapped: 0 };
      const published = r.kind === 'pdf' ? pdfAvailable[r.id] !== false : true;
      const entry = !published
        ? `<span class="btn">未随站点发布</span>`
        : r.kind === 'pdf'
          ? `<a class="btn btn--primary" href="${r.pdf}" target="_blank" rel="noopener">打开 PDF</a>`
          : `<a class="btn btn--primary" href="${r.root}" target="_blank" rel="noopener">打开站点</a>`;
      const scaleHint =
        r.kind === 'pdf'
          ? `<p class="muted small">本地文件：<code>${escapeHtml(r.sourceFile)}</code> · 引用带页码时直接跳到该页（#page=N）</p>`
          : `<p class="muted small">目录快照更新于 ${escapeHtml(catalog.catalogs[r.catalog]?.fetchedAt?.slice(0, 10) ?? '—')}</p>`;
      return `<article class="res-card" style="--accent:${r.accent}">
      <span class="res-dot" aria-hidden="true"></span>
      <h2>${escapeHtml(r.name)}</h2>
      <p class="res-card-role">${escapeHtml(r.role)} · 难度 ${escapeHtml(r.level)}</p>
      <p class="muted small">${escapeHtml(r.scale)}</p>
      <p class="res-card-stat">已生成深链 <strong>${stat.mapped}</strong> / ${stat.total} 条引用</p>
      ${entry}
      ${
        published
          ? `<a class="res-card-root" href="${r.kind === 'pdf' ? r.pdf : r.root}" target="_blank" rel="noopener">${escapeHtml(r.kind === 'pdf' ? r.pdf : r.root)}</a>`
          : `<span class="res-card-root muted">本地文件：${escapeHtml(r.root)}（未发布）</span>`
      }
      ${scaleHint}
    </article>`;
    })
    .join('\n    ');

  const content = `${breadcrumb([{ label: '概览', href: 'index.html' }, { label: '资料目录' }])}
  <header class="page-head">
    <h1>资料目录</h1>
    <p class="muted">7 份资料与手册的引用一一对应。资料映射里的每条引用都会跳到这里的某个站点/PDF 位置。</p>
  </header>
  <div class="res-grid">
    ${cards}
  </div>
  <section class="ref-section">
    <h2>引用解析说明</h2>
    <div class="prose">
      <ul>
        <li>网页资料：按「讲号 / 小节号」定位到真实 URL，标题只用于展示；站点改名不影响跳转。</li>
        <li>PDF：手册里的 <code>（p102）</code> 是 PDF 物理页序，链接用 <code>#page=102</code>，浏览器原生阅读器会直接翻到该页。</li>
        <li>解析覆盖率：<strong>${coverage.mapped}/${coverage.total}</strong>（${coverage.percent}%）。未映射条目会在模块页用虚线与「未映射」标记显示，可在 <code>data/citation-overrides.json</code> 里手工补齐。</li>
        <li>目录快照（<code>data/toc/*.json</code>）随仓库提交，构建离线可复现；<code>npm run fetch:catalogs</code> 可刷新。</li>
      </ul>
    </div>
  </section>`;

  return renderShell({
    title: '资料目录',
    description: '7 份资料入口：ai infra handbook、大模型原理与架构、ai infra guide、llm-algo-leetcode、AI Systems Performance Engineering 与两本 PDF。',
    pageFile: 'resources.html',
    nav,
    content
  });
}

/* ------------------------------------------------------------------ 404 */

export function renderNotFound({ nav }) {
  const content = `<header class="page-head">
    <h1>404 · 页面不存在</h1>
    <p class="muted">链接可能来自旧版本手册。回到 <a href="index.html">概览</a> 或用 ⌘K 搜索。</p>
  </header>`;
  return renderShell({
    title: '404',
    description: '页面不存在',
    pageFile: '',
    nav,
    content
  });
}

export { phaseMeta, SITE_TITLE, SITE_TAGLINE, createMarkdownRenderer };
