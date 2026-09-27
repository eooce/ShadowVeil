import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import pino from 'pino';
import { config } from '../config.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Create the shared pino logger.
 *
 * In development, pino-pretty is used when it is resolvable so logs stay
 * human-readable; production always emits structured JSON.
 */
function createLogger() {
  const options = {
    level: config.logLevel,
    base: { app: 'shadowveil' },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (!config.isProduction) {
    try {
      require.resolve('pino-pretty');
      options.transport = {
        target: path.resolve(__dirname, 'pretty-transport.js'),
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname,app' },
      };
    } catch {
      // pino-pretty not installed — fall back to plain JSON output.
    }
  }

  return pino(options);
}

export const logger = createLogger();
