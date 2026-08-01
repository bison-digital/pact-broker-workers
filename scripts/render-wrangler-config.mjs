#!/usr/bin/env node
// Render wrangler.jsonc from wrangler.jsonc.tmpl.
//
// This is the ONLY thing that produces wrangler.jsonc, and it runs before
// dev, test and deploy alike (see the package.json scripts). Terraform used
// to own this for deploys; it no longer does, so there is a single code path
// and local config cannot drift from deployed config.
//
// Every value comes from an environment variable with a local-dev default.
// Operators set them in CI; contributors need none of them.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const domain = process.env.DOMAIN ?? "";

// Custom domains are per-workspace, so the routes block is only emitted when
// a DOMAIN is supplied. Local dev and the vitest suite render `[]`, which
// keeps `wrangler dev` off the zone API entirely.
//
// JSON.stringify so a domain containing quotes cannot break out of the
// template — the rendered file has to stay valid JSONC.
const routes = domain ? JSON.stringify([{ pattern: domain, custom_domain: true }]) : "[]";

function positiveInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return n;
}

const vars = {
  worker_name: process.env.WORKER_NAME ?? "pact-broker-local",
  account_id: process.env.CLOUDFLARE_ACCOUNT_ID ?? "your-cloudflare-account-id",
  compatibility_date: process.env.WRANGLER_COMPATIBILITY_DATE ?? "2026-04-15",
  allow_public_read: process.env.ALLOW_PUBLIC_READ ?? "false",
  cors_allowed_origins: process.env.CORS_ALLOWED_ORIGINS ?? "",
  public_badges: process.env.PUBLIC_BADGES ?? "true",
  routes,
  mutating_rate_limit: positiveInt("MUTATING_RATE_LIMIT", 60),
  read_rate_limit: positiveInt("READ_RATE_LIMIT", 600),
};

const tmpl = readFileSync(resolve(repoRoot, "wrangler.jsonc.tmpl"), "utf8");
const rendered = tmpl.replaceAll(/\$\{(\w+)\}/g, (_, key) => {
  if (!(key in vars)) {
    throw new Error(`Unknown placeholder in wrangler.jsonc.tmpl: \${${key}}`);
  }
  return vars[key];
});

// Fail here rather than letting wrangler report a confusing parse error on a
// file the contributor never wrote.
const withoutComments = rendered.replaceAll(/^\s*\/\/.*$/gm, "").replaceAll(/\/\*[\s\S]*?\*\//g, "");
try {
  JSON.parse(withoutComments);
} catch (err) {
  throw new Error(
    `Rendered wrangler.jsonc is not valid JSON — check wrangler.jsonc.tmpl: ${err.message}`,
  );
}

writeFileSync(resolve(repoRoot, "wrangler.jsonc"), rendered);
console.log(
  `Rendered wrangler.jsonc (worker=${vars.worker_name}, routes=${domain || "none"})`,
);
