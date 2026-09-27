import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { printBanner } from './utils/banner.js';
import { registerErrorHandler } from './middleware/errorHandler.js';
import { registerRateLimit } from './middleware/rateLimit.js';
import { registerApiRoutes } from './routes/api.js';
import { registerPageRoutes } from './routes/pages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Fastify only logs at warn+ so request noise stays out of the console while
// structured error logs (warn/error from the error handler) still surface.
const httpLogger = logger.child({ name: 'http' });
httpLogger.level = 'warn';

const fastify = Fastify({
  loggerInstance: httpLogger,
  genReqId: () => crypto.randomUUID(),
  requestIdHeader: false,
  trustProxy: true,
  bodyLimit: config.maxCodeBytes + 256 * 1024,
});

/** Minimal CORS support so the API can be called from any origin. */
fastify.addHook('onRequest', async (request, reply) => {
  reply.header('Access-Control-Allow-Origin', '*');
  reply.header('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
  reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (request.raw.method === 'OPTIONS') {
    return reply.status(204).send();
  }
});

/** Attach the request id to every JSON payload sent by the API. */
fastify.addHook('onSend', async (request, reply, payload) => {
  const contentType = reply.getHeader('content-type');
  if (typeof contentType === 'string' && contentType.includes('application/json') && typeof payload === 'string') {
    try {
      const body = JSON.parse(payload);
      if (body && typeof body === 'object' && body.requestId === undefined && !request.raw.url.startsWith('/api/')) {
        body.requestId = request.id;
        return JSON.stringify(body);
      }
    } catch {
      // not JSON after all — leave untouched
    }
  }
  return payload;
});

await registerRateLimit(fastify);

await fastify.register(fastifyStatic, {
  root: path.resolve(__dirname, '..', 'public'),
  prefix: '/',
  index: 'index.html',
  extensions: ['html'],
});

registerErrorHandler(fastify);
await registerPageRoutes(fastify);
await registerApiRoutes(fastify);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    fastify.log.info(`${signal} received — shutting down`);
    await fastify.close();
    process.exit(0);
  });
}

try {
  await fastify.listen({ port: config.port, host: config.host });
  printBanner({
    port: config.port,
    env: config.env,
    dbPath: path.relative(process.cwd(), config.dbPath) || config.dbPath,
    version: config.version,
  });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
