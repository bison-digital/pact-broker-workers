import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

// Three projects so we can exercise auth edge cases that need distinct
// miniflare bindings (ALLOW_PUBLIC_READ=true, misconfigured token). The
// default project excludes those test files so they only run under their
// targeted bindings.
//
// vitest 4 removed workspace files, so these live here rather than in a
// vitest.workspace.ts. @cloudflare/vitest-pool-workers 0.13 removed the
// /config entrypoint along with defineWorkersConfig/defineWorkersProject —
// what used to be `test.poolOptions.workers` is now the argument to the
// cloudflareTest() Vite plugin, applied per project.
const DEFAULT_BINDINGS = {
  PACT_BROKER_TOKEN: "test-token-0123456789abcdef",
  ALLOW_PUBLIC_READ: "false",
};

const WEBHOOK_TARGET = "https://webhook.example/hook";

/**
 * Intercepts every outbound fetch() the Worker makes.
 *
 * Replaces `fetchMock` from `cloudflare:test`, removed in pool 0.13. The
 * documented alternative — mocking globalThis.fetch — does not work here:
 * the request under test is issued inside PactBrokerDO.fireWebhook(), and
 * the "global mocks apply" guarantee only covers the main worker's isolate,
 * not a Durable Object's. outboundService intercepts at the runtime level,
 * which is where fetchMock used to sit.
 *
 * Throwing on anything else reproduces fetchMock.disableNetConnect(): a test
 * that reaches for the real network fails loudly instead of hanging.
 */
function outboundService(request: Request): Response {
  if (request.url === WEBHOOK_TARGET) {
    return new Response("ok", { status: 200 });
  }
  throw new Error(
    `Unexpected outbound request to ${request.url}. Tests must not reach the network; ` +
      `add the URL to vitest.config.ts if this is intentional.`,
  );
}

function workersPlugin(
  bindings: Record<string, string>,
  ratelimits?: Record<string, { namespace_id: string; simple: { limit: number; period: 60 } }>,
) {
  return cloudflareTest({
    wrangler: { configPath: "./wrangler.jsonc" },
    miniflare: { bindings, outboundService, ...(ratelimits ? { ratelimits } : {}) },
  });
}

// A limit low enough to trip inside a test. The rendered wrangler.jsonc uses
// 60/600 per minute, which would need 61 requests to exercise — this project
// overrides the binding so the 429 path is actually covered.
const TIGHT_RATE_LIMITS = {
  RATE_LIMIT_MUTATING: { namespace_id: "9001", simple: { limit: 2, period: 60 as const } },
  RATE_LIMIT_READ: { namespace_id: "9002", simple: { limit: 3, period: 60 as const } },
};

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [workersPlugin(DEFAULT_BINDINGS)],
        test: {
          name: "default",
          include: ["test/**/*.test.ts"],
          exclude: [
            "test/auth.public-read.test.ts",
            "test/auth.bad-token.test.ts",
            "test/rate-limit.test.ts",
          ],
        },
      },
      {
        plugins: [workersPlugin(DEFAULT_BINDINGS, TIGHT_RATE_LIMITS)],
        test: {
          name: "rate-limit",
          include: ["test/rate-limit.test.ts"],
        },
      },
      {
        plugins: [workersPlugin({ ...DEFAULT_BINDINGS, ALLOW_PUBLIC_READ: "true" })],
        test: {
          name: "public-read",
          include: ["test/auth.public-read.test.ts"],
        },
      },
      {
        plugins: [workersPlugin({ ...DEFAULT_BINDINGS, PACT_BROKER_TOKEN: "short" })],
        test: {
          name: "bad-token",
          include: ["test/auth.bad-token.test.ts"],
        },
      },
    ],
  },
});
