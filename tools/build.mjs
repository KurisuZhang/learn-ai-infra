#!/usr/bin/env node
/**
 * 构建站点：node tools/build.mjs [--verify]
 *
 * 输入：AI-Infra-学习手册与路线图.md（唯一内容源）、data/、web/
 * 输出：site/（gitignored）、reports/（构建报告）
 *
 * --verify 额外做严格断言（覆盖率、锚点、PDF 页码抽查、绝对路径扫描），CI 里用它挡住回归。
 */
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadCatalog } from './lib/catalog.mjs';
import { parseManual } from './lib/parse-manual.mjs';
import { createMarkdownRenderer, escapeHtml } from './lib/markdown.mjs';
import { resolveCitationsBlock } from './lib/resolve-citations.mjs';
import {
  renderHome,
  renderModulePage,
  renderNotFound,
  renderPhaseIndex,
  renderPhasePage,
  renderReferencePage,
  renderResourcesPage
} from './lib/render.mjs';

const NEWSITE = path.resolve('site');
const REPORTS = path.resolve('reports');
const MANUAL = path.resolve('AI-Infra-学习手册与路线图.md');
const WEB = path.resolve('web');

const args = new Set(process.argv.slice(2));
const VERIFY = args.has('--verify');

const log = (...a) => console.log(...a);

/** markdown → 纯文本（用于搜索索引与摘要） */
function mdToText(md = '') {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[>#\-*\d.\s]+/gm, ' ')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mermaidToDivs(html) {
  return html.replace(/<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g, (_m, code) => {
    const decoded = code
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
    return `<div class="mermaid">${decoded}</div>`;
  });
}

async function main() {
  const startedAt = Date.now();
  const manualText = await readFile(MANUAL, 'utf8');
  const overrides = JSON.parse(await readFile('data/citation-overrides.json', 'utf8'));
  const catalog = loadCatalog();
  const manual = parseManual(manualText);

  // 哪些 PDF 会随站点发布：默认全部；PDF_EXCLUDE=pdf-book,pdf-llm 可排除（例如版权考虑）
  const pdfExcluded = new Set(
    (process.env.PDF_EXCLUDE ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
  );
  const pdfAvailable = {};
  for (const res of catalog.resources.filter((r) => r.kind === 'pdf')) {
    pdfAvailable[res.id] = !pdfExcluded.has(res.id) && existsSync(path.resolve(res.sourceFile));
  }

  /* ---------------------------------------------------------- 引用解析 */
  const citationsByModule = new Map();
  const report = [];
  const perResource = {};
  let totalLeaves = 0;
  let mappedLeaves = 0;
  let mainReadTotal = 0;
  let mainReadMapped = 0;

  for (const mod of manual.modules) {
    const resolved = resolveCitationsBlock(mod.resourceLines, catalog, overrides.overrides ?? {}, report);
    citationsByModule.set(mod.id, resolved.citations);
    totalLeaves += resolved.stats.total;
    mappedLeaves += resolved.stats.mapped;
    for (const citation of resolved.citations) {
      for (const group of citation.groups) {
        const id = group.resource?.id ?? '(未识别)';
        perResource[id] ??= { total: 0, mapped: 0 };
        const mapped = group.leaves.filter((l) => l.mapped).length;
        perResource[id].total += group.leaves.length;
        perResource[id].mapped += mapped;
        if (citation.kind === '主读') {
          mainReadTotal += group.leaves.length;
          mainReadMapped += mapped;
        }
      }
    }
  }

  const coverage = {
    total: totalLeaves,
    mapped: mappedLeaves,
    percent: totalLeaves ? Math.round((mappedLeaves / totalLeaves) * 1000) / 10 : 0,
    mainRead: { total: mainReadTotal, mapped: mainReadMapped },
    perResource,
    unmapped: report.filter((r) => r.reason === 'unmapped')
  };

  /* -------------------------------------------------------------- 渲染 */
  await rm(NEWSITE, { recursive: true, force: true });
  await mkdir(NEWSITE, { recursive: true });
  await mkdir(REPORTS, { recursive: true });

  const files = new Map();
  const rendererFor = (pageFile) =>
    createMarkdownRenderer({
      slugMap: manual.slugMap,
      anchorMap: manual.anchorMap,
      moduleIndex: new Map(manual.modules.map((m) => [m.id, m])),
      pageFile
    });

  const writePage = (file, html) => files.set(file, mermaidToDivs(html));

  writePage('index.html', renderHome({ manual, resources: catalog.resources, coverage, renderer: rendererFor('index.html') }));

  for (const phase of manual.phases) {
    const idx = manual.phases.indexOf(phase);
    writePage(
      phase.file,
      renderPhasePage({
        phase,
        renderer: rendererFor(phase.file),
        prevPhase: manual.phases[idx - 1],
        nextPhase: manual.phases[idx + 1],
        nav: manual.nav
      })
    );
  }

  manual.modules.forEach((mod, idx) => {
    writePage(
      mod.file,
      renderModulePage({
        module: mod,
        citations: citationsByModule.get(mod.id) ?? [],
        renderer: rendererFor(mod.file),
        prev: manual.modules[idx - 1],
        next: manual.modules[idx + 1],
        nav: manual.nav,
        pdfAvailable
      })
    );
  });

  for (const page of manual.pages.filter((p) => p.kind === 'reference')) {
    writePage(
      page.file,
      renderReferencePage({
        page,
        renderer: rendererFor(page.file),
        nav: manual.nav,
        extraHtml: page.key === 'part-3' ? renderPhaseIndex(manual.phases) : ''
      })
    );
  }

  writePage('resources.html', renderResourcesPage({ resources: catalog.resources, coverage, catalog, nav: manual.nav, pdfAvailable }));
  writePage('404.html', renderNotFound({ nav: manual.nav }));

  /* ---------------------------------------------------------- 静态资源 */
  await mkdir(path.join(NEWSITE, 'assets'), { recursive: true });
  for (const asset of await readdir(WEB)) {
    await cp(path.join(WEB, asset), path.join(NEWSITE, 'assets', asset), { recursive: true });
  }

  // PDF 一并发布：链接用 pdf/xxx.pdf#page=N，浏览器原生阅读器直接翻页
  const pdfCopied = [];
  try {
    for (const res of catalog.resources.filter((r) => r.kind === 'pdf')) {
      if (!pdfAvailable[res.id]) {
        log(`! 跳过 PDF：${res.id}（${pdfExcluded.has(res.id) ? 'PDF_EXCLUDE 排除' : '文件不存在'}）`);
        continue;
      }
      await mkdir(path.join(NEWSITE, 'pdf'), { recursive: true });
      await cp(path.resolve(res.sourceFile), path.join(NEWSITE, res.pdf));
      pdfCopied.push(res.pdf);
    }
  } catch (error) {
    log(`! PDF 复制失败：${error.message}`);
  }

  const needsMermaid = [...files.values()].some((html) => html.includes('class="mermaid"'));
  if (needsMermaid) {
    await cp(
      path.resolve('node_modules/mermaid/dist/mermaid.min.js'),
      path.join(NEWSITE, 'assets/mermaid.min.js')
    );
  }

  /* ------------------------------------------------------ 搜索索引 / 进度 */
  const searchIndex = [];
  for (const mod of manual.modules) {
    searchIndex.push({
      kind: 'module',
      title: `${mod.id} ${mod.title}`,
      href: mod.file,
      phase: mod.phaseTitle.replace(/：.*$/, ''),
      hours: mod.hours,
      priority: mod.priority,
      env: mod.env,
      text: mdToText(`${mod.goalsMd} ${mod.pointsMd} ${mod.tasks.map((t) => t.text).join(' ')}`).slice(0, 600)
    });
  }
  for (const page of manual.pages.filter((p) => p.kind === 'reference')) {
    for (const section of page.sections) {
      searchIndex.push({
        kind: 'section',
        title: section.title,
        href: `${page.file}#${section.anchor}`,
        phase: '',
        text: mdToText(section.md).slice(0, 600)
      });
    }
  }
  for (const phase of manual.phases) {
    searchIndex.push({
      kind: 'phase',
      title: phase.title,
      href: phase.file,
      text: mdToText(phase.introMd).slice(0, 400)
    });
  }

  const progressMeta = {
    totals: {
      modules: manual.modules.length,
      gateItems: manual.phases.reduce((n, p) => n + (p.gate?.items.length ?? 0), 0),
      tasks: manual.modules.reduce((n, m) => n + m.tasks.length, 0)
    },
    modules: manual.modules.map((m) => ({
      id: m.id,
      file: m.file,
      title: m.title,
      phaseId: m.phaseId,
      phaseTitle: m.phaseTitle.replace(/：.*$/, ''),
      hours: m.hours,
      priority: m.priority
    })),
    phases: manual.phases.map((p) => ({
      id: p.id,
      file: p.file,
      title: p.title.replace(/：.*$/, ''),
      modules: p.modules.map((m) => m.id),
      gateItems: p.gate?.items.length ?? 0
    })),
    tasks: manual.modules.map((m) => ({ module: m.id, count: m.tasks.length }))
  };

  await writeFile(path.join(NEWSITE, 'assets/search-index.json'), `${JSON.stringify(searchIndex)}\n`);
  await writeFile(path.join(NEWSITE, 'assets/progress.json'), `${JSON.stringify(progressMeta, null, 2)}\n`);
  await writeFile(path.join(NEWSITE, '.nojekyll'), '');

  /* -------------------------------------------------------------- 落盘 */
  for (const [file, html] of files) {
    await writeFile(path.join(NEWSITE, file), html, 'utf8');
  }

  /* ------------------------------------------------------------ 报告 */
  const unmappedLines = coverage.unmapped.map(
    (r) => `| ${r.resource} | ${r.text.replace(/\|/g, '\\|')} | \`${r.key}\` |`
  );
  const coverageReport = `# 资料引用解析报告

生成时间：${new Date().toISOString()}

- 资料条目总数：**${coverage.total}**
- 已生成深链：**${coverage.mapped}**（${coverage.percent}%）
- 主读引用：${coverage.mainRead.mapped}/${coverage.mainRead.total}

| 资料 | 已映射 / 总数 |
|---|---|
${catalog.resources
  .map((r) => {
    const s = coverage.perResource[r.id] ?? { mapped: 0, total: 0 };
    return `| ${r.name} | ${s.mapped} / ${s.total} |`;
  })
  .join('\n')}

${unmappedLines.length ? `## 未映射条目（可在 data/citation-overrides.json 补齐）\n\n| 资料 | 条目 | 建议键 |\n|---|---|---|\n${unmappedLines.join('\n')}` : '## 未映射条目\n\n无 🎉'}
`;
  await writeFile(path.join(REPORTS, 'link-coverage.md'), coverageReport, 'utf8');
  await writeFile(
    path.join(REPORTS, 'build-report.json'),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        pages: [...files.keys()].sort(),
        modules: manual.modules.length,
        phases: manual.phases.length,
        coverage,
        unmapped: coverage.unmapped.map((r) => ({ resource: r.resource, text: r.text, key: r.key }))
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  /* ------------------------------------------------------------ 断言 */
  const problems = [];

  const expect = (cond, msg) => {
    if (!cond) problems.push(msg);
  };

  expect(manual.modules.length === 27, `模块数应为 27，实际 ${manual.modules.length}`);
  expect(manual.phases.length === 5, `阶段数应为 5，实际 ${manual.phases.length}`);
  const gateItems = manual.phases.reduce((n, p) => n + (p.gate?.items.length ?? 0), 0);
  expect(gateItems === 25, `Gate 勾选项应为 25，实际 ${gateItems}`);
  expect(coverage.mainRead.mapped === coverage.mainRead.total, `主读引用未全部映射（${coverage.mainRead.mapped}/${coverage.mainRead.total}）`);
  if (VERIFY) {
    expect(coverage.percent >= 95, `总体映射率应 ≥95%，实际 ${coverage.percent}%`);
  }

  // 内部链接与锚点
  const idsByFile = new Map();
  for (const [file, html] of files) {
    idsByFile.set(file, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  }
  for (const [file, html] of files) {
    for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const href = m[1];
      if (/^(https?:|mailto:|data:)/.test(href)) continue;
      if (href.startsWith('#')) {
        const id = decodeURIComponent(href.slice(1));
        if (id && !idsByFile.get(file)?.has(id)) problems.push(`${file} 页内锚点缺失：#${id}`);
        continue;
      }
      const [target, anchor] = href.split('#');
      if (/\.html$/.test(target)) {
        if (!files.has(target)) problems.push(`${file} 链接到不存在的页面：${target}`);
        else if (anchor && !idsByFile.get(target)?.has(decodeURIComponent(anchor))) {
          problems.push(`${file} 链接到不存在的锚点：${href}`);
        }
      }
    }
  }

  // 绝对路径扫描（子路径部署）
  for (const [file, html] of files) {
    if (/(?:href|src)="\/(?!\/)/.test(html)) problems.push(`${file} 含绝对路径链接，子路径部署会 404`);
  }

  // PDF 深链抽查
  const moduleHtmlJoined = [...files.entries()].filter(([f]) => /^m\d-\d\.html$/.test(f)).map(([, h]) => h).join('\n');
  const pdfChecks = [
    ['pdf/llm-illustrated.pdf#page=102', '图解大模型 3.1.5 → p102'],
    ['pdf/llm-illustrated.pdf#page=94', '图解大模型 3.1.1 → p94'],
    ['pdf/ai-infra-book.pdf#page=337', 'AI-Infra-Book 8.3 → p337'],
    ['pdf/ai-infra-book.pdf#page=327', 'AI-Infra-Book 8.1 → p327']
  ].filter(([needle]) => !pdfExcluded.has(needle.includes('llm') ? 'pdf-llm' : 'pdf-book'));
  for (const [needle, label] of pdfChecks) {
    expect(moduleHtmlJoined.includes(needle), `PDF 深链抽查失败：${label}`);
  }

  // 首页模块卡
  const homeHtml = files.get('index.html') ?? '';
  const homeModuleLinks = [...homeHtml.matchAll(/class="mod-chip"/g)].length;
  expect(homeModuleLinks === 27, `首页模块卡应为 27，实际 ${homeModuleLinks}`);

  if (problems.length) {
    console.error('\n✘ 构建断言失败：');
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
  } else {
    log(`\n✔ 断言通过（${files.size} 个页面，Gate 项 ${gateItems}，PDF 抽查 ${pdfChecks.length} 条）`);
  }

  const unmappedCount = coverage.unmapped.length;
  log(`✔ 页面：${files.size} 个（首页 1 / 阶段 ${manual.phases.length} / 模块 ${manual.modules.length} / 参考 ${[...files.keys()].filter((f) => !/^m\d-\d/.test(f)).length}）`);
  log(`✔ 引用映射：${coverage.mapped}/${coverage.total}（${coverage.percent}%），主读 ${coverage.mainRead.mapped}/${coverage.mainRead.total}，未映射 ${unmappedCount}`);
  if (pdfCopied.length) log(`✔ PDF：${pdfCopied.join('、')}`);
  log(`✔ 报告：reports/link-coverage.md`);
  log(`✔ 用时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s → site/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
