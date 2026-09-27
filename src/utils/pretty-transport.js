// Thin re-export so pino's thread-stream worker can resolve pino-pretty
// from this project regardless of how node_modules is laid out.
import pretty from 'pino-pretty';

export default pretty;
