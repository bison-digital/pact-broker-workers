import { describe, it, expect } from "vitest";
import { req } from "./helpers";

describe("X-Request-Id propagation", () => {
  it("echoes a caller-supplied X-Request-Id verbatim", async () => {
    const res = await req("/health", { headers: { "X-Request-Id": "my-trace-123" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe("my-trace-123");
  });

  it("generates one when caller doesn't send it", async () => {
    const res = await req("/health");
    expect(res.status).toBe(200);
    const id = res.headers.get("x-request-id") ?? "";
    expect(id.length).toBeGreaterThan(0);
  });

  it("rejects caller-supplied values that don't match the safe pattern", async () => {
    const res = await req("/health", { headers: { "X-Request-Id": "bad id with spaces!" } });
    const id = res.headers.get("x-request-id") ?? "";
    expect(id).not.toBe("bad id with spaces!");
    expect(id.length).toBeGreaterThan(0);
  });
});

describe("CORS", () => {
  it("is permissive when CORS_ALLOWED_ORIGINS is unset (default)", async () => {
    const res = await req("/health", { headers: { Origin: "https://random.example" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("OPTIONS preflight returns 204 with allow-methods/headers", async () => {
    const res = await req("/pacts/latest", {
      method: "OPTIONS",
      headers: {
        Origin: "https://dash.example",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Authorization",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods") ?? "").toMatch(/GET/);
  });
});
