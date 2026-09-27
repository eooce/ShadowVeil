/* ShadowVeil — API docs interactions: example tabs, copy buttons, anchor
 * highlighting and the API key manager card.
 */
(function () {
  'use strict';

  var $ = function (sel) { return document.querySelector(sel); };

  /* --------------------------------------------------- example tabs */

  document.querySelectorAll('.code-example[data-endpoint]').forEach(function (example) {
    var tabs = example.querySelectorAll('.example-tab');
    var codes = example.querySelectorAll('.code-block code[data-example]');

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var target = tab.dataset.example;
        tabs.forEach(function (t) {
          var active = t === tab;
          t.classList.toggle('is-active', active);
          t.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        codes.forEach(function (code) {
          code.hidden = code.dataset.example !== target;
        });
      });
    });
  });

  /* --------------------------------------------------- copy buttons */

  function currentApiKey() {
    try { return sessionStorage.getItem('sv-key') || ''; } catch (err) { return ''; }
  }

  function bindCopy(btn, getText) {
    btn.addEventListener('click', function () {
      var text = getText();
      if (!text) return;
      var done = function () {
        btn.textContent = '已复制 ✓';
        setTimeout(function () { btn.textContent = '复制'; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, done);
      } else {
        done();
      }
    });
  }

  document.querySelectorAll('.example-copy').forEach(function (btn) {
    var example = btn.closest('.code-example');
    bindCopy(btn, function () {
      var visible = example.querySelector('.code-block code:not([hidden])');
      var text = visible ? visible.textContent : '';
      var key = currentApiKey();
      if (key && text.indexOf('YOUR_API_KEY') !== -1) text = text.replaceAll('YOUR_API_KEY', key);
      return text;
    });
  });

  /* ------------------------------------------------- anchor highlighting */

  var navLinks = document.querySelectorAll('.docs-nav-link');
  var observed = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      navLinks.forEach(function (link) {
        var active = link.getAttribute('href') === '#' + entry.target.id;
        link.classList.toggle('is-active', active);
      });
    });
  }, { rootMargin: '0px 0px -72% 0px' });

  document.querySelectorAll('.doc-block[id]').forEach(function (block) {
    observed.observe(block);
  });

  /* --------------------------------------------------- key management */

  var form = $('#key-form');
  var resultBox = $('#key-result');
  var keyValue = $('#key-value');
  var keyMeta = $('#key-meta');
  var revealBtn = $('#key-reveal');
  var copyBtn = $('#key-copy');
  var eyeOn = revealBtn.querySelector('.icon-eye');
  var eyeOff = revealBtn.querySelector('.icon-eye-off');
  var realKey = '';
  var revealed = false;

  function renderKey() {
    keyValue.textContent = revealed ? realKey : realKey.slice(0, 8) + '·'.repeat(18) + realKey.slice(-4);
    keyValue.classList.toggle('masked', !revealed);
    eyeOn.hidden = revealed;
    eyeOff.hidden = !revealed;
    revealBtn.setAttribute('aria-pressed', revealed ? 'true' : 'false');
    revealBtn.setAttribute('aria-label', revealed ? '隐藏 Key' : '显示 Key');
  }

  try {
    var saved = sessionStorage.getItem('sv-key');
    if (saved) {
      realKey = saved;
      resultBox.hidden = false;
      var savedEmail = sessionStorage.getItem('sv-key-email') || '';
      var savedAt = Number(sessionStorage.getItem('sv-key-created') || 0);
      keyMeta.textContent = '本会话之前已生成 · ' + savedEmail + (savedAt ? ' · ' + new Date(savedAt * 1000).toLocaleString() : '');
      renderKey();
    }
  } catch (err) { /* private mode */ }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var input = $('#key-email');
    var email = input.value.trim();
    if (!email) return;

    var submit = $('#key-submit');
    submit.disabled = true;
    submit.querySelector('.btn-text').textContent = '生成中…';

    fetch('/api/v1/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email }),
    })
      .then(function (res) { return res.json(); })
      .then(function (body) {
        if (body.success) {
          realKey = body.data.key;
          revealed = false;
          resultBox.hidden = false;
          keyMeta.textContent = '邮箱 ' + body.data.email + ' · 每分钟 ' + body.data.perMinute + ' 次 · 每日 ' + body.data.dailyQuota + ' 次' +
            (body.data.existing ? ' · （该邮箱已存在，返回原 Key）' : '');
          renderKey();
          try {
            sessionStorage.setItem('sv-key', realKey);
            sessionStorage.setItem('sv-key-email', body.data.email);
            sessionStorage.setItem('sv-key-created', String(body.data.createdAt || 0));
          } catch (err) { /* private mode */ }
          SV.toast('success', 'API Key 已生成', '把它放进 X-API-Key 请求头即可开始调用。');
        } else {
          SV.toast('error', '生成失败（' + (body.error?.code ?? 'UNKNOWN') + '）', body.error?.message ?? '');
        }
      })
      .catch(function () {
        SV.toast('error', '网络错误', '无法连接到 ShadowVeil 服务。');
      })
      .finally(function () {
        submit.disabled = false;
        submit.querySelector('.btn-text').textContent = '生成 Key';
      });
  });

  revealBtn.addEventListener('click', function () {
    revealed = !revealed;
    renderKey();
  });

  copyBtn.addEventListener('click', function () {
    if (!realKey) return;
    var finish = function () { SV.toast('success', '已复制', 'API Key 已复制到剪贴板，注意保管。'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(realKey).then(finish, finish);
    } else {
      finish();
    }
  });
})();
