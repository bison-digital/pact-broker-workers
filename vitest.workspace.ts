import { defineWorkersProject } from "@cloudflare/vitest-pool-workers/config";
import { DEFAULT_BINDINGS } from "./vitest.config";

// Three projects so we can exercise auth edge cases that need distinct
// miniflare bindings (ALLOW_PUBLIC_READ=true, misconfigured token).
export default [
  defineWorkersProject({
    test: {
      name: "default",
      include: ["test/**/*.test.ts"],
      exclude: ["test/auth.public-read.test.ts", "test/auth.bad-token.test.ts"],
      poolOptions: {
        workers: {
          wrangler: { configPath: "./wrangler.jsonc" },
          miniflare: { bindings: DEFAULT_BINDINGS },
        },
      },
    },
  }),
  defineWorkersProject({
    test: {
      name: "public-read",
      include: ["test/auth.public-read.test.ts"],
      poolOptions: {
        workers: {
          wrangler: { configPath: "./wrangler.jsonc" },
          miniflare: {
            bindings: {
              ...DEFAULT_BINDINGS,
              ALLOW_PUBLIC_READ: "true",
            },
          },
        },
      },
    },
  }),
  defineWorkersProject({
    test: {
      name: "bad-token",
      include: ["test/auth.bad-token.test.ts"],
      poolOptions: {
        workers: {
          wrangler: { configPath: "./wrangler.jsonc" },
          miniflare: {
            bindings: {
              ...DEFAULT_BINDINGS,
              PACT_BROKER_TOKEN: "short",
            },
          },
        },
      },
    },
  }),
];
