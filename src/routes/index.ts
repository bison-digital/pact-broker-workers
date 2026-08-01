import { Hono } from "hono";
import type { Env, IndexResponse } from "../types";
import { HalBuilder, getBaseUrl } from "../services/hal";

const app = new Hono<{ Bindings: Env }>();

// Helper to get DO stub
function getBroker(env: Env) {
  const id = env.PACT_BROKER.idFromName("pact-broker");
  return env.PACT_BROKER.get(id);
}

/**
 * Pact-Broker-API compatibility version reported by the index/root
 * endpoint. The Ruby reference implementation uses this field as the
 * authoritative protocol-feature marker, and the canonical Pact CLI
 * (`pact-broker-client`) gates HAL-feature negotiation on it — e.g.
 * publishing with `--branch` and `--build-url` requires the broker to
 * report ≥ 2.86.0, otherwise the CLI prints
 *   WARN: This version of the Pact Broker does not support versions
 *         with branches or build URLs.
 *
 * This worker implements the HAL surface, branch/build-URL publish
 * support, deployed-versions, environments, and matrix queries that
 * landed in the reference broker by 2.107.0, so we report that as the
 * compatibility level. It's the spec version we satisfy, NOT this
 * worker's own semver — keep the latter in `package.json`.
 */
const PACT_BROKER_API_COMPATIBILITY_VERSION = "2.107.0";

// Root/index endpoint
app.get("/", (c) => {
  const hal = new HalBuilder(getBaseUrl(c.req.raw));

  const response: IndexResponse = {
    name: "Pact Broker (Cloudflare Workers)",
    version: PACT_BROKER_API_COMPATIBILITY_VERSION,
    _links: hal.index(),
  };

  return c.json(response);
});

/**
 * Health check — public, no auth.
 *
 * This probes the Durable Object rather than returning a static literal,
 * because it is the only post-deploy signal CI has. Nothing in the deploy
 * pipeline holds a bearer token, so an authenticated smoke test is not
 * available; a static 200 would only prove the Worker booted, not that the
 * DO binding resolves or that its SQLite storage is readable.
 *
 * The trade-off is that an unauthenticated caller can wake and query the DO,
 * and this route is deliberately exempt from rate limiting (see the middleware
 * in src/index.ts) so a throttled broker stays diagnosable and cannot fail its
 * own deploy smoke test. What keeps that safe is the probe itself: a single
 * `SELECT 1 ... LIMIT 1`, O(1) regardless of how much data the broker holds.
 * See PactBrokerDO.healthCheck.
 */
app.get("/health", async (c) => {
  try {
    await getBroker(c.env).healthCheck();
    return c.json({ status: "ok", storage: "ok" });
  } catch (err) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        msg: "health check failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    // Non-2xx so `curl -f` in the deploy smoke test fails the job.
    return c.json({ status: "error", storage: "error" }, 503);
  }
});

export { app as indexRoutes };
