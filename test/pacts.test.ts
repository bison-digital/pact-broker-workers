import { describe, it, expect } from "vitest";
import { req, reqJson, authHeaders, publishPact, tagVersion, samplePact } from "./helpers";

describe("pact publish + retrieve", () => {
  it("publish minimal valid pact returns 201 with HAL body", async () => {
    const { status, body } = await publishPact("c1", "p1", "1.0.0");
    expect(status).toBe(201);
    expect(body).toMatchObject({
      consumer: { name: "c1" },
      provider: { name: "p1" },
      consumerVersion: "1.0.0",
    });
    expect(body).toHaveProperty("contentSha");
    expect(body).toHaveProperty("createdAt");
    expect((body as { _links: { self: { href: string } } })._links.self.href).toMatch(
      /^https:\/\/test-host\/pacts\/provider\/p1\/consumer\/c1\/version\/1\.0\.0$/,
    );
  });

  it("re-publishing identical content returns 200 (not 201)", async () => {
    await publishPact("c2", "p2", "1.0.0");
    const { status } = await publishPact("c2", "p2", "1.0.0");
    expect(status).toBe(200);
  });

  it("re-publishing with different content for same version updates in-place (200)", async () => {
    const first = await publishPact("c3", "p3", "1.0.0", {
      description: "one",
    });
    const second = await publishPact("c3", "p3", "1.0.0", {
      description: "two",
    });
    // Broker keeps one pact row per (consumer_version, provider) pair and
    // updates its content; it doesn't create a second row. So 'created:false'
    // → 200.
    expect(second.status).toBe(200);
    // Content SHA should differ between the two publishes.
    expect((second.body as { contentSha: string }).contentSha).not.toBe(
      (first.body as { contentSha: string }).contentSha,
    );
    // Retrieve should reflect the updated content.
    const retrieved = await reqJson("/pacts/provider/p3/consumer/c3/version/1.0.0", {
      headers: authHeaders(),
    });
    const interactions = (retrieved.body as { interactions: Array<{ description: string }> })
      .interactions;
    expect(interactions[0]?.description).toBe("two");
  });

  it("publishing with ?branch= records the branch on the version", async () => {
    const { status } = await publishPact("c4", "p4", "2.0.0", {
      branch: "main",
    });
    expect(status).toBe(201);
    const ver = await reqJson("/pacticipants/c4/versions/2.0.0", {
      headers: authHeaders(),
    });
    expect(ver.status).toBe(200);
    expect((ver.body as { branch: string }).branch).toBe("main");
  });

  it("publishing invalid JSON returns 400", async () => {
    const { status, body } = await reqJson("/pacts/provider/p5/consumer/c5/version/1.0.0", {
      method: "PUT",
      headers: authHeaders("test-token-0123456789abcdef", {
        "Content-Type": "application/json",
      }),
      body: "{not-json",
    });
    expect(status).toBe(400);
    expect(body).toMatchObject({ message: "Invalid JSON body" });
  });

  it("publishing missing consumer/provider/interactions returns 400", async () => {
    const { status, body } = await reqJson("/pacts/provider/p6/consumer/c6/version/1.0.0", {
      method: "PUT",
      headers: authHeaders("test-token-0123456789abcdef", {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ consumer: { name: "c6" } }),
    });
    expect(status).toBe(400);
    expect((body as { message: string }).message).toMatch(/consumer.*provider.*interactions/);
  });

  it("retrieve by version returns 200 with interactions", async () => {
    await publishPact("c7", "p7", "1.0.0", { description: "the-desc" });
    const { status, body } = await reqJson("/pacts/provider/p7/consumer/c7/version/1.0.0", {
      headers: authHeaders(),
    });
    expect(status).toBe(200);
    const interactions = (body as { interactions: Array<{ description: string }> }).interactions;
    expect(interactions[0]?.description).toBe("the-desc");
  });

  it("retrieve latest returns one of the published versions", async () => {
    // Broker's `latest` order is `versions.createdAt DESC`. SQLite stores
    // createdAt as `YYYY-MM-DD HH:MM:SS` (second precision), so two publishes
    // in the same second tie and the tie-break is implementation-defined.
    // For deterministic "most recent" semantics, use `latest/{tag}` (covered
    // by the next test).
    await publishPact("c8", "p8", "1.0.0", { description: "v1" });
    await publishPact("c8", "p8", "2.0.0", { description: "v2" });
    const { status, body } = await reqJson("/pacts/provider/p8/consumer/c8/latest", {
      headers: authHeaders(),
    });
    expect(status).toBe(200);
    expect((body as { consumerVersion: string }).consumerVersion).toMatch(/^[12]\.0\.0$/);
  });

  it("retrieve latest/{tag} returns version carrying that tag", async () => {
    await publishPact("c9", "p9", "1.0.0");
    await publishPact("c9", "p9", "2.0.0");
    expect(await tagVersion("c9", "1.0.0", "prod")).toBe(201);
    const { status, body } = await reqJson("/pacts/provider/p9/consumer/c9/latest/prod", {
      headers: authHeaders(),
    });
    expect(status).toBe(200);
    expect((body as { consumerVersion: string }).consumerVersion).toBe("1.0.0");
  });

  it("retrieve by content SHA returns 200 with hal+json content-type", async () => {
    const { body } = await publishPact("c10", "p10", "1.0.0");
    const sha = (body as { contentSha: string }).contentSha;
    const res = await req(`/pacts/provider/p10/consumer/c10/pact-version/${sha}`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/hal\+json/);
  });

  it("retrieve non-existent pact returns 404 with error envelope", async () => {
    const { status, body } = await reqJson("/pacts/provider/nope/consumer/also-nope/latest", {
      headers: authHeaders(),
    });
    expect(status).toBe(404);
    expect(body).toMatchObject({ error: "Not Found" });
  });

  it("retrieve by SHA that doesn't exist returns 404", async () => {
    const { status } = await reqJson(
      `/pacts/provider/p11/consumer/c11/pact-version/${"0".repeat(64)}`,
      { headers: authHeaders() },
    );
    expect(status).toBe(404);
  });

  it("/pacts/latest returns all latest pacts across pairs", async () => {
    await publishPact("c12", "p12", "1.0.0");
    await publishPact("c13", "p13", "1.0.0");
    const { status, body } = await reqJson("/pacts/latest", {
      headers: authHeaders(),
    });
    expect(status).toBe(200);
    const pacts = (body as { _embedded?: { pacts?: unknown[] } })._embedded?.pacts;
    expect(Array.isArray(pacts)).toBe(true);
    expect((pacts ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("/pacts/provider/:p/latest returns all latest for one provider", async () => {
    await publishPact("cA", "pShared", "1.0.0");
    await publishPact("cB", "pShared", "1.0.0");
    const { status, body } = await reqJson("/pacts/provider/pShared/latest", {
      headers: authHeaders(),
    });
    expect(status).toBe(200);
    const pacts = (body as { _embedded?: { pacts?: unknown[] } })._embedded?.pacts;
    expect((pacts ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("HAL _links.self.href is fully-qualified", async () => {
    const { body } = await publishPact("c14", "p14", "1.0.0");
    const self = (body as { _links: { self: { href: string } } })._links.self.href;
    expect(self).toMatch(/^https?:\/\//);
  });

  it("createdAt is a non-empty string", async () => {
    const { body } = await publishPact("c15", "p15", "1.0.0");
    const ts = (body as { createdAt: string }).createdAt;
    expect(typeof ts).toBe("string");
    expect(ts.length).toBeGreaterThan(0);
  });

  it("publishing preserves interaction metadata", async () => {
    const payload = samplePact({
      consumer: "c16",
      provider: "p16",
      path: "/specific-path",
    });
    const res = await req("/pacts/provider/p16/consumer/c16/version/1.0.0", {
      method: "PUT",
      headers: authHeaders("test-token-0123456789abcdef", {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(201);
    const retrieved = await reqJson("/pacts/provider/p16/consumer/c16/version/1.0.0", {
      headers: authHeaders(),
    });
    const interactions = (retrieved.body as { interactions: Array<{ request: { path: string } }> })
      .interactions;
    expect(interactions[0]?.request.path).toBe("/specific-path");
  });
});
