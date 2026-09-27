import { logger } from '../utils/logger.js';
import { ObfuscationError } from '../core/errors.js';

/**
 * Global error handler: every failure becomes a structured JSON envelope,
 * never a raw 500 stack trace. ObfuscationError instances carry their own
 * machine readable code and HTTP status.
 */
export function registerErrorHandler(fastify) {
  fastify.setErrorHandler((err, request, reply) => {
    const requestId = request.id;

    if (err instanceof ObfuscationError || err.code === 'INVALID_SYNTAX' || err.code === 'CODE_TOO_LARGE' || err.code === 'INVALID_KEY') {
      const code = err.code ?? 'INTERNAL_ERROR';
      const statusMap = { INVALID_SYNTAX: 422, CODE_TOO_LARGE: 413, INVALID_KEY: 401 };
      const status = statusMap[code] ?? 400;
      request.log.warn({ code, message: err.message }, 'obfuscation error');
      return reply.status(status).send({
        success: false,
        requestId,
        error: { code, message: err.message },
      });
    }

    if (err.validation) {
      const field = err.validation[0]?.instancePath?.replace(/^\//, '') ?? 'body';
      return reply.status(400).send({
        success: false,
        requestId,
        error: {
          code: 'INVALID_REQUEST',
          message: `invalid request: ${field} ${err.validation[0]?.message ?? 'failed validation'}`,
        },
      });
    }

    if (err.statusCode === 429 && err.error?.code) {
      // thrown by @fastify/rate-limit's errorResponseBuilder — the object
      // already carries our structured envelope.
      const { statusCode, ...body } = err;
      return reply.status(429).send(body);
    }

    if (err.statusCode === 429) {
      return reply.status(429).send({
        success: false,
        requestId,
        error: { code: 'RATE_LIMITED', message: err.message ?? 'too many requests' },
      });
    }

    if (err.statusCode === 413) {
      return reply.status(413).send({
        success: false,
        requestId,
        error: { code: 'CODE_TOO_LARGE', message: err.message ?? 'payload too large' },
      });
    }

    logger.error({ err, requestId }, 'unhandled error');
    return reply.status(500).send({
      success: false,
      requestId,
      error: { code: 'INTERNAL_ERROR', message: 'an unexpected error occurred' },
    });
  });

  fastify.setNotFoundHandler((request, reply) => {
    if (request.raw.url?.startsWith('/api/')) {
      return reply.status(404).send({
        success: false,
        requestId: request.id,
        error: { code: 'NOT_FOUND', message: `no such endpoint: ${request.raw.method} ${request.raw.url}` },
      });
    }
    return reply.status(404).send(
      `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>404 — ShadowVeil</title>` +
      `<meta http-equiv="refresh" content="3;url=/"><style>body{font-family:system-ui,sans-serif;background:#0A100D;color:#8B9C8F;` +
      `display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;gap:8px}` +
      `h1{font-size:64px;margin:0;background:linear-gradient(135deg,#3F7A59,#58B088,#7CC5C9);-webkit-background-clip:text;background-clip:text;color:transparent}` +
      `p{margin:0}a{color:#8ED0D4}</style></head><body><h1>404</h1><p>此页面隐入了暗影。</p><p><a href="/">返回首页</a> · 3 秒后自动跳转</p></body></html>`
    );
  });
}
