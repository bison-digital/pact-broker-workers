#!/usr/bin/env node
// Render a local wrangler.jsonc from wrangler.jsonc.tmpl for `pnpm dev`.
//
// In production, Terraform renders this file (see infra/wrangler.tf →
// local_file.wrangler_config). This script exists only so contributors
// can run `pnpm dev` without standing up a TF workspace. It mirrors the
// Terraform templatefile() substitution exactly.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const vars = {
  worker_name: process.env.WORKER_NAME ?? "pact-broker-local",
  account_id: process.env.CLOUDFLARE_ACCOUNT_ID ?? "your-cloudflare-account-id",
  compatibility_date: process.env.WRANGLER_COMPATIBILITY_DATE ?? "2024-12-01",
  allow_public_read: process.env.ALLOW_PUBLIC_READ ?? "false",
  cors_allowed_origins: process.env.CORS_ALLOWED_ORIGINS ?? "",
  public_badges: process.env.PUBLIC_BADGES ?? "true",
};

const tmpl = readFileSync(resolve(repoRoot, "wrangler.jsonc.tmpl"), "utf8");
const rendered = tmpl.replaceAll(/\$\{(\w+)\}/g, (_, key) => {
  if (!(key in vars)) {
    throw new Error(`Unknown placeholder in wrangler.jsonc.tmpl: \${${key}}`);
  }
  return vars[key];
});

writeFileSync(resolve(repoRoot, "wrangler.jsonc"), rendered);
console.log("Rendered wrangler.jsonc from wrangler.jsonc.tmpl");
