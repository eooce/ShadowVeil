import { parentPort } from 'node:worker_threads';
import JavaScriptObfuscator from 'javascript-obfuscator';

/**
 * Worker thread entry: runs javascript-obfuscator off the event loop.
 * Protocol: { id, code, options } in → { id, code } | { id, error, code } out.
 */
parentPort.on('message', ({ id, code, options }) => {
  try {
    const out = JavaScriptObfuscator.obfuscate(code, options).getObfuscatedCode();
    parentPort.postMessage({ id, code: out });
  } catch (err) {
    parentPort.postMessage({ id, error: err instanceof Error ? err.message : String(err), code: 'INVALID_SYNTAX' });
  }
});
