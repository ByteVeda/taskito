// Typed HTTP errors thrown by dashboard handlers; the server maps them to
// JSON error responses without leaking internals.

/** Handler-level error carrying an HTTP status and a stable error code. */
export class DashboardError extends Error {
  readonly status: number;

  constructor(status: number, code: string) {
    super(code);
    this.name = "DashboardError";
    this.status = status;
  }
}

export const badRequest = (code: string): DashboardError => new DashboardError(400, code);
export const notFound = (code: string): DashboardError => new DashboardError(404, code);
