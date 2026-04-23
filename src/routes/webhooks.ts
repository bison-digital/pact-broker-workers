import { Hono } from "hono";
import { z } from "zod";
import type { Env, WebhookEvent, WebhookResponse, WebhookExecutionResponse } from "../types";
import { HalBuilder, getBaseUrl } from "../services/hal";
import { idSchema, parseId, validateParam } from "../lib/validation";

const app = new Hono<{ Bindings: Env }>();

function getBroker(env: Env) {
  const id = env.PACT_BROKER.idFromName("pact-broker");
  return env.PACT_BROKER.get(id);
}

const webhookCreateSchema = z.object({
  events: z
    .array(z.enum(["contract_published", "provider_verification_published"]))
    .min(1, "events must contain at least one event"),
  url: z
    .string()
    .url("url must be a valid URL")
    .refine((u) => u.startsWith("https://"), {
      message: "url must use https",
    }),
  method: z.enum(["POST", "PUT", "PATCH"]).optional(),
  headers: z.record(z.string()).optional(),
  body: z.string().nullable().optional(),
  consumer: z
    .string()
    .regex(/^[a-zA-Z0-9._-]+$/)
    .nullable()
    .optional(),
  provider: z
    .string()
    .regex(/^[a-zA-Z0-9._-]+$/)
    .nullable()
    .optional(),
  enabled: z.boolean().optional(),
  description: z.string().max(500).optional(),
});

const webhookUpdateSchema = webhookCreateSchema.partial();

function serialiseWebhook(
  hal: HalBuilder,
  input: {
    webhook: {
      id: number;
      events: string;
      url: string;
      method: string;
      headers: string | null;
      body: string | null;
      enabled: boolean;
      description: string | null;
      createdAt: string;
    };
    consumer: { name: string } | null;
    provider: { name: string } | null;
  },
): WebhookResponse {
  const { webhook, consumer, provider } = input;
  let headers: Record<string, string> | null = null;
  if (webhook.headers) {
    try {
      headers = JSON.parse(webhook.headers) as Record<string, string>;
    } catch {
      headers = null;
    }
  }
  return {
    id: webhook.id,
    events: webhook.events.split(",").map((s) => s.trim()) as WebhookEvent[],
    url: webhook.url,
    method: webhook.method,
    headers,
    body: webhook.body,
    consumer: consumer?.name ?? null,
    provider: provider?.name ?? null,
    enabled: webhook.enabled,
    description: webhook.description,
    createdAt: webhook.createdAt,
    _links: {
      self: hal.link(`/webhooks/${webhook.id}`),
      "pb:executions": hal.link(`/webhooks/${webhook.id}/executions`, "Delivery log"),
      "pb:execute": hal.link(`/webhooks/${webhook.id}/execute`, "Fire manually"),
    },
  };
}

function serialiseExecution(
  hal: HalBuilder,
  webhookId: number,
  execution: {
    id: number;
    webhookId: number;
    event: string;
    triggeredBy: string | null;
    requestUrl: string;
    requestMethod: string;
    responseStatus: number | null;
    responseBody: string | null;
    attempt: number;
    succeeded: boolean;
    error: string | null;
    executedAt: string;
  },
): WebhookExecutionResponse {
  return {
    ...execution,
    _links: {
      self: hal.link(`/webhooks/${webhookId}/executions/${execution.id}`),
      "pb:webhook": hal.link(`/webhooks/${webhookId}`),
    },
  };
}

// List webhooks
app.get("/", async (c) => {
  const broker = getBroker(c.env);
  const list = await broker.listWebhooks();
  const hal = new HalBuilder(getBaseUrl(c.req.raw));
  return c.json({
    _links: { self: hal.link("/webhooks") },
    _embedded: {
      webhooks: list.map((w) => serialiseWebhook(hal, w)),
    },
  });
});

// Create webhook
app.post("/", async (c) => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "Bad Request", message: "Invalid JSON body" }, 400);
  }
  const parsed = webhookCreateSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    return c.json(
      {
        error: "Bad Request",
        message: first ? `${first.path.join(".")}: ${first.message}` : "Invalid webhook",
      },
      400,
    );
  }
  const broker = getBroker(c.env);
  const hook = await broker.createWebhook({
    events: parsed.data.events as WebhookEvent[],
    url: parsed.data.url,
    method: parsed.data.method,
    headers: parsed.data.headers ?? null,
    body: parsed.data.body ?? null,
    consumer: parsed.data.consumer ?? null,
    provider: parsed.data.provider ?? null,
    enabled: parsed.data.enabled,
    description: parsed.data.description ?? null,
  });
  const full = await broker.getWebhook(hook.id);
  if (!full) {
    return c.json({ error: "Internal Error", message: "Failed to load created webhook" }, 500);
  }
  const hal = new HalBuilder(getBaseUrl(c.req.raw));
  return c.json(serialiseWebhook(hal, full), 201);
});

// Get webhook
app.get("/:id", async (c) => {
  const idResult = validateParam(c, idSchema, c.req.param("id"), "id");
  if (!idResult.valid) return idResult.response;
  const broker = getBroker(c.env);
  const full = await broker.getWebhook(parseId(idResult.value));
  if (!full) return c.json({ error: "Not Found", message: "Webhook not found" }, 404);
  const hal = new HalBuilder(getBaseUrl(c.req.raw));
  return c.json(serialiseWebhook(hal, full));
});

// Update webhook
app.put("/:id", async (c) => {
  const idResult = validateParam(c, idSchema, c.req.param("id"), "id");
  if (!idResult.valid) return idResult.response;
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "Bad Request", message: "Invalid JSON body" }, 400);
  }
  const parsed = webhookUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    return c.json(
      {
        error: "Bad Request",
        message: first ? `${first.path.join(".")}: ${first.message}` : "Invalid webhook",
      },
      400,
    );
  }
  const broker = getBroker(c.env);
  const updated = await broker.updateWebhook(parseId(idResult.value), {
    ...(parsed.data.events !== undefined && { events: parsed.data.events as WebhookEvent[] }),
    ...(parsed.data.url !== undefined && { url: parsed.data.url }),
    ...(parsed.data.method !== undefined && { method: parsed.data.method }),
    ...(parsed.data.headers !== undefined && { headers: parsed.data.headers }),
    ...(parsed.data.body !== undefined && { body: parsed.data.body }),
    ...(parsed.data.consumer !== undefined && { consumer: parsed.data.consumer }),
    ...(parsed.data.provider !== undefined && { provider: parsed.data.provider }),
    ...(parsed.data.enabled !== undefined && { enabled: parsed.data.enabled }),
    ...(parsed.data.description !== undefined && { description: parsed.data.description }),
  });
  if (!updated) return c.json({ error: "Not Found", message: "Webhook not found" }, 404);
  const full = await broker.getWebhook(updated.id);
  if (!full) return c.json({ error: "Not Found", message: "Webhook not found" }, 404);
  const hal = new HalBuilder(getBaseUrl(c.req.raw));
  return c.json(serialiseWebhook(hal, full));
});

// Delete webhook
app.delete("/:id", async (c) => {
  const idResult = validateParam(c, idSchema, c.req.param("id"), "id");
  if (!idResult.valid) return idResult.response;
  const broker = getBroker(c.env);
  const ok = await broker.deleteWebhook(parseId(idResult.value));
  if (!ok) return c.json({ error: "Not Found", message: "Webhook not found" }, 404);
  return c.body(null, 204);
});

// Fire webhook manually (for testing). Returns 202 immediately and runs the
// delivery in the background via executionCtx.waitUntil.
app.post("/:id/execute", async (c) => {
  const idResult = validateParam(c, idSchema, c.req.param("id"), "id");
  if (!idResult.valid) return idResult.response;
  const broker = getBroker(c.env);
  const webhookId = parseId(idResult.value);
  const existing = await broker.getWebhook(webhookId);
  if (!existing) return c.json({ error: "Not Found", message: "Webhook not found" }, 404);
  if (!existing.webhook.enabled) {
    return c.json({ error: "Bad Request", message: "webhook is disabled" }, 400);
  }
  c.executionCtx.waitUntil(broker.executeWebhookManually(webhookId));
  return c.json({ fired: true }, 202);
});

// List executions for a webhook
app.get("/:id/executions", async (c) => {
  const idResult = validateParam(c, idSchema, c.req.param("id"), "id");
  if (!idResult.valid) return idResult.response;
  const webhookId = parseId(idResult.value);
  const broker = getBroker(c.env);
  const full = await broker.getWebhook(webhookId);
  if (!full) return c.json({ error: "Not Found", message: "Webhook not found" }, 404);
  const executions = await broker.getWebhookExecutions(webhookId);
  const hal = new HalBuilder(getBaseUrl(c.req.raw));
  return c.json({
    _links: {
      self: hal.link(`/webhooks/${webhookId}/executions`),
      "pb:webhook": hal.link(`/webhooks/${webhookId}`),
    },
    _embedded: {
      executions: executions.map((e) => serialiseExecution(hal, webhookId, e)),
    },
  });
});

export { app as webhookRoutes };
