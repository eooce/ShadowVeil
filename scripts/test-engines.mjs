// Local engine test harness (not part of the server).
import { obfuscate } from '../src/core/index.js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const pythonSamples = {
  simple: `def greet(name):
    msg = "Hello, " + name
    print(msg)

greet("World")
`,
  fstrings: `import os

count = 10
total = 0
for i in range(count):
    total += i

def report(items, label="items"):
    return f"{label}: {len(items)} total={total}"

data = {"key": "value", "num": 42}
print(report([1, 2, 3]))
print(f"dict={data['key']} hex={total:04x} pct={total/count:.1%}")
print(os.getcwd())
`,
  classes: `class Calculator:
    """A docstring that should stay readable."""

    def __init__(self, base=0):
        self.base = base
        self.history = []

    def add(self, x, y=None):
        result = self.base + x + (y or 0)
        self.history.append(result)
        return result

calc = Calculator(base=100)
val = calc.add(5, y=10)
print(f"result={val}")
`,
  escapes: `a = "tab\\there\\nnew"
b = 'quote\\'s and "dquotes"'
c = b"bytes\\x00here"
d = r"raw\\path"
e = 0x1F + 0b101 + 1_000
f = "unicode \\u00e9\\u4e2d"
print(a, b, c, d, e, f)
`,
  concat: `a = ('one'  # comment inside the concatenation group
      'two\\n'
      'three')
b = b'\\x00\\x01' b'tail' b''
c = 'a\\n' r'\\nb' 'c\\x41'
d = f'left {a[:3]}' ' right'
e = ' right ' f'left {len(a)}'
g = 'x' 'y' f'z {1+1}' 'w'
print(a, b, c, d, e, g)
`,
  keywords: `import os
from collections import OrderedDict as OD

limit = 10
offset = 0

def fetch(url, timeout=30, retries=3):
    # keyword args must keep their names
    return f"{url} {timeout} {retries} {limit}"

while offset < limit:
    offset += 2

try:
    value = int("42")
except ValueError as exc:
    print(exc)

with open(os.devnull) as devnull:
    content = devnull.read()

nums = [x * 2 for x in range(5)]
evens = list(filter(lambda n: n % 2 == 0, nums))
match evens:
    case [0, *rest]:
        print(rest)
    case _:
        print(evens)
print(fetch(url="http://x", retries=1))
print(type(OD.__name__))
`,
};

const shellSamples = {
  simple: `#!/bin/bash
# deploy script
TARGET_DIR="/opt/app"
BACKUP_COUNT=3
message="Deploying"

echo "$message to $TARGET_DIR"

for file in one two three; do
    echo "found: $file"
done

echo "kept $BACKUP_COUNT backups, host=\${HOSTNAME:-unknown}, args=$#"
`,
  heredoc: `#!/bin/sh
name="world"
greeting="hello"

cat <<EOF
Hello, $name!
Your greeting is: $greeting
EOF

cat <<'LITERAL'
Nothing $expands here, not even $name
LITERAL

printf 'done\\n'
`,
  arithmetic: `#!/bin/bash
count=0
total=100
step=5

while [ $count -lt 10 ]; do
    count=$((count + 1))
    total=$(( total + step ))
done

(( step += 2 ))
let "result = total * 2"
shifted=$((1 << 4))

idx=1
items=("a" "b" "c")
echo "\${items[$idx]}" "$count" "$total" "$result" "$shifted"
`,
};

const jsSample = `// demo
function fibonacci(n) {
  if (n <= 1) return n;
  let a = 0, b = 1;
  for (let i = 2; i <= n; i++) {
    [a, b] = [b, a + b];
  }
  return b;
}
const secret = "hunter2";
console.log(fibonacci(10), secret);
`;

function writeTemp(name, content) {
  const file = path.join(os.tmpdir(), `shadowveil-test-${name}`);
  fs.writeFileSync(file, content);
  return file;
}

let failures = 0;

async function check(label, fn) {
  try {
    await fn();
    console.log(`  ok    ${label}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL  ${label}`);
    console.log(String(err?.message ?? err).split('\n').slice(0, 14).map((l) => '        ' + l).join('\n'));
  }
}

console.log('== Python (high = lexical + shells) ==');
for (const [name, src] of Object.entries(pythonSamples)) {
  await check(`python/${name}`, async () => {
    const { code } = await obfuscate(src, 'python', undefined);
    const file = writeTemp(`py-${name}.py`, code);
    const orig = execFileSync('python', ['-W', 'ignore', '-c', src], { encoding: 'utf8' });
    const got = execFileSync('python', ['-W', 'ignore', file], { encoding: 'utf8' });
    if (orig !== got) {
      throw new Error(`stdout mismatch\n--- expected ---\n${orig}--- got ---\n${got}--- code ---\n${code}`);
    }
  });
}

console.log('== Python (light = compress-only) ==');
for (const [name, src] of Object.entries(pythonSamples)) {
  await check(`python-light/${name}`, async () => {
    const { code } = await obfuscate(src, 'python', 'light');
    const file = writeTemp(`py-light-${name}.py`, code);
    const orig = execFileSync('python', ['-W', 'ignore', '-c', src], { encoding: 'utf8' });
    const got = execFileSync('python', ['-W', 'ignore', file], { encoding: 'utf8' });
    if (orig !== got) {
      throw new Error(`stdout mismatch\n--- expected ---\n${orig}--- got ---\n${got}--- code ---\n${code}`);
    }
  });
}

console.log('== Shell (base64 / high) ==');
for (const [name, src] of Object.entries(shellSamples)) {
  for (const mode of ['base64', 'high']) {
    await check(`shell/${name}/${mode}`, async () => {
      const { code } = await obfuscate(src, 'shell', mode);
      const file = writeTemp(`sh-${name}-${mode}.sh`, code);
      execFileSync('bash', ['-n', file], { stdio: 'pipe' });
      const origFile = writeTemp(`sh-orig-${name}.sh`, src);
      const orig = execFileSync('bash', [origFile], { encoding: 'utf8', cwd: os.tmpdir() });
      const got = execFileSync('bash', [file], { encoding: 'utf8', cwd: os.tmpdir() });
      if (orig !== got) {
        throw new Error(`stdout mismatch\n--- expected ---\n${orig}--- got ---\n${got}--- code ---\n${code}`);
      }
    });
  }
}

console.log('== Shell legacy level mapping ==');
await check('shell legacy "max" maps to high', async () => {
  const { code } = await obfuscate(shellSamples.simple, 'shell', 'max');
  if (!code.includes("base64 -d | bash")) throw new Error('not wrapped');
  const file = writeTemp('sh-legacy-max.sh', code);
  const got = execFileSync('bash', [file], { encoding: 'utf8', cwd: os.tmpdir() });
  if (!got.includes('Deploying to /opt/app')) throw new Error('wrong output: ' + got);
});
await check('shell legacy "standard" maps to base64', async () => {
  const { code } = await obfuscate(shellSamples.simple, 'shell', 'standard');
  if (!/^#!\/bin\/bash\necho "/.test(code)) throw new Error('unexpected shape: ' + code.slice(0, 60));
});

console.log('== JavaScript ==');
for (const level of ['light', 'standard', 'max']) {
  await check(`js/sample/${level}`, async () => {
    const { code } = await obfuscate(jsSample, 'javascript', level);
    const file = writeTemp(`js-${level}.js`, code);
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    const orig = execFileSync(process.execPath, ['-e', jsSample], { encoding: 'utf8' });
    const got = execFileSync(process.execPath, [file], { encoding: 'utf8' });
    if (orig !== got) throw new Error(`stdout mismatch\n--- expected ---\n${orig}--- got ---\n${got}`);
  });
}

console.log('== Syntax error detection ==');
await check('python unclosed bracket rejected', async () => {
  try {
    await obfuscate('def f(:\n    pass\n', 'python', undefined);
  } catch (err) {
    if (err.code !== 'INVALID_SYNTAX') throw new Error(`wrong code: ${err.code}`);
    return;
  }
  throw new Error('expected INVALID_SYNTAX');
});
await check('python unclosed string rejected', async () => {
  try {
    await obfuscate('x = "oops\n', 'python', undefined);
  } catch (err) {
    if (err.code !== 'INVALID_SYNTAX') throw new Error(`wrong code: ${err.code}`);
    return;
  }
  throw new Error('expected INVALID_SYNTAX');
});
await check('shell unterminated quote rejected', async () => {
  try {
    await obfuscate('echo "oops\n', 'shell', 'base64');
  } catch (err) {
    if (err.code !== 'INVALID_SYNTAX') throw new Error(`wrong code: ${err.code}`);
    return;
  }
  throw new Error('expected INVALID_SYNTAX');
});
await check('shell arithmetic << not a heredoc', async () => {
  await obfuscate('x=$((1 << 3))\necho "$x"\n', 'shell', 'high');
});
await check('js invalid syntax rejected', async () => {
  try {
    await obfuscate('function ( {', 'javascript', 'standard');
  } catch (err) {
    if (err.code !== 'INVALID_SYNTAX') throw new Error(`wrong code: ${err.code}`);
    return;
  }
  throw new Error('expected INVALID_SYNTAX');
});

console.log(failures === 0 ? '\nALL ENGINE TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
