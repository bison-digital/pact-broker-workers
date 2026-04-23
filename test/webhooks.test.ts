import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { fetchMock } from "cloudflare:test";
import { req, reqJson, authHeaders, publishPact, publishVerification } from "./helpers";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

beforeEach(() => {
  // Re-prime interceptors each test. Each fetch consumes one interceptor.
  const origin = fetchMock.get("https://webhook.example");
  origin.intercept({ path: "/hook", method: "POST" }).reply(200, "ok").persist();
});

async function createWebhook(
  payload: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await req("/webhooks", {
    method: "POST",
    headers: authHeaders("test-token-0123456789abcdef", {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(payload),
  });
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

async function listExecutions(id: number): Promise<Record<string, unknown>[]> {
  const r = await reqJson(`/webhooks/${id}/executions`, { headers: authHeaders() });
  const body = r.body as { _embedded?: { executions?: Record<string, unknown>[] } };
  return body._embedded?.executions ?? [];
}

async function waitForExecutions(
  id: number,
  min = 1,
  timeoutMs = 5000,
): Promise<Record<string, unknown>[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const list = await listExecutions(id);
    if (list.length >= min) return list;
    await new Promise((r) => setTimeout(r, 50));
  }
  return listExecutions(id);
}

describe("webhooks", () => {
  it("rejects non-https URL on create", async () => {
    const { status } = await createWebhook({
      events: ["contract_published"],
      url: "http://insecure.example/hook",
    });
    expect(status).toBe(400);
  });

  it("rejects empty events list on create", async () => {
    const { status } = await createWebhook({
      events: [],
      url: "https://webhook.example/hook",
    });
    expect(status).toBe(400);
  });

  it("creates, retrieves, updates, deletes a webhook", async () => {
    const created = await createWebhook({
      events: ["contract_published"],
      url: "https://webhook.example/hook",
      description: "integration-test",
    });
    expect(created.status).toBe(201);
    const id = created.body.id as number;
    expect(typeof id).toBe("number");

    const got = await reqJson(`/webhooks/${id}`, { headers: authHeaders() });
    expect(got.status).toBe(200);
    expect((got.body as { description: string }).description).toBe("integration-test");

    const updated = await req(`/webhooks/${id}`, {
      method: "PUT",
      headers: authHeaders("test-token-0123456789abcdef", { "Content-Type": "application/json" }),
      body: JSON.stringify({ enabled: false, description: "disabled" }),
    });
    expect(updated.status).toBe(200);

    const deleted = await req(`/webhooks/${id}`, { method: "DELETE", headers: authHeaders() });
    expect(deleted.status).toBe(204);

    const after = await reqJson(`/webhooks/${id}`, { headers: authHeaders() });
    expect(after.status).toBe(404);
  });

  it("fires on contract_published when pact is published", async () => {
    const created = await createWebhook({
      events: ["contract_published"],
      url: "https://webhook.example/hook",
      consumer: "wh-consumer",
      provider: "wh-provider",
    });
    const id = created.body.id as number;

    const publish = await publishPact("wh-consumer", "wh-provider", "1.0.0");
    expect(publish.status).toBe(201);

    const executions = await waitForExecutions(id, 1);
    expect(executions.length).toBeGreaterThanOrEqual(1);
    expect(executions[0]!.succeeded).toBe(true);
    expect(executions[0]!.event).toBe("contract_published");
  });

  it("fires on provider_verification_published when verification is posted", async () => {
    const created = await createWebhook({
      events: ["provider_verification_published"],
      url: "https://webhook.example/hook",
    });
    const id = created.body.id as number;

    const publish = await publishPact("vh-consumer", "vh-provider", "1.0.0");
    const sha = publish.body.contentSha as string;
    const vr = await publishVerification("vh-provider", "vh-consumer", sha, true);
    expect(vr).toBe(201);

    const executions = await waitForExecutions(id, 1);
    expect(executions.length).toBeGreaterThanOrEqual(1);
    expect(executions[0]!.event).toBe("provider_verification_published");
  });

  it("manual /execute fires the webhook even without pact activity", async () => {
    const created = await createWebhook({
      events: ["contract_published"],
      url: "https://webhook.example/hook",
    });
    const id = created.body.id as number;

    const fire = await req(`/webhooks/${id}/execute`, {
      method: "POST",
      headers: authHeaders(),
    });
    expect(fire.status).toBe(202);

    const executions = await waitForExecutions(id, 1);
    expect(executions.length).toBeGreaterThanOrEqual(1);
  });
});
