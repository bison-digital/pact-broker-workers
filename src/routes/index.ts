import { Hono } from "hono";
import type { Env, IndexResponse } from "../types";
import { HalBuilder, getBaseUrl } from "../services/hal";

const app = new Hono<{ Bindings: Env }>();

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

// Health check
app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

export { app as indexRoutes };
