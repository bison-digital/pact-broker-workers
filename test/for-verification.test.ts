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

/**
 * Every fixture write is asserted.
 *
 * These helpers return a status that used to be discarded, so a failed setup
 * surfaced much later as an opaque "expected 0 to be greater than or equal to
 * 1" in whichever test happened to depend on the missing row — with no
 * indication that the write, not the query, was at fault. Failing here instead
 * names the exact call that broke.
 */
async function publishSetup(): Promise<void> {
  expect((await publishPact("fv-c1", PROVIDER, "1.0.0", { branch: "main" })).status).toBe(201);
  expect((await publishPact("fv-c1", PROVIDER, "2.0.0", { branch: "feature/x" })).status).toBe(201);
  expect(await tagVersion("fv-c1", "1.0.0", "prod")).toBe(201);
  expect((await publishPact("fv-c2", PROVIDER, "1.0.0", { branch: "main" })).status).toBe(201);
}

/**
 * A selector *selects* versions; it does not filter the latest one.
 *
 * The fixture below tags 1.0.0 as `prod` and then publishes a newer 2.0.0, so
 * the tagged version is deliberately not the newest. An implementation that
 * starts from "latest pact per consumer" and filters can never return it —
 * meaning the provider silently skips verifying the pact its production
 * consumer is actually running.
 */
async function selectorPacts(selector: Record<string, unknown>): Promise<string[]> {
  const { body } = await reqJson("/pacts/provider/sel-p/for-verification", {
    method: "POST",
    headers: authHeaders("test-token-0123456789abcdef", {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({ consumerVersionSelectors: [selector] }),
  });
  return (
    (body as { _embedded?: { pacts?: Array<{ shortDescription: string }> } })._embedded?.pacts ?? []
  ).map((p) => p.shortDescription);
}

describe("selectors choose versions rather than filtering the latest", () => {
  beforeAll(async () => {
    expect((await publishPact("sel-c", "sel-p", "1.0.0", { branch: "main" })).status).toBe(201);
    expect(await tagVersion("sel-c", "1.0.0", "sel-prod")).toBe(201);
    expect((await publishPact("sel-c", "sel-p", "2.0.0", { branch: "feature/y" })).status).toBe(
      201,
    );
  });

  it("selects the tagged version even though a newer version exists", async () => {
    expect(await selectorPacts({ tag: "sel-prod" })).toEqual([
      "Pact between sel-c (1.0.0) and sel-p",
    ]);
  });

  it("selects the branch's version even though a newer branch exists", async () => {
    expect(await selectorPacts({ branch: "main" })).toEqual([
      "Pact between sel-c (1.0.0) and sel-p",
    ]);
  });

  it("selects the main-branch version even though a newer version exists", async () => {
    expect(await selectorPacts({ mainBranch: true })).toEqual([
      "Pact between sel-c (1.0.0) and sel-p",
    ]);
  });

  it("selects the deployed version even though a newer version exists", async () => {
    await ensureEnvironment("sel-env");
    await recordDeployment("sel-c", "1.0.0", "sel-env");

    expect(await selectorPacts({ deployed: true, environment: "sel-env" })).toEqual([
      "Pact between sel-c (1.0.0) and sel-p",
    ]);
  });

  it("still returns the newest version for a latest selector", async () => {
    expect(await selectorPacts({ latest: true })).toEqual(["Pact between sel-c (2.0.0) and sel-p"]);
  });
});

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
