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

### Stale `compatibility_date`
`wrangler.jsonc.tmpl` pins `compatibility_date: "2024-12-01"`. Bump to a recent date (e.g. `"2026-04-01"`) and verify the broker still builds + tests pass. Nothing in the current code requires new Workers features, but keeping the pin recent avoids accruing implicit tech debt.

### Request body size limit (shipped)
`PUT /pacts/...` capped at 1 MB via `hono/body-limit`; pacts with more than 1000 interactions are rejected as 400. Global 10 MB cap retained for all other routes.

### Rate limiting via Cloudflare ruleset (shipped)
`infra/main.tf` now provisions a `cloudflare_ruleset` with two `http_ratelimit` rules (mutating vs read). Gated by `enable_rate_limiting` (default `true`) so operators on the free CF plan can disable it.

### Dependabot
No `.github/dependabot.yml`. Upstream product + MIT license + Cloudflare SDK churn means deps will rot silently. Add weekly updates for `npm`, `terraform`, and `github-actions`.

### GitHub Actions Node-20 deprecation
`actions/checkout@v4`, `actions/setup-node@v4`, `pnpm/action-setup@v4` all emit deprecation annotations (forced to Node 24 in June 2026). Bump to `@v5` where available. Touches all three workflow files.

### Secret scanning posture
Verify GitHub's native secret scanning is enabled on this public repo (Settings → Code security). If a downstream fork publishes pre-review, a stray `PACT_BROKER_TOKEN` in a commit would ship. Consider also a `gitleaks-action` run in CI as a second line.

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
- **Env-toggle auth cases** — `ALLOW_PUBLIC_READ=true` happy path and `PACT_BROKER_TOKEN` too-short → 500. Mutating `env` from the test scope doesn't propagate into the Worker's env. Needs a separate vitest project (or a second config file) with its own `miniflare.bindings`. Two tests skipped in `test/auth.test.ts` with TODOs.
- **Tags — deep behavior.** Add/remove tag idempotency, tag-on-nonexistent-version, tag name collisions.
- **Verifications — edge cases.** Multiple verifications per pact, latest-verification selection, success-after-failure.
- **Environments + deployments — in depth.** PUT/GET/DELETE env, deploy + undeploy, `isVersionDeployed`, cross-environment `deployed` selector.
- **Selector combinations in `for-verification`.** Multiple selectors on one request, pending-flag handling, notices content assertions.
- **Coverage reporting.** `--coverage` + GH job summary upload.

### Durable-object state isolation note
`@cloudflare/vitest-pool-workers` defaults to `isolatedStorage: true`, giving each test a fresh DO namespace. If a future test file needs to share state across tests (e.g. a large setup in `beforeAll`), scope state with unique pacticipant names (current pattern in `for-verification.test.ts`).

## Not goals (intentionally scoped out)

- **Deploy-to-Cloudflare button.** Conflicts with the IaC-only invariant — all prod changes flow through Terraform.
- **Replicating the reference broker's exact internal schema.** This broker aims for client-wire compatibility (`pact-broker-client` works against it), not internal SQL compatibility.
- **Horizontal scaling of the Durable Object.** Single-instance-per-broker is intentional; the workload is CI-volume, not user traffic, and DO-local SQLite is plenty.
