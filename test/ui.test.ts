import { describe, it, expect } from "vitest";
import { req } from "./helpers";

describe("HAL browser UI", () => {
  it("is served without auth and returns HTML", async () => {
    const res = await req("/ui");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/text\/html/);
    const body = await res.text();
    expect(body).toContain("<title>Pact Broker");
    // key DOM hooks the client-side JS relies on
    expect(body).toContain('id="path"');
    expect(body).toContain('id="links"');
    expect(body).toContain('id="body"');
  });
});
