import { describe, it, expect, beforeAll } from "vitest";
import {
  req,
  reqJson,
  authHeaders,
  publishPact,
  publishVerification,
  tagVersion,
  ensureEnvironment,
  recordDeployment,
} from "./helpers";

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

  // pact_broker-client sends `environment=` for --to-environment and `tag=` for
  // --to (matrix/query.rb#query_options); parse_query.rb accepts both.
  it("narrows on the environment query param the reference client sends", async () => {
    // A *different* provider version is in the environment — one that never
    // verified this pact. Ignoring `environment=` would report the passing
    // verification from p-1.0.0 instead.
    await ensureEnvironment("mx-prod");
    await req("/pacticipants/mx-p1/branches/main/versions/p-2.0.0", {
      method: "PUT",
      headers: authHeaders(),
    });
    await recordDeployment("mx-p1", "p-2.0.0", "mx-prod");

    const { body } = await reqJson("/matrix?pacticipant=mx-c1&version=1.0.0&environment=mx-prod", {
      headers: authHeaders(),
    });
    const summary = (body as { summary: { success: number; unknown: number; reason: string } })
      .summary;

    expect(summary.success).toBe(0);
    expect(summary.unknown).toBe(1);
    expect(summary.reason).toContain("currently in mx-prod (p-2.0.0)");
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

// The two reported findings compound: with no branch on the provider version a
// branch-scoped query resolved nothing, every row came back verificationResult
// null, and a *failed* verification was reported as *absent*. Same data, same
// moment, two answers depending on whether `to` was passed.
describe("/can-i-deploy narrowed to a target", () => {
  beforeAll(async () => {
    const { body } = await publishPact("tgt-c", "tgt-p", "1.0.0");
    await publishVerification(
      "tgt-p",
      "tgt-c",
      (body as { contentSha: string }).contentSha,
      false,
      "p-9.0.0",
    );
    await req("/pacticipants/tgt-p/branches/main/versions/p-9.0.0", {
      method: "PUT",
      headers: authHeaders(),
    });
  });

  it("still reports the failure when narrowed to the provider's branch", async () => {
    const { body } = await reqJson("/can-i-deploy?pacticipant=tgt-c&version=1.0.0&to=main", {
      headers: authHeaders(),
    });
    const summary = (body as { summary: { reason: string; failed: number; deployable: unknown } })
      .summary;

    expect(summary.reason).toContain("failed");
    expect(summary.failed).toBe(1);
    expect(summary.deployable).toBe(false);
  });

  it("says the target matched nothing rather than calling it unverified", async () => {
    const { body } = await reqJson("/can-i-deploy?pacticipant=tgt-c&version=1.0.0&to=nowhere", {
      headers: authHeaders(),
    });
    const summary = (body as { summary: { reason: string; unknown: number; deployable: unknown } })
      .summary;

    expect(summary.reason).toContain("no such version exists");
    expect(summary.unknown).toBe(1);
    expect(summary.deployable).toBeNull();
  });

  it("accepts a target whose name contains a slash or a dot", async () => {
    const { status } = await reqJson(
      "/can-i-deploy?pacticipant=tgt-c&version=1.0.0&to=release/1.2",
      {
        headers: authHeaders(),
      },
    );

    expect(status).toBe(200);
  });

  // `prod` is routinely both a tag and an environment, and they can point at
  // different versions. A recorded deployment is the stronger statement about
  // what is actually running, so it wins.
  it("prefers the deployed version when a target names both an environment and a tag", async () => {
    const { body } = await publishPact("prec-c", "prec-p", "1.0.0");
    const sha = (body as { contentSha: string }).contentSha;

    await publishVerification("prec-p", "prec-c", sha, true, "v-tagged");
    await tagVersion("prec-p", "v-tagged", "prec-shared");

    await publishVerification("prec-p", "prec-c", sha, false, "v-deployed");
    await ensureEnvironment("prec-shared");
    await recordDeployment("prec-p", "v-deployed", "prec-shared");

    const { body: result } = await reqJson(
      "/can-i-deploy?pacticipant=prec-c&version=1.0.0&to=prec-shared",
      { headers: authHeaders() },
    );
    const summary = (result as { summary: { failed: number; success: number } }).summary;

    expect(summary.failed).toBe(1);
    expect(summary.success).toBe(0);
  });

  it("resolves a target that names an environment the provider is deployed to", async () => {
    await ensureEnvironment("tgt-staging");
    await recordDeployment("tgt-p", "p-9.0.0", "tgt-staging");

    const { body } = await reqJson("/can-i-deploy?pacticipant=tgt-c&version=1.0.0&to=tgt-staging", {
      headers: authHeaders(),
    });
    const summary = (body as { summary: { failed: number } }).summary;

    expect(summary.failed).toBe(1);
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
