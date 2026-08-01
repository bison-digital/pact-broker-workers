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

  it("verified pact → deployable:true with 'All pacts verified' reason", async () => {
    const { status, body } = await reqJson("/matrix?pacticipant=mx-c1&version=1.0.0", {
      headers: authHeaders(),
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({
      summary: {
        deployable: true,
        reason: "All pacts verified successfully",
      },
    });
  });

  it("unverified pact → deployable:false with reason", async () => {
    const { status, body } = await reqJson("/matrix?pacticipant=mx-c2&version=1.0.0", {
      headers: authHeaders(),
    });
    expect(status).toBe(200);
    expect((body as { summary: { deployable: boolean } }).summary.deployable).toBe(false);
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

/**
 * ⚠️ **The defect that made `can-i-deploy` unusable in practice.**
 *
 * CI publishes a pact on every commit, so a consumer republishes a byte-identical contract under a new
 * version constantly — and every publish inserts a new `pacts` row. Those rows share a `content_sha`,
 * which is exactly what that column is for.
 *
 * Verifications were matched on `pact.id` alone, so the matrix looked them up against *this* version's
 * row while `publishVerification` had attached them to whichever row shared the sha. The two diverge
 * the moment the consumer commits again, and `can-i-deploy` then answers "1 pact(s) have not been
 * verified" **forever** — for a contract the provider has verified, with nothing the consumer can do
 * short of asking the provider to re-run against every new commit.
 *
 * Found by driving the real loop from company-manager: publish → verify → ask, where the ask was a
 * second consumer version of an unchanged contract.
 */
describe("a verification follows the pact CONTENT, not one consumer version", () => {
  beforeAll(async () => {
    // Version 1: publish and verify.
    const { body } = await publishPact("sha-c1", "sha-p1", "1.0.0");
    const sha = (body as { contentSha: string }).contentSha;
    await publishVerification("sha-p1", "sha-c1", sha, true, "p-1.0.0");
    // Version 2: the SAME contract, republished under a new consumer version — an ordinary CI commit.
    const { body: second } = await publishPact("sha-c1", "sha-p1", "2.0.0");
    expect((second as { contentSha: string }).contentSha).toBe(sha);
  });

  it("reports the NEW consumer version as verified when the contract is unchanged", async () => {
    const { status, body } = await reqJson("/can-i-deploy?pacticipant=sha-c1&version=2.0.0", {
      headers: authHeaders(),
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({
      summary: { deployable: true, reason: "All pacts verified successfully" },
    });
  });

  it("still reports a CHANGED contract as unverified", async () => {
    // The counterweight, and the reason this is scoped by sha rather than simply relaxed: a contract
    // that actually changed gets a new sha, inherits no result, and must be verified again.
    await publishPact("sha-c1", "sha-p1", "3.0.0", { description: "a different interaction" });
    const { body } = await reqJson("/can-i-deploy?pacticipant=sha-c1&version=3.0.0", {
      headers: authHeaders(),
    });
    expect((body as { summary: { deployable: boolean } }).summary.deployable).toBe(false);
  });
});
