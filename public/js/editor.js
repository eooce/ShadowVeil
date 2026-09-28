/* ShadowVeil — editor integration.
 *
 * Desktop: Monaco with transparent, page-matching themes.
 * Mobile (coarse pointer / narrow viewport): native <textarea> adapters —
 * Monaco's touch support is unreliable on phones, while a native textarea
 * gets the system keyboard and proper input UX for free. Both modes expose
 * the same SV.editors interface (getValue/setValue/focus/...).
 */
(function () {
  'use strict';

  window.SV = window.SV || {};
  SV.editors = { input: null, output: null };
  SV.editorReady = new Promise((resolve) => { SV._resolveEditorReady = resolve; });

  var MONACO_CDN = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs';

  /* -------------------------------------------------- shared placeholder */

  function placeholderEl() { return document.getElementById('input-placeholder'); }

  function updatePlaceholder() {
    var ph = placeholderEl();
    if (!ph || !SV.editors.input) return;
    var empty = SV.editors.input.getValue().length === 0;
    ph.style.display = empty ? 'block' : 'none';
  }

  function setInputPlaceholderText(text) {
    var ph = placeholderEl();
    if (ph) ph.textContent = text;
    updatePlaceholder();
  }

  /* --------------------------------------------------------- mobile mode */

  var useTextarea =
    window.matchMedia('(pointer: coarse)').matches ||
    window.innerWidth < 768;

  function setupMobileEditors() {
    document.body.classList.add('mobile-editors');
    var inputTa = document.getElementById('input-textarea');
    var outputTa = document.getElementById('output-textarea');
    inputTa.hidden = false;
    outputTa.hidden = false;

    var listeners = [];
    function fire() {
      updatePlaceholder();
      listeners.forEach(function (fn) { fn(); });
    }
    inputTa.addEventListener('input', fire);

    SV.editors.input = {
      getValue: function () { return inputTa.value; },
      setValue: function (v) { inputTa.value = v; fire(); },
      focus: function () { inputTa.focus(); },
      layout: function () {},
      addCommand: function () {},
      onDidChangeModelContent: function (fn) { listeners.push(fn); },
    };
    SV.editors.output = {
      getValue: function () { return outputTa.value; },
      setValue: function (v) { outputTa.value = v; },
      focus: function () { outputTa.focus(); },
      layout: function () {},
      addCommand: function () {},
      onDidChangeModelContent: function () {},
    };

    SV.setEditorLanguage = function () {};   // textarea has no language mode
    SV.setMonacoTheme = function () {};      // theme is CSS-driven
    SV.setInputPlaceholder = setInputPlaceholderText;
    updatePlaceholder();
    SV._resolveEditorReady();
  }

  /* --------------------------------------------------------- desktop mode */

  var DARK_RULES = [
    { token: 'comment', foreground: '6B7C72', fontStyle: 'italic' },
    { token: 'keyword', foreground: '98E0B4' },
    { token: 'string', foreground: '8ED0D4' },
    { token: 'string.escape', foreground: 'C0EAD2' },
    { token: 'number', foreground: 'A8DDBC' },
    { token: 'regexp', foreground: 'A8DDBC' },
    { token: 'type', foreground: '7CC5C9' },
    { token: 'identifier', foreground: 'E8F0EA' },
    { token: 'delimiter', foreground: '93A69A' },
    { token: 'operator', foreground: '9FD0B8' },
  ];

  var LIGHT_RULES = [
    { token: 'comment', foreground: '8A9A8F', fontStyle: 'italic' },
    { token: 'keyword', foreground: '2F7A50' },
    { token: 'string', foreground: '35909A' },
    { token: 'number', foreground: '3E8E68' },
    { token: 'type', foreground: '3FA0A8' },
    { token: 'operator', foreground: '4E8966' },
  ];

  function defineThemes(monaco) {
    monaco.editor.defineTheme('shadowveil-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: DARK_RULES,
      colors: {
        'editor.background': '#00000000',
        'editor.foreground': '#E8F0EA',
        'editorLineNumber.foreground': '#3E5046',
        'editorLineNumber.activeForeground': '#8A9A8F',
        'editorCursor.foreground': '#8FD8A8',
        'editor.selectionBackground': '#4E896638',
        'editor.inactiveSelectionBackground': '#4E896620',
        'editor.lineHighlightBackground': '#00000000',
        'editor.lineHighlightBorder': '#00000000',
        'editorIndentGuide.background1': '#FFFFFF0A',
        'editorIndentGuide.activeBackground1': '#FFFFFF1E',
        'editorWidget.background': '#121A15',
        'editorWidget.border': '#FFFFFF14',
        'scrollbarSlider.background': '#FFFFFF14',
        'scrollbarSlider.hoverBackground': '#FFFFFF2A',
        'scrollbarSlider.activeBackground': '#FFFFFF3A',
      },
    });

    monaco.editor.defineTheme('shadowveil-light', {
      base: 'vs',
      inherit: true,
      rules: LIGHT_RULES,
      colors: {
        'editor.background': '#00000000',
        'editor.foreground': '#26302A',
        'editorLineNumber.foreground': '#B9C4BB',
        'editorCursor.foreground': '#3F7A59',
        'editor.selectionBackground': '#4E896626',
        'editor.lineHighlightBackground': '#00000000',
        'editor.lineHighlightBorder': '#00000000',
        'editorWidget.background': '#FFFFFF',
        'editorWidget.border': '#E3E8E2',
        'scrollbarSlider.background': '#2D504218',
        'scrollbarSlider.hoverBackground': '#2D50422E',
      },
    });
  }

  function commonOptions(readonly) {
    return {
      value: '',
      minimap: { enabled: false },
      fontSize: 13.5,
      lineHeight: 21,
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      fontLigatures: true,
      wordWrap: 'on',
      automaticLayout: true,
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      renderLineHighlight: 'none',
      lineNumbersMinChars: 2,
      lineDecorationsWidth: 2,
      glyphMargin: false,
      cursorBlinking: 'phase',
      cursorSmoothCaretAnimation: 'on',
      padding: { top: 14, bottom: 14 },
      scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      overviewRulerBorder: false,
      bracketPairColorization: { enabled: true },
      guides: { indentation: true },
      stickyScroll: { enabled: false },
      readOnly: readonly,
      renderWhitespace: 'none',
      tabSize: 2,
      theme: document.documentElement.dataset.theme === 'light' ? 'shadowveil-light' : 'shadowveil-dark',
    };
  }

  require.config({ paths: { vs: MONACO_CDN } });

  if (useTextarea) {
    // Mobile: skip Monaco entirely — native textareas are already set up.
    setupMobileEditors();
    return;
  }

  require(['vs/editor/editor.main'], function () {
    defineThemes(monaco);

    SV.editors.input = monaco.editor.create(document.getElementById('input-editor'), Object.assign(commonOptions(false), {
      language: 'javascript',
      value: '',
    }));

    SV.editors.output = monaco.editor.create(document.getElementById('output-editor'), Object.assign(commonOptions(true), {
      language: 'javascript',
      value: '',
    }));

    // Ghost placeholder overlay: shown while the input is empty. It is never
    // real content, so nothing has to be deleted before pasting.
    SV.editors.input.onDidChangeModelContent(updatePlaceholder);
    SV.editors.input.onDidLayoutChange(function () {
      var ph = placeholderEl();
      if (ph && ph.style.display !== 'none') {
        ph.style.paddingLeft = SV.editors.input.getLayoutInfo().contentLeft + 'px';
      }
    });
    SV.setInputPlaceholder = setInputPlaceholderText;
    updatePlaceholder();

    // Ctrl/Cmd + Enter runs the obfuscation from inside either editor.
    var runShortcut = monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter;
    SV.editors.input.addCommand(runShortcut, function () { SV.requestObfuscate && SV.requestObfuscate(); });
    SV.editors.output.addCommand(runShortcut, function () { SV.requestObfuscate && SV.requestObfuscate(); });

    SV.setEditorLanguage = function (lang) {
      monaco.editor.setModelLanguage(SV.editors.input.getModel(), lang);
      monaco.editor.setModelLanguage(SV.editors.output.getModel(), lang);
    };

    SV.setMonacoTheme = function (themeName) {
      monaco.editor.setTheme(themeName);
    };

    SV._resolveEditorReady();
  });

  if (useTextarea) setupMobileEditors();
})();
