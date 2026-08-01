# Backlog

Things this broker deliberately does not do yet. Filed here so operators know what to expect, and so contributors know where a PR would land.

## Feature parity with the reference Pact Broker

### Webhooks (shipped)
Implemented. `POST /webhooks` to subscribe; fire on `contract_published` and `provider_verification_published`. Best-effort delivery with three retries; every attempt logged to `GET /webhooks/{id}/executions`. Admin-only (no `ALLOW_PUBLIC_READ` bypass).

### HAL browser UI (shipped)
Implemented. A dependency-free HTML page at `/ui` that prompts for the bearer token (stored only in `sessionStorage`) and lets operators follow HAL `_links`.

### Matrix badge endpoint (shipped)
Implemented. `GET /pacts/provider/{p}/consumer/{c}/badge` returns an SVG pill. Public by default (set `PUBLIC_BADGES=false` to require auth).

## Hardening / hygiene

Items found during a periodic audit of the upstream repo. Not blockers; filed so they don't get forgotten.

### Stale `compatibility_date` (shipped)
`wrangler.jsonc.tmpl` now pins `compatibility_date: "2026-04-15"`. All existing tests pass under the new date. Re-run this bump periodically (Dependabot doesn't cover it).

### Request body size limit (shipped)
`PUT /pacts/...` capped at 1 MB via `hono/body-limit`; pacts with more than 1000 interactions are rejected as 400. Global 10 MB cap retained for all other routes.

### Rate limiting (shipped)
Enforced in the Worker via Cloudflare's `ratelimits` binding — separate buckets for mutating and read requests, keyed on `CF-Connecting-IP`, configured in `wrangler.jsonc.tmpl` and tuned via `MUTATING_RATE_LIMIT` / `READ_RATE_LIMIT`.

This replaced a zone-level `http_ratelimit` ruleset when Terraform was removed. Two trade-offs, both deliberate: it runs inside the Worker so a throttled request still costs an invocation, and limits are per Cloudflare location rather than zone-wide. In exchange it works on every Cloudflare plan — the ruleset needed Pro+, hence the kill switch it used to ship with.

### Dependabot (shipped)
Weekly updates configured for `npm` and `github-actions`, grouped by minor/patch and major (see `.github/dependabot.yml`). The `terraform` ecosystem entry was dropped along with `infra/`.

### GitHub Actions Node-20 deprecation (shipped)
`actions/checkout` and `actions/setup-node` bumped to `@v5` across `ci.yml`, `deploy-staging.yml`, `deploy-production.yml`. `pnpm/action-setup` stays at `@v4` (no `@v5` published yet; Dependabot will catch it).

### Secret scanning posture
Verify GitHub's native secret scanning is enabled on this public repo (Settings → Code security). If a downstream fork publishes pre-review, a stray `PACT_BROKER_TOKEN` in a commit would ship. Consider also a `gitleaks-action` run in CI as a second line.

### Worker bundle size — never use `import { z } from "zod"` (shipped)

Fixed in 2.0.0, recorded because the failure mode is silent and easy to
reintroduce.

zod 4 briefly doubled the bundle to 891.53 KiB (148.14 KiB gzip), of which
278.7 KiB was **locale files for every language zod ships** and 48.1 KiB was
JSON-Schema conversion. Neither is used: every validation message here is a
custom English string, and nothing calls `toJSONSchema`.

zod declares `sideEffects: false`, so it was not a bundler misconfiguration.
`import { z } from "zod"` pulls the whole namespace, which makes `z.locales` a
reachable property that esbuild cannot drop. Named imports
(`import { object, string, enum as zEnum } from "zod"`) fix it:

| | before | after |
| --- | --- | --- |
| total upload | 891.53 KiB | **483.69 KiB** |
| gzipped | 148.14 KiB | **93.92 KiB** |
| zod's share | 544.7 KiB | **141.4 KiB** |
| zod locales | 278.7 KiB | **0 KiB** |

**Keep validators on named imports.** A single `import { z } from "zod"`
anywhere in `src/` puts all 279 KiB of locales back, and nothing in CI will
tell you — the bundle-size check that would catch it does not exist yet.

Largest remaining dependency is drizzle-orm at 167.3 KiB. Worth a look only
if bundle size ever becomes a real constraint; Workers limits apply to the
gzipped size, so 94 KiB sits against a 3 MB free-plan ceiling.

## Operational gaps

### Durable Object SQLite snapshot / export
No built-in mechanism to export the broker's stored pacts, verifications, tags, or deployments. Cloudflare replicates DO storage internally but there's no point-in-time backup. Options to consider at production rollout:
- A scheduled Worker that walks the broker API and writes JSON to R2.
- Treat the broker as a CI gate only; keep consumer/provider pacts reproducible from CI artefacts so a broker loss is recoverable.

### Scheduled verification runs / reminders
Not implemented. The broker stores verification results passively; it does not remind providers that a consumer's pact is unverified.

### Multi-tenant or per-team auth
Single bearer token. No scoped tokens, per-team isolation, or audit log of who published what. Suitable for a single-org deployment.

## Test coverage

### Tier 1 suite (landed in v1.1.0)
Integration + unit tests live under `test/` — auth middleware, input validation, core pact flow, matrix / can-i-deploy, for-verification selectors, HAL builder. 82 tests + 2 skipped. CI drops `--passWithNoTests`; failing tests now block merges.

### Tier 2 follow-ups
- **Env-toggle auth cases (shipped)** — `ALLOW_PUBLIC_READ=true` happy path and `PACT_BROKER_TOKEN` too-short → 500 run under dedicated vitest projects (`public-read`, `bad-token`) in `vitest.config.ts`. A fourth project, `rate-limit`, overrides the rate-limit bindings low enough to exercise the 429 path.
- **Tags — deep behavior.** Add/remove tag idempotency, tag-on-nonexistent-version, tag name collisions.
- **Verifications — edge cases.** Multiple verifications per pact, latest-verification selection, success-after-failure.
- **Environments + deployments — in depth.** PUT/GET/DELETE env, deploy + undeploy, `isVersionDeployed`, cross-environment `deployed` selector.
- **Selector combinations in `for-verification`.** Multiple selectors on one request, pending-flag handling, notices content assertions.
- **Coverage reporting — still blocked upstream (re-tested on pool 0.20.1, 2026-08-01).** `@vitest/coverage-v8` now fails hard rather than reporting a misleading 0%: the Workers isolate has no `node:inspector` Session, so the run aborts with `ERR_METHOD_NOT_IMPLEMENTED` before any test executes. Do **not** wire `--coverage` into CI. Revisit when the pool ships its own instrumentation, or split the pure-function tests (`*.unit.test.ts`) into a separate Node-pool project where v8 coverage does work.

### Durable-object state isolation note
**Changed in pool 0.20:** the `isolatedStorage` option is gone and storage is now isolated per test *file*, not per test. Mutations from one `it()` persist into the next in the same file.

The suite already survives this because fixtures use names unique to the test that creates them (`c1`/`p1`, `c2`/`p2`, `badge-c` vs `badge-fc`, …) and collection assertions use `toBeGreaterThanOrEqual` rather than exact counts. Keep both habits — they are now load-bearing rather than merely tidy. `for-verification.test.ts` deliberately shares a `beforeAll` fixture across its tests, which is the pattern this isolation model supports.

## Not goals (intentionally scoped out)

- **Deploy-to-Cloudflare button.** Production changes should flow through the reviewed pipeline, not a one-click deploy that bypasses the required-reviewer gate. (The old phrasing here cited an "IaC-only invariant"; that invariant went away with Terraform, but the reasoning stands on the gate alone.)
- **Replicating the reference broker's exact internal schema.** This broker aims for client-wire compatibility (`pact-broker-client` works against it), not internal SQL compatibility.
- **Horizontal scaling of the Durable Object.** Single-instance-per-broker is intentional; the workload is CI-volume, not user traffic, and DO-local SQLite is plenty.
