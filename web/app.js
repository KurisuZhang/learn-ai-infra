/* =====================================================================
   AI Infra 学习手册 · 前端脚本（无框架、无构建依赖）
   - 本地进度（localStorage）：模块完成 / Gate 勾选 / 练习勾选
   - 深浅色、移动端抽屉、⌘K 搜索、Mermaid 按需渲染
   ===================================================================== */
(function () {
  'use strict';

  var STORAGE_KEY = 'ai-infra-progress:v1';
  var THEME_KEY = 'ai-infra-theme';

  /* ------------------------------------------------------------ 进度存储 */

  var state = loadState();
  var meta = null;
  var metaPromise = fetch('assets/progress.json', { cache: 'no-cache' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; })
    .then(function (data) {
      meta = data;
      return data;
    });

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { done: {} };
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || typeof parsed.done !== 'object') return { done: {} };
      return { done: parsed.done || {} };
    } catch (e) {
      return { done: {} };
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      /* 隐私模式下忽略 */
    }
  }

  function isDone(key) { return Boolean(state.done[key]); }

  function setDone(key, value) {
    if (value) state.done[key] = true;
    else delete state.done[key];
    saveState();
    syncAll(key);
  }

  /* -------------------------------------------------------------- 进度 UI */

  function moduleKeys() {
    return meta ? meta.modules.map(function (m) { return 'module:' + m.id; }) : [];
  }

  function computeStats() {
    var stats = { modulesDone: 0, modulesTotal: 0, gateDone: 0, gateTotal: 0, taskDone: 0, taskTotal: 0 };
    if (!meta) return stats;
    meta.modules.forEach(function (m) {
      stats.modulesTotal += 1;
      if (isDone('module:' + m.id)) stats.modulesDone += 1;
    });
    meta.phases.forEach(function (p) {
      stats.gateTotal += p.gateItems;
      for (var i = 1; i <= p.gateItems; i += 1) if (isDone(p.id + ':item:' + i)) stats.gateDone += 1;
    });
    meta.tasks.forEach(function (t) {
      stats.taskTotal += t.count;
      for (var i = 1; i <= t.count; i += 1) if (isDone('task:' + t.module + ':' + i)) stats.taskDone += 1;
    });
    return stats;
  }

  function phaseStats(phase) {
    var done = phase.modules.filter(function (id) { return isDone('module:' + id); }).length;
    return { done: done, total: phase.modules.length };
  }

  function refreshGlobal() {
    var stats = computeStats();
    var pct = stats.modulesTotal ? Math.round((stats.modulesDone / stats.modulesTotal) * 100) : 0;

    var ring = document.querySelector('[data-progress-ring]');
    if (ring) {
      ring.style.setProperty('--p', String(pct));
      var label = ring.querySelector('[data-progress-percent]');
      if (label) label.textContent = pct + '%';
    }

    var summary = document.querySelector('[data-progress-summary]');
    if (summary) {
      summary.textContent =
        '模块 ' + stats.modulesDone + '/' + stats.modulesTotal +
        ' · Gate ' + stats.gateDone + '/' + stats.gateTotal +
        ' · 练习 ' + stats.taskDone + '/' + stats.taskTotal;
    }

    var mini = document.querySelector('[data-mini-progress]');
    if (mini && meta) {
      mini.hidden = false;
      mini.querySelector('.mini-ring').style.setProperty('--p', String(pct));
      mini.querySelector('.mini-text').textContent = stats.modulesDone + '/' + stats.modulesTotal;
      mini.title = '已完成 ' + stats.modulesDone + ' / ' + stats.modulesTotal + ' 个模块（点击回到概览）';
    }
  }

  function refreshPhaseBits() {
    if (!meta) return;
    meta.phases.forEach(function (phase) {
      var s = phaseStats(phase);
      var badge = document.querySelector('[data-phase-progress="' + phase.id + '"]');
      if (badge) badge.textContent = s.done + '/' + s.total;
      var bar = document.querySelector('[data-phase-bar="' + phase.id + '"]');
      if (bar) bar.style.width = (s.total ? (s.done / s.total) * 100 : 0) + '%';
      var val = document.querySelector('[data-phase-bar-value="' + phase.id + '"]');
      if (val) val.textContent = s.done + '/' + s.total;
      refreshGateBadge(phase);
    });
  }

  function refreshGateBadge(phase) {
    if (!phase) return;
    var el = document.querySelector('[data-gate-count="' + phase.id + '"]');
    if (!el) return;
    var done = 0;
    for (var i = 1; i <= phase.gateItems; i += 1) if (isDone(phase.id + ':item:' + i)) done += 1;
    el.textContent = done + '/' + phase.gateItems;
  }

  function syncCheckboxes() {
    document.querySelectorAll('input[data-progress]').forEach(function (input) {
      input.checked = isDone(input.getAttribute('data-progress'));
    });
  }

  function syncDots() {
    document.querySelectorAll('[data-progress-dot]').forEach(function (el) {
      var key = 'module:' + el.getAttribute('data-progress-dot');
      el.classList.toggle('is-done', isDone(key));
    });
    document.querySelectorAll('[data-phase-module]').forEach(function (el) {
      el.classList.toggle('is-done', isDone('module:' + el.getAttribute('data-phase-module')));
    });
  }

  function syncAll(changedKey) {
    refreshGlobal();
    refreshPhaseBits();
    syncDots();
    if (changedKey) {
      var phaseId = String(changedKey).split(':')[0];
      if (/^phase-/.test(phaseId) && meta) {
        refreshGateBadge(meta.phases.filter(function (p) { return p.id === phaseId; })[0]);
      }
    }
  }

  document.addEventListener('change', function (event) {
    var input = event.target.closest('input[data-progress]');
    if (!input) return;
    setDone(input.getAttribute('data-progress'), input.checked);
  });

  /* ---------------------------------------------------------- 导入 / 导出 */

  function exportProgress() {
    var payload = { version: 1, exportedAt: new Date().toISOString(), done: state.done };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ai-infra-progress.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function importProgress(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(String(reader.result));
        var incoming = data.done || data;
        if (!incoming || typeof incoming !== 'object') throw new Error('格式不正确');
        Object.keys(incoming).forEach(function (key) {
          if (incoming[key]) state.done[key] = true;
        });
        saveState();
        syncCheckboxes();
        syncAll();
        toast('进度已导入');
      } catch (e) {
        toast('导入失败：' + e.message);
      }
    };
    reader.readAsText(file);
  }

  function toast(message) {
    var el = document.createElement('div');
    el.className = 'search-empty';
    el.textContent = message;
    el.style.cssText =
      'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:80;padding:10px 18px;' +
      'border:1px solid var(--border);border-radius:999px;background:var(--bg-elevated);box-shadow:var(--shadow);';
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 2200);
  }

  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-progress-export]')) exportProgress();
    if (event.target.closest('[data-progress-reset]')) {
      if (confirm('确定清空本机的全部学习进度？此操作不可撤销。')) {
        state = { done: {} };
        saveState();
        syncCheckboxes();
        syncAll();
        toast('进度已重置');
      }
    }
    if (event.target.closest('[data-progress-import]')) {
      var input = document.querySelector('[data-progress-file]');
      if (input) input.click();
    }
    if (event.target.closest('[data-copy-links]')) copyModuleLinks(event.target.closest('[data-copy-links]'));
    if (event.target.closest('[data-mini-progress]')) {
      if (!location.pathname.endsWith('index.html') && location.pathname !== '/' ) location.href = 'index.html';
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  document.addEventListener('change', function (event) {
    if (event.target.matches('[data-progress-file]') && event.target.files?.[0]) {
      importProgress(event.target.files[0]);
      event.target.value = '';
    }
  });

  function copyModuleLinks(button) {
    var links = Array.prototype.map
      .call(document.querySelectorAll('.cite-link'), function (a) { return a.href; })
      .join('\n');
    if (!links) return toast('本页没有可复制的链接');
    navigator.clipboard.writeText(links).then(
      function () { toast('已复制 ' + links.split('\n').length + ' 条链接'); },
      function () { toast('复制失败，请手动选择'); }
    );
  }

  /* ------------------------------------------------------------ 主题切换 */

  function applyTheme(theme) {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }

  document.addEventListener('click', function (event) {
    if (!event.target.closest('[data-theme-toggle]')) return;
    var current = document.documentElement.dataset.theme;
    var next = current === 'dark' ? 'light' : current === 'light' ? '' : 'dark';
    if (next) {
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    } else {
      applyTheme(null);
      try { localStorage.removeItem(THEME_KEY); } catch (e) {}
    }
  });

  /* ------------------------------------------------------------ 移动端导航 */

  var navToggle = document.querySelector('[data-nav-toggle]');
  if (navToggle) {
    navToggle.addEventListener('click', function () {
      var open = document.body.classList.toggle('nav-open');
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', function (event) {
      if (!document.body.classList.contains('nav-open')) return;
      if (event.target.closest('.sidebar') || event.target.closest('[data-nav-toggle]')) return;
      document.body.classList.remove('nav-open');
      navToggle.setAttribute('aria-expanded', 'false');
    });
  }

  /* ---------------------------------------------------------------- 搜索 */

  var dialog = document.querySelector('[data-search]');
  var input = document.querySelector('[data-search-input]');
  var resultsEl = document.querySelector('[data-search-results]');
  var filtersEl = document.querySelector('[data-search-filters]');
  var indexPromise = null;
  var activeFilter = 'all';
  var activeIndex = -1;
  var currentResults = [];

  function loadIndex() {
    indexPromise ??= fetch('assets/search-index.json', { cache: 'no-cache' })
      .then(function (r) { return r.json(); })
      .catch(function () { return []; });
    return indexPromise;
  }

  function openSearch() {
    if (!dialog) return;
    loadIndex();
    if (!dialog.open) dialog.showModal();
    setTimeout(function () { input.focus(); input.select(); }, 30);
  }

  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-search-open]')) {
      event.preventDefault();
      openSearch();
    }
    if (event.target === dialog) dialog.close();
  });

  document.addEventListener('keydown', function (event) {
    var isMac = /Mac|iPhone|iPad/.test(navigator.platform);
    if ((isMac ? event.metaKey : event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openSearch();
    }
    if (event.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName) && !dialog?.open) {
      event.preventDefault();
      openSearch();
    }
    if (dialog?.open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      moveActive(event.key === 'ArrowDown' ? 1 : -1);
    }
    if (dialog?.open && event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      var target = currentResults[activeIndex];
      if (target) location.href = target.href;
    }
  });

  function moveActive(delta) {
    if (!currentResults.length) return;
    activeIndex = (activeIndex + delta + currentResults.length) % currentResults.length;
    Array.prototype.forEach.call(resultsEl.children, function (li, i) {
      li.classList.toggle('is-active', i === activeIndex);
      if (i === activeIndex) li.scrollIntoView({ block: 'nearest' });
    });
  }

  var FILTERS = [
    { id: 'all', label: '全部' },
    { id: 'module', label: '模块' },
    { id: 'section', label: '章节' },
    { id: 'phase', label: '阶段' }
  ];

  function renderFilters() {
    if (!filtersEl || filtersEl.childElementCount) return;
    FILTERS.forEach(function (f) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = f.label;
      btn.dataset.filter = f.id;
      if (f.id === activeFilter) btn.classList.add('is-on');
      btn.addEventListener('click', function () {
        activeFilter = f.id;
        filtersEl.querySelectorAll('button').forEach(function (b) { b.classList.toggle('is-on', b === btn); });
        runSearch(input.value);
      });
      filtersEl.appendChild(btn);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function highlight(text, query) {
    var safe = escapeHtml(text);
    if (!query) return safe;
    var terms = query.split(/\s+/).filter(Boolean).map(function (t) {
      return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    });
    if (!terms.length) return safe;
    return safe.replace(new RegExp('(' + terms.join('|') + ')', 'gi'), '<mark>$1</mark>');
  }

  function score(item, q) {
    var title = item.title.toLowerCase();
    var text = (item.text || '').toLowerCase();
    var score = 0;
    if (title === q) score += 100;
    if (title.indexOf(q) === 0) score += 60;
    if (title.indexOf(q) > -1) score += 40;
    if (text.indexOf(q) > -1) score += 12;
    q.split(/\s+/).filter(Boolean).forEach(function (term) {
      if (title.indexOf(term) > -1) score += 18;
      if (text.indexOf(term) > -1) score += 6;
    });
    if (item.kind === 'module') score += 5;
    return score;
  }

  function runSearch(query) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) {
      currentResults = [];
      activeIndex = -1;
      resultsEl.innerHTML = '<li class="search-empty">输入关键词开始搜索：模块号、知识点、资料名都可以</li>';
      return;
    }
    loadIndex().then(function (index) {
      var hits = index
        .filter(function (item) { return activeFilter === 'all' || item.kind === activeFilter; })
        .map(function (item) { return { item: item, s: score(item, q) }; })
        .filter(function (x) { return x.s > 0; })
        .sort(function (a, b) { return b.s - a.s; })
        .slice(0, 40)
        .map(function (x) { return x.item; });

      currentResults = hits;
      activeIndex = hits.length ? 0 : -1;

      if (!hits.length) {
        resultsEl.innerHTML = '<li class="search-empty">没有匹配结果，试试更短的关键词</li>';
        return;
      }
      resultsEl.innerHTML = hits
        .map(function (item, i) {
          var kindLabel = item.kind === 'module' ? '模块' : item.kind === 'phase' ? '阶段' : '章节';
          var extra = item.kind === 'module' ? ' · ' + item.priority + ' · ' + item.hours + 'h' : '';
          return (
            '<li class="' + (i === 0 ? 'is-active' : '') + '"><a href="' + item.href + '">' +
            '<span class="sr-kind">' + kindLabel + extra + '</span><br/>' +
            highlight(item.title, q) +
            (item.text ? '<span class="sr-snip">' + highlight(item.text.slice(0, 110), q) + '…</span>' : '') +
            '</a></li>'
          );
        })
        .join('');
    });
  }

  if (input) {
    renderFilters();
    var debounce;
    input.addEventListener('input', function () {
      clearTimeout(debounce);
      debounce = setTimeout(function () { runSearch(input.value); }, 90);
    });
    runSearch('');
  }

  /* ------------------------------------------------------------- Mermaid */

  function initMermaid() {
    var blocks = document.querySelectorAll('.mermaid');
    if (!blocks.length) return;
    var script = document.createElement('script');
    script.src = 'assets/mermaid.min.js';
    script.onload = function () {
      if (!window.mermaid) return;
      var dark = document.documentElement.dataset.theme === 'dark' ||
        (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
      window.mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default', securityLevel: 'loose' });
      window.mermaid.run({ nodes: blocks }).catch(function () {});
    };
    document.head.appendChild(script);
  }

  /* ---------------------------------------------------------------- 启动 */

  function boot() {
    syncCheckboxes();
    metaPromise.then(function () {
      syncAll();
      var slot = document.querySelector('[data-progress-import-slot]');
      if (slot) {
        var label = document.createElement('label');
        label.className = 'btn btn--ghost';
        label.textContent = '导入进度 JSON';
        var file = document.createElement('input');
        file.type = 'file';
        file.accept = 'application/json';
        file.hidden = true;
        file.setAttribute('data-progress-file', '');
        label.appendChild(file);
        label.addEventListener('click', function (e) { e.preventDefault(); file.click(); });
        slot.appendChild(label);
      }
    });
    initMermaid();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
