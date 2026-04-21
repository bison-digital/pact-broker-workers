import { describe, it, expect } from "vitest";
import { req, reqJson, authHeaders, TOKEN } from "./helpers";

describe("auth middleware", () => {
  it("/health is open (no auth required)", async () => {
    const res = await req("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("missing Authorization header returns 401", async () => {
    const { status, body } = await reqJson("/pacticipants");
    expect(status).toBe(401);
    expect(body).toMatchObject({
      error: "Unauthorized",
      message: "Missing Authorization header",
    });
  });

  it("non-Bearer scheme returns 401", async () => {
    const { status, body } = await reqJson("/pacticipants", {
      headers: { Authorization: `Basic ${btoa("user:pass")}` },
    });
    expect(status).toBe(401);
    expect(body).toMatchObject({ error: "Unauthorized" });
    expect((body as { message: string }).message).toMatch(/format/i);
  });

  it("Bearer with empty token returns 401", async () => {
    const { status } = await reqJson("/pacticipants", {
      headers: { Authorization: "Bearer " },
    });
    expect(status).toBe(401);
  });

  it("wrong token returns 401 Invalid token", async () => {
    const { status, body } = await reqJson("/pacticipants", {
      headers: authHeaders("not-the-right-token"),
    });
    expect(status).toBe(401);
    expect(body).toMatchObject({
      error: "Unauthorized",
      message: "Invalid token",
    });
  });

  it("wrong-length token also returns 401", async () => {
    const { status } = await reqJson("/pacticipants", {
      headers: authHeaders("x"),
    });
    expect(status).toBe(401);
  });

  it("correct token returns 200 on /pacticipants", async () => {
    const res = await req("/pacticipants", { headers: authHeaders() });
    expect(res.status).toBe(200);
  });

  it("token is case-sensitive", async () => {
    const { status } = await reqJson("/pacticipants", {
      headers: authHeaders(TOKEN.toUpperCase()),
    });
    expect(status).toBe(401);
  });

  it("token with leading/trailing whitespace is NOT trimmed", async () => {
    const { status } = await reqJson("/pacticipants", {
      headers: { Authorization: `Bearer  ${TOKEN} ` },
    });
    expect(status).toBe(401);
  });

  it.skip("ALLOW_PUBLIC_READ=true: GET bypasses auth — needs per-file miniflare override", () => {
    // TODO: cover via a separate vitest project with
    // miniflare.bindings.ALLOW_PUBLIC_READ="true". Mutating `env` from the
    // test scope doesn't propagate into the Worker's env. Tracked in
    // BACKLOG.md ("Test coverage → auth env-toggle cases").
  });

  it.skip("misconfigured PACT_BROKER_TOKEN (<8 chars) returns 500 — needs per-file miniflare override", () => {
    // TODO: same reason as above. Covered at the unit level (auth middleware
    // reads env.PACT_BROKER_TOKEN.length < 8 → 500) but not exercised here.
  });
});
