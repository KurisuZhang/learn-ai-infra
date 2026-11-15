#!/usr/bin/env node
/**
 * 抓取 5 份在线资料的目录结构，生成可离线构建的快照：data/toc/*.json
 *
 * 为什么要快照：站点构建（含 CI）不应依赖外站可用性。UI 上展示的每个深链
 * 都由这些快照里的真实 URL 派生，一次抓取、多次构建、可审计（记录 fetchedAt）。
 *
 * 用法：npm run fetch:catalogs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.resolve('data/toc');
const UA = 'Mozilla/5.0 (compatible; learn-ai-infra-site-catalog/1.0)';

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#39;': "'",
  '&nbsp;': ' ', '&hellip;': '…', '&mdash;': '—', '&ndash;': '–'
};

const decode = (s) =>
  s.replace(/&[a-z#0-9x]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? ENTITIES[m] ?? '');
const stripTags = (s) =>
  decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

async function fetchText(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'text/html,text/plain,*/*' },
        signal: AbortSignal.timeout(25000),
        redirect: 'follow'
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw new Error(`${url} 抓取失败：${lastErr?.message ?? lastErr}`);
}

/** 按文档顺序抽取 <a href>（保留顺序，用于「章节 → 条目」归属推断） */
function anchors(html) {
  const out = [];
  for (const m of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    out.push({ href: decode(m[1]), text: stripTags(m[2]) });
  }
  return out;
}

const uniqByHref = (list) => {
  const seen = new Set();
  return list.filter((x) => (seen.has(x.href) ? false : (seen.add(x.href), true)));
};

const numPrefix = (text) => {
  const m = text.match(/^\s*(\d{1,3}(?:\.\d{1,2})*)\s*[.．、]?\s*(.*)$/);
  if (!m) return { key: '', title: text.trim() };
  return { key: m[1], title: m[2].trim() || text.trim() };
};

const meta = (source, extra = {}) => ({
  source,
  fetchedAt: new Date().toISOString(),
  ...extra
});

/* ------------------------------------------------------------------ handbook */

async function fetchHandbook() {
  const root = 'https://ai-infra-handbook.sunxiaohui2022.workers.dev';
  const html = await fetchText(`${root}/`);
  const links = uniqByHref(anchors(html)).filter((a) =>
    /\/(l|p)\/\d+$/.test(a.href)
  );

  const parts = [];
  const lectures = [];
  for (const link of links) {
    const isLecture = /\/l\/(\d+)$/.test(link.href);
    if (!isLecture) {
      const no = Number(link.href.match(/\/p\/(\d+)$/)[1]);
      parts.push({
        no,
        title: link.text.replace(/→\s*$/, '').trim(),
        url: `${root}${link.href}`,
        lectures: []
      });
      continue;
    }
    const no = Number(link.href.match(/\/l\/(\d+)$/)[1]);
    const { title } = numPrefix(link.text);
    const lecture = { no, title: title.replace(/^[·:：\s]+/, '').trim(), url: `${root}${link.href}` };
    lectures.push(lecture);
    const host = parts[parts.length - 1];
    if (host) host.lectures.push(lecture);
  }
  lectures.sort((a, b) => a.no - b.no);
  for (const part of parts) part.lectures.sort((a, b) => a.no - b.no);
  if (lectures.length < 100) throw new Error(`handbook 只解析到 ${lectures.length} 讲，疑似结构变化`);
  return { ...meta(`${root}/`), parts, lectures };
}

/* ---------------------------------------------------------------------- yeasy */

async function fetchYeasy() {
  const root = 'https://yeasy.gitbook.io/llm_internals';
  const txt = await fetchText(`${root}/llms.txt`);
  const pages = [];
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*-\s*\[([^\]]+)\]\(([^)]+)\)\s*$/);
    if (!m) continue;
    const title = m[1].trim();
    const url = m[2].trim().replace(/\.md$/, '');
    // 章节号：10.14 / A.3 / 1.0；章标题（第X章 / 第X部分）没有小节号
    const number = title.match(/^([A-Z]\.\d+|\d+\.\d+)\s/)?.[1] ?? '';
    pages.push({ title, url, number });
  }
  if (pages.length < 100) throw new Error(`yeasy 只解析到 ${pages.length} 页，疑似结构变化`);
  return { ...meta(`${root}/llms.txt`), root, pages };
}

/* ---------------------------------------------------------------------- guide */

const GUIDE_MODULES = [
  { key: 'prerequisites', title: '模块一 前置知识' },
  { key: 'cuda', title: '模块二 CUDA 编程与算子优化' },
  { key: 'distributed', title: '模块三 分布式训练' },
  { key: 'inference', title: '模块四 推理优化' }
];

async function fetchGuide() {
  const root = 'https://caomaolufei.github.io/AIInfraGuide';
  const modules = [];
  for (const mod of GUIDE_MODULES) {
    const html = await fetchText(`${root}/${mod.key}`);
    const prefix = `/AIInfraGuide/${mod.key}/`;
    const links = uniqByHref(anchors(html)).filter((a) => a.href.startsWith(prefix));

    const chapters = [];
    const entries = [];
    for (const link of links) {
      const segs = link.href.slice(prefix.length).split('/');
      const last = segs[segs.length - 1];
      const chapterHit = last.match(/第(\d+)章/);
      const slugNo = last.match(/^(\d{1,2})-/)?.[1];
      const { key } = numPrefix(link.text);

      if (chapterHit) {
        const chapter = {
          no: Number(chapterHit[1]),
          title: link.text.trim(),
          url: link.href,
          articles: []
        };
        chapters.push(chapter);
        entries.push({ kind: 'chapter', number: '', chapterNo: chapter.no, title: chapter.title, url: chapter.url });
        continue;
      }

      // 模块四的文章号来自 slug（21-pagedattention → 2.1）；其余模块优先用标题编号
      const inferredChapter = Number(slugNo ? slugNo.slice(0, -1) || slugNo[0] : 0);
      const number = /^\d+\.\d+$/.test(key) ? key : '';
      const entry = {
        kind: 'article',
        number,
        chapterNo: inferredChapter || undefined,
        title: link.text.trim(),
        url: link.href,
        slug: last
      };
      entries.push(entry);
      const host =
        chapters.find((c) => c.url.split('/').pop() === segs[segs.length - 2]) ??
        chapters.filter((c) => c.no === inferredChapter)[0];
      if (host) host.articles.push(entry);
    }

    chapters.sort((a, b) => a.no - b.no);
    modules.push({ key: mod.key, title: mod.title, url: `${root}/${mod.key}`, chapters, entries });
  }
  const total = modules.reduce((n, m) => n + m.entries.filter((e) => e.kind === 'article').length, 0);
  if (total < 30) throw new Error(`guide 只解析到 ${total} 篇，疑似结构变化`);
  return { ...meta(`${root}/`), root, modules };
}

/* ------------------------------------------------------------------- leetcode */

const LEETCODE_PART_NAMES = {
  '00_Prerequisites': 'Part 00 Python、PyTorch 与实验基础',
  '01_Hardware_Math_and_Systems': 'Part 01 硬件、数学与系统',
  '02_PyTorch_Algorithms': 'Part 02 PyTorch 算法实战',
  '03_Triton_Kernels': 'Part 03 Triton 算子开发',
  '04_CUDA_and_System_Optimization': 'Part 04 CUDA C++ 与系统优化',
  '05_Integrated_Projects_and_Decisions': 'Part 05 综合项目与决策收口'
};

async function fetchLeetcode() {
  const root = 'https://datawhalechina.github.io/llm-algo-leetcode';
  const html = await fetchText(`${root}/`);
  const prefix = '/llm-algo-leetcode/';
  const links = uniqByHref(anchors(html)).filter((a) => {
    if (!a.href.startsWith(prefix) || !a.href.endsWith('.html')) return false;
    return /^[^/]+\/[^/]+\.html$/.test(a.href.slice(prefix.length));
  });

  const parts = new Map();
  let currentGroup = null;
  for (const link of links) {
    const rel = link.href.slice(prefix.length);
    const [dir, file] = rel.split('/');
    if (!parts.has(dir)) {
      parts.set(dir, {
        dir,
        title: LEETCODE_PART_NAMES[dir] ?? dir,
        url: `${root}/${dir}/intro.html`,
        groups: [],
        pages: []
      });
    }
    const part = parts.get(dir);
    const base = file.replace(/\.html$/, '');
    const isGroup = /^\d[A-Z]$/.test(base) || /^\d_\d+$/.test(base);

    if (base === 'intro') continue;
    if (isGroup) {
      currentGroup = { id: base, title: link.text.trim(), url: `${root}/${rel}`, items: [] };
      part.groups.push(currentGroup);
      continue;
    }
    const noMatch = base.match(/^(\d{2,3})_/) ?? link.text.match(/^(\d{2,3})[.．]/);
    const page = {
      id: base,
      no: noMatch ? noMatch[1].replace(/^0+(?=\d)/, '') : '',
      rawNo: noMatch ? noMatch[1] : '',
      title: link.text.trim().replace(/^\d{2,3}\.\s*/, ''),
      url: `${root}/${rel}`,
      group: currentGroup?.id ?? ''
    };
    part.pages.push(page);
    if (currentGroup) currentGroup.items.push(page);
  }

  const partsArr = [...parts.values()].filter((p) => p.pages.length > 0 || p.groups.length > 0);
  const total = partsArr.reduce((n, p) => n + p.pages.length, 0);
  if (total < 80) throw new Error(`leetcode 只解析到 ${total} 页，疑似结构变化`);
  return { ...meta(`${root}/`), root, parts: partsArr };
}

/* ---------------------------------------------------------------------- aispe */

const AISPE_CHAPTERS = [
  '引言与 AI 系统概述',
  'AI 系统硬件概述',
  'GPU 环境的 OS、Docker 与 Kubernetes 调优',
  '分布式网络通信调优',
  'GPU 存储 I/O 优化',
  'GPU 架构、CUDA 编程与最大化占用率',
  'GPU 内存访问模式分析与调优',
  '占用率调优、Warp 效率与指令级并行',
  '提高 CUDA 内核效率与算术强度',
  '内核内流水线、Warp 特化与协作线程块集群',
  '内核间流水线、同步与 CUDA 流有序内存分配',
  '动态调度、CUDA 图与设备发起的内核编排',
  'PyTorch 性能分析、调优与扩展',
  'PyTorch 编译器、OpenAI Triton 与 XLA 后端',
  '多节点推理、并行、解码与路由优化',
  '大规模推理的性能分析、调试与调优',
  '扩展分离式预填充与解码推理',
  '高级预填充-解码与 KV 缓存调优',
  '动态自适应推理引擎优化',
  'AI 辅助性能优化与向百万 GPU 集群扩展'
];

function buildAispe() {
  const root = 'https://aispe.notlate.cn';
  const chapters = AISPE_CHAPTERS.map((title, i) => ({
    no: i + 1,
    title: `第${i + 1}章 ${title}`,
    url: `${root}/chapters/ch${String(i + 1).padStart(2, '0')}/`
  }));
  return {
    ...meta(`${root}/（章节清单取自首页“全部章节”列表，URL 模式 /chapters/chNN/ 已实测）`),
    root,
    chapters,
    appendix: { title: '附录', url: `${root}/appendix/appendix/` }
  };
}

/* ---------------------------------------------------------------------- main */

async function main() {
  await mkdir(DATA_DIR, { recursive: true });
  const jobs = [
    ['handbook.json', fetchHandbook],
    ['yeasy.json', fetchYeasy],
    ['guide.json', fetchGuide],
    ['leetcode.json', fetchLeetcode]
  ];
  const errors = [];
  for (const [file, fn] of jobs) {
    try {
      const data = await fn();
      await writeFile(path.join(DATA_DIR, file), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
      const size =
        data.lectures?.length ??
        data.pages?.length ??
        data.modules?.reduce(
          (n, m) => n + m.chapters.reduce((k, c) => k + c.articles.length, 0),
          0
        ) ??
        data.parts?.reduce((n, p) => n + p.pages.length, 0) ??
        0;
      console.log(`✔ ${file}（条目 ${size}）`);
    } catch (err) {
      errors.push({ file, message: err.message });
      console.error(`✘ ${file}: ${err.message}`);
    }
  }
  const aispe = buildAispe();
  await writeFile(path.join(DATA_DIR, 'aispe.json'), `${JSON.stringify(aispe, null, 2)}\n`, 'utf8');
  console.log(`✔ aispe.json（${aispe.chapters.length} 章）`);

  if (errors.length) {
    console.error(`\n有 ${errors.length} 个资料快照失败；已生成的快照保留，失败的沿用仓库内旧文件。`);
    process.exitCode = 1;
  } else {
    console.log('\n全部快照已更新。');
  }
}

main();
