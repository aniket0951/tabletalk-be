import type { Context } from "hono";

interface SuccessResponse<T> {
  status_code: 200;
  message: string;
  data: T;
}

interface ErrorResponse {
  status_code: 422 | 401 | 500;
  message: string;
  debug_message?: string;
  code?: string;
  data: null;
}

export function success<T>(c: Context, data: T, message = "Success") {
  return c.json<SuccessResponse<T>>({ status_code: 200, message, data });
}

export function validationError(c: Context, message: string, debugOrCode?: string, code?: string) {
  const body: ErrorResponse = { status_code: 422, message, data: null };
  if (code) {
    body.debug_message = debugOrCode;
    body.code = code;
  } else if (debugOrCode) {
    // If only one extra arg, check if it looks like a machine-readable code (UPPER_SNAKE)
    if (/^[A-Z_]+$/.test(debugOrCode)) {
      body.code = debugOrCode;
    } else {
      body.debug_message = debugOrCode;
    }
  }
  return c.json(body, 422);
}

export function authError(c: Context, message = "Unauthorized") {
  return c.json<ErrorResponse>({ status_code: 401, message, data: null }, 401);
}

export function serverError(c: Context, debug?: string) {
  const body: ErrorResponse = { status_code: 500, message: "Server error", data: null };
  if (debug) body.debug_message = debug;
  return c.json(body, 500);
}
