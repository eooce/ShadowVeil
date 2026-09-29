/**
 * Per-language obfuscation level metadata and JS engine presets.
 *
 * - JavaScript: three levels (light / standard / max), default `standard`,
 *   mirroring the classic js-obfuscator online presets.
 * - Python: two levels (light / high), default `high`.
 *   `light` ships the source untouched inside a single zlib + base64
 *   self-extracting shell (maximum compatibility); `high` runs the lexical
 *   obfuscator first, then applies two shells. Any other value maps to
 *   `high`, so legacy single-mode requests keep their old behavior.
 * - Shell: two levels (base64 / high), default `base64`.
 *   Legacy API values map: light|standard -> base64, max -> high.
 */

export const LANGUAGES = {
  javascript: {
    id: 'javascript',
    label: 'JavaScript',
    monaco: 'javascript',
    extension: 'js',
    mime: 'text/javascript',
    levels: [
      { id: 'light', label: '轻' },
      { id: 'standard', label: '中' },
      { id: 'max', label: '高' },
    ],
    defaultLevel: 'standard',
    levelNote: '参考 js-obfuscator 在线预设：轻 = 结构压缩与十六进制标识符；中 = 字符串加密 + 控制流扁平化；高 = 全量混淆（性能开销大）。',
  },
  python: {
    id: 'python',
    label: 'Python',
    monaco: 'python',
    extension: 'py',
    mime: 'text/x-python',
    levels: [
      { id: 'light', label: '轻' },
      { id: 'high', label: '高' },
    ],
    defaultLevel: 'high',
    levelNote: '轻 = 仅压缩打包（zlib + base64 自解压外壳，源码不改写，兼容性最好）；高 = 词法混淆（重命名 / 字符串加密 / 数字混淆）+ 多层自解压外壳。',
  },
  shell: {
    id: 'shell',
    label: 'Shell',
    monaco: 'shell',
    extension: 'sh',
    mime: 'text/x-sh',
    levels: [
      { id: 'base64', label: '默认' },
      { id: 'high', label: '高' },
    ],
    defaultLevel: 'base64',
    levelNote: '默认 = base64 编码经 base64 -d | bash 执行；高 = bashfuscator 风格多层变换（base64 + 字符替换 + 八进制 printf + 变量拼接 eval）。',
  },
};

/** Legacy level values accepted by the API, mapped per language. */
export const LEGACY_LEVEL_MAP = {
  shell: { light: 'base64', standard: 'base64', max: 'high' },
};

/** javascript-obfuscator option presets per level. */
export const JS_PRESETS = {
  light: {
    compact: true,
    simplify: true,
    identifierNamesGenerator: 'hexadecimal',
  },
  standard: {
    compact: true,
    simplify: true,
    identifierNamesGenerator: 'hexadecimal',
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 1,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.5,
    deadCodeInjection: false,
    selfDefending: true,
  },
  max: {
    compact: true,
    simplify: true,
    identifierNamesGenerator: 'hexadecimal',
    stringArray: true,
    stringArrayEncoding: ['rc4'],
    stringArrayThreshold: 1,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 1,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.4,
    splitStrings: true,
    splitStringsChunkLength: 5,
    numbersToExpressions: true,
    selfDefending: true,
    debugProtection: true,
    disableConsoleOutput: true,
  },
};

/** Advanced option switches accepted (and sanitized) on the API. */
export const JS_OPTION_KEYS = [
  'selfDefending',
  'debugProtection',
  'controlFlowFlattening',
  'deadCodeInjection',
  'stringArray',
];

/**
 * Map an API level value onto the engine level for a language.
 * @param {'javascript'|'python'|'shell'} language
 * @param {string|undefined} level raw level from the request
 */
export function normalizeLevel(language, level) {
  if (language === 'python') {
    return level === 'light' ? 'light' : 'high';
  }
  if (language === 'shell') {
    if (level === 'high' || level === 'max') return 'high';
    return 'base64';
  }
  return ['light', 'standard', 'max'].includes(level) ? level : 'standard';
}
