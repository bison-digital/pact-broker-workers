import { describe, it, expect, beforeAll } from "vitest";
import { req, reqJson, authHeaders, publishPact, publishVerification, tagVersion } from "./helpers";

/** The subset of a matrix row these tests assert on — see matrix_decorator.rb. */
interface MatrixRowShape {
  consumer: { name: string; version: { number: string; tags: Array<{ name: string }> } };
  provider: { name: string; version: { number: string } | null };
  pact: { createdAt: string; _links: { self: { href: string } } };
  verificationResult: { success: boolean; _links: { self: { href: string } } } | null;
}

describe("/matrix", () => {
  beforeAll(async () => {
    // verified pact pair
    const { body: pubVerified } = await publishPact("mx-c1", "mx-p1", "1.0.0");
    const shaVerified = (pubVerified as { contentSha: string }).contentSha;
    await publishVerification("mx-p1", "mx-c1", shaVerified, true);
    await tagVersion("mx-c1", "1.0.0", "prod");

    // unverified pact pair
    await publishPact("mx-c2", "mx-p2", "1.0.0");
  });

  it("returns 400 when pacticipant query param is missing", async () => {
    const { status, body } = await reqJson("/matrix", {
      headers: authHeaders(),
    });
    expect(status).toBe(400);
    expect((body as { message: string }).message).toMatch(/pacticipant/i);
  });

  it("verified pact → deployable:true with the reference broker's success reason", async () => {
    const { status, body } = await reqJson("/matrix?pacticipant=mx-c1&version=1.0.0", {
      headers: authHeaders(),
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({
      summary: {
        deployable: true,
        reason: "All required verification results are published and successful",
      },
    });
  });

  // Unverified is "don't know", not "known bad" — deployment_status_summary.rb
  // returns nil, and the CLI treats anything other than true as a stop.
  it("unverified pact → deployable:null, not false", async () => {
    const { status, body } = await reqJson("/matrix?pacticipant=mx-c2&version=1.0.0", {
      headers: authHeaders(),
    });
    expect(status).toBe(200);
    expect((body as { summary: { deployable: boolean | null } }).summary.deployable).toBeNull();
  });

  // Row shape follows matrix_decorator.rb. pact_broker-client's TextFormatter
  // reads row[:consumer][:version][:number]; a bare string there raises
  // TypeError in Ruby rather than degrading, so the object form is load-bearing.
  it("reports the consumer version as an object, not a bare string", async () => {
    const { body } = await reqJson("/matrix?pacticipant=mx-c1&version=1.0.0", {
      headers: authHeaders(),
    });
    const row = (body as { matrix: MatrixRowShape[] }).matrix[0]!;

    expect(row.consumer.version.number).toBe("1.0.0");
    expect(row.consumer.version.tags).toEqual([{ name: "prod" }]);
  });

  it("reports the provider version that produced the verification", async () => {
    const { body } = await reqJson("/matrix?pacticipant=mx-c1&version=1.0.0", {
      headers: authHeaders(),
    });
    const row = (body as { matrix: MatrixRowShape[] }).matrix[0]!;

    expect(row.provider.version?.number).toBe("p-1.0.0");
  });

  it("leaves the provider version null when nothing verified the pact", async () => {
    const { body } = await reqJson("/matrix?pacticipant=mx-c2&version=1.0.0", {
      headers: authHeaders(),
    });
    const row = (body as { matrix: MatrixRowShape[] }).matrix[0]!;

    expect(row.provider.version).toBeNull();
    expect(row.verificationResult).toBeNull();
  });

  it("links each verification result to a resource that resolves", async () => {
    const { body } = await reqJson("/matrix?pacticipant=mx-c1&version=1.0.0", {
      headers: authHeaders(),
    });
    const row = (body as { matrix: MatrixRowShape[] }).matrix[0]!;
    const href = row.verificationResult?._links.self.href;

    expect(href).toBeDefined();
    const followed = await req(new URL(href!).pathname, { headers: authHeaders() });
    expect(followed.status).toBe(200);
  });

  it("reports the pact under `pact` with its creation time", async () => {
    const { body } = await reqJson("/matrix?pacticipant=mx-c1&version=1.0.0", {
      headers: authHeaders(),
    });
    const row = (body as { matrix: MatrixRowShape[] }).matrix[0]!;

    expect(typeof row.pact.createdAt).toBe("string");
    const followed = await req(new URL(row.pact._links.self.href).pathname, {
      headers: authHeaders(),
    });
    expect(followed.status).toBe(200);
  });

  it("response shape includes summary, matrix, _links", async () => {
    const { body } = await reqJson("/matrix?pacticipant=mx-c1&version=1.0.0", {
      headers: authHeaders(),
    });
    expect(body).toHaveProperty("summary");
    expect(body).toHaveProperty("matrix");
    expect(body).toHaveProperty("_links");
  });
});

// Reported by agent-books 2026-08-02: a consumer version with one failed and
// one unverified pact reported only the unverified count, so CI printed
// "has not been verified" about a run that had gone red.
describe("/can-i-deploy with a mixed matrix", () => {
  beforeAll(async () => {
    const { body: failing } = await publishPact("mix-c", "mix-p-red", "1.0.0");
    await publishVerification(
      "mix-p-red",
      "mix-c",
      (failing as { contentSha: string }).contentSha,
      false,
    );
    // second provider, same consumer version, never verified
    await publishPact("mix-c", "mix-p-none", "1.0.0", { path: "/other" });
  });

  it("names the failure as well as the unverified pact", async () => {
    const { body } = await reqJson("/can-i-deploy?pacticipant=mix-c&version=1.0.0", {
      headers: authHeaders(),
    });
    const summary = (body as { summary: { reason: string } }).summary;

    expect(summary.reason).toContain(
      "The verification for the pact between version 1.0.0 of mix-c and any version of mix-p-red failed",
    );
    expect(summary.reason).toContain(
      "There is no verified pact between version 1.0.0 of mix-c and any version of mix-p-none",
    );
  });

  it("counts the failure and the unverified pact separately", async () => {
    const { body } = await reqJson("/can-i-deploy?pacticipant=mix-c&version=1.0.0", {
      headers: authHeaders(),
    });

    expect((body as { summary: Record<string, unknown> }).summary).toMatchObject({
      deployable: false,
      success: 0,
      failed: 1,
      unknown: 1,
    });
  });
});

describe("/can-i-deploy", () => {
  beforeAll(async () => {
    const { body } = await publishPact("cid-c1", "cid-p1", "1.0.0");
    const sha = (body as { contentSha: string }).contentSha;
    await publishVerification("cid-p1", "cid-c1", sha, true, "p-1.0.0");
    // `?to=prod` narrows verifications to PROVIDER versions carrying the tag.
    // Tag the provider version, not the consumer.
    await tagVersion("cid-p1", "p-1.0.0", "prod");
  });

  it("returns 400 when version query param is missing", async () => {
    const { status } = await reqJson("/can-i-deploy?pacticipant=cid-c1", {
      headers: authHeaders(),
    });
    expect(status).toBe(400);
  });

  it("verified + provider-version tagged → deployable:true", async () => {
    const { status, body } = await reqJson(
      "/can-i-deploy?pacticipant=cid-c1&version=1.0.0&to=prod",
      { headers: authHeaders() },
    );
    expect(status).toBe(200);
    expect((body as { summary: { deployable: boolean } }).summary.deployable).toBe(true);
  });
});
