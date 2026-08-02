import { describe, it, expect } from "vitest";
import { req, reqJson, authHeaders, publishPact, publishVerification } from "./helpers";

/**
 * PUT /pacticipants/{name}/branches/{branch}/versions/{version} — the resource
 * behind the pb:branch-version link. pact-reference's publish_provider_branch
 * PUTs "{}" here before publishing verification results; if it 404s or the link
 * is missing, the verifier abandons the results publish entirely.
 */
async function putBranchVersion(
  pacticipant: string,
  branch: string,
  version: string,
  init: RequestInit = {},
): Promise<Response> {
  return req(
    `/pacticipants/${encodeURIComponent(pacticipant)}/branches/${branch}/versions/${encodeURIComponent(version)}`,
    { method: "PUT", headers: authHeaders(), ...init },
  );
}

async function getVersion(pacticipant: string, version: string) {
  const { body } = await reqJson(
    `/pacticipants/${encodeURIComponent(pacticipant)}/versions/${encodeURIComponent(version)}`,
    { headers: authHeaders() },
  );
  return body as { number: string; branch: string | null };
}

describe("PUT branch version", () => {
  it("creates a version carrying the branch", async () => {
    const res = await putBranchVersion("bv-new", "main", "1.0.0");
    expect(res.status).toBe(200);

    expect(await getVersion("bv-new", "1.0.0")).toMatchObject({
      number: "1.0.0",
      branch: "main",
    });
  });

  // publishVerification creates the provider version with no branch. A verifier
  // that publishes results first (or re-runs on a version already recorded)
  // must still be able to attach the branch afterwards.
  it("attaches a branch to a version that already exists without one", async () => {
    const { body } = await publishPact("bv-c", "bv-existing", "1.0.0");
    await publishVerification(
      "bv-existing",
      "bv-c",
      (body as { contentSha: string }).contentSha,
      true,
      "p-2.0.0",
    );
    expect((await getVersion("bv-existing", "p-2.0.0")).branch).toBeNull();

    const res = await putBranchVersion("bv-existing", "main", "p-2.0.0");

    expect(res.status).toBe(200);
    expect((await getVersion("bv-existing", "p-2.0.0")).branch).toBe("main");
  });

  it("moves a version to a different branch when told to", async () => {
    await putBranchVersion("bv-move", "main", "1.0.0");

    const res = await putBranchVersion("bv-move", "release%2F1.x", "1.0.0");

    expect(res.status).toBe(200);
    expect((await getVersion("bv-move", "1.0.0")).branch).toBe("release/1.x");
  });

  it("round-trips a branch name containing a slash", async () => {
    const res = await putBranchVersion("bv-slash", "feature%2Fthing", "1.0.0");

    expect(res.status).toBe(200);
    expect((await getVersion("bv-slash", "1.0.0")).branch).toBe("feature/thing");
  });

  // pact-reference sends the literal string "{}"; earlier clients send nothing.
  // Requiring parseable JSON here would reject the verifier outright.
  it("accepts an empty body with no content type", async () => {
    const res = await putBranchVersion("bv-nobody", "main", "1.0.0", { body: undefined });

    expect(res.status).toBe(200);
  });

  it("accepts the empty JSON object pact-reference sends", async () => {
    const res = await putBranchVersion("bv-emptyjson", "main", "1.0.0", {
      headers: authHeaders(undefined, { "Content-Type": "application/json" }),
      body: "{}",
    });

    expect(res.status).toBe(200);
  });
});

describe("pact publish branch recording", () => {
  it("backfills the branch when an earlier publish omitted it", async () => {
    await publishPact("bv-backfill-c", "bv-backfill-p", "1.0.0");
    expect((await getVersion("bv-backfill-c", "1.0.0")).branch).toBeNull();

    await publishPact("bv-backfill-c", "bv-backfill-p", "1.0.0", { branch: "main" });

    expect((await getVersion("bv-backfill-c", "1.0.0")).branch).toBe("main");
  });
});
