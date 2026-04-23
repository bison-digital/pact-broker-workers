import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

// Three projects so we can exercise auth edge cases that need distinct
// miniflare bindings (ALLOW_PUBLIC_READ=true, misconfigured token). The
// default project excludes those test files so they only run under their
// targeted bindings.
const DEFAULT_BINDINGS = {
  PACT_BROKER_TOKEN: "test-token-0123456789abcdef",
  ALLOW_PUBLIC_READ: "false",
};

export default defineWorkersConfig({
  test: {
    // Default pool options for any test that isn't captured by a named project
    // (shouldn't happen in practice — see workspace below — but vitest's
    // resolver still wants a sane top-level config).
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: { bindings: DEFAULT_BINDINGS },
      },
    },
  },
});

// Re-exported so the workspace file can pull the same DEFAULT_BINDINGS.
export { DEFAULT_BINDINGS };
