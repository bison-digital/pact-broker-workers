import { describe, it, expect } from "vitest";
import { reqJson, authHeaders } from "./helpers";

// Run under the "bad-token" vitest project (PACT_BROKER_TOKEN="short").
describe("auth middleware — misconfigured PACT_BROKER_TOKEN", () => {
  it("returns 500 when the deployed token is shorter than 8 chars", async () => {
    const { status, body } = await reqJson("/pacticipants", { headers: authHeaders() });
    expect(status).toBe(500);
    expect(body).toMatchObject({ error: "Internal Server Error" });
  });
});
