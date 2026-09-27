import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Minimal .env loader (no external dependency, Node 20+ compatible). */
function loadEnvFile() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile();

function intEnv(name, fallback) {
  const raw = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

const projectRoot = path.resolve(__dirname, '..');

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  isProduction: (process.env.NODE_ENV ?? 'development') === 'production',
  port: intEnv('PORT', 3000),
  host: process.env.HOST ?? '0.0.0.0',
  dbPath: path.resolve(projectRoot, process.env.DB_PATH ?? 'data/shadowveil.db'),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  /** Max accepted source code size in bytes (200KB). */
  maxCodeBytes: intEnv('MAX_CODE_BYTES', 200 * 1024),
  /** Anonymous requests per minute, per IP. */
  anonRateLimit: intEnv('ANON_RATE_LIMIT', 10),
  /** Authenticated requests per minute, per API key. */
  keyRateLimit: intEnv('KEY_RATE_LIMIT', 100),
  /** Authenticated requests per day, per API key. */
  keyDailyQuota: intEnv('KEY_DAILY_QUOTA', 5000),
  /** Requests per minute allowed on the key-issuing endpoint. */
  keyIssueRateLimit: intEnv('KEY_ISSUE_RATE_LIMIT', 5),
  version: '1.0.0',
};
