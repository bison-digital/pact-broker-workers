import { describe, it, expect, beforeAll } from "vitest";
import { reqJson, authHeaders, publishPact, publishVerification, tagVersion } from "./helpers";

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
