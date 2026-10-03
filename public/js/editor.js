/* ShadowVeil — editor integration.
 *
 * Desktop: Monaco with transparent, page-matching backgrounds. Token colors
 * follow the VS Code default themes (Dark+ / Light+) — see DARK_RULES and
 * LIGHT_RULES below; scopes not listed fall back to editor.foreground.
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

  /* VS Code "Default Dark+" token palette. Monaco's monarch tokenizers
   * only emit the scopes below (verified for js/ts, python, shell), so
   * keywords keep the generic blue — the purple keyword.control of VS
   * Code's semantic layer is not distinguishable here. */
  var DARK_RULES = [
    { token: 'comment', foreground: '6A9955' },
    { token: 'string', foreground: 'CE9178' },
    { token: 'string.escape', foreground: 'D7BA7D' },
    { token: 'regexp', foreground: 'D16969' },
    { token: 'keyword', foreground: '569CD6' },
    { token: 'number', foreground: 'B5CEA8' },
    { token: 'type', foreground: '4EC9B0' },
    { token: 'type.identifier', foreground: '4EC9B0' },
    { token: 'identifier', foreground: '9CDCFE' },
    { token: 'variable', foreground: '9CDCFE' },
    { token: 'tag', foreground: 'DCDCAA' }, // python decorators
    { token: 'attribute.name', foreground: '9CDCFE' }, // shell flags
    { token: 'metatag', foreground: '569CD6' }, // shell shebang
    { token: 'delimiter', foreground: 'D4D4D4' },
  ];

  /* VS Code "Default Light+" token palette. */
  var LIGHT_RULES = [
    { token: 'comment', foreground: '008000' },
    { token: 'string', foreground: 'A31515' },
    { token: 'string.escape', foreground: 'EE0000' },
    { token: 'regexp', foreground: '811F3F' },
    { token: 'keyword', foreground: '0000FF' },
    { token: 'number', foreground: '098658' },
    { token: 'type', foreground: '267F99' },
    { token: 'type.identifier', foreground: '267F99' },
    { token: 'identifier', foreground: '001080' },
    { token: 'variable', foreground: '001080' },
    { token: 'tag', foreground: '795E26' }, // python decorators
    { token: 'attribute.name', foreground: '001080' }, // shell flags
    { token: 'metatag', foreground: '0000FF' }, // shell shebang
    { token: 'delimiter', foreground: '000000' },
  ];

  function defineThemes(monaco) {
    monaco.editor.defineTheme('shadowveil-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: DARK_RULES,
      colors: {
        'editor.background': '#00000000',
        'editor.foreground': '#D4D4D4',
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
        'editor.foreground': '#000000',
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
