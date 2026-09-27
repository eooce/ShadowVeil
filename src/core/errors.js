/**
 * Shared error type for all obfuscation failures.
 * `code` is surfaced to API clients in the structured error response.
 */
export class ObfuscationError extends Error {
  /**
   * @param {string} code machine readable error code
   * @param {string} message human readable message
   * @param {{line?: number, column?: number}} [position]
   */
  constructor(code, message, position) {
    super(message);
    this.name = 'ObfuscationError';
    this.code = code;
    this.line = position?.line;
    this.column = position?.column;
  }
}
