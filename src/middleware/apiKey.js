import crypto from 'node:crypto';
import { findKey, touchKey, countUsageSince, startOfToday } from '../db/index.js';
import { config } from '../config.js';
import { ObfuscationError } from '../core/errors.js';

/**
 * Generate a fresh API key: `sv_` + 24 random bytes as hex.
 * @returns {string}
 */
export function generateApiKey() {
  return `sv_${crypto.randomBytes(24).toString('hex')}`;
}

/**
 * Resolve the `X-API-Key` header against the database.
 * @param {import('fastify').FastifyRequest} request
 * @returns {object|null} the api_keys row, or null when no header was sent
 * @throws {ObfuscationError} INVALID_KEY when the header exists but is unknown or disabled
 */
export function requireApiKey(request) {
  const raw = request.headers['x-api-key'];
  if (!raw) {
    throw new ObfuscationError('INVALID_KEY', 'missing X-API-Key header');
  }
  const key = findKey(String(raw));
  if (!key) {
    throw new ObfuscationError('INVALID_KEY', 'unknown API key');
  }
  if (!key.enabled) {
    throw new ObfuscationError('INVALID_KEY', 'this API key has been disabled');
  }
  touchKey(key.id);
  return key;
}

/**
 * Soft resolver used inside the rate-limit key generator: never throws, so
 * a bad key still gets rate limited (per IP) before the 401 is raised.
 * @param {import('fastify').FastifyRequest} request
 * @returns {object|null}
 */
export function resolveApiKeySoft(request) {
  const raw = request.headers['x-api-key'];
  if (!raw) return null;
  const key = findKey(String(raw));
  if (!key || !key.enabled) {
    request.invalidApiKey = true;
    return null;
  }
  request.apiKey = key;
  return key;
}

/**
 * Fastify preHandler: rejects invalid keys and enforces the daily quota of
 * authenticated callers.
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 */
export async function enforceApiKeyAndQuota(request, reply) {
  if (request.invalidApiKey) {
    throw new ObfuscationError('INVALID_KEY', 'unknown or disabled API key');
  }

  const key = request.apiKey;
  if (!key) return;

  const midnightUtc = startOfToday();
  const usedToday = countUsageSince(key.id, midnightUtc);
  const quota = Math.min(key.daily_quota ?? config.keyDailyQuota, config.keyDailyQuota);
  if (usedToday >= quota) {
    const secondsUntilReset = midnightUtc + 86400 - Math.floor(Date.now() / 1000);
    reply.header('Retry-After', String(Math.max(1, secondsUntilReset)));
    throw new ObfuscationError('QUOTA_EXCEEDED', `daily quota of ${quota} requests exhausted; resets at 00:00 UTC`);
  }

  request.keyQuota = { usedToday, quota };
}
