// 用根目录的 test.js / test.py / test.sh 验证三种语言混淆功能 + 自动语言识别
import { obfuscate } from '../src/core/index.js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve(import.meta.dirname, '..');

let failures = 0;
async function check(label, fn) {
  try {
    await fn();
    console.log(`  ok    ${label}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL  ${label}`);
    console.log(String(err?.message ?? err).split('\n').slice(0, 10).map((l) => '        ' + l).join('\n'));
  }
}

const write = (name, content) => {
  const file = path.join(os.tmpdir(), `sv-3lang-${name}`);
  fs.writeFileSync(file, content);
  return file;
};

console.log('== test.js (javascript) ==');
await check('test.js -> obfuscate + node --check', async () => {
  const src = fs.readFileSync(path.join(root, 'test.js'), 'utf8');
  const { code } = await obfuscate(src, 'javascript', 'standard');
  const file = write('test.obf.js', code);
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
});

console.log('== test.py (python) ==');
await check('test.py -> obfuscate + python compile', async () => {
  const src = fs.readFileSync(path.join(root, 'test.py'), 'utf8');
  const { code } = await obfuscate(src, 'python', undefined);
  const file = write('test.obf.py', code);
  execFileSync('python', ['-c', `compile(open(r'${file}', encoding='utf-8').read(), 'obf', 'exec')`], { stdio: 'pipe' });
  if (!code.includes('zlib')) throw new Error('missing exec wrapper');
});

console.log('== test.sh (shell) ==');
for (const mode of ['base64', 'high']) {
  await check(`test.sh -> obfuscate (${mode}) + bash -n`, async () => {
    const src = fs.readFileSync(path.join(root, 'test.sh'), 'utf8');
    const { code } = await obfuscate(src, 'shell', mode);
    const file = write(`test.obf.${mode}.sh`, code);
    execFileSync('bash', ['-n', file], { stdio: 'pipe' });
  });
}

console.log('== 自动语言识别（前端同款判定逻辑）==');
const detectLanguage = (code) => {
  if (!code || !code.trim()) return null;
  const shebang = code.match(/^#![^\n]*/m);
  if (shebang) {
    if (/python/i.test(shebang[0])) return 'python';
    if (/\b(ba|z|k|da)?sh\b/i.test(shebang[0])) return 'shell';
    if (/node/i.test(shebang[0])) return 'javascript';
  }
  const scores = { javascript: 0, python: 0, shell: 0 };
  if (/^\s*def\s+\w+\s*\(/m.test(code)) scores.python += 3;
  if (/^\s*(import|from)\s+\w+/m.test(code)) scores.python += 2;
  if (/:\s*$/m.test(code)) scores.python += 1;
  if (/\bprint\s*\(/.test(code) && !/console\.log/.test(code)) scores.python += 1;
  if (/\b(function\s+\w*\s*\(|const\s|let\s|var\s)\w*/m.test(code)) scores.javascript += 3;
  if (/=>|console\.log|module\.exports|\brequire\(/.test(code)) scores.javascript += 2;
  if (/^\s*(fi|done|esac)\s*$/m.test(code)) scores.shell += 3;
  if (/^\s*(echo|cd|export|source|mkdir|rm|apt|wget|curl|pip|npm)\s/m.test(code)) scores.shell += 2;
  if (/\$\{?\w+\}|\$\(|\bgrep\b|\bawk\b|\bsed\b/.test(code)) scores.shell += 1;
  let best = null;
  let bestScore = 0;
  for (const lang of Object.keys(scores)) if (scores[lang] > bestScore) { best = lang; bestScore = scores[lang]; }
  return best;
};

await check('detectLanguage(test.js) === javascript', async () => {
  const got = detectLanguage(fs.readFileSync(path.join(root, 'test.js'), 'utf8'));
  if (got !== 'javascript') throw new Error(`got ${got}`);
});
await check('detectLanguage(test.py) === python', async () => {
  const got = detectLanguage(fs.readFileSync(path.join(root, 'test.py'), 'utf8'));
  if (got !== 'python') throw new Error(`got ${got}`);
});
await check('detectLanguage(test.sh) === shell', async () => {
  const got = detectLanguage(fs.readFileSync(path.join(root, 'test.sh'), 'utf8'));
  if (got !== 'shell') throw new Error(`got ${got}`);
});

console.log(failures === 0 ? '\nALL 3-LANGUAGE TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
