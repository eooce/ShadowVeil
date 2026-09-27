import { ObfuscationError } from '../errors.js';

/**
 * A hand-written Python 3 tokenizer (lexer).
 *
 * It understands the lexical subset of Python needed for safe, semantics
 * preserving obfuscation:
 *   - strings: single/double/triple quotes, f/r/b/u prefixes and combos,
 *     escape sequences, f-string interpolation fields (nested quotes tracked)
 *   - comments (#) and shebang / PEP 263 coding declarations
 *   - logical lines with INDENT / DEDENT, bracket continuation and
 *     backslash line continuation
 *   - numbers (int / float / hex / oct / bin / imaginary, underscore groups)
 *
 * The tokenizer never evaluates code; it only produces a flat token stream.
 */

export const PY_KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break',
  'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally',
  'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal',
  'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
]);

/** Soft keywords must never be renamed: renaming would break `match` statements. */
export const PY_SOFT_KEYWORDS = new Set(['match', 'case', 'type']);

export const PY_BUILTINS = new Set([
  'abs', 'aiter', 'all', 'any', 'anext', 'ascii', 'bin', 'bool', 'breakpoint',
  'bytearray', 'bytes', 'callable', 'chr', 'classmethod', 'compile', 'complex',
  'delattr', 'dict', 'dir', 'divmod', 'enumerate', 'eval', 'exec', 'filter',
  'float', 'format', 'frozenset', 'getattr', 'globals', 'hasattr', 'hash',
  'hex', 'id', 'input', 'int', 'isinstance', 'issubclass', 'iter', 'len',
  'list', 'locals', 'map', 'max', 'memoryview', 'min', 'next', 'object',
  'oct', 'open', 'ord', 'pow', 'print', 'property', 'range', 'repr',
  'reversed', 'round', 'set', 'setattr', 'slice', 'sorted', 'staticmethod',
  'str', 'sum', 'super', 'tuple', 'type', 'vars', 'zip', '__import__',
  '__name__', '__file__', '__doc__', '__debug__', 'self', 'cls', '_', 'BaseException',
  'Exception', 'ArithmeticError', 'AttributeError', 'EOFError', 'IndexError',
  'KeyError', 'KeyboardInterrupt', 'LookupError', 'MemoryError', 'NameError',
  'NotImplementedError', 'OSError', 'OverflowError', 'RecursionError',
  'ReferenceError', 'RuntimeError', 'StopIteration', 'StopAsyncIteration',
  'SyntaxError', 'SystemError', 'SystemExit', 'TypeError', 'ValueError',
  'ZeroDivisionError', 'NotImplemented', 'Ellipsis', '__class__', '__init__',
]);

/** Longest-first operator table. */
const OPERATORS = [
  '**=', '//=', '>>=', '<<=', '...', '->', '!=', '>=', '<=', '==', ':=',
  '+=', '-=', '*=', '/=', '%=', '@=', '&=', '|=', '^=', '//', '**', '>>', '<<',
  '+', '-', '*', '/', '%', '@', '(', ')', '[', ']', '{', '}', ',', ':', ';',
  '.', '=', '<', '>', '&', '|', '^', '~',
];

const STRING_PREFIX_RE = /^[fFrRbBuU]{1,2}$/;

const VALID_PREFIXES = new Set(['r', 'u', 'b', 'f', 'br', 'rb', 'fr', 'rf']);

/**
 * @typedef {Object} PyToken
 * @property {string} type  NAME|KEYWORD|NUMBER|STRING|FSTRING|OP|NEWLINE|INDENT|DEDENT|COMMENT|EOF
 * @property {string} value raw source text of the token
 * @property {string} lead  whitespace between the previous token and this one ('' at line start)
 * @property {number} line  1-based source line
 * @property {boolean} [isPlainInt] NUMBER only: unsigned decimal integer literal
 */

/**
 * Tokenize Python source code.
 * @param {string} source
 * @returns {{tokens: PyToken[], indentUnit: number}}
 * @throws {ObfuscationError} on unterminated strings/brackets or bad indentation
 */
export function tokenizePython(source) {
  // Normalize invisible characters that ride along with code copied from
  // web pages / PDFs: NBSP and friends become plain spaces, zero-width
  // characters are dropped — otherwise they surface as confusing
  // "unexpected character" errors.
  const src = source
    .replace(/^\uFEFF/, '')
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    .replace(/[\u200B-\u200D\u2060]/g, '');
  const n = src.length;
  const tokens = [];
  const indents = [0];
  const bracketStack = [];
  let pos = 0;
  let line = 1;
  let atLineStart = true;
  let lineHasCode = false;
  let continued = false; // saw an explicit backslash continuation since last token
  let lastEnd = 0; // source offset where the previous token ended
  let indentUnit = 0; // detected indentation width (0 = unknown)

  const err = (message) => {
    throw new ObfuscationError('INVALID_SYNTAX', message, { line, column: pos });
  };

  /** Push a token, computing its leading whitespace. */
  function emit(type, value, extra = {}) {
    let lead;
    if (continued) {
      lead = ' ';
      continued = false;
    } else {
      const rawLead = src.slice(lastEnd, pos - value.length).replace(/\r/g, '');
      lead = rawLead.includes('\n') && bracketStack.length === 0 ? '' : rawLead;
      if (lead.includes('\n')) lead = ' ';
    }
    tokens.push({ type, value, lead, line, ...extra });
    lastEnd = pos;
    lineHasCode = true;
  }

  function columnOf(rawIndent) {
    let col = 0;
    for (const ch of rawIndent) col = ch === '\t' ? (Math.floor(col / 8) + 1) * 8 : col + 1;
    return col;
  }

  /** Consume the indentation of a physical line, emitting INDENT/DEDENT. */
  function handleIndentation() {
    const start = pos;
    while (pos < n && (src[pos] === ' ' || src[pos] === '\t')) pos++;
    const rawIndent = src.slice(start, pos);
    // Blank or comment-only lines never emit NEWLINE/INDENT/DEDENT.
    if (pos >= n || src[pos] === '\n' || src[pos] === '\r' || src[pos] === '#') return;
    const col = columnOf(rawIndent);
    const top = indents[indents.length - 1];
    if (col > top) {
      indents.push(col);
      if (!indentUnit && col > 0) indentUnit = col;
      tokens.push({ type: 'INDENT', value: rawIndent, lead: '', line });
    } else if (col < top) {
      while (indents.length > 1 && indents[indents.length - 1] > col) {
        indents.pop();
        tokens.push({ type: 'DEDENT', value: '', lead: '', line });
      }
      if (indents[indents.length - 1] !== col) {
        throw new ObfuscationError('INVALID_SYNTAX', 'unindent does not match any outer indentation level', { line, column: col });
      }
    }
  }

  /** Scan a string literal starting at an optional prefix. Returns the token. */
  function scanString(prefixStart, quoteStart) {
    const prefix = src.slice(prefixStart, quoteStart);
    const isF = /[fF]/.test(prefix);
    if (prefix && !VALID_PREFIXES.has(prefix.toLowerCase())) {
      err(`invalid string prefix '${prefix}'`);
    }
    const quote = src[quoteStart];
    const triple = src[quoteStart] === src[quoteStart + 1] && src[quoteStart] === src[quoteStart + 2];
    let i = quoteStart + (triple ? 3 : 1);
    const contentStart = i;
    let braceDepth = 0; // inside an f-string interpolation field
    let exprParen = 0; // parens inside the current interpolation field

    const unterminated = () => {
      throw new ObfuscationError('INVALID_SYNTAX', 'unterminated string literal', { line: src.slice(0, quoteStart).split('\n').length, column: quoteStart });
    };

    for (;;) {
      if (i >= n) unterminated();
      const ch = src[i];

      if (ch === '\\' && i + 1 < n) {
        i += 2;
        if (src[i - 1] === '\n') line++;
        continue;
      }

      if (ch === '\n') {
        if (!triple && braceDepth === 0) unterminated();
        line++;
        i++;
        continue;
      }

      if (isF && braceDepth === 0 && ch === '{') {
        if (src[i + 1] === '{') { i += 2; continue; } // literal {{
        braceDepth = 1;
        i++;
        continue;
      }

      if (isF && braceDepth > 0 && exprParen === 0 && ch === '}') {
        braceDepth = 0; // end of the interpolation field
        i++;
        continue;
      }

      if (isF && braceDepth > 0) {
        if (ch === '(' || ch === '[' || ch === '{') { exprParen++; i++; continue; }
        if (ch === ')' || ch === ']' || ch === '}') { exprParen--; i++; continue; }
        if (ch === '\'' || ch === '"') {
          // Quoted string inside an interpolation expression (PEP 701 nesting).
          const q = ch;
          const qTriple = src[i] === src[i + 1] && src[i] === src[i + 2];
          const qLen = qTriple ? 3 : 1;
          let j = i + qLen;
          for (;;) {
            if (j >= n) unterminated();
            if (src[j] === '\\') { j += 2; continue; }
            if (src[j] === '\n') {
              if (!qTriple) unterminated();
              line++;
              j++;
              continue;
            }
            if (src[j] === q && (!qTriple || (src[j + 1] === q && src[j + 2] === q))) {
              j += qLen;
              break;
            }
            j++;
          }
          i = j;
          continue;
        }
      }

      if (ch === quote) {
        if (!triple) {
          i++;
          break;
        }
        if (src[i + 1] === quote && src[i + 2] === quote) {
          i += 3;
          break;
        }
        i++;
        continue;
      }

      i++;
    }

    const end = i;
    pos = end;
    const value = src.slice(prefixStart, end);
    const content = src.slice(contentStart, end - (triple ? 3 : 1));
    const prefixLower = prefix.toLowerCase();
    emit(isF ? 'FSTRING' : 'STRING', value, {
      content,
      prefix: prefixLower,
      triple,
      quote: quote === '\'' ? '\'' : '"',
      isBytes: prefixLower.includes('b'),
      isRaw: prefixLower.includes('r'),
    });
  }

  /** Scan a numeric literal. */
  function scanNumber() {
    const start = pos;
    if (src[pos] === '0' && /[xXbBoO]/.test(src[pos + 1] ?? '')) {
      pos += 2;
      while (pos < n && /[0-9a-fA-F_]/.test(src[pos])) pos++;
    } else {
      while (pos < n && /[0-9_]/.test(src[pos])) pos++;
      if (src[pos] === '.' && pos + 1 < n && /[0-9]/.test(src[pos + 1])) {
        pos++;
        while (pos < n && /[0-9_]/.test(src[pos])) pos++;
      }
      if (/[eE]/.test(src[pos] ?? '') && /[0-9+-]/.test(src[pos + 1] ?? '')) {
        pos++;
        if (/[+-]/.test(src[pos])) pos++;
        while (pos < n && /[0-9_]/.test(src[pos])) pos++;
      }
      if (/[jJ]/.test(src[pos] ?? '')) pos++;
    }
    const value = src.slice(start, pos);
    emit('NUMBER', value, { isPlainInt: /^\d[\d_]*$/.test(value) });
  }

  /** Scan an identifier / keyword, possibly turning into a string prefix. */
  function scanName() {
    const start = pos;
    while (pos < n && /[\w\u00c0-\uffff]/.test(src[pos])) pos++;
    const name = src.slice(start, pos);
    if (name.length <= 2 && STRING_PREFIX_RE.test(name) && (src[pos] === '\'' || src[pos] === '"')) {
      scanString(start, pos);
      return;
    }
    emit(PY_KEYWORDS.has(name) ? 'KEYWORD' : 'NAME', name, {});
  }

  while (pos < n) {
    if (atLineStart && bracketStack.length === 0) {
      handleIndentation();
      atLineStart = false;
      if (pos >= n) break;
    }
    const ch = src[pos];

    if (ch === ' ' || ch === '\t' || ch === '\r') {
      pos++;
      continue;
    }

    if (ch === '\\' && src[pos + 1] === '\n') {
      pos += 2;
      line++;
      continued = true;
      continue;
    }
    if (ch === '\\' && src[pos + 1] === '\r' && src[pos + 2] === '\n') {
      pos += 3;
      line++;
      continued = true;
      continue;
    }

    if (ch === '\n') {
      pos++;
      if (bracketStack.length === 0 && lineHasCode) emit('NEWLINE', '\n');
      line++;
      atLineStart = true;
      lineHasCode = false;
      lastEnd = pos;
      continue;
    }

    if (ch === '#') {
      const start = pos;
      while (pos < n && src[pos] !== '\n') pos++;
      const value = src.slice(start, pos);
      tokens.push({ type: 'COMMENT', value, lead: lineHasCode ? ' ' : '', line });
      lastEnd = pos;
      continue;
    }

    if (ch === '\'' || ch === '"') {
      scanString(pos, pos);
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[pos + 1] ?? ''))) {
      scanNumber();
      continue;
    }

    if (/[\w\u00c0-\uffff]/.test(ch)) {
      scanName();
      continue;
    }

    // Operator via longest match ('!' only ever appears inside '!=', so the
    // dispatch cannot test single characters alone).
    const opCandidate = OPERATORS.find((candidate) => src.startsWith(candidate, pos));
    if (opCandidate) {
      if (opCandidate === '(' || opCandidate === '[' || opCandidate === '{') bracketStack.push({ ch: opCandidate, line });
      else if (opCandidate === ')' || opCandidate === ']' || opCandidate === '}') {
        const open = bracketStack.pop();
        if (!open || !matches(open.ch, opCandidate)) {
          throw new ObfuscationError('INVALID_SYNTAX', `unmatched closing '${opCandidate}'`, { line, column: pos });
        }
      }
      pos += opCandidate.length;
      emit('OP', opCandidate, {});
      continue;
    }

    err(`unexpected character '${ch}' (U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')})`);
  }

  if (bracketStack.length > 0) {
    const open = bracketStack[bracketStack.length - 1];
    throw new ObfuscationError('INVALID_SYNTAX', `bracket '${open.ch}' opened on line ${open.line} was never closed`, { line: open.line });
  }

  if (lineHasCode) tokens.push({ type: 'NEWLINE', value: '\n', lead: '', line });
  while (indents.length > 1) {
    indents.pop();
    tokens.push({ type: 'DEDENT', value: '', lead: '', line });
  }
  tokens.push({ type: 'EOF', value: '', lead: '', line });

  return { tokens, indentUnit };
}

function matches(open, close) {
  return (open === '(' && close === ')') || (open === '[' && close === ']') || (open === '{' && close === '}');
}
