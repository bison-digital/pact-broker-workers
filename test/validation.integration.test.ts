import { describe, it, expect } from "vitest";
import { reqJson, authHeaders, samplePact } from "./helpers";

describe("path-param validation (HTTP integration)", () => {
  it("rejects path-traversal provider name with 400", async () => {
    const { status, body } = await reqJson("/pacts/provider/..%2Fetc/consumer/c/version/1.0.0", {
      method: "PUT",
      headers: authHeaders("test-token-0123456789abcdef", {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(samplePact()),
    });
    expect(status).toBe(400);
    expect(body).toMatchObject({ error: "Bad Request" });
    expect((body as { message: string }).message).toMatch(/provider/i);
  });

  it("rejects html-like pacticipant name with 400", async () => {
    const { status, body } = await reqJson("/pacticipants/%3Cscript%3E", {
      headers: authHeaders(),
    });
    expect(status).toBe(400);
    expect((body as { message: string }).message).toMatch(/name/i);
  });

  it("rejects non-hex sha with 400", async () => {
    const { status, body } = await reqJson("/pacts/provider/p/consumer/c/pact-version/not-a-sha", {
      headers: authHeaders(),
    });
    expect(status).toBe(400);
    expect((body as { message: string }).message).toMatch(/sha/i);
  });

  it("rejects too-short sha with 400", async () => {
    const { status } = await reqJson(
      `/pacts/provider/p/consumer/c/pact-version/${"a".repeat(10)}`,
      { headers: authHeaders() },
    );
    expect(status).toBe(400);
  });

  it("accepts valid inputs (smoke)", async () => {
    const { status } = await reqJson("/pacticipants/demo-consumer", {
      headers: authHeaders(),
    });
    // 404 because it doesn't exist — the point is validation didn't return 400
    expect(status).toBe(404);
  });

  it("400 body shape: {error, message} with 'Invalid <param>'", async () => {
    const { body } = await reqJson("/pacticipants/%3Cscript%3E", {
      headers: authHeaders(),
    });
    expect(body).toHaveProperty("error", "Bad Request");
    expect(body).toHaveProperty("message");
    expect((body as { message: string }).message).toMatch(/^Invalid /);
  });

  it("rejects name exceeding 255 chars", async () => {
    const { status } = await reqJson(`/pacticipants/${"a".repeat(256)}`, {
      headers: authHeaders(),
    });
    expect(status).toBe(400);
  });

  it("rejects bad branch query param on publish", async () => {
    const { status } = await reqJson(
      "/pacts/provider/p/consumer/c/version/1.0.0?branch=" + encodeURIComponent("$(whoami)"),
      {
        method: "PUT",
        headers: authHeaders("test-token-0123456789abcdef", {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(samplePact()),
      },
    );
    expect(status).toBe(400);
  });
});
