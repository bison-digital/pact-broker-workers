import { Hono } from "hono";
import type { Env, EnvironmentResponse, EnvironmentRequest } from "../types";
import { HalBuilder, getBaseUrl } from "../services/hal";
import { environmentNameSchema, validateParam } from "../lib/validation";

const app = new Hono<{ Bindings: Env }>();

// Helper to get DO stub
function getBroker(env: Env) {
  const id = env.PACT_BROKER.idFromName("pact-broker");
  return env.PACT_BROKER.get(id);
}

// List all environments
app.get("/", async (c) => {
  const broker = getBroker(c.env);
  const envs = await broker.getAllEnvironments();
  const hal = new HalBuilder(getBaseUrl(c.req.raw));

  const response = {
    _links: {
      self: hal.link("/environments"),
      // pact-broker-client looks the environment up by link `name` here
      // (record_release.rb#environment_exists?), not in _embedded.
      "pb:environments": envs.map((e) => ({
        ...hal.link(`/environments/${encodeURIComponent(e.name)}`, e.displayName ?? e.name),
        name: e.name,
      })),
    },
    _embedded: {
      environments: envs.map((e) => ({
        name: e.name,
        displayName: e.displayName,
        production: e.production,
        createdAt: e.createdAt,
        _links: hal.environment(e.name),
      })),
    },
  };

  return c.json(response);
});

// Create an environment — `pact-broker create-environment` POSTs the collection.
app.post("/", async (c) => {
  let body: EnvironmentRequest & { name?: unknown } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Bad Request", message: "Invalid JSON body" }, 400);
  }

  const nameResult = validateParam(
    c,
    environmentNameSchema,
    typeof body.name === "string" ? body.name : undefined,
    "name",
  );
  if (!nameResult.valid) return nameResult.response;
  const name = nameResult.value;

  const broker = getBroker(c.env);
  const env = await broker.getOrCreateEnvironment(name, body.displayName, body.production);

  const hal = new HalBuilder(getBaseUrl(c.req.raw));
  const response: EnvironmentResponse = {
    name: env.name,
    displayName: env.displayName,
    production: env.production ?? false,
    createdAt: env.createdAt,
    _links: hal.environment(env.name),
  };

  return c.json(response, 201, { "Content-Type": "application/hal+json" });
});

// Get a specific environment
app.get("/:name", async (c) => {
  const nameResult = validateParam(c, environmentNameSchema, c.req.param("name"), "name");
  if (!nameResult.valid) return nameResult.response;
  const name = nameResult.value;

  const broker = getBroker(c.env);
  const env = await broker.getEnvironment(name);

  if (!env) {
    return c.json({ error: "Not Found", message: "Environment not found" }, 404);
  }

  const hal = new HalBuilder(getBaseUrl(c.req.raw));
  const response: EnvironmentResponse = {
    name: env.name,
    displayName: env.displayName,
    production: env.production ?? false,
    createdAt: env.createdAt,
    _links: hal.environment(env.name),
  };

  return c.json(response);
});

// Create or update an environment
app.put("/:name", async (c) => {
  const nameResult = validateParam(c, environmentNameSchema, c.req.param("name"), "name");
  if (!nameResult.valid) return nameResult.response;
  const name = nameResult.value;

  let body: EnvironmentRequest = {};
  try {
    body = await c.req.json();
  } catch {
    // Empty body is valid
  }

  const broker = getBroker(c.env);
  const env = await broker.getOrCreateEnvironment(name, body.displayName, body.production);

  const hal = new HalBuilder(getBaseUrl(c.req.raw));
  const response: EnvironmentResponse = {
    name: env.name,
    displayName: env.displayName,
    production: env.production ?? false,
    createdAt: env.createdAt,
    _links: hal.environment(env.name),
  };

  return c.json(response, 201);
});

export { app as environmentRoutes };
