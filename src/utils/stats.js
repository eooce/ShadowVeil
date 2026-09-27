/**
 * Build usage statistics comparing original and obfuscated code.
 * @param {string} originalCode
 * @param {string} obfuscatedCode
 * @param {number} startedAtMs  performance.now() captured before obfuscation
 * @returns {{originalSize: number, outputSize: number, ratio: number, duration: number}}
 */
export function buildStats(originalCode, obfuscatedCode, startedAtMs) {
  const originalSize = Buffer.byteLength(originalCode, 'utf8');
  const outputSize = Buffer.byteLength(obfuscatedCode, 'utf8');
  const duration = Math.max(0, Math.round(performance.now() - startedAtMs));
  const ratio = originalSize > 0 ? Number((outputSize / originalSize).toFixed(2)) : 0;
  return { originalSize, outputSize, ratio, duration };
}
