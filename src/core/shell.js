import { ObfuscationError } from './errors.js';

/**
 * Shell obfuscator with two levels:
 *
 * - `base64` (default): the script is base64-encoded and executed via
 *   `echo "<payload>" | base64 -d | bash`. The original shebang stays on
 *   line 1 of the output.
 * - `high`: a bashfuscator-style multi-layer transform — base64, then a
 *   character-substitution layer (ROT13 via tr), then octal escaping,
 *   split across underscore-named variables and reassembled with
 *   `printf %b` inside an eval. Nothing is ever executed during
 *   obfuscation; a lightweight scanner validates quotes/heredocs first.
 */

const ROT13_FROM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ROT13_TO = 'NOPQRSTUVWXYZABCDEFGHIJKLMnopqrstuvwxyzabcdefghijklm';

/* NOTE: a single `_` is bash's special "last argument" variable and gets
 * reset after every command, so the obfuscated names start at `__`. */
const VAR_NAMES = ['__', '___', '____'];

function base64Of(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}

function rot13(text) {
  return text.replace(/[a-zA-Z]/g, (ch) => ROT13_TO[ROT13_FROM.indexOf(ch)]);
}

function toOctalEscapes(text) {
  let out = '';
  for (const byte of Buffer.from(text, 'utf8')) {
    out += '\\' + byte.toString(8).padStart(3, '0');
  }
  return out;
}

/** Split the source into its shebang line (if any) and the rest. */
function splitShebang(code) {
  const normalized = code.replace(/^\uFEFF/, '');
  const match = normalized.match(/^#![^\n]*\n/);
  return { shebang: match ? match[0] : '', body: match ? normalized.slice(match[0].length) : normalized };
}

/**
 * Lightweight syntax sanity check: unterminated quotes, unbalanced
 * command substitutions and dangling heredocs become friendly errors.
 * This is a scan only — user code is never executed.
 * @param {string} source
 */
export function assertShellSyntax(source) {
  const n = source.length;
  let i = 0;
  let line = 1;
  let pendingHeredocs = [];
  let inHeredoc = null;
  let arithDepth = 0; // inside (( )) / $(( )) — `<<` there is a left shift

  const err = (msg) => {
    throw new ObfuscationError('INVALID_SYNTAX', `${msg} (line ${line})`, { line });
  };

  while (i < n) {
    if (inHeredoc) {
      let lineEnd = source.indexOf('\n', i);
      if (lineEnd === -1) lineEnd = n;
      const raw = source.slice(i, lineEnd);
      const check = inHeredoc.stripTabs ? raw.replace(/^\t+/, '') : raw;
      if (check === inHeredoc.marker) {
        pendingHeredocs.shift();
        inHeredoc = pendingHeredocs[0] ?? null;
      }
      i = Math.min(n, lineEnd + 1);
      line++;
      continue;
    }

    const ch = source[i];

    if (ch === '(' && source[i + 1] === '(' ) {
      arithDepth++;
      i += 2;
      continue;
    }
    if (ch === ')' && source[i + 1] === ')' && arithDepth > 0) {
      arithDepth--;
      i += 2;
      continue;
    }

    if (ch === '\\' && (source[i + 1] === '\n' || source[i + 1] === '\r')) {
      i += source[i + 1] === '\r' ? 3 : 2;
      line++;
      continue;
    }

    if (ch === '\n') {
      line++;
      i++;
      if (pendingHeredocs.length > 0) inHeredoc = pendingHeredocs[0];
      continue;
    }

    if (ch === '\'') {
      let j = i + 1;
      while (j < n && source[j] !== '\'') { if (source[j] === '\n') line++; j++; }
      if (j >= n) err('unterminated single-quoted string');
      i = j + 1;
      continue;
    }

    if (ch === '$' && source[i + 1] === '\'') {
      let j = i + 2;
      while (j < n) {
        if (source[j] === '\\') { j += 2; continue; }
        if (source[j] === '\n') line++;
        if (source[j] === '\'') break;
        j++;
      }
      if (j >= n) err("unterminated $'...' string");
      i = j + 1;
      continue;
    }

    if (ch === '"') {
      let j = i + 1;
      let depth = 0;
      while (j < n) {
        const c = source[j];
        if (c === '\\') { j += 2; continue; }
        if (c === '\n') line++;
        if (depth > 0 && (c === '\'' || c === '"')) {
          const q = c;
          j++;
          while (j < n) {
            if (source[j] === '\\') { j += 2; continue; }
            if (source[j] === '\n') line++;
            if (source[j] === q) { j++; break; }
            j++;
          }
          continue;
        }
        if (c === '$' && (source[j + 1] === '(' || source[j + 1] === '{')) { depth++; j += 2; continue; }
        if (c === '`') { depth++; j++; continue; }
        if (c === ')' || c === '}') {
          // A bare `}` / `)` inside double quotes is a literal character
          // (e.g. `-d "{\"a\": ${X}}"`); only shrink the nesting counter.
          if (depth > 0) depth--;
          j++;
          continue;
        }
        if (depth === 0 && c === '"') break;
        j++;
      }
      if (j >= n) err('unterminated double-quoted string');
      i = j + 1;
      continue;
    }

    if (ch === '<' && source[i + 1] === '<' && source[i + 2] !== '<' && arithDepth === 0) {
      let j = i + 2;
      let stripTabs = false;
      if (source[j] === '-') { stripTabs = true; j++; }
      while (j < n && /[ \t]/.test(source[j])) j++;
      let marker = '';
      if (source[j] === '\'' || source[j] === '"') {
        const q = source[j];
        j++;
        const start = j;
        while (j < n && source[j] !== q) j++;
        if (j >= n) err('unterminated heredoc marker');
        marker = source.slice(start, j);
        j++;
      } else {
        const start = j;
        while (j < n && /[\w./-]/.test(source[j])) j++;
        marker = source.slice(start, j);
      }
      if (!marker) err('missing heredoc delimiter');
      pendingHeredocs.push({ marker, stripTabs });
      i = j;
      continue;
    }

    i++;
  }

  if (pendingHeredocs.length > 0) {
    err(`heredoc '${pendingHeredocs[0].marker}' was never terminated`);
  }
}

/**
 * Obfuscate shell source.
 * @param {string} code
 * @param {'base64'|'high'} mode shell obfuscation level
 * @returns {Promise<string>} obfuscated source, shebang preserved on line 1
 */
export async function obfuscateShell(code, mode) {
  // Yield before the CPU-bound transform so queued I/O can proceed.
  await new Promise((resolve) => setImmediate(resolve));

  assertShellSyntax(code);

  const { shebang, body } = splitShebang(code);
  const b64 = base64Of(body);

  if (mode !== 'high') {
    // Default level: straight base64 pipe, as `echo "<b64>" | base64 -d | bash`.
    return `${shebang}echo "${b64}" | base64 -d | bash\n`;
  }

  // High level (bashfuscator style): rot13(base64) hidden behind octal
  // escapes, split across underscore variables, reassembled by printf.
  // The octal string is passed as printf's *format string* where \NNN
  // (1-3 octal digits) is the escape form; it cannot contain a bare `%`
  // because % itself gets octal-encoded. Splits are contiguous runs of
  // whole escape units, so `printf a b c` restores the exact byte order.
  const octal = toOctalEscapes(rot13(b64));
  const groups = octal.match(/\\[0-7]{3}/g) ?? [];
  const perPart = Math.ceil(groups.length / VAR_NAMES.length);
  const parts = VAR_NAMES.map((_, idx) => groups.slice(idx * perPart, (idx + 1) * perPart).join(''));
  const assignments = VAR_NAMES.map((name, idx) => `${name}='${parts[idx]}'`);
  const concatenated = VAR_NAMES.map((name) => `"$${name}"`).join('');

  return (
    `${shebang}${assignments.join('\n')}\n` +
    `printf ${concatenated} | tr 'N-ZA-Mn-za-m' 'A-Za-z' | base64 -d | bash\n`
  );
}
