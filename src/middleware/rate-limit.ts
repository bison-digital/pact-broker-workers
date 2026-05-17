import { createMiddleware } from "hono/factory";
import type { HonoEnv } from "../types";

/**
 * Paths that bypass rate limiting unconditionally. Orchestrator health
 * probes must remain reachable even when the rest of the API is being
 * abused.
 */
const PUBLIC_PATHS = new Set(["/health"]);

/**
 * HTTP methods routed to the mutating limiter (lower threshold). All
 * other methods go to the read limiter.
 */
const MUTATING_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

/**
 * Per-IP rate limit via the Workers Rate Limiting API.
 *
 * Two bindings (`MUTATING_RATE_LIMITER`, `READ_RATE_LIMITER`) are
 * declared in `wrangler.jsonc.tmpl`. The middleware picks one based on
 * request method and calls `.limit({ key })` keyed on Cloudflare's
 * `cf-connecting-ip` header.
 *
 * If a binding is absent (test environments without the wrangler config
 * loaded; deployments that haven't enabled the binding) the middleware
 * passes the request through. This is intentional: rate limiting is
 * defence in depth on top of the bearer-token auth layer, not a
 * hard requirement for the broker to serve.
 */
export const rateLimitMiddleware = createMiddleware<HonoEnv>(async (c, next) => {
  if (PUBLIC_PATHS.has(c.req.path)) {
    return next();
  }

  // Cloudflare's authoritative client IP. Always present when running
  // behind Cloudflare; absent in unit tests and local `wrangler dev`
  // without a tunnel.
  const key = c.req.header("cf-connecting-ip");
  if (!key) {
    return next();
  }

  const limiter = MUTATING_METHODS.has(c.req.method)
    ? c.env.MUTATING_RATE_LIMITER
    : c.env.READ_RATE_LIMITER;

  if (!limiter) {
    return next();
  }

  const { success } = await limiter.limit({ key });
  if (!success) {
    return c.json(
      {
        error: "Too Many Requests",
        message: "Rate limit exceeded; try again shortly",
      },
      429,
    );
  }

  return next();
});
