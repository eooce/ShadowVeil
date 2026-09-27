import { JS_PRESETS, JS_OPTION_KEYS } from './presets.js';
import { runInWorker } from './worker-pool.js';

/**
 * Map frontend advanced switches onto javascript-obfuscator options.
 * @param {Record<string, unknown>} options raw advanced options from the request
 * @returns {Record<string, unknown>} sanitized overrides
 */
export function sanitizeJsOptions(options = {}) {
  const out = {};
  for (const key of JS_OPTION_KEYS) {
    if (typeof options[key] === 'boolean') out[key] = options[key];
  }
  if (
    typeof options.identifierNamesGenerator === 'string' &&
    ['hexadecimal', 'mangled', 'mangled-shuffled'].includes(options.identifierNamesGenerator)
  ) {
    out.identifierNamesGenerator = options.identifierNamesGenerator;
  }
  return out;
}

/**
 * Obfuscate JavaScript source with javascript-obfuscator, running on a
 * worker thread so the event loop stays responsive during the CPU-bound
 * transformation.
 * @param {string} code
 * @param {'light'|'standard'|'max'} level
 * @param {Record<string, unknown>} options advanced overrides (validated)
 * @returns {Promise<string>} obfuscated code
 */
export async function obfuscateJavaScript(code, level, options = {}) {
  const presetOptions = { ...JS_PRESETS[level], ...options, sourceMap: false, sourceMapBaseUrl: '' };
  return runInWorker({ code, options: presetOptions });
}
