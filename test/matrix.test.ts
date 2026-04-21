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
