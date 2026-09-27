import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '..', '..', 'public');

/** Static page routes: one page per navigation entry. */
export async function registerPageRoutes(fastify) {
  fastify.get('/', { logLevel: 'warn' }, async (request, reply) => {
    return reply.sendFile('index.html');
  });

  fastify.get('/docs', { logLevel: 'warn' }, async (request, reply) => {
    return reply.sendFile('docs.html');
  });

  fastify.get('/pricing', { logLevel: 'warn' }, async (request, reply) => {
    return reply.sendFile('pricing.html');
  });

  fastify.get('/about', { logLevel: 'warn' }, async (request, reply) => {
    return reply.sendFile('about.html');
  });

  fastify.get('/favicon.svg', async (request, reply) => {
    return reply.sendFile('assets/logo.svg');
  });

  void publicDir;
}
