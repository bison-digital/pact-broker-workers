import { describe, it, expect } from "vitest";
import { req } from "./helpers";

// Run under the "public-read" vitest project (ALLOW_PUBLIC_READ=true binding).
describe("auth middleware — ALLOW_PUBLIC_READ=true", () => {
  it("GET bypasses auth", async () => {
    const res = await req("/pacticipants");
    expect(res.status).toBe(200);
  });

  it("HEAD bypasses auth", async () => {
    const res = await req("/pacticipants", { method: "HEAD" });
    expect(res.status).toBe(200);
  });

  it("mutating methods still require auth", async () => {
    const res = await req("/pacts/provider/p/consumer/c/version/1.0.0", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });
});
