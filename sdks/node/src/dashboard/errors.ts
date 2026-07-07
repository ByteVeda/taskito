// Typed exceptions for the dashboard package. HTTP-mapped errors carry a
// status the server returns verbatim; store-level validation errors are
// transport-agnostic and map to 400 at the HTTP boundary.

/** Base for errors that map directly to an HTTP response. */
export class DashboardError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = new.target.name;
    this.status = status;
  }
}

/** Malformed or unacceptable request input (400). */
export class BadRequestError extends DashboardError {
  constructor(message: string) {
    super(400, message);
  }
}

/** Missing resource, or one deliberately reported as absent (404). */
export class NotFoundError extends DashboardError {
  constructor(message: string) {
    super(404, message);
  }
}

/** No valid session/token on a protected route (401). */
export class UnauthorizedError extends DashboardError {
  constructor(message = "not_authenticated") {
    super(401, message);
  }
}

/** Authenticated but not allowed: CSRF failure or missing role (403). */
export class ForbiddenError extends DashboardError {
  constructor(message: string) {
    super(403, message);
  }
}

/** No users exist yet — the SPA must run the first-admin setup flow (503). */
export class SetupRequiredError extends DashboardError {
  constructor() {
    super(503, "setup_required");
  }
}

/**
 * Invalid input rejected by a dashboard store (auth, overrides, middleware
 * toggles). Transport-agnostic so `Queue`-level callers get a plain error;
 * the HTTP server maps it to a 400 response.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
