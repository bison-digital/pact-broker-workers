import { describe, it, expect } from "vitest";
import {
  reqJson,
  authHeaders,
  publishPact,
  tagVersion,
  publishVerification,
  ensureEnvironment,
  recordDeployment,
} from "./helpers";

/**
 * `versions.created_at` defaults to `datetime('now')`, which is second
 * granularity. Two versions published inside the same second therefore tie, and
 * "the latest version" becomes whichever row SQLite happens to return — so a
 * selector could match against the wrong version of a consumer. CI is fast
 * enough to hit this; a developer machine usually is not.
 */
describe("latest version selection with same-second writes", () => {
  it("treats the most recently created version as latest", async () => {
    // No await between these beyond the requests themselves — both land in the
    // same second on any reasonably quick machine.
    await publishPact("ord-c", "ord-p", "1.0.0", { branch: "main" });
    await publishPact("ord-c", "ord-p", "2.0.0", { branch: "main" });

    const { body } = await reqJson("/pacts/provider/ord-p/consumer/ord-c/latest", {
      headers: authHeaders(),
    });

    expect((body as { consumerVersion: string }).consumerVersion).toBe("2.0.0");
  });

  it("keeps for-verification anchored to the newest version, not an arbitrary tie", async () => {
    await publishPact("ord2-c", "ord2-p", "1.0.0", { branch: "main" });
    await publishPact("ord2-c", "ord2-p", "2.0.0", { branch: "main" });
    await tagVersion("ord2-c", "2.0.0", "ord-prod");

    const { body } = await reqJson("/pacts/provider/ord2-p/for-verification", {
      method: "POST",
      headers: authHeaders(undefined, { "Content-Type": "application/json" }),
      body: JSON.stringify({ consumerVersionSelectors: [{ tag: "ord-prod" }] }),
    });
    const pacts =
      (body as { _embedded?: { pacts?: Array<{ shortDescription: string }> } })._embedded?.pacts ??
      [];

    expect(pacts.map((p) => p.shortDescription)).toContain(
      "Pact between ord2-c (2.0.0) and ord2-p",
    );
  });

  it("resolves the latest tagged version when several share a timestamp", async () => {
    await publishPact("ord3-c", "ord3-p", "1.0.0");
    await publishPact("ord3-c", "ord3-p", "2.0.0");
    await tagVersion("ord3-c", "1.0.0", "shared");
    await tagVersion("ord3-c", "2.0.0", "shared");

    const { body } = await reqJson("/pacts/provider/ord3-p/consumer/ord3-c/latest/shared", {
      headers: authHeaders(),
    });

    expect((body as { consumerVersion: string }).consumerVersion).toBe("2.0.0");
  });

  // verifications.verified_at is second-granularity too: a re-run that flips a
  // pact from red to green in the same second must not report the stale result.
  it("reports the most recent verification when two land in the same second", async () => {
    const { body } = await publishPact("ord4-c", "ord4-p", "1.0.0");
    const sha = (body as { contentSha: string }).contentSha;

    await publishVerification("ord4-p", "ord4-c", sha, false, "p-1");
    await publishVerification("ord4-p", "ord4-c", sha, true, "p-2");

    const { body: matrix } = await reqJson("/matrix?pacticipant=ord4-c&version=1.0.0", {
      headers: authHeaders(),
    });

    expect((matrix as { summary: { deployable: boolean | null } }).summary.deployable).toBe(true);
  });

  // Same for deployed_versions.deployed_at, which decides which version a
  // can-i-deploy target resolves to.
  it("resolves the most recent deployment when two land in the same second", async () => {
    const { body } = await publishPact("ord5-c", "ord5-p", "1.0.0");
    const sha = (body as { contentSha: string }).contentSha;
    await publishVerification("ord5-p", "ord5-c", sha, true, "p-old");
    await publishVerification("ord5-p", "ord5-c", sha, false, "p-new");

    await ensureEnvironment("ord-env");
    await recordDeployment("ord5-p", "p-old", "ord-env");
    await recordDeployment("ord5-p", "p-new", "ord-env");

    const { body: result } = await reqJson(
      "/can-i-deploy?pacticipant=ord5-c&version=1.0.0&to=ord-env",
      { headers: authHeaders() },
    );

    expect((result as { summary: { failed: number } }).summary.failed).toBe(1);
  });
});
