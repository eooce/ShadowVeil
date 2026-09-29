/* ShadowVeil — main page logic.
 * Loaded on every page: toasts + theme switch live everywhere; the
 * obfuscation workspace logic only activates on the home page.
 *
 * Levels are per-language (from LANGS metadata):
 *   JavaScript: light / standard (default) / max
 *   Python:     light (compress-only) / high (default)
 *   Shell:      base64 (default) / high
 */
(function () {
  'use strict';

  window.SV = window.SV || {};

  var LANGS = {
    javascript: {
      label: 'JavaScript',
      monaco: 'javascript',
      ext: 'js',
      file: 'input.js',
      out: 'output.js · 混淆结果',
      levels: [
        { id: 'light', label: '轻' },
        { id: 'standard', label: '中' },
        { id: 'max', label: '高' },
      ],
      defaultLevel: 'standard',
      levelNote: '',
    },
    python: {
      label: 'Python',
      monaco: 'python',
      ext: 'py',
      file: 'input.py',
      out: 'output.py · 混淆结果',
      levels: [
        { id: 'light', label: '轻' },
        { id: 'high', label: '高' },
      ],
      defaultLevel: 'high',
      levelNote: '',
    },
    shell: {
      label: 'Shell',
      monaco: 'shell',
      ext: 'sh',
      file: 'input.sh',
      out: 'output.sh · 混淆结果',
      levels: [
        { id: 'base64', label: '默认' },
        { id: 'high', label: '高' },
      ],
      defaultLevel: 'base64',
      levelNote: '',
    },
  };

  var SAMPLES = {
    javascript: [
      '// 欢迎使用 ShadowVeil —— 让代码隐入暗影',
      '// 粘贴你的 JavaScript / Python / Shell，按 Ctrl+Enter 开始混淆',
      '',
      'function greet(name) {',
      '  const message = "Hello, " + name + "!";',
      '  const secret = "s3cr3t-t0k3n";',
      '  if (name !== "admin") {',
      '    console.log(message, secret);',
      '  }',
      '  return secret;',
      '}',
      '',
      'greet("world");',
    ].join('\n'),
    python: [
      '#!/usr/bin/env python3',
      '# -*- coding: utf-8 -*-',
      'import os',
      '',
      '',
      'class Vault:',
      '    """存储密钥的保险库。"""',
      '',
      '    def __init__(self, master_key, retries=3):',
      '        self.master_key = master_key',
      '        self.retries = retries',
      '        self._cache = {}',
      '',
      '    def unlock(self, token):',
      '        # 比对令牌后解锁',
      '        if token == self.master_key:',
      '            return f"unlocked with {self.retries} retries"',
      '        return None',
      '',
      '',
      'vault = Vault(master_key="hunter2")',
      'print(vault.unlock("hunter2"))',
      'print(f"home={os.getcwd()}")',
    ].join('\n'),
    shell: [
      '#!/bin/bash',
      '# 简单的部署脚本',
      'TARGET_DIR="/opt/app"',
      'BACKUP_COUNT=3',
      'log_tag="deploy"',
      '',
      'echo "[$log_tag] deploying to $TARGET_DIR"',
      'mkdir -p "$TARGET_DIR"',
      '',
      'for item in config assets index.html; do',
      '    echo "[$log_tag] copying $item"',
      'done',
      '',
      'echo "[$log_tag] done, backups=$BACKUP_COUNT, host=${HOSTNAME:-unknown}"',
    ].join('\n'),
  };

  var $ = function (sel) { return document.querySelector(sel); };
  var onWorkspace = Boolean(document.getElementById('obfuscate-btn'));

  var state = onWorkspace
    ? {
        lang: 'javascript',
        levels: { javascript: 'standard', python: 'high', shell: 'base64' },
        busy: false,
        lastResult: null,
      }
    : null;

  /* ------------------------------------------------------------ toast */

  var TOAST_ICONS = {
    success: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
    error: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    info: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M12 8h.01M12 12v4"/></svg>',
  };

  SV.toast = function (type, title, msg, timeout) {
    var container = $('#toast-container');
    if (!container) return;
    var el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML =
      '<span class="toast-icon">' + (TOAST_ICONS[type] || TOAST_ICONS.info) + '</span>' +
      '<span class="toast-body"><span class="toast-title"></span><span class="toast-msg"></span></span>';
    el.querySelector('.toast-title').textContent = title;
    el.querySelector('.toast-msg').textContent = msg || '';
    var dismiss = function () {
      el.classList.add('leaving');
      setTimeout(function () { el.remove(); }, 240);
    };
    el.addEventListener('click', dismiss);
    container.appendChild(el);
    setTimeout(dismiss, timeout || (type === 'error' ? 5200 : 3400));
  };

  /* ------------------------------------------------------ theme (all pages) */

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    if (SV.setMonacoTheme) SV.setMonacoTheme(theme === 'light' ? 'shadowveil-light' : 'shadowveil-dark');
    try { localStorage.setItem('sv-theme', theme); } catch (err) { /* private mode */ }
  }

  var themeToggle = $('#theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', function () {
      applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
    });
  }

  (function initTheme() {
    var saved = 'dark';
    try { saved = localStorage.getItem('sv-theme') || 'dark'; } catch (err) { /* private mode */ }
    document.documentElement.dataset.theme = saved;
  })();

  if (!onWorkspace) {
    // staggered hero entrance on the sub pages too
    document.querySelectorAll('.reveal').forEach(function (el, index) {
      el.style.setProperty('--reveal-delay', Math.min(index * 60, 240) + 'ms');
    });
    return;
  }

  /* --------------------------------------------------- URL query sync */

  function readUrlState() {
    var params = new URLSearchParams(location.search);
    var lang = params.get('lang');
    if (LANGS[lang]) state.lang = lang;
    Object.keys(LANGS).forEach(function (langId) {
      var meta = LANGS[langId];
      if (meta.levels.length === 0) return;
      var raw = params.get('level');
      var valid = meta.levels.some(function (lvl) { return lvl.id === raw; });
      state.levels[langId] = valid ? raw : meta.defaultLevel;
    });
  }

  function writeUrlState() {
    var params = new URLSearchParams();
    params.set('lang', state.lang);
    var meta = LANGS[state.lang];
    if (meta.levels.length > 0) params.set('level', state.levels[state.lang]);
    var query = params.toString();
    history.replaceState(null, '', location.pathname + (query ? '?' + query : '') + location.hash);
  }

  /* ------------------------------------------------------ UI rendering */

  function renderSegments() {
    var buttons = document.querySelectorAll('.segment');
    var activeBtn = null;
    buttons.forEach(function (btn) {
      var active = btn.dataset.lang === state.lang;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      if (active) activeBtn = btn;
    });
    if (activeBtn) {
      var slider = activeBtn.parentElement.querySelector('.segmented-slider');
      slider.style.width = activeBtn.offsetWidth + 'px';
      slider.style.transform = 'translateX(' + (activeBtn.offsetLeft - 4) + 'px)';
    }
  }

  function renderLevel() {
    var meta = LANGS[state.lang];
    var control = $('#level-control');
    var note = $('#level-note');
    var slider = $('#level-slider');
    var marks = $('#level-marks');

    if (meta.levels.length === 0) {
      control.hidden = true;
      note.hidden = false;
      note.innerHTML = '<span class="note-dot"></span>' + meta.levelNote;
      return;
    }

    control.hidden = false;
    note.hidden = true;

    var current = meta.levels.indexOf(meta.levels.find(function (lvl) { return lvl.id === state.levels[state.lang]; }));
    slider.max = String(meta.levels.length - 1);
    slider.value = String(Math.max(0, current));
    slider.setAttribute('aria-label', '混淆等级：' + meta.levels.map(function (l) { return l.label; }).join(' / '));
    slider.style.setProperty('--fill', (current / (meta.levels.length - 1)) * 100 + '%');

    marks.innerHTML = meta.levels
      .map(function (lvl) { return '<span data-level="' + lvl.id + '">' + lvl.label + '</span>'; })
      .join('');
    marks.querySelectorAll('span').forEach(function (mark) {
      mark.classList.toggle('is-active', mark.dataset.level === state.levels[state.lang]);
    });
  }

  var editorContents = {}; // lang -> last content typed by the user
  var editorNames = {};    // lang -> uploaded file name (if any)

  function setInputContent(lang, content) {
    editorContents[lang] = content;
    if (SV.editors.input) SV.editors.input.setValue(content);
  }

  /**
   * Content-based language detection (shebang first, then scoring).
   * Returns 'javascript' | 'python' | 'shell' | null when undecided.
   */
  function detectLanguage(code) {
    if (!code || !code.trim()) return null;
    var shebang = code.match(/^#![^\n]*/m);
    if (shebang) {
      if (/python/i.test(shebang[0])) return 'python';
      if (/\b(ba|z|k|da)?sh\b/i.test(shebang[0])) return 'shell';
      if (/node/i.test(shebang[0])) return 'javascript';
    }
    var scores = { javascript: 0, python: 0, shell: 0 };
    if (/^\s*def\s+\w+\s*\(/m.test(code)) scores.python += 3;
    if (/^\s*(import|from)\s+\w+/m.test(code)) scores.python += 2;
    if (/:\s*$/m.test(code)) scores.python += 1;
    if (/\bprint\s*\(/.test(code) && !/console\.log/.test(code)) scores.python += 1;
    if (/\b(function\s+\w*\s*\(|const\s|let\s|var\s)\w*/m.test(code)) scores.javascript += 3;
    if (/=>|console\.log|module\.exports|\brequire\(/.test(code)) scores.javascript += 2;
    if (/^\s*(fi|done|esac)\s*$/m.test(code)) scores.shell += 3;
    if (/^\s*(echo|cd|export|source|mkdir|rm|apt|wget|curl|pip|npm)\s/m.test(code)) scores.shell += 2;
    if (/\$\{?\w+\}|\$\(|\bgrep\b|\bawk\b|\bsed\b/.test(code)) scores.shell += 1;
    var best = null;
    var bestScore = 0;
    for (var lang in scores) {
      if (scores[lang] > bestScore) { best = lang; bestScore = scores[lang]; }
    }
    return best;
  }

  /**
   * Silent language switch for auto-detection: keeps the editor content,
   * refreshes tab slider, level control, Monaco language and titles.
   */
  function switchLanguageOnly(lang) {
    if (applyLanguage.lastLang && applyLanguage.lastLang !== lang) {
      editorContents[applyLanguage.lastLang] = SV.editors.input.getValue();
    }
    state.lang = lang;
    SV.setEditorLanguage(LANGS[lang].monaco);
    applyLanguage.lastLang = lang;
    $('#input-filename').textContent = editorNames[lang] || LANGS[lang].file;
    $('#output-filename').textContent = LANGS[lang].out;
    renderSegments();
    renderLevel();
    writeUrlState();
  }

  function applyLanguage() {
    var lang = LANGS[state.lang];
    $('#input-filename').textContent = editorNames[state.lang] || lang.file;
    $('#output-filename').textContent = lang.out;
    if (SV.editors.input && SV.setEditorLanguage) {
      if (applyLanguage.lastLang && applyLanguage.lastLang !== state.lang) {
        editorContents[applyLanguage.lastLang] = SV.editors.input.getValue();
      }
      SV.editors.input.setValue(editorContents[state.lang] ?? '');
      SV.setEditorLanguage(lang.monaco);
      applyLanguage.lastLang = state.lang;
      // faint sample shown while the pane is empty (overlay, not content)
      if (SV.setInputPlaceholder) SV.setInputPlaceholder(SAMPLES[state.lang]);
    }
    renderLevel();
    clearResult();
  }

  function clearResult() {
    state.lastResult = null;
    if (SV.editors.output) SV.editors.output.setValue('');
    $('#result-actions').hidden = true;
    $('#stats-bar').hidden = true;
  }

  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  function renderStats(stats) {
    $('#stat-original').textContent = formatBytes(stats.originalSize);
    $('#stat-output').textContent = formatBytes(stats.outputSize);
    var ratioBadge = $('#stat-ratio-badge');
    $('#stat-ratio').textContent = '×' + stats.ratio.toFixed(2) + (stats.ratio > 1 ? '（更大）' : '（更小）');
    ratioBadge.classList.toggle('bad', stats.ratio > 3);
    $('#stat-duration').textContent = stats.duration + ' ms';
    $('#stats-bar').hidden = false;
  }

  /* -------------------------------------------------------- obfuscate */

  SV.requestObfuscate = function () {
    var btn = $('#obfuscate-btn');
    if (state.busy) return;
    var code = SV.editors.input ? SV.editors.input.getValue() : '';
    if (!code.trim()) {
      SV.toast('info', '没有可混淆的代码', '请先粘贴或输入源代码。');
      return;
    }

    // 自动语言识别：内容与所选语言不一致时静默切换（编辑器内容保持不变）
    var detected = detectLanguage(code);
    if (detected && detected !== state.lang) {
      switchLanguageOnly(detected);
      SV.toast('info', '已自动识别语言', '内容更符合 ' + LANGS[detected].label + '，已自动切换。');
    }

    state.busy = true;
    btn.classList.add('loading');
    btn.setAttribute('aria-busy', 'true');
    $('#progress-track').classList.add('active');

    var meta = LANGS[state.lang];
    var payload = {
      language: state.lang,
      code: code,
    };
    if (meta.levels.length > 0) payload.level = state.levels[state.lang];

    fetch('/api/v1/obfuscate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        return res.json().then(function (body) { return { ok: res.ok, status: res.status, body: body }; });
      })
      .then(function (res) {
        if (res.ok && res.body.success) {
          showResult(res.body.data);
          SV.toast('success', '混淆完成', '耗时 ' + res.body.data.stats.duration + ' ms，快复制结果吧。');
        } else {
          var err = res.body.error || { code: 'UNKNOWN', message: '未知错误' };
          if (err.code === 'RATE_LIMITED') {
            SV.toast('error', '请求太频繁', err.message);
          } else if (err.code === 'INVALID_SYNTAX') {
            SV.toast('error', '语法错误', err.message);
          } else {
            SV.toast('error', '混淆失败（' + err.code + '）', err.message);
          }
        }
      })
      .catch(function () {
        SV.toast('error', '网络错误', '无法连接到 ShadowVeil 服务，请稍后重试。');
      })
      .finally(function () {
        state.busy = false;
        btn.classList.remove('loading');
        btn.removeAttribute('aria-busy');
        $('#progress-track').classList.remove('active');
      });
  };

  function showResult(data) {
    state.lastResult = data;
    SV.editors.output.setValue(data.code);
    renderStats(data.stats);
    $('#result-actions').hidden = false;
    var pane = document.querySelector('.pane-output');
    pane.classList.remove('reveal-result');
    void pane.offsetWidth;
    pane.classList.add('reveal-result');
    var editors = $('#editors');
    if (window.innerWidth < 768) {
      editors.classList.add('mobile-show-output');
      document.querySelectorAll('.mobile-tab').forEach(function (tab) {
        var active = tab.dataset.pane === 'output';
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    }
  }

  /* ------------------------------------------------------ result ops */

  function copyText(text, okMsg) {
    var done = function () { SV.toast('success', '已复制', okMsg); };
    var fail = function () { SV.toast('error', '复制失败', '请手动选择并复制。'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text) ? done() : fail(); });
    } else {
      legacyCopy(text) ? done() : fail();
    }
  }

  function legacyCopy(text) {
    try {
      var area = document.createElement('textarea');
      area.value = text;
      area.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.appendChild(area);
      area.select();
      var ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch (err) {
      return false;
    }
  }

  $('#copy-btn').addEventListener('click', function () {
    if (state.lastResult) copyText(state.lastResult.code, '混淆结果已复制到剪贴板。');
  });

  $('#download-btn').addEventListener('click', function () {
    if (!state.lastResult) return;
    var blob = new Blob([state.lastResult.code], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'obfuscated.' + LANGS[state.lang].ext;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    SV.toast('success', '开始下载', 'obfuscated.' + LANGS[state.lang].ext);
  });

  $('#fullscreen-btn').addEventListener('click', function () {
    $('#editors').classList.add('fullscreen-mode');
    $('#fullscreen-btn').hidden = true;
    $('#exit-fullscreen-btn').hidden = false;
  });

  $('#exit-fullscreen-btn').addEventListener('click', exitFullscreen);

  function exitFullscreen() {
    $('#editors').classList.remove('fullscreen-mode');
    $('#fullscreen-btn').hidden = false;
    $('#exit-fullscreen-btn').hidden = true;
  }

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') exitFullscreen();
  });

  $('#clear-input-btn').addEventListener('click', function () {
    setInputContent(state.lang, '');
    delete editorNames[state.lang];
    $('#input-filename').textContent = LANGS[state.lang].file;
    clearResult();
    SV.toast('info', '已清空', '输入与结果都已移除。');
  });

  $('#sample-btn').addEventListener('click', function () {
    setInputContent(state.lang, SAMPLES[state.lang]);
    delete editorNames[state.lang];
    $('#input-filename').textContent = LANGS[state.lang].file;
    clearResult();
    SV.toast('info', '示例已载入', LANGS[state.lang].label + ' 示例代码已就绪。');
  });

  /* ---------------------------------------------------- file upload
   * 只在浏览器里读取文件内容填入编辑器——不经过服务端、不做任何持久化。
   * 支持点击上传按钮和直接拖拽到输入区。
   */

  var MAX_FILE_BYTES = 200 * 1024; // 与服务端 200KB 限制一致

  function loadFile(file) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      SV.toast('error', '文件太大', (file.size / 1024).toFixed(1) + ' KB 超过了 200KB 的混淆上限。');
      return;
    }
    file.text().then(function (text) {
      if (text.indexOf('\u0000') !== -1) {
        SV.toast('error', '无法读取', '这似乎是二进制文件，请上传文本格式的源代码。');
        return;
      }
      // 语言自动识别：扩展名优先，其次按内容判定；不同则静默切换
      var ext = (file.name.split('.').pop() || '').toLowerCase();
      var extLang = { js: 'javascript', mjs: 'javascript', cjs: 'javascript', py: 'python', sh: 'shell', bash: 'shell', zsh: 'shell', ksh: 'shell' };
      var detected = extLang[ext] || detectLanguage(text) || state.lang;
      editorNames[state.lang] = undefined;
      if (detected !== state.lang) {
        state.lang = detected;
        SV.setEditorLanguage(LANGS[detected].monaco);
        applyLanguage.lastLang = detected;
        renderSegments();
        renderLevel();
      }
      editorContents[detected] = text;
      editorNames[detected] = file.name;
      SV.editors.input.setValue(text);
      $('#input-filename').textContent = file.name;
      $('#output-filename').textContent = LANGS[detected].out;
      clearResult();
      SV.toast('success', '文件已读取', file.name + ' · ' + (file.size / 1024).toFixed(1) + ' KB（仅读取，未保存）');
    }, function () {
      SV.toast('error', '读取失败', '无法读取该文件的内容。');
    });
  }

  $('#upload-btn').addEventListener('click', function () {
    $('#file-input').click();
  });

  $('#file-input').addEventListener('change', function () {
    loadFile(this.files && this.files[0]);
    this.value = ''; // 允许连续选择同一个文件
  });

  // 拖拽上传
  (function initDragDrop() {
    var shell = $('#input-shell');
    var dragDepth = 0;
    shell.addEventListener('dragenter', function (event) {
      event.preventDefault();
      dragDepth++;
      shell.classList.add('dragover');
    });
    shell.addEventListener('dragover', function (event) {
      event.preventDefault();
    });
    shell.addEventListener('dragleave', function () {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) shell.classList.remove('dragover');
    });
    shell.addEventListener('drop', function (event) {
      event.preventDefault();
      dragDepth = 0;
      shell.classList.remove('dragover');
      loadFile(event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]);
    });
  })();

  /* ------------------------------------------------------ interactions */

  document.querySelectorAll('.segment').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (state.lang === btn.dataset.lang) return;
      state.lang = btn.dataset.lang;
      renderSegments();
      applyLanguage();
      writeUrlState();
    });
  });

  $('#level-slider').addEventListener('input', function (event) {
    var meta = LANGS[state.lang];
    var level = meta.levels[Number(event.target.value)];
    if (level) {
      state.levels[state.lang] = level.id;
      renderLevel();
      writeUrlState();
    }
  });

  $('#obfuscate-btn').addEventListener('click', SV.requestObfuscate);

  document.addEventListener('keydown', function (event) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      SV.requestObfuscate();
    }
  });

  // draggable divider
  (function initDivider() {
    var divider = $('#divider');
    var editors = $('#editors');
    var dragging = false;

    divider.addEventListener('pointerdown', function (event) {
      dragging = true;
      divider.classList.add('dragging');
      divider.setPointerCapture(event.pointerId);
      document.body.style.userSelect = 'none';
    });

    divider.addEventListener('pointermove', function (event) {
      if (!dragging) return;
      var rect = editors.getBoundingClientRect();
      var ratio = (event.clientX - rect.left) / rect.width;
      ratio = Math.min(0.8, Math.max(0.2, ratio));
      editors.style.setProperty('--split', 'calc(' + (ratio * 100).toFixed(2) + '% - 3px)');
      editors.style.setProperty('--split-out', 'calc(' + ((1 - ratio) * 100).toFixed(2) + '% - 3px)');
    });

    var stop = function () {
      dragging = false;
      divider.classList.remove('dragging');
      document.body.style.userSelect = '';
    };
    divider.addEventListener('pointerup', stop);
    divider.addEventListener('pointercancel', stop);
  })();

  // mobile pane tabs
  document.querySelectorAll('.mobile-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      var showOutput = tab.dataset.pane === 'output';
      $('#editors').classList.toggle('mobile-show-output', showOutput);
      document.querySelectorAll('.mobile-tab').forEach(function (t) {
        var active = t.dataset.pane === tab.dataset.pane;
        t.classList.toggle('is-active', active);
        t.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    });
  });

  /* -------------------------------------------------------------- init */

  readUrlState();
  renderSegments();

  SV.editorReady.then(function () {
    applyLanguage();
    setTimeout(renderSegments, 60);
    window.addEventListener('resize', renderSegments);
  });

  document.querySelectorAll('.hero .reveal').forEach(function (el, index) {
    el.style.setProperty('--reveal-delay', index * 60 + 'ms');
  });
})();
