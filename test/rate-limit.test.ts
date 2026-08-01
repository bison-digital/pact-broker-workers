import { describe, it, expect } from "vitest";
import { req, authHeaders, samplePact } from "./helpers";

/**
 * Rate limiting replaced the zone-level `http_ratelimit` ruleset that
 * Terraform used to provision, so it is now application behaviour and needs
 * covering like any other.
 *
 * This file runs under the `rate-limit` vitest project, which overrides the
 * bindings to limit: 2 (mutating) and limit: 3 (read). The rendered
 * wrangler.jsonc uses 60/600 per minute, which no test could reasonably trip.
 */
async function publishAttempt(n: number): Promise<number> {
  const res = await req(`/pacts/provider/rl-p/consumer/rl-c${n}/version/1.0.0`, {
    method: "PUT",
    headers: authHeaders("test-token-0123456789abcdef", {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(samplePact({ consumer: `rl-c${n}`, provider: "rl-p" })),
  });
  return res.status;
}

describe("rate limiting", () => {
  it("returns 429 with an error envelope once the read limit is exceeded", async () => {
    // limit is 3; the 4th should be refused.
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await req("/pacticipants", { headers: authHeaders() });
      statuses.push(res.status);
    }

    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses).toContain(429);

    const refused = await req("/pacticipants", { headers: authHeaders() });
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({
      error: "Too Many Requests",
      message: "Rate limit exceeded. Retry shortly.",
    });
  });

  it("counts mutating requests against a separate, tighter bucket", async () => {
    // Mutating limit is 2, read limit is 3 — separate buckets, so exhausting
    // writes must not depend on reads and vice versa.
    expect(await publishAttempt(1)).toBe(201);
    expect(await publishAttempt(2)).toBe(201);
    expect(await publishAttempt(3)).toBe(429);
  });

  it("exempts /health so a throttled broker stays diagnosable", async () => {
    // The deploy smoke test polls /health up to five times. If limiting
    // applied there, a busy broker could fail its own deploy.
    for (let i = 0; i < 8; i++) {
      const res = await req("/health");
      expect(res.status).toBe(200);
    }
  });
});
