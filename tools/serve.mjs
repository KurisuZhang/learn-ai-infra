#!/usr/bin/env node
/**
 * 本地预览：node tools/serve.mjs [--port 4173] [--base /]
 *
 * 零依赖静态服务器，未命中时回退 404.html；
 * --base 模拟 GitHub Pages 的子路径部署（例：--base /learn-ai-infra/）。
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

const argv = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const PORT = Number(argValue('port', process.env.PORT ?? 4173));
const BASE = (() => {
  const raw = argValue('base', process.env.BASE ?? '/');
  const withLead = raw.startsWith('/') ? raw : `/${raw}`;
  return withLead.endsWith('/') ? withLead : `${withLead}/`;
})();
const ROOT = path.resolve('site');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

async function resolveFile(urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (BASE !== '/' && rel.startsWith(BASE)) rel = rel.slice(BASE.length - 1);
  if (rel.endsWith('/')) rel += 'index.html';
  const abs = path.join(ROOT, rel);
  if (!abs.startsWith(ROOT)) return null;
  try {
    const info = await stat(abs);
    return info.isDirectory() ? path.join(abs, 'index.html') : abs;
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  const file = await resolveFile(req.url ?? '/');
  if (!file) {
    const notFound = path.join(ROOT, '404.html');
    res.writeHead(404, { 'content-type': TYPES['.html'] });
    createReadStream(notFound).pipe(res);
    return;
  }
  const type = TYPES[path.extname(file)] ?? 'application/octet-stream';
  const headers = { 'content-type': type, 'cache-control': 'no-cache' };
  const info = await stat(file);

  // PDF 需要真正的 206 Partial Content，Chrome 内置阅读器才会按需取页（#page=N 秒开）
  const range = req.headers.range;
  if (type === 'application/pdf' && range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
      if (start <= end && start < info.size) {
        res.writeHead(206, {
          ...headers,
          'accept-ranges': 'bytes',
          'content-range': `bytes ${start}-${end}/${info.size}`,
          'content-length': end - start + 1
        });
        createReadStream(file, { start, end }).pipe(res);
        return;
      }
    }
  }

  headers['accept-ranges'] = 'bytes';
  headers['content-length'] = info.size;
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
});

server.listen(PORT, () => {
  console.log(`预览： http://localhost:${PORT}${BASE}`);
  console.log(`根目录： ${ROOT}`);
  if (BASE !== '/') console.log(`（模拟 GitHub Pages 子路径：${BASE}）`);
});
