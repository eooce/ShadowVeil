import rateLimit from '@fastify/rate-limit';
import { config } from '../config.js';
import { resolveApiKeySoft } from './apiKey.js';

/**
 * Register @fastify/rate-limit (non-global). Each protected route opts in
 * through its `config.rateLimit` options.
 *
 * The obfuscate endpoint uses a dynamic bucket: authenticated requests are
 * keyed by API key id and get KEY_RATE_LIMIT requests/minute, anonymous
 * requests are keyed by IP and get ANON_RATE_LIMIT requests/minute.
 * Daily quotas are enforced separately in the API key middleware.
 */
export async function registerRateLimit(fastify) {
  await fastify.register(rateLimit, { global: false });
}

/**
 * Rate-limit options for POST /api/v1/obfuscate.
 * @param {number} anonLimit override for tests
 * @param {number} keyLimit override for tests
 */
export function obfuscateRateLimitOptions() {
  return {
    max: (request, key) => (key.startsWith('key:') ? config.keyRateLimit : config.anonRateLimit),
    timeWindow: '1 minute',
    keyGenerator: async (request) => {
      const key = resolveApiKeySoft(request);
      return key ? `key:${key.id}` : `ip:${request.ip}`;
    },
    errorResponseBuilder: (request, context) => ({
      statusCode: 429,
      success: false,
      requestId: request.id,
      error: {
        code: 'RATE_LIMITED',
        message: request.apiKey
          ? `rate limit exceeded: ${config.keyRateLimit} requests/minute for keyed callers`
          : `rate limit exceeded: ${config.anonRateLimit} requests/minute for anonymous callers — get a free API key below`,
      },
      retryAfter: context.after,
    }),
  };
}

/** Rate-limit options for the key-issuing endpoint (per IP). */
export function keyIssueRateLimitOptions() {
  return {
    max: config.keyIssueRateLimit,
    timeWindow: '1 minute',
    keyGenerator: (request) => `issue:${request.ip}`,
    errorResponseBuilder: (request) => ({
      statusCode: 429,
      success: false,
      requestId: request.id,
      error: {
        code: 'RATE_LIMITED',
        message: `too many keys requested from this address; try again in a minute`,
      },
    }),
  };
}
