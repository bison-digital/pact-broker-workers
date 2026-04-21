import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            PACT_BROKER_TOKEN: "test-token-0123456789abcdef",
            ALLOW_PUBLIC_READ: "false",
          },
        },
      },
    },
  },
});
