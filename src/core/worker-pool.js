import os from 'node:os';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = path.resolve(__dirname, 'obfuscate-worker.js');

const MAX_WORKERS = Math.max(1, Math.min(4, os.availableParallelism() - 1));

const idle = [];
const waiting = [];
let total = 0;
let nextTaskId = 0;

function acquireWorker() {
  if (idle.length > 0) return Promise.resolve(idle.pop());
  if (total < MAX_WORKERS) {
    total++;
    return Promise.resolve(new Worker(WORKER_PATH));
  }
  return new Promise((resolve) => waiting.push(resolve));
}

function releaseWorker(worker) {
  const next = waiting.shift();
  if (next) next(worker);
  else idle.push(worker);
}

/**
 * Run a task on a pooled worker thread.
 * @param {{code: string, options: object}} payload
 * @returns {Promise<string>} obfuscated output
 */
export function runInWorker(payload) {
  return acquireWorker().then(
    (worker) =>
      new Promise((resolve, reject) => {
        const taskId = ++nextTaskId;
        const onMessage = (msg) => {
          if (msg.id !== taskId) return;
          cleanup();
          releaseWorker(worker);
          if (msg.error) {
            const err = new Error(msg.error);
            err.code = msg.code ?? 'INTERNAL_ERROR';
            reject(err);
          } else {
            resolve(msg.code);
          }
        };
        const onError = (err) => {
          cleanup();
          total--;
          reject(err instanceof Error ? err : new Error(String(err)));
        };
        const cleanup = () => {
          worker.off('message', onMessage);
          worker.off('error', onError);
        };
        worker.on('message', onMessage);
        worker.on('error', onError);
        worker.postMessage({ id: taskId, ...payload });
      })
  );
}
