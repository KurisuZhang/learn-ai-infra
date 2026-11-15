# learn-ai-infra

参考资料教程：
1. **ai infra handbook**：https://ai-infra-handbook.sunxiaohui2022.workers.dev/
2. **ai infra guide**：https://caomaolufei.github.io/AIInfraGuide/guides/ai-infra%E5%AD%A6%E4%B9%A0%E8%B7%AF%E7%BA%BF/
3. **llm-algo-leetcode**：https://datawhalechina.github.io/llm-algo-leetcode/
4. **大模型原理与架构**：https://yeasy.gitbook.io/llm_internals
5. **AI Systems Performance Engineering**：https://aispe.notlate.cn/
6. **图解大模型（PDF）**：@图解大模型_生成式AI原理与实战_Jay_Alammar,_Maartey.pdf
7. **AI Infra Book（PDF）**：@AI-Infra-Book.pdf

## 站点（GitHub Pages）

📖 **在线地址**：https://kurisuzhang.github.io/learn-ai-infra/

手册本身是一份 1600+ 行、78 个标题的 Markdown，直接读会遇到两个问题：太长、每一处资料引用都要手工搜索跳转。
站点把手册渲染成的页面，并把 **每一条资料引用解析成真正的深链**：

| 资料 | 跳转粒度 | 例子 |
|---|---|---|
| ai infra handbook | 讲（`/l/118`） | `M3.6` 的 `118 v0 从权重文件到第一个 token` → 直接打开该讲 |
| 大模型原理与架构 | 小节（`10.1_bottleneck`） | 按小节号映射，站点改标题也不影响链接 |
| ai infra guide | 文章 / 章 | 模块一「GPU 基础知识」→ `prerequisites/…/gpu/gpu-basics` |
| llm-algo-leetcode | 页面（Part / 组 / 单题） | `2.6` → `02_PyTorch_Algorithms/2_6_…`，按编号定位而非标题 |
| AI Systems Performance Engineering | 章（`ch06`） | `第6章 GPU` → `chapters/ch06/` |
| 两本 PDF | 页（`#page=102`） | 手册里的 `（p102）` → PDF 浏览器的真实第 102 页 |

站点同时提供：

- **按阶段/模块拆分**：Part 1–4、5 个 Phase、27 个模块页、附录 A/B/C，侧边栏树形导航 + 页内目录；
- **进度追踪**：模块完成 / Gate 验收 / 每题练习都可在页面上勾选，进度存在浏览器 `localStorage`，可导出导入迁移；
- **⌘K 搜索**：按模块号（`M3.2`）、知识点关键词、资料名搜索全站；
- **资料目录页**：7 份资料的入口与引用覆盖率明细；
- 深浅色、移动端抽屉、打印样式；Mermaid 图（Part 2 的三张图）按需渲染。

## 目录结构

```
AI-Infra-学习手册与路线图.md   # 唯一内容源（Obsidian 继续编辑它，站点只读）
AI-Infra-Book.pdf              # 随站点发布的 PDF（页码深链）
图解大模型_….pdf                # 同上
data/
  resources.json               # 7 份资料的元信息（名称、别名、站点根、PDF 文件名）
  citation-overrides.json      # 引用解析的人工补齐表（未映射条目在这里补）
  toc/*.json                   # 各站点目录快照（离线可复现，随仓库提交）
tools/
  build.mjs                    # 构建站点 + 断言（--verify 严格模式）
  serve.mjs                    # 本地预览（支持 --base 模拟子路径）
  check-links.mjs              # 每周外链体检
  fetch-catalogs.mjs           # 刷新目录快照
  extract-pdf-toc.py           # 从 PDF 书签提取标题与页码
  lib/                         # 解析手册 / 解析引用 / Markdown → HTML / 页面渲染
web/                           # 前端资源（styles.css、app.js、favicon）
.github/workflows/pages.yml    # push 到 main 自动构建并部署 Pages
.github/workflows/link-check.yml
site/                          # 构建产物（gitignore）
reports/                       # 构建报告与外链体检报告（gitignore）
```

## 本地开发

```bash
npm ci                 # 安装 marked / github-slugger / mermaid
npm run build          # 生成 site/（含引用解析报告 reports/link-coverage.md）
npm run preview        # http://localhost:4173/
npm run preview -- --base /learn-ai-infra/   # 模拟子路径部署
npm run verify         # 严格构建：覆盖率、锚点、PDF 页码、绝对路径等断言
```

> `npm run fetch:catalogs` 抓取的是**别人站点**的目录，站点改版会抓空，脚本里带了条目数阈值会直接报错而不是静默生成残缺目录。
> `npm run extract:pdf` 依赖 Python 的 PyMuPDF（`pip install pymupdf`），只有重新生成 PDF 书签快照时才需要。

改手册只需编辑 `AI-Infra-学习手册与路线图.md` 后重新 `npm run build`：

- 新增模块：写 `### M6.1 标题　`Nh`　`P0`　`L0`` + 四个固定小标题（`**学习目标**`、`**核心知识点清单**`、`**精准资料映射**`、`**动手练习与验收标准**`），站点自动生成页面、挂进导航与搜索；
- 新增资料引用：沿用 `` - `[主读]` 资料名 › 层级 › 叶 `` 的写法即可自动解析；
- 引用写法特殊（例如指向「路线页的检验标准」）时，把 `reports/link-coverage.md` 里给出的建议键补进 `data/citation-overrides.json`。

构建断言（`npm run verify`）会挡住这些回归：模块/阶段/Gate 数量变化、主读引用未 100% 映射、站内链接或锚点失效、PDF 页码抽查不符、出现 `/` 开头的绝对路径（子路径部署会 404）。

刷新目录快照与外链体检：

```bash
npm run fetch:catalogs   # 重新抓取 5 个站点的目录（会校验条目数阈值，防止站点改版抓空）
npm run check:links      # 探测所有外链，输出 reports/link-check.md（不阻断）
```

## 部署

1. 仓库 **Settings → Pages → Source** 选择 **GitHub Actions**（只需设置一次）；
2. push 到 `main` 后，`Deploy site to GitHub Pages` 会自动 `npm ci → npm run verify → 上传 site/`；
3. 站点路径为 `https://<用户>.github.io/<仓库名>/`，所有链接都是相对路径，不需要改配置。

PDF 默认随之发布（体积约 19 MB）。若不想公开分发 PDF，可在 workflow 里给构建步骤加环境变量 `PDF_EXCLUDE: pdf-book,pdf-llm`：
站点会把 PDF 引用降级为「本地文件 + 页码」提示，其余功能不受影响（`npm run verify` 会跳过 PDF 页码抽查）。

> ⚠️ 两本 PDF 的版权归原作者/译者所有；若要公开部署，请自行确认分发授权。GitHub Pages 上的内容同样受 DMCA 约束。

