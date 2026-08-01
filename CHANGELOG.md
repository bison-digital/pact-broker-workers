# Changelog

All notable changes to `pact-broker-workers`.

## 2.0.0 — 2026-08-01

Removes the AWS dependency that had crept into the deployment path, and
brings the whole toolchain current. **Breaking for fork operators** — the
state backend, the secret model, and the required GitHub secrets all change.
See [Migration](#migration-from-13x) below.

### Removed

- **AWS, entirely.** `infra/secrets.tf` (the `aws_secretsmanager_secret_version`
  data source), the `hashicorp/aws` provider, the `aws_region` /
  `terraform_state_bucket` / `secrets_prefix` variables, and the
  `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` repo secrets used as AWS
  credentials.

  The root of it was `terraform_data.worker_secret`, which read the bearer
  token on every apply and piped it to `wrangler secret put`. Terraform is
  convergent, so asserting "the Worker's secret matches the source of truth"
  required reading the value during apply — which made CI a secret-reading
  principal and required long-lived IAM keys. It also achieved nothing:
  Cloudflare Worker secrets are durable and survive every deploy, so the
  loop re-pushed an unchanged value each time.

- **`SMOKE_TEST_BROKER_TOKEN`.** The post-deploy smoke test no longer needs a
  token. Operators should delete this environment secret — it was a standing
  copy of a live credential.

- **`drizzle-kit`** (no config, no migrations directory, no script referenced
  it) and the unused `@/*` tsconfig path alias.

### Added

- **`secrets.required` in `wrangler.jsonc.tmpl`.** Declares
  `PACT_BROKER_TOKEN` by name without carrying its value, so
  `wrangler deploy` fails if a Worker was never seeded rather than shipping a
  broker that rejects every request. This replaces the guarantee
  `worker_secret` used to provide.
- **`/health` now probes the Durable Object**, returning
  `{"status":"ok","storage":"ok"}` or a 503. It previously returned a static
  literal, which proved only that the Worker booted. Since CI holds no token,
  this is the deploy pipeline's only signal, so it has to mean something.
- **`.oxfmtrc.json`.** Formatting was running on implicit defaults, leaving
  every oxfmt release free to restyle the repo. Pins current style exactly.
- **Type-aware linting** (`oxlint --type-aware`, unlocked by TypeScript 7).
  Found a floating `blockConcurrencyWhile()` promise in the DO constructor.
- **`pnpm-workspace.yaml`** for `onlyBuiltDependencies` — pnpm 10 blocks
  lifecycle scripts by default, and workerd/esbuild need theirs.
- **Dependabot `major` group**, so coupled majors arrive as one reviewable PR.

### Changed

- **Terraform state moves to Cloudflare R2.** The backend type stays `s3`,
  which is the S3 *protocol* — Terraform has no native R2 backend, and the
  protocol keeps the config portable to MinIO, B2, or Amazon S3. Credentials
  now come from `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`, mapped onto the
  `AWS_*` env names the protocol reads.
- **Bearer token seeding is out-of-band**:
  `openssl rand -hex 32 | wrangler secret put PACT_BROKER_TOKEN --name <worker>`.
  Rotation is the same command; it takes effect immediately with no deploy.
- **Smoke test is tokenless**: `/health` must report `storage: "ok"`, and an
  unauthenticated `/pacticipants` must return 401. The 401 assertion is new
  coverage — nothing previously caught a broker accidentally serving data
  without auth.
- **Cloudflare Terraform provider** `= 5.19.0-beta.5` → `~> 5.22`.
- **Node floor** `>=18.0.0` → `>=22.12.0`. The old floor was already violated
  by the installed oxlint/oxfmt.
- **Dependencies**: typescript 5.9 → 7.0.2 (dropping
  `@typescript/native-preview`; `tsgo` → `tsc`), wrangler 3 → 4,
  vitest 2 → 4 with `@cloudflare/vitest-pool-workers` 0.8 → 0.20,
  zod 3 → 4, drizzle-orm 0.38 → 0.45.2, hono 4.10 → 4.12.33,
  `@cloudflare/workers-types` 4 → 5, oxlint 1.61 → 1.76, oxfmt 0.42 → 0.61.

  drizzle 0.45.2 carries a SQL-injection fix (CWE-89) in
  `sql.identifier()`/`sql.as()`, neither of which this repo uses; hono
  4.12.33 carries four advisories, none exploitable here.

### Fixed

- **Floating promise in `PactBrokerDO`'s constructor.**
  `ctx.blockConcurrencyWhile()` was unmarked. Harmless in practice but
  invisible to every check in the toolchain — and the DO fires webhooks with
  retry loops, which is where a dropped promise disappears silently.
- **Three dead type assertions.** Two `as WebhookEvent[]` casts became
  redundant once zod 4 inferred `z.enum([...]).array()` precisely.

### Migration from 1.3.x

1. Create an R2 bucket for Terraform state and an R2 API token scoped to it.
   Add `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` as repo secrets and delete
   the AWS ones.
2. Rewrite `infra/backend.hcl` from
   [`infra/backend.hcl.example`](infra/backend.hcl.example) and migrate state
   (`terraform init -migrate-state -backend-config=backend.hcl`).
3. Seed the bearer token on each Worker with `wrangler secret put`. Use the
   *existing* value from Secrets Manager to avoid a client-visible rotation.
4. Delete the `SMOKE_TEST_BROKER_TOKEN` and `SECRETS_PREFIX` / `AWS_REGION`
   entries from your GitHub Environments.
5. Decommission the Secrets Manager entries and the S3 state bucket once a
   deploy has gone green.

## 1.3.0 — 2026-05-06

Documentation parity with the broader Cupa platform handover repos, plus
the long-pending HAL spec-version fix that originated downstream in
`cupa-pact-broker`.

### Added

- **`docs/` operator handbook.** Six new files: `ARCHITECTURE.md`,
  `CICD.md`, `MONITORING.md`, `INCIDENT-RESPONSE.md`, `UPGRADING.md`,
  `PUBLISH-ORDER.md`. Matches the operator-handbook style used by
  `mongodb-http-proxy` and `cupa-product-middleware`. Each file is
  scoped: architecture for design context, CICD for deploy mechanics,
  monitoring for signals, incident-response for triage, upgrading for
  the manual sync-from-upstream playbook, publish-order for the
  consumer-first contract publishing flow.
- **`README.md` documentation index.** New top-level table linking
  out to each doc with audience + use-case columns. The stale
  "Not (yet) implemented" line has been removed (webhooks, HAL UI,
  and the matrix badge all shipped in 1.2.0).

### Changed

- **HAL index `version` field**: `0.1.0` → `2.107.0`. The reference
  Ruby Pact Broker uses this field as the protocol-feature marker that
  `pact-broker-client` inspects when negotiating HAL features —
  publishing with `--branch` or `--build-url` requires the broker to
  report ≥ 2.86.0. Below that, the CLI prints a misleading "this
  version of the Pact Broker does not support versions with branches
  or build URLs" warning even though this implementation supports
  both. The bumped value brings the CLI's compatibility check in line
  with what the broker actually ships. The index `version` is the
  spec-version we satisfy, not this worker's own semver — `package.json`
  remains the authoritative semver source.
- **`CONTRIBUTING.md`**: new "Releases" section formalising the
  semver / tag / GH Release process for maintainers.
- **`README.md` "Staying in sync with upstream"**: now points at
  `docs/UPGRADING.md` for the full playbook with worked examples and
  conflict-resolution guidance.

### Not included (intentional follow-ups)

- Automated upstream-sync GitHub Action — manual playbook is the
  chosen UX. Operators preferred a reliable manual flow over a
  fragile automation; revisit if release cadence picks up.
- Periodic Durable Object snapshot/export to R2 — `BACKLOG.md` tracks
  the feature. Until then, `docs/INCIDENT-RESPONSE.md` documents the
  recover-from-consumer-side approach for state-loss scenarios.

## 1.2.0 — 2026-04-23

Production-readiness hardening. Closes the three long-standing
feature-parity gaps with the Ruby reference broker, plus a round of
input-validation and abuse-bounding improvements.

### Added

- **Webhooks.** `POST /webhooks` registers an HTTPS target keyed on
  `contract_published` and / or `provider_verification_published`.
  Delivery is best-effort via `executionCtx.waitUntil` so a slow target
  never blocks the publish response. Three retries with exponential
  back-off (200 ms / 800 ms / 3200 ms). Every attempt is recorded;
  query the delivery log via `GET /webhooks/{id}/executions`.
- **HAL Browser UI.** Static page at `GET /ui` for hands-on API
  exploration. The UI prompts for a bearer token in the browser; the
  token never leaves the tab.
- **Matrix badge.** `GET /pacts/provider/{p}/consumer/{c}/badge`
  returns an SVG verification badge embeddable in READMEs. Public by
  default (`PUBLIC_BADGES=true`); set the env var to `"false"` to
  require a bearer token.
- **Edge rate limiting.** Two Cloudflare rate-limit rulesets are
  provisioned by Terraform on the broker hostname: mutating requests
  (`PUT`/`POST`/`DELETE`) capped per IP per minute, reads capped
  separately. Gated by `enable_rate_limiting` (default `true`); see
  the README config table.
- **Per-route input validation.** Tags, deployed-versions, environments,
  and the matrix / can-i-deploy query params now run through Zod
  schemas. New tests under `test/auth.bad-token.test.ts`,
  `test/auth.public-read.test.ts`, `test/middleware.test.ts`,
  `test/badge.test.ts`, `test/ui.test.ts`, `test/webhooks.test.ts`
  cover the additions.

### Changed

- **Body-limit caps.** 1 MB body limit on `PUT /pacts/...`. Per-pact
  interaction count capped at 1000 to bound abuse under a leaked token.
- **Auth flow.** Bad-token and public-read paths got dedicated test
  coverage; the middleware itself didn't change but the contracts are
  now nailed down.

## 1.1.0 — 2026-04-21

### Added

- **Vitest Tier 1 suite** under `test/` — 82 tests + 2 tracked-as-skipped.
  Covers: auth middleware (401 paths, scheme/whitespace/case), input
  validation (Zod schemas + HTTP path-param integration), core pact flow
  (publish / retrieve by version / latest / contentSha / tag, HAL shape),
  `for-verification` consumer selectors (latest / tag / branch /
  deployed), `/matrix` + `/can-i-deploy`, `HalBuilder`.
- **`test/helpers.ts`** — `SELF.fetch()` wrapper and publish/tag/verify/
  deploy helpers for integration tests.
- **`pretest:run`** npm hook renders `wrangler.jsonc` so CI works from a
  fresh checkout without a Terraform apply.
- **`.oxlintrc.json`** categories config (correctness=error,
  suspicious=warn, style/nursery/pedantic=off).

### Changed

- **Formatter**: prettier replaced with `oxfmt`.
- **Type checker**: `tsc` replaced with `tsgo` via
  `@typescript/native-preview`. `tsconfig.json` drops the deprecated
  `baseUrl` and uses relative `paths`.
- **Linter**: `oxlint` bumped `0.15` → `1.61`. Now runs with
  `--deny-warnings`.
- **CI**: workflows call `type-check` consistently; `--passWithNoTests`
  removed from `test:run` (failing tests block merges).
- `vitest.config.ts` sets `miniflare.bindings` so tests run without a
  seeded AWS Secrets Manager.

## 1.0.0 — 2026-04-21

First tagged release. Brings the broker to a production-grade, turnkey
deployable state.

### Added

- **Terraform `infra/`.** Manages the Cloudflare Worker custom-domain
  binding and the `PACT_BROKER_TOKEN` secret, sourced from AWS Secrets
  Manager. Uses `wrangler` as a subprocess for the code upload and secret
  push; Terraform owns the lifecycle. S3 partial-backend with native
  locking.
- **GitHub Actions workflows.**
  - `ci.yml` — lint, format check, type check, vitest, Terraform plan
    against the `staging` environment. Comments the plan on PRs.
  - `deploy-staging.yml` — push to `main` auto-applies to the `staging`
    workspace, then runs `/health` + authenticated `/pacticipants` smoke
    tests.
  - `deploy-production.yml` — manual dispatch. Plan → required-reviewer
    gate (via `production` GH Environment) → apply → smoke tests.
- **`wrangler.jsonc.tmpl`.** Source of truth for the Worker config;
  rendered per workspace by Terraform in production and by
  `scripts/render-wrangler-dev.mjs` for local dev. Includes a no-routes
  guard — custom-domain routing is Terraform-only.
- **CI route-block guard.** `ci.yml` fails the build if a `routes` block
  is re-added to `wrangler.jsonc.tmpl`, locking the Terraform-owns-domain
  invariant.
- **Governance docs.** `CONTRIBUTING.md`, `CODEOWNERS`, `.envrc.example`,
  and a rewritten `README.md` with a "Forking for your organisation"
  section that describes the upstream-tracking workflow.
- **`infra/README.md`.** Turnkey walkthrough: prerequisites, required
  GH Actions vars/secrets tables, local `.envrc` example, seeding the
  bearer token in AWS Secrets Manager, plan/apply commands, rollback,
  and backup considerations for the Durable Object.
- **Node 22 + pnpm** for CI. `predev` / `predeploy` npm hooks
  auto-render `wrangler.jsonc` before local dev/deploy.

### Changed

- `wrangler.jsonc` is now a build artifact (gitignored). The template
  is the source of truth. Existing callers who ran `wrangler deploy`
  directly against a hand-edited `wrangler.jsonc` should migrate to the
  Terraform-driven flow (`pnpm run terraform:apply`) or run
  `node scripts/render-wrangler-dev.mjs` before deploying.
- `package.json` `version` bumped to `1.0.0`.

### Not included (intentional follow-ups)

- Webhooks.
- HAL Browser UI.
- Matrix badge endpoint.
- Vitest integration suite exercising the Pact API — the test
  infrastructure is wired but the suite itself is empty.
- Durable Object snapshot/export mechanism — call it out in your
  operational runbook; see `infra/README.md` → Backup considerations.
