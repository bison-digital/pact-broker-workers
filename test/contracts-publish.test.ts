import { describe, it, expect } from "vitest";
import { req, reqJson, authHeaders, samplePact } from "./helpers";

/**
 * POST /contracts/publish — the modern publish endpoint.
 *
 * `pact-broker publish` only takes this path when the index advertises
 * `pb:publish-contracts` (publish_pacts.rb#call). Otherwise it falls back to a
 * legacy path that cannot record branches at all: it prints "This version of
 * the Pact Broker does not support versions with branches or build URLs" and
 * publishes the pact anyway, so the branch is lost while the command succeeds.
 */
function contractsBody(overrides: Record<string, unknown> = {}) {
  const pact = samplePact({ consumer: "ct-consumer", provider: "ct-provider" });
  return {
    pacticipantName: "ct-consumer",
    pacticipantVersionNumber: "1.0.0",
    branch: "main",
    buildUrl: "https://ci.example/build/7",
    tags: ["prod"],
    contracts: [
      {
        consumerName: "ct-consumer",
        providerName: "ct-provider",
        specification: "pact",
        contentType: "application/json",
        content: btoa(JSON.stringify(pact)),
      },
    ],
    ...overrides,
  };
}

async function publishContracts(body: unknown) {
  return req("/contracts/publish", {
    method: "POST",
    headers: authHeaders(undefined, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
}

describe("POST /contracts/publish", () => {
  it("is advertised on the index as pb:publish-contracts", async () => {
    const { body } = await reqJson("/", { headers: authHeaders() });
    const links = (body as { _links: Record<string, { href: string }> })._links;

    expect(links["pb:publish-contracts"]).toMatchObject({
      href: "https://test-host/contracts/publish",
    });
  });

  it("stores the pact from base64 content", async () => {
    const res = await publishContracts(contractsBody());
    expect(res.status).toBe(200);

    const { status, body } = await reqJson(
      "/pacts/provider/ct-provider/consumer/ct-consumer/version/1.0.0",
      { headers: authHeaders() },
    );
    expect(status).toBe(200);
    expect((body as { interactions: unknown[] }).interactions).toHaveLength(1);
  });

  it("records the branch and build URL that the legacy path drops", async () => {
    await publishContracts(
      contractsBody({ pacticipantVersionNumber: "2.0.0", branch: "release/2.x" }),
    );

    const { body } = await reqJson("/pacticipants/ct-consumer/versions/2.0.0", {
      headers: authHeaders(),
    });
    expect(body).toMatchObject({
      branch: "release/2.x",
      buildUrl: "https://ci.example/build/7",
    });
  });

  it("applies the tags sent alongside the contract", async () => {
    await publishContracts(contractsBody({ pacticipantVersionNumber: "3.0.0" }));

    const { body } = await reqJson("/pacticipants/ct-consumer/versions/3.0.0/tags", {
      headers: authHeaders(),
    });
    const tags = (body as { _embedded: { tags: Array<{ name: string }> } })._embedded.tags;
    expect(tags.map((t) => t.name)).toContain("prod");
  });

  // publish_pacts.rb#text_message renders `notices` when present; without them
  // the CLI falls back to printing the raw body.
  it("returns notices the CLI can render", async () => {
    const res = await publishContracts(contractsBody({ pacticipantVersionNumber: "4.0.0" }));
    const body = (await res.json()) as { notices: Array<{ type: string; text: string }> };

    expect(Array.isArray(body.notices)).toBe(true);
    expect(body.notices[0]).toMatchObject({ type: expect.any(String), text: expect.any(String) });
  });

  it("rejects a contract whose content is not valid base64 JSON", async () => {
    const res = await publishContracts(
      contractsBody({
        pacticipantVersionNumber: "5.0.0",
        contracts: [
          {
            consumerName: "ct-consumer",
            providerName: "ct-provider",
            specification: "pact",
            contentType: "application/json",
            content: "not-base64-json",
          },
        ],
      }),
    );

    expect(res.status).toBe(400);
  });

  it("rejects a body with no contracts", async () => {
    const res = await publishContracts(contractsBody({ contracts: [] }));

    expect(res.status).toBe(400);
  });
});
