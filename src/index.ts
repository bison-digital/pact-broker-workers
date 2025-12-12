import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { Env } from "./types";
import { authMiddleware } from "./middleware/auth";
import { indexRoutes } from "./routes/index";
import { pacticipantRoutes } from "./routes/pacticipants";
import { pactRoutes } from "./routes/pacts";
import { verificationRoutes } from "./routes/verifications";
import { matrixRoutes } from "./routes/matrix";
import { environmentRoutes } from "./routes/environments";

// Re-export the Durable Object class
export { PactBrokerDO } from "./durable-objects/pact-broker";

// Create the Hono app
const app = new Hono<{ Bindings: Env }>();

// Global middleware
app.use("*", logger());
app.use("*", cors());

// Auth middleware (applied to all routes except health)
app.use("*", async (c, next) => {
  // Skip auth for health check
  if (c.req.path === "/health") {
    return next();
  }
  return authMiddleware(c, next);
});

// Mount routes
app.route("/", indexRoutes);
app.route("/pacticipants", pacticipantRoutes);
app.route("/pacts", pactRoutes);
app.route("/pacts", verificationRoutes);
app.route("/environments", environmentRoutes);
app.route("/", matrixRoutes);

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      error: "Not Found",
      message: `Route ${c.req.method} ${c.req.path} not found`,
    },
    404
  );
});

// Error handler
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json(
    {
      error: "Internal Server Error",
      message: err.message,
    },
    500
  );
});

export default app;
