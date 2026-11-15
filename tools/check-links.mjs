#!/usr/bin/env node
/**
 * 外链体检：node tools/check-links.mjs [--strict] [--limit 400]
 *
 * 站点里的资料链接来自别人的站点，会随时间漂移；这里定期探测并生成报告。
 * 默认永不失败（Pages 部署不应被外部站点拖垮）；--strict 时发现 404 即退出 1。
 *
 * 注意：不少站点对无 UA 的请求返回 403/429，这类归为「被拦截」，不算坏链。
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const argv = new Set(process.argv.slice(2));
const STRICT = argv.has('--strict');
const limitArg = [...argv].find((a) => a.startsWith('--limit'));
const LIMIT = limitArg ? Number(limitArg.split('=')[1] ?? 0) || Infinity : Infinity;

const SITE = path.resolve('site');
const REPORTS = path.resolve('reports');
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

async function collectFromSite() {
  const urls = new Set();
  let files = [];
  try {
    files = (await readdir(SITE)).filter((f) => f.endsWith('.html'));
  } catch {
    console.error('找不到 site/，请先 npm run build');
    process.exit(1);
  }
  for (const file of files) {
    const html = await readFile(path.join(SITE, file), 'utf8');
    for (const m of html.matchAll(/(?:href|src)="(https?:\/\/[^"]+)"/g)) urls.add(m[1]);
  }
  return urls;
}

async function collectFromCatalogs() {
  const urls = new Set();
  const dir = path.resolve('data/toc');
  let files = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  } catch {
    return urls;
  }
  const walk = (value) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach(walk);
    for (const [key, child] of Object.entries(value)) {
      if (key === 'url' && typeof child === 'string' && /^https?:\/\//.test(child)) urls.add(child);
      else walk(child);
    }
  };
  for (const file of files) walk(JSON.parse(await readFile(path.join(dir, file), 'utf8')));
  return urls;
}

async function probe(url) {
  const attempt = async () => {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'user-agent': UA, accept: '*/*' },
      signal: AbortSignal.timeout(20000)
    });
    // 只读状态码，不消费 body
    res.body?.cancel?.();
    return res.status;
  };
  try {
    const status = await attempt();
    if (status >= 400 && status !== 403 && status !== 429 && status !== 401) {
      await new Promise((r) => setTimeout(r, 600));
      return { url, status: await attempt() };
    }
    return { url, status };
  } catch (error) {
    try {
      return { url, status: await attempt() };
    } catch (err2) {
      return { url, status: 0, error: String(err2?.cause?.code ?? err2?.name ?? err2).slice(0, 60) };
    }
  }
}

function classify({ status, error }) {
  if (error) return 'error';
  if (status >= 200 && status < 400) return 'ok';
  if ([401, 403, 429, 999].includes(status)) return 'blocked';
  return 'broken';
}

async function runPool(items, worker, concurrency = 10) {
  const results = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

const siteUrls = await collectFromSite();
const catalogUrls = await collectFromCatalogs();
const all = [...new Set([...siteUrls, ...catalogUrls])].slice(0, LIMIT);

console.log(`探测 ${all.length} 个外部链接（站点 ${siteUrls.size} + 目录快照 ${catalogUrls.size}）…`);
const started = Date.now();
const results = (await runPool(all, probe, 10)).map((r) => ({ ...r, verdict: classify(r) }));

const groups = { broken: [], error: [], blocked: [], ok: [] };
for (const r of results) groups[r.verdict].push(r);

const rows = [...groups.broken, ...groups.error, ...groups.blocked]
  .map((r) => `| ${r.verdict === 'broken' ? '✘' : r.verdict === 'error' ? '⚠️' : '🔒'} | ${r.status || r.error || '-'} | ${r.url} |`)
  .join('\n');

const report = `# 外链体检报告

- 生成时间：${new Date().toISOString()}
- 探测总数：${results.length}
- 正常：${groups.ok.length} ｜ 失效：${groups.broken.length} ｜ 网络错误：${groups.error.length} ｜ 被拦截（403/429，通常正常）：${groups.blocked.length}
- 耗时：${((Date.now() - started) / 1000).toFixed(1)}s

${rows ? `## 需要人工确认\n\n| 结果 | 状态 | URL |\n|---|---|---|\n${rows}\n` : '## 需要人工确认\n\n无 🎉\n'}
`;

await writeFile(path.join(REPORTS, 'link-check.md'), report, 'utf8');
console.log(
  `正常 ${groups.ok.length} ｜ 失效 ${groups.broken.length} ｜ 网络错误 ${groups.error.length} ｜ 被拦截 ${groups.blocked.length}`
);
console.log('报告：reports/link-check.md');

if (STRICT && groups.broken.length) process.exit(1);
