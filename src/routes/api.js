import { z } from 'zod';
import { obfuscate } from '../core/index.js';
import { ObfuscationError } from '../core/errors.js';
import { LANGUAGES } from '../core/presets.js';
import { config } from '../config.js';
import { getOrCreateKey, findByEmail, countUsageSince, countUsageTotal, startOfToday, logUsage } from '../db/index.js';
import { generateApiKey, requireApiKey, enforceApiKeyAndQuota } from '../middleware/apiKey.js';
import { obfuscateRateLimitOptions, keyIssueRateLimitOptions } from '../middleware/rateLimit.js';

const obfuscateBodySchema = z.object({
  language: z.enum(['javascript', 'python', 'shell']),
  code: z.string().min(1, 'code is required'),
  // javascript: light|standard|max (default standard); python: light
  // (compress-only shell) | high (lexical + shells, default high);
  // shell: base64|high — legacy light|standard|max accepted.
  level: z.enum(['light', 'standard', 'max', 'base64', 'high']).optional(),
  options: z
    .object({
      selfDefending: z.boolean().optional(),
      debugProtection: z.boolean().optional(),
      controlFlowFlattening: z.boolean().optional(),
      deadCodeInjection: z.boolean().optional(),
      stringArray: z.boolean().optional(),
      identifierNamesGenerator: z.enum(['hexadecimal', 'mangled', 'mangled-shuffled']).optional(),
    })
    .optional(),
});

const keyBodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
});

/**
 * Register all /api/v1 endpoints.
 * @param {import('fastify').FastifyInstance} fastify
 */
export async function registerApiRoutes(fastify) {
  // ---------------------------------------------------------------- health
  fastify.get('/api/v1/health', async () => ({
    success: true,
    requestId: null,
    data: {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      version: config.version,
      languages: Object.keys(LANGUAGES),
    },
  }));

  // ------------------------------------------------------------- languages
  fastify.get('/api/v1/languages', async () => ({
    success: true,
    requestId: null,
    data: {
      languages: Object.values(LANGUAGES).map((lang) => ({
        id: lang.id,
        label: lang.label,
        extension: lang.extension,
        levels: lang.levels.map((lvl) => ({ id: lvl.id, label: lvl.label })),
        defaultLevel: lang.defaultLevel,
        note: lang.levelNote,
      })),
    },
  }));

  // ------------------------------------------------------------- obfuscate
  fastify.post('/api/v1/obfuscate', {
    config: { rateLimit: obfuscateRateLimitOptions() },
    preHandler: enforceApiKeyAndQuota,
    bodyLimit: config.maxCodeBytes + 64 * 1024,
  }, async (request, reply) => {
    const parsed = obfuscateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ObfuscationError('INVALID_REQUEST', `${issue.path.join('.') || 'body'}: ${issue.message}`);
    }

    const { language, code, level, options } = parsed.data;
    const codeBytes = Buffer.byteLength(code, 'utf8');
    if (codeBytes > config.maxCodeBytes) {
      throw new ObfuscationError('CODE_TOO_LARGE', `code is ${codeBytes} bytes; the limit is ${config.maxCodeBytes} bytes`);
    }

    const startedAt = Date.now();
    let result;
    try {
      result = await obfuscate(code, language, level, options ?? {});
    } catch (err) {
      logUsage({
        apiKeyId: request.apiKey?.id ?? null,
        ip: request.ip,
        language,
        inputSize: codeBytes,
        outputSize: 0,
        durationMs: Date.now() - startedAt,
        success: false,
      });
      throw err;
    }

    logUsage({
      apiKeyId: request.apiKey?.id ?? null,
      ip: request.ip,
      language,
      inputSize: result.stats.originalSize,
      outputSize: result.stats.outputSize,
      durationMs: result.stats.duration,
      success: true,
    });

    return reply.send({
      success: true,
      requestId: request.id,
      data: { code: result.code, stats: result.stats },
    });
  });

  // ------------------------------------------------------------- issue key
  fastify.post('/api/v1/keys', {
    config: { rateLimit: keyIssueRateLimitOptions() },
  }, async (request, reply) => {
    const parsed = keyBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ObfuscationError('INVALID_REQUEST', `email: ${parsed.error.issues[0]?.message ?? 'invalid email address'}`);
    }

    const email = parsed.data.email;
    const existed = Boolean(findByEmail(email));
    const key = getOrCreateKey(email, generateApiKey());

    return reply.status(existed ? 200 : 201).send({
      success: true,
      requestId: request.id,
      data: {
        key: key.key,
        email: key.email,
        createdAt: key.created_at,
        dailyQuota: key.daily_quota ?? config.keyDailyQuota,
        perMinute: config.keyRateLimit,
        existing: existed,
      },
    });
  });

  // ------------------------------------------------------------- key usage
  fastify.get('/api/v1/keys/me', { preHandler: async (request) => { request.apiKey = requireApiKey(request); } }, async (request) => {
    const key = request.apiKey;
    const midnightUtc = startOfToday();
    const quota = key.daily_quota ?? config.keyDailyQuota;
    const usedToday = countUsageSince(key.id, midnightUtc);
    const usedTotal = countUsageTotal(key.id);

    return {
      success: true,
      requestId: request.id,
      data: {
        keyPreview: `${key.key.slice(0, 8)}…${key.key.slice(-4)}`,
        email: key.email,
        createdAt: key.created_at,
        lastUsedAt: key.last_used_at,
        enabled: Boolean(key.enabled),
        usage: {
          today: usedToday,
          total: usedTotal,
          dailyQuota: quota,
          remainingToday: Math.max(0, quota - usedToday),
          perMinute: config.keyRateLimit,
        },
      },
    };
  });
}
