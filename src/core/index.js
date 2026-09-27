import { obfuscateJavaScript, sanitizeJsOptions } from './javascript.js';
import { obfuscatePythonSingle } from './python/obfuscator.js';
import { obfuscateShell } from './shell.js';
import { normalizeLevel } from './presets.js';
import { buildStats } from '../utils/stats.js';
import { ObfuscationError } from './errors.js';

export { ObfuscationError };

/**
 * Unified obfuscation entry point.
 *
 * Levels: JavaScript uses light|standard|max (default standard); Python has
 * a single mode and ignores the level; Shell uses base64|high, with the
 * legacy light|standard|max values mapped onto them.
 *
 * @param {string} code source code to obfuscate
 * @param {'javascript'|'python'|'shell'} language
 * @param {string|undefined} level raw level from the request
 * @param {Record<string, unknown>} [options] advanced options (javascript API only)
 * @returns {Promise<{code: string, stats: {originalSize: number, outputSize: number, ratio: number, duration: number}}>}
 * @throws {ObfuscationError} with a machine readable `code` on failure
 */
export async function obfuscate(code, language, level, options = {}) {
  const engineLevel = normalizeLevel(language, level);
  const startedAt = performance.now();

  let output;
  switch (language) {
    case 'javascript':
      output = await obfuscateJavaScript(code, engineLevel, sanitizeJsOptions(options));
      break;
    case 'python':
      output = await obfuscatePythonSingle(code);
      break;
    case 'shell':
      output = await obfuscateShell(code, engineLevel);
      break;
    default:
      throw new ObfuscationError('UNSUPPORTED_LANGUAGE', `language '${language}' is not supported`);
  }

  return { code: output, stats: buildStats(code, output, startedAt) };
}
