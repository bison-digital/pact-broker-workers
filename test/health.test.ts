import { describe, it, expect } from "vitest";
import { req, reqJson } from "./helpers";

/**
 * /health is the only post-deploy signal CI has — nothing in the deploy
 * pipeline holds a bearer token. These tests pin the contract that
 * .github/workflows/deploy-*.yml assert against, so a change here that
 * breaks the smoke test fails in CI rather than in production.
 */
describe("health endpoint", () => {
  it("returns 200 with status and storage both ok", async () => {
    const { status, body } = await reqJson("/health");
    expect(status).toBe(200);
    expect(body).toEqual({ status: "ok", storage: "ok" });
  });

  it("requires no authentication", async () => {
    // No Authorization header at all — the deploy smoke test sends none.
    const res = await req("/health");
    expect(res.status).toBe(200);
  });

  it("reports storage:ok, proving the DO round-trip actually happened", async () => {
    // A static { status: "ok" } would pass the assertion above without
    // touching the Durable Object. `storage` is only present when
    // PactBrokerDO.healthCheck() resolved, so it is the field that
    // distinguishes "Worker booted" from "broker works".
    const { body } = await reqJson("/health");
    expect(body).toHaveProperty("storage", "ok");
  });

  it("stays healthy after data has been written", async () => {
    // Guards the LIMIT 1 probe against a regression where it only works on
    // an empty table (or vice versa).
    const { publishPact } = await import("./helpers");
    await publishPact("health-c", "health-p", "1.0.0");

    const { status, body } = await reqJson("/health");
    expect(status).toBe(200);
    expect(body).toEqual({ status: "ok", storage: "ok" });
  });

  it("is served as JSON", async () => {
    const res = await req("/health");
    expect(res.headers.get("Content-Type")).toMatch(/application\/json/);
  });
});
