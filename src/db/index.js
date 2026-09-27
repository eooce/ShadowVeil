import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'db' });

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS api_keys (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    key           TEXT UNIQUE NOT NULL,
    email         TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    last_used_at  INTEGER,
    daily_quota   INTEGER DEFAULT 5000,
    enabled       INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS usage_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    api_key_id  INTEGER,
    ip          TEXT,
    language    TEXT,
    input_size  INTEGER,
    output_size INTEGER,
    duration_ms INTEGER,
    success     INTEGER,
    created_at  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_usage_logs_key_time ON usage_logs (api_key_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at ON usage_logs (created_at);
`);

log.info({ dbPath: config.dbPath }, 'sqlite database ready');

/** Start of "today" (UTC midnight) as a unix timestamp in seconds. */
export function startOfToday() {
  const now = new Date();
  return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000);
}

const stmts = {
  insertKey: db.prepare('INSERT INTO api_keys (key, email, created_at) VALUES (?, ?, ?)'),
  findByEmail: db.prepare('SELECT * FROM api_keys WHERE email = ? LIMIT 1'),
  findByKey: db.prepare('SELECT * FROM api_keys WHERE key = ? LIMIT 1'),
  findById: db.prepare('SELECT * FROM api_keys WHERE id = ? LIMIT 1'),
  touchKey: db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?'),
  countSince: db.prepare('SELECT COUNT(*) AS n FROM usage_logs WHERE api_key_id = ? AND created_at >= ?'),
  countTotal: db.prepare('SELECT COUNT(*) AS n FROM usage_logs WHERE api_key_id = ?'),
  insertLog: db.prepare(`
    INSERT INTO usage_logs (api_key_id, ip, language, input_size, output_size, duration_ms, success, created_at)
    VALUES (@apiKeyId, @ip, @language, @inputSize, @outputSize, @durationMs, @success, @createdAt)
  `),
};

/**
 * Return the API key record for an email, creating one when missing.
 * @param {string} email
 * @param {string} key
 */
export function getOrCreateKey(email, key) {
  const existing = stmts.findByEmail.get(email);
  if (existing) return existing;
  const info = stmts.insertKey.run(key, email, Math.floor(Date.now() / 1000));
  return stmts.findById.get(Number(info.lastInsertRowid));
}

/** @param {string} key */
export function findKey(key) {
  return stmts.findByKey.get(key);
}

/** Look up an API key row by email. @param {string} email */
export function findByEmail(email) {
  return stmts.findByEmail.get(email);
}

/** @param {number} id */
export function touchKey(id) {
  stmts.touchKey.run(Math.floor(Date.now() / 1000), id);
}

/**
 * Number of requests a key has made since a given unix timestamp (seconds).
 * @param {number} keyId
 * @param {number} sinceSeconds
 */
export function countUsageSince(keyId, sinceSeconds) {
  return stmts.countSince.get(keyId, sinceSeconds).n;
}

/** Total logged requests for a key. @param {number} keyId */
export function countUsageTotal(keyId) {
  return stmts.countTotal.get(keyId).n;
}

/**
 * Persist one usage log entry.
 * @param {{apiKeyId: number|null, ip: string, language: string, inputSize: number, outputSize: number, durationMs: number, success: boolean}} entry
 */
export function logUsage(entry) {
  stmts.insertLog.run({
    apiKeyId: entry.apiKeyId ?? null,
    ip: entry.ip ?? null,
    language: entry.language,
    inputSize: entry.inputSize,
    outputSize: entry.outputSize ?? 0,
    durationMs: entry.durationMs ?? 0,
    success: entry.success ? 1 : 0,
    createdAt: Math.floor(Date.now() / 1000),
  });
}

export default db;
