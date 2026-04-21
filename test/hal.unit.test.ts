import { describe, it, expect } from "vitest";
import { HalBuilder, getBaseUrl } from "../src/services/hal";

describe("HalBuilder", () => {
  it("link() returns fully-qualified href", () => {
    const hal = new HalBuilder("https://broker.example.com");
    expect(hal.link("/pacticipants")).toEqual({
      href: "https://broker.example.com/pacticipants",
    });
  });

  it("link() title + templated flags pass through", () => {
    const hal = new HalBuilder("https://broker.example.com");
    expect(hal.link("/p/{name}", "pact", true)).toEqual({
      href: "https://broker.example.com/p/{name}",
      title: "pact",
      templated: true,
    });
  });

  it("trailing slash in base URL is normalized", () => {
    const hal = new HalBuilder("https://broker.example.com/");
    expect(hal.link("/x").href).toBe("https://broker.example.com/x");
  });

  it("pact() returns expected _links record with all keys", () => {
    const hal = new HalBuilder("https://broker.example.com");
    const links = hal.pact("prov", "cons", "1.0.0", "a".repeat(64));
    expect(Object.keys(links).sort()).toEqual([
      "pb:consumer",
      "pb:consumer-version",
      "pb:latest-pact-version",
      "pb:provider",
      "pb:publish-verification-results",
      "self",
    ]);
    expect(links.self?.href).toBe(
      "https://broker.example.com/pacts/provider/prov/consumer/cons/version/1.0.0",
    );
  });

  it("pact() percent-encodes names with special chars", () => {
    const hal = new HalBuilder("https://broker.example.com");
    const links = hal.pact("p/rov", "c ons", "1.0.0", "a".repeat(64));
    expect(links.self?.href).toContain("/provider/p%2Frov/consumer/c%20ons/");
  });
});

describe("getBaseUrl", () => {
  it("preserves scheme and host from request URL", () => {
    const req = new Request("https://public-host.example.com/some/path");
    expect(getBaseUrl(req)).toBe("https://public-host.example.com");
  });

  it("works for http too", () => {
    const req = new Request("http://localhost:9090/health");
    expect(getBaseUrl(req)).toBe("http://localhost:9090");
  });
});
