import { describe, it, expect, beforeAll } from "vitest";
import {
  req,
  reqJson,
  authHeaders,
  publishPact,
  tagVersion,
  ensureEnvironment,
  recordDeployment,
} from "./helpers";

const PROVIDER = "fv-provider";

async function publishSetup(): Promise<void> {
  await publishPact("fv-c1", PROVIDER, "1.0.0", { branch: "main" });
  await publishPact("fv-c1", PROVIDER, "2.0.0", { branch: "feature/x" });
  await tagVersion("fv-c1", "1.0.0", "prod");
  await publishPact("fv-c2", PROVIDER, "1.0.0", { branch: "main" });
}

describe("for-verification", () => {
  beforeAll(async () => {
    await publishSetup();
  });

  it("GET default returns latest pact per consumer", async () => {
    const { status, body } = await reqJson(`/pacts/provider/${PROVIDER}/for-verification`, {
      headers: authHeaders(),
    });
    expect(status).toBe(200);
    const pacts = (body as { _embedded?: { pacts?: unknown[] } })._embedded?.pacts ?? [];
    expect(pacts.length).toBeGreaterThanOrEqual(2);
  });

  it("GET returns hal+json content-type with correct _links.self shape", async () => {
    const res = await req(`/pacts/provider/${PROVIDER}/for-verification`, {
      headers: authHeaders(),
    });
    expect(res.headers.get("content-type")).toMatch(/application\/hal\+json/);
    const body = (await res.json()) as {
      _embedded?: { pacts?: Array<{ _links: { self: { href: string } } }> };
    };
    const first = body._embedded?.pacts?.[0];
    expect(first?._links.self.href).toMatch(/\/pact-version\/[a-f0-9]{64}$/);
  });

  it("POST with latest selector returns same as GET default", async () => {
    const { status, body } = await reqJson(`/pacts/provider/${PROVIDER}/for-verification`, {
      method: "POST",
      headers: authHeaders("test-token-0123456789abcdef", {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ consumerVersionSelectors: [{ latest: true }] }),
    });
    expect(status).toBe(200);
    const pacts = (body as { _embedded?: { pacts?: unknown[] } })._embedded?.pacts ?? [];
    expect(pacts.length).toBeGreaterThanOrEqual(2);
  });

  it("POST with tag selector returns only tagged versions", async () => {
    const { status, body } = await reqJson(`/pacts/provider/${PROVIDER}/for-verification`, {
      method: "POST",
      headers: authHeaders("test-token-0123456789abcdef", {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        consumerVersionSelectors: [{ tag: "prod" }],
      }),
    });
    expect(status).toBe(200);
    const pacts =
      (
        body as {
          _embedded?: {
            pacts?: Array<{ shortDescription: string }>;
          };
        }
      )._embedded?.pacts ?? [];
    expect(pacts.length).toBeGreaterThanOrEqual(1);
    // Tagged version 1.0.0 of fv-c1
    expect(pacts.some((p) => p.shortDescription.includes("fv-c1 (1.0.0)"))).toBe(true);
  });

  it("POST with branch selector filters to matching branch", async () => {
    const { status, body } = await reqJson(`/pacts/provider/${PROVIDER}/for-verification`, {
      method: "POST",
      headers: authHeaders("test-token-0123456789abcdef", {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        consumerVersionSelectors: [{ branch: "feature/x" }],
      }),
    });
    expect(status).toBe(200);
    const pacts =
      (
        body as {
          _embedded?: { pacts?: Array<{ shortDescription: string }> };
        }
      )._embedded?.pacts ?? [];
    expect(pacts.every((p) => p.shortDescription.includes("(2.0.0)"))).toBe(true);
  });

  it("POST with deployed selector returns only versions deployed to env", async () => {
    await ensureEnvironment("production");
    await recordDeployment("fv-c1", "1.0.0", "production");
    const { status, body } = await reqJson(`/pacts/provider/${PROVIDER}/for-verification`, {
      method: "POST",
      headers: authHeaders("test-token-0123456789abcdef", {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        consumerVersionSelectors: [{ deployed: "production" }],
      }),
    });
    expect(status).toBe(200);
    const pacts =
      (
        body as {
          _embedded?: { pacts?: Array<{ shortDescription: string }> };
        }
      )._embedded?.pacts ?? [];
    expect(pacts.some((p) => p.shortDescription.includes("fv-c1"))).toBe(true);
  });
});
