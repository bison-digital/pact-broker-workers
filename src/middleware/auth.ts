import { createMiddleware } from "hono/factory";
import type { Env } from "../types";

/**
 * Constant-time string comparison to prevent timing attacks.
 * Always compares all bytes regardless of where differences occur.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do a comparison to maintain constant time for same-length checks
    // but we'll return false regardless
    const dummy = "x".repeat(b.length);
    let result = 0;
    for (let i = 0; i < dummy.length; i++) {
      result |= dummy.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Bearer token authentication middleware.
 *
 * Checks for Authorization: Bearer <token> header and validates against
 * the PACT_BROKER_TOKEN environment variable.
 *
 * If ALLOW_PUBLIC_READ is "true", GET/HEAD requests are allowed without auth.
 */
export const authMiddleware = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    const method = c.req.method;
    const allowPublicRead = c.env.ALLOW_PUBLIC_READ === "true";

    // Allow public read if configured
    if (allowPublicRead && (method === "GET" || method === "HEAD")) {
      return next();
    }

    // Validate that PACT_BROKER_TOKEN is configured
    if (!c.env.PACT_BROKER_TOKEN || c.env.PACT_BROKER_TOKEN.length < 8) {
      console.error("PACT_BROKER_TOKEN is not configured or too short (min 8 chars)");
      return c.json(
        {
          error: "Internal Server Error",
          message: "Authentication not configured",
        },
        500
      );
    }

    const authHeader = c.req.header("Authorization");

    if (!authHeader) {
      return c.json(
        {
          error: "Unauthorized",
          message: "Missing Authorization header",
        },
        401
      );
    }

    const [scheme, token] = authHeader.split(" ");

    if (scheme !== "Bearer" || !token) {
      return c.json(
        {
          error: "Unauthorized",
          message: "Invalid Authorization header format. Expected: Bearer <token>",
        },
        401
      );
    }

    // Use constant-time comparison to prevent timing attacks
    if (!timingSafeEqual(token, c.env.PACT_BROKER_TOKEN)) {
      return c.json(
        {
          error: "Unauthorized",
          message: "Invalid token",
        },
        401
      );
    }

    return next();
  }
);
