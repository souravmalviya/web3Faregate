/**
 * Thrown by handlers to produce a structured error response.
 *
 * Fields are declared and assigned explicitly rather than using TypeScript
 * parameter properties. Node runs these sources directly with type stripping,
 * which erases types but cannot emit code, so `constructor(readonly x: T)` is a
 * runtime syntax error. The same rule rules out enums and decorators here.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}
