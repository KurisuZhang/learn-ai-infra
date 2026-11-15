/**
 * 资料目录快照的加载与查询。
 *
 * 数据来源（均已入库，构建时零网络）：
 *   data/resources.json          7 份资料注册表
 *   data/toc/*.json              目录快照（npm run fetch:catalogs / extract:pdf 生成）
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve('data');

/** 宽松归一：小写、去空白与常见分隔符，用于别名/标题比对 */
export function normKey(input = '') {
  return String(input)
    .replace(/\*\*/g, '')
    .replace(/[`~]/g, '')
    .toLowerCase()
    .replace(/[（）()【】\[\]、，,。.：:；;·・\-—_/／|]/g, '')
    .replace(/\s+/g, '');
}

/** 标题归一：保守一些，保留中文与字母数字 */
export function normTitle(input = '') {
  return String(input)
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/^\s*(第[\d一二三四五六七八九十百]+[章篇部分]+[：:、.]?\s*)/, '')
    .replace(/^\s*([A-Z]\.\d+|\d{1,3}(?:\.\d{1,3})*)[.．、]?\s*/, '')
    .replace(/[*`（）()【】\[\]]/g, ' ')
    .replace(/[，,。.：:；;·・、\-—_/／]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** 去掉全部空白后的标题，用于忽略中英混排空格差异（「GPU 基础知识」↔「GPU基础知识」） */
export function compactTitle(input = '') {
  return normTitle(input).replace(/\s+/g, '');
}

/** 取标题主体（冒号前的部分），用于「10.6 投机解码：为什么能加速」这类带副标题的匹配 */
export function titleHead(input = '') {
  const norm = normTitle(input);
  return norm.split(/[：:]/)[0].trim();
}

function readJson(file) {
  return JSON.parse(readFileSync(path.join(DATA_DIR, file), 'utf8'));
}

export function loadCatalog() {
  const registry = readJson('resources.json');
  const resources = [...registry.resources].sort((a, b) => a.order - b.order);
  const byId = new Map(resources.map((r) => [r.id, r]));

  const aliasMap = new Map();
  for (const res of resources) {
    const keys = new Set([res.name, res.short, ...(res.aliases ?? [])]);
    for (const key of keys) aliasMap.set(normKey(key), res.id);
  }
  // 手册里出现过的写法兜底（大小写/空格差异已被 normKey 吸收）
  aliasMap.set(normKey('AI Infra Handbook'), 'handbook');
  aliasMap.set(normKey('大模型原理与架构（站）'), 'yeasy');
  aliasMap.set(normKey('AI-Infra-Book（PDF）'), 'pdf-book');
  aliasMap.set(normKey('图解大模型（PDF）'), 'pdf-llm');

  const handbook = readJson('toc/handbook.json');
  const yeasy = readJson('toc/yeasy.json');
  const guide = readJson('toc/guide.json');
  const leetcode = readJson('toc/leetcode.json');
  const aispe = readJson('toc/aispe.json');
  const pdfBook = readJson('toc/pdf-book.json');
  const pdfLlm = readJson('toc/pdf-llm.json');

  const catalogs = { handbook, yeasy, guide, leetcode, aispe, 'pdf-book': pdfBook, 'pdf-llm': pdfLlm };

  // 站点快照里有相对 URL（如 guide 的 /AIInfraGuide/...），统一补成绝对地址
  for (const [id, catalog] of Object.entries(catalogs)) {
    const root = byId.get(id)?.root;
    if (!root || !/^https?:/.test(root)) continue;
    const rootUrl = new URL(root);
    const rootPath = rootUrl.pathname.replace(/\/+$/, '');
    const fix = (value) => {
      if (typeof value !== 'string' || !value.startsWith('/')) return value;
      if (rootPath && (value === rootPath || value.startsWith(`${rootPath}/`))) return `${rootUrl.origin}${value}`;
      return `${rootUrl.origin}${rootPath}${value}`;
    };
    const lists = [];
    for (const key of ['entries', 'chapters', 'parts', 'pages', 'modules']) {
      if (Array.isArray(catalog?.[key])) lists.push(catalog[key]);
    }
    for (const list of lists) {
      for (const item of list) {
        if (item.url) item.url = fix(item.url);
        for (const key of ['entries', 'chapters']) {
          for (const child of item[key] ?? []) if (child.url) child.url = fix(child.url);
        }
      }
    }
  }

  return {
    resources,
    byId,
    aliasMap,
    catalogs,
    resourceForName(name) {
      const id = aliasMap.get(normKey(name));
      return id ? byId.get(id) : null;
    },
    catalogFor(resource) {
      return resource?.catalog ? catalogs[resource.catalog] ?? null : null;
    }
  };
}
