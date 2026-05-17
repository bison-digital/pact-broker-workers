import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type { HonoEnv } from "../src/types";
import { rateLimitMiddleware } from "../src/middleware/rate-limit";

/**
 * Unit tests for the rate-limit middleware. The middleware reads the
 * RATE_LIMITER bindings from `c.env`, so we supply mocks via the third
 * argument to `app.request()` rather than going through SELF.fetch +
 * the real wrangler bindings — that way we can directly assert the
 * passthrough/reject paths without exhausting a real per-minute
 * counter.
 */

function makeApp(env: Partial<HonoEnv["Bindings"]> = {}) {
  const app = new Hono<HonoEnv>();
  app.use("*", rateLimitMiddleware);
  app.get("/probe", (c) => c.json({ ok: true }));
  app.post("/probe", (c) => c.json({ ok: true }));
  app.get("/health", (c) => c.json({ status: "ok" }));
  return async (path: string, init: RequestInit = {}) => app.request(path, init, env);
}

const headers = (ip: string): Record<string, string> => ({ "cf-connecting-ip": ip });

describe("rateLimitMiddleware — passthrough", () => {
  it("/health bypasses rate limiting unconditionally", async () => {
    const limit = vi.fn();
    const app = makeApp({
      READ_RATE_LIMITER: { limit } as unknown as RateLimit,
      MUTATING_RATE_LIMITER: { limit } as unknown as RateLimit,
    });
    const res = await app("/health", { headers: headers("1.2.3.4") });
    expect(res.status).toBe(200);
    expect(limit).not.toHaveBeenCalled();
  });

  it("passes through when cf-connecting-ip is absent", async () => {
    const limit = vi.fn();
    const app = makeApp({
      READ_RATE_LIMITER: { limit } as unknown as RateLimit,
    });
    const res = await app("/probe");
    expect(res.status).toBe(200);
    expect(limit).not.toHaveBeenCalled();
  });

  it("passes through when the binding is unset", async () => {
    const app = makeApp({});
    const res = await app("/probe", { headers: headers("1.2.3.4") });
    expect(res.status).toBe(200);
  });
});

describe("rateLimitMiddleware — limiter calls", () => {
  it("read methods consult READ_RATE_LIMITER", async () => {
    const readLimit = vi.fn().mockResolvedValue({ success: true });
    const mutatingLimit = vi.fn().mockResolvedValue({ success: true });
    const app = makeApp({
      READ_RATE_LIMITER: { limit: readLimit } as unknown as RateLimit,
      MUTATING_RATE_LIMITER: { limit: mutatingLimit } as unknown as RateLimit,
    });

    await app("/probe", { headers: headers("1.2.3.4") });

    expect(readLimit).toHaveBeenCalledWith({ key: "1.2.3.4" });
    expect(mutatingLimit).not.toHaveBeenCalled();
  });

  it("mutating methods consult MUTATING_RATE_LIMITER", async () => {
    const readLimit = vi.fn().mockResolvedValue({ success: true });
    const mutatingLimit = vi.fn().mockResolvedValue({ success: true });
    const app = makeApp({
      READ_RATE_LIMITER: { limit: readLimit } as unknown as RateLimit,
      MUTATING_RATE_LIMITER: { limit: mutatingLimit } as unknown as RateLimit,
    });

    await app("/probe", { method: "POST", headers: headers("1.2.3.4") });

    expect(mutatingLimit).toHaveBeenCalledWith({ key: "1.2.3.4" });
    expect(readLimit).not.toHaveBeenCalled();
  });
});

describe("rateLimitMiddleware — over-cap", () => {
  it("returns 429 with the expected envelope when the limiter rejects", async () => {
    const app = makeApp({
      READ_RATE_LIMITER: {
        limit: vi.fn().mockResolvedValue({ success: false }),
      } as unknown as RateLimit,
    });

    const res = await app("/probe", { headers: headers("1.2.3.4") });

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: "Too Many Requests",
      message: "Rate limit exceeded; try again shortly",
    });
  });
});
