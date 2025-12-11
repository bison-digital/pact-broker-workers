import { Hono } from "hono";
import type { Env, IndexResponse } from "../types";
import { HalBuilder, getBaseUrl } from "../services/hal";

const app = new Hono<{ Bindings: Env }>();

// Root/index endpoint
app.get("/", (c) => {
  const hal = new HalBuilder(getBaseUrl(c.req.raw));

  const response: IndexResponse = {
    name: "Pact Broker (Cloudflare Workers)",
    version: "0.1.0",
    _links: hal.index(),
  };

  return c.json(response);
});

// Health check
app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

export { app as indexRoutes };
