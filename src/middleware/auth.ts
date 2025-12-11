import { createMiddleware } from "hono/factory";
import type { Env } from "../types";

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

    if (token !== c.env.PACT_BROKER_TOKEN) {
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
