import { Hono } from "hono";
import type { Env, HonoEnv } from "./types";
import { authMiddleware } from "./middleware/auth";
import { indexRoutes } from "./routes/index";
import { pacticipantRoutes } from "./routes/pacticipants";
import { pactRoutes } from "./routes/pacts";
import { verificationRoutes } from "./routes/verifications";
import { matrixRoutes } from "./routes/matrix";
import { environmentRoutes } from "./routes/environments";
import { webhookRoutes } from "./routes/webhooks";
import { badgeRoutes } from "./routes/badge";
import { HAL_BROWSER_HTML } from "./ui/index";

// Re-export the Durable Object class
export { PactBrokerDO } from "./durable-objects/pact-broker";

// Constants
const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10 MB

// Request-id character set: safe for header value + log correlation.
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

// Create the Hono app
const app = new Hono<HonoEnv>();

// Assign / propagate a request ID as early as possible so every downstream
// middleware and error path can include it.
app.use("*", async (c, next) => {
  const incoming = c.req.header("X-Request-Id");
  const requestId = incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : crypto.randomUUID();
  c.set("requestId", requestId);
  c.header("X-Request-Id", requestId);
  await next();
});

// Security headers middleware
app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("X-XSS-Protection", "1; mode=block");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
});

// Structured JSON access log. Never logs the Authorization header or body.
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const durationMs = Date.now() - start;
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      requestId: c.get("requestId"),
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs,
    }),
  );
});

// Request size limit middleware
app.use("*", async (c, next) => {
  const contentLength = c.req.header("Content-Length");
  if (contentLength && parseInt(contentLength) > MAX_BODY_SIZE) {
    return c.json(
      {
        error: "Payload Too Large",
        message: `Request body exceeds maximum size of ${MAX_BODY_SIZE} bytes`,
      },
      413,
    );
  }
  return next();
});

// Content-Type validation for POST/PUT requests
app.use("*", async (c, next) => {
  const method = c.req.method;
  if (method === "POST" || method === "PUT") {
    const contentType = c.req.header("Content-Type");
    // Allow empty bodies (some endpoints accept them) or require application/json
    if (contentType && !contentType.includes("application/json")) {
      return c.json(
        {
          error: "Unsupported Media Type",
          message: "Content-Type must be application/json",
        },
        415,
      );
    }
  }
  return next();
});

// Configurable CORS. Unset env var = permissive (back-compat). When set to a
// comma-separated list of origins, we only echo Access-Control-Allow-Origin for
// matching requests, and never for the wildcard or opaque Origin headers.
app.use("*", async (c, next) => {
  const allowlist = (c.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const origin = c.req.header("Origin");
  const allowCredentials = allowlist.length > 0;

  if (c.req.method === "OPTIONS") {
    if (allowlist.length === 0) {
      c.header("Access-Control-Allow-Origin", "*");
    } else if (origin && allowlist.includes(origin)) {
      c.header("Access-Control-Allow-Origin", origin);
      if (allowCredentials) c.header("Access-Control-Allow-Credentials", "true");
    }
    c.header("Vary", "Origin");
    c.header(
      "Access-Control-Allow-Methods",
      c.req.header("Access-Control-Request-Method") ?? "GET,POST,PUT,DELETE,OPTIONS",
    );
    c.header(
      "Access-Control-Allow-Headers",
      c.req.header("Access-Control-Request-Headers") ?? "Authorization,Content-Type",
    );
    c.header("Access-Control-Max-Age", "600");
    return c.body(null, 204);
  }

  await next();

  if (allowlist.length === 0) {
    c.header("Access-Control-Allow-Origin", "*");
  } else if (origin && allowlist.includes(origin)) {
    c.header("Access-Control-Allow-Origin", origin);
    if (allowCredentials) c.header("Access-Control-Allow-Credentials", "true");
  }
  c.header("Vary", "Origin");
});

// Paths that skip bearer-token auth. The HAL UI ships only static HTML/JS and
// asks the user for a token in the browser; badges are SVG meant to be embedded
// in README files, so they're public unless PUBLIC_BADGES is explicitly "false".
function isPublicPath(path: string, env: Env): boolean {
  if (path === "/health") return true;
  if (path === "/ui") return true;
  if (
    env.PUBLIC_BADGES !== "false" &&
    /^\/pacts\/provider\/[^/]+\/consumer\/[^/]+\/badge$/.test(path)
  ) {
    return true;
  }
  return false;
}

// Auth middleware (applied to all routes except public ones above)
app.use("*", async (c, next) => {
  if (isPublicPath(c.req.path, c.env)) {
    return next();
  }
  return authMiddleware(c, next);
});

// Serve the HAL browser UI before mounting authenticated API routes so
// it always wins the path match.
app.get("/ui", (c) => c.html(HAL_BROWSER_HTML));

// Mount routes
app.route("/", indexRoutes);
app.route("/pacticipants", pacticipantRoutes);
app.route("/pacts", pactRoutes);
app.route("/pacts", verificationRoutes);
app.route("/pacts", badgeRoutes);
app.route("/environments", environmentRoutes);
app.route("/webhooks", webhookRoutes);
app.route("/", matrixRoutes);

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      error: "Not Found",
      message: `Route ${c.req.method} ${c.req.path} not found`,
    },
    404,
  );
});

// Error handler - sanitize error messages to prevent information disclosure
app.onError((err, c) => {
  const requestId = c.get("requestId") ?? crypto.randomUUID();

  // Log full error details server-side only
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      requestId,
      path: c.req.path,
      method: c.req.method,
      message: err.message,
      stack: err.stack,
    }),
  );

  // Return sanitized error to client; X-Request-Id header is set by upstream middleware.
  return c.json(
    {
      error: "Internal Server Error",
      message: "An unexpected error occurred",
      requestId,
    },
    500,
  );
});

export default app;
