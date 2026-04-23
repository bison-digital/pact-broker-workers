import { describe, it, expect } from "vitest";
import { req, publishPact, publishVerification } from "./helpers";

describe("badge endpoint", () => {
  it("serves an SVG even when no pact exists (unknown state)", async () => {
    const res = await req("/pacts/provider/no-such-p/consumer/no-such-c/badge");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/image\/svg\+xml/);
    const body = await res.text();
    expect(body).toContain("<svg");
    expect(body).toContain("unknown");
  });

  it("is publicly accessible (no bearer token required)", async () => {
    const res = await req("/pacts/provider/b-p/consumer/b-c/badge");
    expect(res.status).toBe(200);
    // no Authorization header sent
  });

  it("shows 'verified' once a successful verification exists", async () => {
    const publish = await publishPact("badge-c", "badge-p", "1.0.0");
    expect(publish.status).toBe(201);
    const sha = publish.body.contentSha as string;
    const vr = await publishVerification("badge-p", "badge-c", sha, true);
    expect(vr).toBe(201);

    const res = await req("/pacts/provider/badge-p/consumer/badge-c/badge");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("verified");
  });

  it("shows 'failed' after a failed verification", async () => {
    const publish = await publishPact("badge-fc", "badge-fp", "1.0.0");
    const sha = publish.body.contentSha as string;
    const vr = await publishVerification("badge-fp", "badge-fc", sha, false);
    expect(vr).toBe(201);

    const res = await req("/pacts/provider/badge-fp/consumer/badge-fc/badge");
    const body = await res.text();
    expect(body).toContain("failed");
  });

  it("validates path params and rejects path traversal", async () => {
    const res = await req("/pacts/provider/" + encodeURIComponent("../etc") + "/consumer/c/badge");
    expect(res.status).toBe(400);
  });
});
