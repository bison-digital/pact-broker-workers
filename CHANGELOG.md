# Changelog

All notable changes to `pact-broker-workers`.

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
