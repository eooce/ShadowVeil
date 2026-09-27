import zlib from 'node:zlib';
import { tokenizePython, PY_KEYWORDS, PY_SOFT_KEYWORDS, PY_BUILTINS } from './tokenizer.js';
import { ObfuscationError } from '../errors.js';

const OPERATOR_ASSIGN = new Set(['+=', '-=', '*=', '/=', '//=', '%=', '@=', '&=', '|=', '^=', '>>=', '<<=', '**=']);

/** Names that must never be renamed. */
const RESERVED = new Set([
  ...PY_BUILTINS,
  ...PY_KEYWORDS,
  ...PY_SOFT_KEYWORDS,
  'self', 'cls', '_',
]);

const NAME_RE = /^[A-Za-z_]\w*$/;

const SIGNIFICANT = (t) => !['NEWLINE', 'INDENT', 'DEDENT', 'COMMENT', 'EOF'].includes(t.type);

function randomHex(len) {
  let out = '';
  for (let i = 0; i < len; i++) out += '0123456789abcdef'[Math.floor(Math.random() * 16)];
  return out;
}

/**
 * Single analysis pass over the significant token stream. Collects every
 * rename candidate (bound names), plus the exclusion sets that keep the
 * output semantically equivalent: attribute names, keyword arguments,
 * def/class names, imported bindings and docstring positions.
 * @param {Array} tokens full token stream
 */
function analyze(tokens) {
  const candidates = new Set();
  const attrNames = new Set();
  const kwargNames = new Set();
  const definedNames = new Set();
  const docstrings = new Set();

  const sig = tokens.filter(SIGNIFICANT);

  // Inside import statements only the `as` alias may be renamed.
  for (let i = 0; i < sig.length; i++) {
    const t = sig[i];
    if (t.type === 'KEYWORD' && (t.value === 'import' || t.value === 'from')) {
      let depth0 = 0;
      let awaitingAs = false;
      for (let j = i + 1; j < sig.length; j++) {
        const s = sig[j];
        if (s.type === 'OP') {
          if ('([{'.includes(s.value)) { depth0++; continue; }
          if (')]}'.includes(s.value)) { if (depth0 === 0) break; depth0--; continue; }
          if (s.value === ';' && depth0 === 0) break;
        }
        if (depth0 === 0 && s.line > t.line) break;
        if (s.type === 'KEYWORD' && s.value === 'as') { awaitingAs = true; continue; }
        if (s.type === 'NAME') {
          if (awaitingAs) awaitingAs = false;
          else s._skipRename = true;
        }
      }
    }
  }

  // Inside match/case patterns a rewritten literal like (0+0) would be an
  // illegal pattern, so numbers there must stay untouched. `case` is a soft
  // keyword, so it arrives as a NAME token.
  for (let i = 0; i < sig.length; i++) {
    const t = sig[i];
    if ((t.type === 'NAME' || t.type === 'KEYWORD') && t.value === 'case') {
      for (let j = i + 1; j < sig.length; j++) {
        const s = sig[j];
        if (s.line > t.line) break;
        if (s.type === 'OP' && s.value === ':' && !'([{'.includes(sig[j - 1]?.value ?? '')) break;
        if (s.type === 'NUMBER') s._inPattern = true;
      }
    }
  }

  const brackets = []; // { ch, isCall }
  let inDefParams = false;
  let defParenDepth = -1;
  let inLambda = false;
  let lambdaDepth = -1;
  for (let i = 0; i < sig.length; i++) {
    const t = sig[i];
    const p1 = i > 0 ? sig[i - 1] : null;
    const p2 = i > 1 ? sig[i - 2] : null;
    const nx = i + 1 < sig.length ? sig[i + 1] : null;

    if (t.type === 'OP') {
      if ('([{'.includes(t.value)) {
        const isCall =
          t.value === '(' &&
          p1 && (p1.type === 'NAME' || (p1.type === 'OP' && p1.value === ')')) &&
          !(p2 && p2.type === 'KEYWORD' && (p2.value === 'def' || p2.value === 'class'));
        brackets.push({ ch: t.value, isCall });
      } else if (')]}'.includes(t.value)) {
        brackets.pop();
      }
    }
    const depth = brackets.length;
    const topBracket = brackets[brackets.length - 1];

    if (t.type === 'NAME') {
      if (p1 && p1.type === 'OP' && p1.value === '.') attrNames.add(t.value);
      if (p1 && p1.type === 'KEYWORD' && (p1.value === 'def' || p1.value === 'class')) definedNames.add(t.value);
      if (p1 && p1.type === 'KEYWORD' && p1.value === 'as') candidates.add(t.value);
      if (p1 && p1.type === 'KEYWORD' && (p1.value === 'global' || p1.value === 'nonlocal')) candidates.add(t.value);
      if (
        topBracket?.isCall && nx && nx.type === 'OP' && nx.value === '=' &&
        !(p1 && p1.type === 'OP' && p1.value === '.') && !t._skipRename
      ) {
        kwargNames.add(t.value);
      }
      if (
        inDefParams && depth === defParenDepth + 1 &&
        p1 && ['(', ',', '*', '**'].includes(p1.value) &&
        !(p2 && p2.type === 'OP' && p2.value === '.')
      ) {
        candidates.add(t.value);
      }
      if (
        inLambda && depth === lambdaDepth && p1 &&
        ((p1.type === 'KEYWORD' && p1.value === 'lambda') || ['(', ',', '*', '**'].includes(p1.value))
      ) {
        candidates.add(t.value);
      }
    }

    if (t.type === 'KEYWORD') {
      if (t.value === 'def') { inDefParams = true; defParenDepth = depth; }
      if (t.value === 'lambda') { inLambda = true; lambdaDepth = depth; }
      if (t.value === 'global' || t.value === 'nonlocal') {
        for (let j = i + 1; j < sig.length && sig[j].line === t.line; j++) {
          const s = sig[j];
          if (s.type === 'NAME') candidates.add(s.value);
          if (s.type === 'OP' && ';'.includes(s.value)) break;
        }
      }
    }

    if (inDefParams && t.type === 'OP' && t.value === ':' && depth === defParenDepth) inDefParams = false;
    if (inLambda && t.type === 'OP' && t.value === ':' && depth === lambdaDepth) inLambda = false;

    // for-comprehension targets
    if (t.type === 'KEYWORD' && t.value === 'for') {
      let d = 0;
      for (let j = i + 1; j < sig.length; j++) {
        const s = sig[j];
        if (s.type === 'OP') {
          if ('([{'.includes(s.value)) { d++; continue; }
          if (')]}'.includes(s.value)) { if (d === 0) break; d--; continue; }
        }
        if (d === 0 && s.type === 'KEYWORD' && s.value === 'in') break;
        if (s.type === 'NAME' && !(sig[j - 1].type === 'OP' && ['.', '['].includes(sig[j - 1].value))) {
          candidates.add(s.value);
        }
      }
    }

    // assignment targets
    if (t.type === 'OP' && t.value === '=') collectAssignTargets(sig, i, candidates);
    if (t.type === 'OP' && (OPERATOR_ASSIGN.has(t.value) || t.value === ':=')) {
      const left = sig[i - 1];
      if (left && left.type === 'NAME') candidates.add(left.value);
    }
    // annotated assignment `x: int = 5`
    if (t.type === 'OP' && t.value === ':' && depth === 0) {
      const left = sig[i - 1];
      if (left && left.type === 'NAME' && NAME_RE.test(left.value)) {
        let sawEq = false;
        for (let j = i + 1; j < sig.length && sig[j].line === t.line; j++) {
          if (sig[j].type === 'OP' && sig[j].value === '=') { sawEq = true; break; }
        }
        if (sawEq) candidates.add(left.value);
      }
    }

    // docstrings: standalone string statements (module/class/function docs),
    // detected on the full token stream (NEWLINE tokens matter here)
    void 0;
  }

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'STRING') continue;
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    const startsSuite =
      !prev ||
      ['NEWLINE', 'INDENT', 'DEDENT', 'EOF', 'COMMENT'].includes(prev.type) ||
      (prev.type === 'OP' && prev.value === ':');
    const endsStatement =
      !next ||
      ['NEWLINE', 'DEDENT', 'EOF'].includes(next.type) ||
      (next.type === 'OP' && next.value === ';');
    if (startsSuite && endsStatement) docstrings.add(t);
  }

  return { candidates, attrNames, kwargNames, definedNames, docstrings };
}

/**
 * Walk left from an `=` and collect simple assignment-target names
 * (`x = ...`, `(a, b) = ...`, `*rest = ...`). Subscript and attribute
 * targets are intentionally ignored.
 */
function collectAssignTargets(sig, eqIndex, candidates) {
  const left = sig[eqIndex - 1];
  if (!left) return;
  if (left.type === 'NAME' && NAME_RE.test(left.value)) {
    candidates.add(left.value);
    return;
  }
  if (left.type === 'OP' && left.value === '*') {
    const name = sig[eqIndex - 2];
    if (name && name.type === 'NAME') candidates.add(name.value);
    return;
  }
  if (left.type === 'OP' && left.value === ')') {
    let d = 0;
    for (let j = eqIndex - 1; j >= 0; j--) {
      const t = sig[j];
      if (t.type === 'OP' && t.value === ')') d++;
      if (t.type === 'OP' && t.value === '(') {
        d--;
        if (d === 0) {
          for (let k = j + 1; k < eqIndex; k++) {
            const g = sig[k];
            const ok = (g.type === 'NAME' && NAME_RE.test(g.value)) || (g.type === 'OP' && [',', '(', ')', '*'].includes(g.value));
            if (!ok) return;
          }
          for (let k = j + 1; k < eqIndex; k++) {
            const g = sig[k];
            const prevG = sig[k - 1];
            if (g.type === 'NAME' && !(prevG.type === 'OP' && prevG.value === '.')) candidates.add(g.value);
          }
          return;
        }
      }
    }
  }
}

/**
 * Decode a Python string literal body into its runtime text value.
 * @returns {{text: string} | null} null when the literal uses escapes we do
 *   not decode (e.g. \N{...}) and encryption must be skipped.
 */
function decodeStringBody(content, isRaw) {
  if (isRaw) return { text: content };
  let out = '';
  let i = 0;
  while (i < content.length) {
    const ch = content[i];
    if (ch !== '\\') { out += ch; i++; continue; }
    const next = content[i + 1];
    if (next === undefined) { out += ch; i++; break; }
    i += 2;
    switch (next) {
      case '\n': break;
      case '\\': out += '\\'; break;
      case '\'': out += '\''; break;
      case '"': out += '"'; break;
      case 'a': out += '\x07'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case 'n': out += '\n'; break;
      case 'r': out += '\r'; break;
      case 't': out += '\t'; break;
      case 'v': out += '\v'; break;
      case 'x': {
        const hex = content.slice(i, i + 2);
        if (!/^[0-9a-fA-F]{2}$/.test(hex)) return null;
        out += String.fromCharCode(Number.parseInt(hex, 16));
        i += 2;
        break;
      }
      case 'u': {
        const hex = content.slice(i, i + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null;
        out += String.fromCharCode(Number.parseInt(hex, 16));
        i += 4;
        break;
      }
      case 'U': {
        const hex = content.slice(i, i + 8);
        if (!/^[0-9a-fA-F]{8}$/.test(hex)) return null;
        const cp = Number.parseInt(hex, 16);
        if (cp > 0x10ffff) return null;
        out += String.fromCodePoint(cp);
        i += 8;
        break;
      }
      case 'N': return null;
      default: {
        if (/[0-7]/.test(next)) {
          let oct = next;
          while (oct.length < 3 && /[0-7]/.test(content[i] ?? '')) oct += content[i++];
          out += String.fromCharCode(Number.parseInt(oct, 8) & 0xff);
        } else {
          out += '\\' + next; // unknown escapes keep the backslash in Python
        }
      }
    }
  }
  return { text: out };
}

/**
 * Convert the runtime text of a bytes literal into raw bytes, mirroring
 * Python semantics: literal non-ASCII characters encode as UTF-8, \xNN and
 * octal escapes map to single bytes.
 * @param {string} text
 * @returns {Uint8Array}
 */
function bytesFromText(text) {
  const out = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp <= 0xff) out.push(cp);
    else for (const b of new TextEncoder().encode(ch)) out.push(b);
  }
  return Uint8Array.from(out);
}

/**
 * Rename identifiers inside f-string interpolation fields. Nested `{...}`
 * groups inside format specs and nested f-strings (PEP 701) are handled
 * recursively.
 * @param {string} raw full f-string literal including prefix and quotes
 * @param {Map<string, string>} renameMap
 */
function renameInsideFString(raw, renameMap) {
  const prefixMatch = raw.match(/^[fFrRbBuU]{0,2}/);
  const prefix = prefixMatch ? prefixMatch[0] : '';
  const quoteChar = raw[prefix.length];
  const triple = raw.slice(prefix.length).startsWith(quoteChar.repeat(3));
  const quoteLen = triple ? 3 : 1;
  const bodyStart = prefix.length + quoteLen;
  const bodyEnd = raw.length - quoteLen;
  const body = raw.slice(bodyStart, bodyEnd);

  let out = '';
  let i = 0;
  let depth = 0;
  let fieldStart = -1;

  while (i < body.length) {
    const ch = body[i];
    if (depth === 0) {
      if (ch === '\\') { out += body.slice(i, i + 2); i += 2; continue; }
      if (ch === '{') {
        if (body[i + 1] === '{') { out += '{{'; i += 2; continue; }
        depth = 1;
        fieldStart = i + 1;
        i++;
        continue;
      }
      out += ch;
      i++;
      continue;
    }
    // depth > 0 — inside an interpolation field: skip until it closes
    if (ch === '\\') { i += 2; continue; }
    if (ch === '{') { depth++; i++; continue; }
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        out += '{' + renameInExpression(body.slice(fieldStart, i), renameMap) + '}';
        fieldStart = -1;
      }
      i++;
      continue;
    }
    i++;
  }
  out += body.slice(i);
  return raw.slice(0, bodyStart) + out + raw.slice(bodyEnd);
}

/**
 * Rename identifiers in one interpolation expression; text after a
 * top-level `:` is a format spec whose nested `{...}` groups recurse.
 */
function renameInExpression(expr, renameMap) {
  let depth = 0;
  let inQuote = null;
  let splitAt = -1;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (inQuote) {
      if (ch === '\\') { i++; continue; }
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '\'' || ch === '"') { inQuote = ch; continue; }
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === ':' && depth === 0) { splitAt = i; break; }
  }
  const head = splitAt === -1 ? expr : expr.slice(0, splitAt);
  const tail = splitAt === -1 ? '' : expr.slice(splitAt);
  return renameNamesInCode(head, renameMap) + (splitAt === -1 ? '' : renameNestedGroups(tail, renameMap));
}

function renameNestedGroups(spec, renameMap) {
  let out = '';
  let i = 0;
  while (i < spec.length) {
    if (spec[i] === '{') {
      let depth = 0;
      let j = i;
      for (; j < spec.length; j++) {
        if (spec[j] === '{') depth++;
        else if (spec[j] === '}') { depth--; if (depth === 0) break; }
        else if (spec[j] === '\\') j++;
      }
      const inner = spec.slice(i + 1, j);
      out += '{' + renameInExpression(inner, renameMap) + '}';
      i = j + 1;
      continue;
    }
    out += spec[i];
    i++;
  }
  return out;
}

/**
 * Apply the rename map to a standalone code fragment. Names used as keyword
 * arguments (NAME followed by a single `=`) and attribute names are skipped.
 */
function renameNamesInCode(code, renameMap) {
  if (renameMap.size === 0) return code;
  let out = '';
  let i = 0;
  let prevSignificant = '';
  let prevWord = '';
  while (i < code.length) {
    const ch = code[i];
    if (ch === '\'' || ch === '"') {
      const q = ch;
      const prefix = /[\w]/.test(code[i - 1] ?? '') ? '' : '';
      void prefix;
      const isFString = i > 0 && /[fF]/.test(code[i - 1] ?? '') && !/[\w]/.test(code[i - 2] ?? '');
      const triple = code.slice(i, i + 3) === q.repeat(3);
      let j = i + (triple ? 3 : 1);
      for (;;) {
        if (j >= code.length) break;
        if (code[j] === '\\') { j += 2; continue; }
        if (code[j] === q && (!triple || (code[j + 1] === q && code[j + 2] === q))) {
          j += triple ? 3 : 1;
          break;
        }
        j++;
      }
      const literal = code.slice(i, j);
      out += isFString ? renameInsideFString((code[i - 1] ?? '') + literal, renameMap).slice(1) : literal;
      i = j;
      prevSignificant = 'str';
      continue;
    }
    if (/[\w\u00c0-\uffff]/.test(ch)) {
      let j = i;
      while (j < code.length && /[\w\u00c0-\uffff]/.test(code[j])) j++;
      const word = code.slice(i, j);
      const nextChar = code[j] ?? '';
      const nextIsKwarg = nextChar === '=' && code[j + 1] !== '=';
      const renamable = renameMap.has(word) && prevSignificant !== '.' && !nextIsKwarg;
      out += renamable ? renameMap.get(word) : word;
      prevWord = word;
      prevSignificant = 'word';
      i = j;
      continue;
    }
    if (ch === '.') { out += ch; i++; prevSignificant = '.'; continue; }
    if (ch === '(') {
      out += ch;
      i++;
      prevSignificant = prevWord && prevWord !== 'lambda' && renameMap.has(prevWord) ? 'callee' : 'paren';
      void prevSignificant;
      continue;
    }
    out += ch;
    i++;
    if (!/\s/.test(ch)) prevSignificant = 'op';
  }
  return out;
}

/**
 * Encrypt one STRING token. Returns { code, kind } or null to keep the
 * literal as-is.
 */
function encryptStringToken(t, decoderName, bytesDecoderName) {
  const decoded = decodeStringBody(t.content, t.isRaw);
  if (!decoded) return null;
  if (t.isBytes) {
    const bytes = bytesFromText(decoded.text);
    return { code: `${bytesDecoderName}('${Buffer.from(bytes).toString('base64')}')`, kind: 'bytes' };
  }
  return { code: `${decoderName}('${Buffer.from(new TextEncoder().encode(decoded.text)).toString('base64')}')`, kind: 'str' };
}

/** Rewrite a plain decimal integer literal as hex or an arithmetic split. */
function obfuscateInt(value) {
  if (!Number.isSafeInteger(value)) return String(value);
  if (Math.random() < 0.5) return `(0x${value.toString(16)})`;
  const a = Math.floor(Math.random() * value);
  const b = value - a;
  return `(${a}+${b})`;
}

/**
 * Obfuscate Python source with the self-contained lexer pipeline: variable
 * renaming, base64 string encryption, integer rewrites and comment stripping.
 * The tokenizer guarantees syntax errors are reported before any output.
 * @param {string} code
 * @param {'light'|'standard'|'max'} level
 * @param {{renameVariables?: boolean, encryptStrings?: boolean, obfuscateNumbers?: boolean, removeComments?: boolean}} [options]
 * @returns {Promise<string>} obfuscated source
 */
export async function obfuscatePython(code, level, options = {}) {
  // Yield once so queued I/O can proceed before the CPU-bound transform.
  await new Promise((resolve) => setImmediate(resolve));

  const flags = {
    renameVariables: options.renameVariables ?? true,
    encryptStrings: options.encryptStrings ?? level !== 'light',
    obfuscateNumbers: options.obfuscateNumbers ?? level !== 'light',
    removeComments: options.removeComments ?? true,
  };

  const { tokens } = tokenizePython(code);
  const { candidates, attrNames, kwargNames, definedNames, docstrings } = analyze(tokens);

  const renameMap = new Map();
  if (flags.renameVariables) {
    for (const name of candidates) {
      if (RESERVED.has(name)) continue;
      if (attrNames.has(name)) continue;
      if (kwargNames.has(name)) continue;
      if (definedNames.has(name)) continue;
      if (name.startsWith('__') && name.endsWith('__')) continue;
      if (!NAME_RE.test(name)) continue;
      renameMap.set(name, `_0x${randomHex(6)}`);
    }
  }

  const usedNames = new Set([...candidates, ...definedNames, ...attrNames]);
  let decoderName = '_d';
  let bytesDecoderName = '_b';
  while (usedNames.has(decoderName)) decoderName = `_d${randomHex(4)}`;
  while (usedNames.has(bytesDecoderName)) bytesDecoderName = `_b${randomHex(4)}`;

  let encryptedStr = 0;
  let encryptedBytes = 0;
  for (const t of tokens) {
    if (t.type === 'NAME' && renameMap.has(t.value) && !t._skipRename) {
      t.value = renameMap.get(t.value);
      continue;
    }
    if (t.type === 'FSTRING' && renameMap.size > 0) {
      t.value = renameInsideFString(t.value, renameMap);
      continue;
    }
    if (t.type === 'STRING' && flags.encryptStrings && !docstrings.has(t)) {
      const encrypted = encryptStringToken(t, decoderName, bytesDecoderName);
      if (encrypted) {
        t.value = encrypted.code;
        t.type = 'OP'; // emit the replacement verbatim
        if (encrypted.kind === 'bytes') encryptedBytes++;
        else encryptedStr++;
      }
      continue;
    }
    if (t.type === 'NUMBER' && flags.obfuscateNumbers && t.isPlainInt && !t._inPattern) {
      t.value = obfuscateInt(Number.parseInt(t.value.replace(/_/g, ''), 10));
    }
  }

  return renderTokens(tokens, {
    removeComments: flags.removeComments,
    decoderName,
    bytesDecoderName,
    encryptedStr,
    encryptedBytes,
  });
}

/**
 * Render the token stream back to source with normalized 4-space
 * indentation, no blank lines and (optionally) no comments. Shebang and
 * PEP 263 coding declarations are always preserved at the top.
 */
function renderTokens(tokens, { removeComments, decoderName, bytesDecoderName, encryptedStr, encryptedBytes }) {
  const prelude = [];
  const lines = [];
  let indent = 0;
  let cur = '';
  let atLineStart = true;

  const pushLine = () => {
    lines.push(('    '.repeat(indent) + cur).replace(/\s+$/, ''));
    cur = '';
    atLineStart = true;
  };

  for (const t of tokens) {
    if (t.type === 'INDENT') { indent++; continue; }
    if (t.type === 'DEDENT') { indent = Math.max(0, indent - 1); continue; }
    if (t.type === 'NEWLINE') { pushLine(); continue; }
    if (t.type === 'EOF') break;

    if (t.type === 'COMMENT') {
      const isShebang = t.line === 1 && t.value.startsWith('#!');
      const isCoding = t.line <= 2 && /coding[:=]\s*[-\w.]+/.test(t.value);
      if (isShebang || isCoding) {
        prelude.push({ line: t.line, text: t.value });
        continue;
      }
      if (removeComments) continue;
      cur += (atLineStart ? '' : (t.lead || '  ')) + t.value;
      // A kept comment ends the physical line; inside brackets this stays valid.
      cur += '\n';
      pushLine();
      continue;
    }

    if (atLineStart) {
      cur += t.value;
      atLineStart = false;
    } else {
      cur += (t.lead || '') + t.value;
    }
  }
  if (cur.trim()) pushLine();

  const helpers = [];
  if (encryptedStr > 0) {
    helpers.push(`def ${decoderName}(_s):`, "    return __import__('base64').b64decode(_s).decode('utf-8')");
  }
  if (encryptedBytes > 0) {
    helpers.push(`def ${bytesDecoderName}(_s):`, "    return __import__('base64').b64decode(_s)");
  }

  const preludeText = prelude.sort((a, b) => a.line - b.line).map((p) => p.text).join('\n');
  const parts = [];
  if (preludeText) parts.push(preludeText);
  if (helpers.length) parts.push(helpers.join('\n'));
  parts.push(lines.join('\n'));
  return parts.filter((p) => p.length > 0).join('\n') + '\n';
}

export { ObfuscationError };

/**
 * One self-extracting outer shell: the payload is deflate-compressed,
 * base64-encoded and reloaded at runtime through zlib/base64. Works on any
 * Python 3 interpreter without extra dependencies.
 */
function wrapLayer(source) {
  const compressed = zlib.deflateSync(Buffer.from(source, 'utf8'), { level: 9 }).toString('base64');
  return `exec(__import__('zlib').decompress(__import__('base64').b64decode('${compressed}')))`;
}

/** Extract a shebang line and PEP 263 coding declaration from raw source. */
function extractHeader(code) {
  const lines = code.replace(/^\uFEFF/, '').split(/\r?\n/);
  let shebang = '';
  let coding = '';
  for (let i = 0; i < Math.min(2, lines.length); i++) {
    const line = lines[i];
    if (/^#!/.test(line) && !shebang) shebang = line;
    else if (/^(\s|#)*#.*coding[:=]\s*[-\w.]+/.test(line) && !coding) coding = line;
  }
  return { shebang, coding };
}

/**
 * Single-mode Python obfuscation (no level selection): run the lexical
 * obfuscator first, then wrap the result in two self-extracting
 * zlib + base64 shells. Runtime output stays identical to the original.
 * @param {string} code
 * @returns {Promise<string>} obfuscated source
 */
export async function obfuscatePythonSingle(code) {
  const lexical = await obfuscatePython(code, 'max', {
    renameVariables: true,
    encryptStrings: true,
    obfuscateNumbers: true,
    removeComments: true,
  });
  let payload = wrapLayer(lexical);
  payload = wrapLayer(payload);
  const { shebang, coding } = extractHeader(code);
  return [shebang, coding, payload].filter(Boolean).join('\n') + '\n';
}
