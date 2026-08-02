import { describe, it, expect } from "vitest";
import { req, reqJson, authHeaders, ensureEnvironment } from "./helpers";

/**
 * Relations `pact-broker-client` navigates from the index, and the resources
 * behind them. Each of these was found by running the real CLI: without them
 * `publish --branch` records no branch and reports success, and
 * `record-deployment` fails with "Could not find relation 'pb:pacticipant-version'".
 */
async function index() {
  const { body } = await reqJson("/", { headers: authHeaders() });
  return (body as { _links: Record<string, { href: string; templated?: boolean }> })._links;
}

async function getVersion(pacticipant: string, version: string) {
  const { body } = await reqJson(`/pacticipants/${pacticipant}/versions/${version}`, {
    headers: authHeaders(),
  });
  return body as {
    number: string;
    branch: string | null;
    buildUrl: string | null;
    _links: Record<
      string,
      { href: string; name?: string } | Array<{ href: string; name?: string }>
    >;
  };
}

describe("index relations the CLI navigates", () => {
  // versions/create.rb#branch_versions_supported? gates the whole branch flow on
  // this relation being present on the index — not on the pacticipant resource.
  it("advertises pb:pacticipant-branch-version", async () => {
    expect((await index())["pb:pacticipant-branch-version"]).toMatchObject({
      href: "https://test-host/pacticipants/{pacticipant}/branches/{branch}/versions/{version}",
      templated: true,
    });
  });

  // record_release.rb#get_pacticipant_version expands this to reach the version.
  it("advertises pb:pacticipant-version", async () => {
    expect((await index())["pb:pacticipant-version"]).toMatchObject({
      href: "https://test-host/pacticipants/{pacticipant}/versions/{version}",
      templated: true,
    });
  });

  it("advertises pb:pacticipant-version-tag", async () => {
    expect((await index())["pb:pacticipant-version-tag"]).toMatchObject({
      href: "https://test-host/pacticipants/{pacticipant}/versions/{version}/tags/{tag}",
      templated: true,
    });
  });
});

describe("PUT a pacticipant version", () => {
  // versions/create.rb#create_version PUTs the bare version; the legacy publish
  // path PUTs {branch, buildUrl} (publish_pacts_the_old_way.rb#version_body).
  it("creates a version from a bare PUT", async () => {
    const res = await req("/pacticipants/pv-bare/versions/1.0.0", {
      method: "PUT",
      headers: authHeaders(),
    });

    expect(res.status).toBe(200);
    expect((await getVersion("pv-bare", "1.0.0")).number).toBe("1.0.0");
  });

  it("records the branch and buildUrl the publish path sends", async () => {
    await req("/pacticipants/pv-body/versions/1.0.0", {
      method: "PUT",
      headers: authHeaders(undefined, { "Content-Type": "application/json" }),
      body: JSON.stringify({ branch: "main", buildUrl: "https://ci.example/build/9" }),
    });

    expect(await getVersion("pv-body", "1.0.0")).toMatchObject({
      branch: "main",
      buildUrl: "https://ci.example/build/9",
    });
  });
});

describe("environments as the CLI expects them", () => {
  // `pact-broker create-environment` POSTs the collection.
  it("creates an environment from a POST to the collection", async () => {
    const res = await req("/environments", {
      method: "POST",
      headers: authHeaders(undefined, { "Content-Type": "application/json" }),
      body: JSON.stringify({ name: "cli-created", displayName: "CLI Created", production: true }),
    });

    expect(res.status).toBe(201);
    const { body } = await reqJson("/environments/cli-created", { headers: authHeaders() });
    expect(body).toMatchObject({ name: "cli-created", production: true });
  });

  // record_release.rb#environment_exists? does
  // index._link!("pb:environments").get!._links("pb:environments").find(name),
  // so the collection needs named pb:environments links, not just _embedded.
  it("lists environments as a named pb:environments link collection", async () => {
    await ensureEnvironment("cli-listed");

    const { body } = await reqJson("/environments", { headers: authHeaders() });
    const links = (body as { _links: { "pb:environments"?: Array<{ name?: string }> } })._links[
      "pb:environments"
    ];

    expect(Array.isArray(links)).toBe(true);
    expect(links!).toContainEqual(expect.objectContaining({ name: "cli-listed" }));
  });
});

describe("recording a deployment the way the CLI does", () => {
  // record_release.rb reads a *collection* of pb:record-deployment links off the
  // version resource and picks the one named after the environment.
  it("offers a named pb:record-deployment link per environment", async () => {
    await ensureEnvironment("cli-prod");
    await req("/pacticipants/dep-app/versions/1.0.0", { method: "PUT", headers: authHeaders() });

    const links = (await getVersion("dep-app", "1.0.0"))._links["pb:record-deployment"];

    expect(Array.isArray(links)).toBe(true);
    expect(links as Array<{ name?: string }>).toContainEqual(
      expect.objectContaining({ name: "cli-prod" }),
    );
  });

  it("records the deployment when that link is POSTed to", async () => {
    await ensureEnvironment("cli-stage");
    await req("/pacticipants/dep-app2/versions/1.0.0", { method: "PUT", headers: authHeaders() });

    const links = (await getVersion("dep-app2", "1.0.0"))._links["pb:record-deployment"] as Array<{
      href: string;
      name?: string;
    }>;
    const target = links.find((l) => l.name === "cli-stage")!;

    const res = await req(new URL(target.href).pathname, {
      method: "POST",
      headers: authHeaders(undefined, { "Content-Type": "application/json" }),
      body: JSON.stringify({ target: null }),
    });
    expect(res.status).toBe(201);

    const { body } = await reqJson("/pacticipants/dep-app2/versions/1.0.0/deployed", {
      headers: authHeaders(),
    });
    const deployments = (body as { _embedded: { deployments: Array<{ environment: string }> } })
      ._embedded.deployments;
    expect(deployments.map((d) => d.environment)).toContain("cli-stage");
  });
});
