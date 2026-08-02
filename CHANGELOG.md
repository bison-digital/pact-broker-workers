# Changelog

All notable changes to `pact-broker-workers`.

## 3.0.0 — 2026-08-02

Acts on a report from the **agent-books** team, who moved the AgentBooks ↔
Company-Manager contract onto a live instance and found two defects. Checking
them against the reference implementation turned up a third that neither we nor
they had noticed: our matrix rows could not be rendered by `pact-broker
can-i-deploy` at all.

**Breaking on the wire** for anything reading `/matrix` or `/can-i-deploy`.
Publishing, verification and `for-verification` are untouched.

### Fixed

- **`can-i-deploy` reported an unverified pact while hiding a failed one.**
  `canIDeploy` partitioned the matrix into unverified and failed, then returned
  on unverified first. A consumer version with one of each printed
  `1 pact(s) have not been verified` while a red verification sat in the same
  matrix — so CI read "hasn't been verified" about a run that had happened and
  gone red. Those are different facts with different owners.

  `summary.reason` now carries every applicable reason, joined with newlines,
  as `matrix_decorator.rb` does. The `/matrix` route had a second, separate
  inline summary with the same defect; both now share one summariser.

- **Provider versions could not carry a branch.** `GET /pacticipants/{name}`
  advertised only `self` and `pb:versions`. With `providerVersionBranch` set,
  pact-reference navigates `pb:provider` to that resource, looks for
  `pb:branch-version`, and — not finding it — abandons the verification results
  publish entirely, while `verifyProvider()` still resolves normally. The link
  is now emitted and `PUT /pacticipants/{name}/branches/{branch}/versions/{version}`
  serves it.

  The link alone would not have been enough: `getOrCreateVersion` returned
  early on an existing row without recording the branch, so a provider version
  created by an earlier verification publish stayed `branch: null` forever. It
  now backfills, and the branch-version resource overwrites.

- **A `can-i-deploy` target that matched nothing looked like an unverified
  pact.** `getMatrix` resolved `to` through tags only, so a branch-scoped query
  found no provider version, every row came back `verificationResult: null`, and
  a *failed* verification was reported as *absent* — the two findings above
  compounding into one wrong answer.

  `to` now resolves against environments (via currently deployed versions),
  then tags, then branches, and an unresolved target is reported as itself:
  `the latest version of X with tag T (no such version exists)`. When a target
  does resolve, its provider version is reported even if that version has not
  verified the pact.

- **`to` rejected valid names.** It was validated with `environmentNameSchema`,
  which forbids `.` and `/`, so `to=release/1.2` and `to=1.0.0-rc` returned 400
  before resolution was attempted. It now uses `branchSchema`.

### Changed

- **BREAKING — matrix row shape.** `pact_broker-client`'s `TextFormatter`
  navigates `row[:consumer][:version][:number]`. We emitted `version` as a bare
  string, so `pact-broker can-i-deploy` died before printing anything:

  ```
  Error retrieving matrix. TypeError - String does not have #dig method
    pact_broker-client-1.77.0/lib/pact_broker/client/matrix/text_formatter.rb:95
    in 'PactBroker::Client::Matrix::TextFormatter.sortable_attributes'
  ```

  Reproduced against this broker at 2.0.0 with `pactfoundation/pact-cli`, and
  confirmed fixed at 3.0.0 — the CLI now renders its table, the verification
  results section, and both reasons. The README's claim that
  `pact-broker-client` works against this broker was false for that command.

  Rows now follow `matrix_decorator.rb`: `consumer`/`provider` `version` is an
  object (`number`, `branch`, `tags`, `_links`), `pactVersion: {sha}` becomes
  `pact: {createdAt, _links}`, and `verificationResult` carries a link to the
  stored result. The provider version is populated from the verification that
  produced it, rather than being hardcoded `null`.

- **BREAKING — `summary.deployable` is tri-state.** `true` / `false` / `null`,
  per `deployment_status_summary.rb#deployable?`. `null` means something is
  unknown; `false` now means known-bad only. Anything gating on
  `deployable === true` is unaffected; anything gating on `=== false` should
  move to `!== true`.

- **`summary` gained `success` / `failed` / `unknown` counts** and the response
  gained a top-level `notices: [{type, text}]`. The reference client reads both
  (`matrix/resource.rb`) and silently lost the "unknown" warning without them.

- **`/matrix` accepts `environment=`**, which is what `pact_broker-client` sends
  for `--to-environment`.

### Added — `pact-broker-client` command support

Found by running the real CLI while checking the compatibility claim above.
Each failed *quietly enough to look like success* from the broker's side.

- **`POST /contracts/publish`**, advertised as `pb:publish-contracts`. Without
  it `pact-broker publish` falls back to a legacy path that cannot record
  branches at all — it prints "This version of the Pact Broker does not support
  versions with branches or build URLs", publishes the pact anyway, and the
  version lands with `branch: null` while the command exits 0. Accepts the
  documented body (base64 contract content, `branch`, `buildUrl`, `tags`) and
  returns `notices` for the CLI to render.
- **`POST /environments`** so `create-environment` works, and `GET /environments`
  now carries a named `pb:environments` link collection — the CLI looks
  environments up by link name, and its absence crashed `record-deployment`
  with `NoMethodError - undefined method 'find' for nil`.
- **`record-deployment` support**: `pb:pacticipant-version` on the index, a
  per-environment `pb:record-deployment` link collection on the version
  resource, and the `POST` endpoint behind it. Previously it failed outright
  with `Could not find relation 'pb:pacticipant-version'`.
- **`PUT /pacticipants/{name}/versions/{version}`**, plus
  `pb:pacticipant-branch-version` and `pb:pacticipant-version-tag` on the index.
- An unresolved target is now described in the terms the caller used:
  `--to-environment` naming an empty environment reports "no version is
  currently recorded as deployed/released in this environment" rather than
  calling it a missing tag.

Verified end to end against `pactfoundation/pact-cli`: `publish --branch
--build-url --tag`, `create-environment`, `record-deployment`, and
`can-i-deploy --to-environment`.

### Notes

Deliberate remaining gaps are listed in `BACKLOG.md` under "Reference-broker
parity" rather than left implicit.

## 2.0.0 — 2026-08-01

Removes the AWS dependency that crept into the deployment path, removes the
Terraform deploy layer with it, and brings the toolchain current.

**Breaking for fork operators.** Deployment no longer uses Terraform; the
required GitHub configuration changes completely. See
[Migration](#migration-from-1x).

### Removed

- **AWS, entirely.** No AWS account, service, SDK, credential or
  environment-variable name remains. It had arrived as an S3 Terraform state
  backend, a Secrets Manager data source holding the bearer token, and static
  IAM keys as repo secrets.

  The root of it was `terraform_data.worker_secret`, which read the token on
  every apply in order to hash it. Terraform is convergent, so asserting "the
  Worker's secret matches the source of truth" meant the value had to pass
  through the apply — which made CI a secret-reading principal and required
  long-lived credentials. It also achieved nothing: Cloudflare Worker secrets
  are durable and survive every deploy, so the loop re-pushed an unchanged
  value each time.

  Moving state to R2 was considered and rejected. It removes the AWS *account*
  but not the AWS *strings* — `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` are
  hardcoded in the SDK credential chain Terraform's `s3` backend uses. Passing
  credentials as backend config instead is worse: Terraform writes them in
  plaintext into `.terraform/terraform.tfstate`.

- **Terraform from the deploy path.** `infra/` is now an optional module (below)
  rather than a root configuration every deploy had to run.

- **`INFRA_DEPLOY_ENABLED`.** The flag existed because one set of workflows was
  trying to be both the project's CI and an operator's CD. Those are separate
  now, so nothing needs gating.

- **`SMOKE_TEST_BROKER_TOKEN`.** The post-deploy smoke test no longer needs a
  token. Delete this environment secret — it was a standing copy of a live
  credential.

- **`.envrc.example`**, the `terraform:*` npm scripts, the
  `wrangler-routes-guard` CI job (it existed only to stop anyone re-adding a
  `routes` block while Terraform owned routing), `drizzle-kit` (no config, no
  migrations directory, nothing invoked it), and the unused `@/*` tsconfig
  path alias.

### Added

- **Custom domain in wrangler config** — `routes: [{ custom_domain: true }]`.
  Wrangler creates the DNS record and issues the certificate on deploy.
- **`secrets.required` in `wrangler.jsonc.tmpl`.** Declares `PACT_BROKER_TOKEN`
  by name without its value, so `wrangler deploy` fails if a Worker was never
  seeded rather than shipping a broker that rejects every request. This
  replaces the guarantee `worker_secret` used to provide.
- **`/health` now probes the Durable Object**, returning
  `{"status":"ok","storage":"ok"}` or a 503. It previously returned a static
  literal, which proved only that the Worker booted. Since CI holds no token,
  this is the deploy pipeline's only signal, so it has to mean something.
- **Tokenless smoke test.** `/health` must report `storage: "ok"` and an
  unauthenticated `/pacticipants` must return 401. The 401 assertion is new
  coverage — nothing previously caught a broker serving data without auth.
- **`ci.yml` gains a `config-renders` job** that renders with operator-shaped
  values and dry-runs a deploy. The suite always renders without a `DOMAIN`, so
  this is the only check on the operator path.
- **`.oxfmtrc.json`** — formatting ran on implicit defaults, leaving every oxfmt
  release free to restyle the repo. Pins current style exactly.
- **Type-aware linting** (`oxlint --type-aware`, unlocked by TypeScript 7).
- **`pnpm-workspace.yaml`** for `onlyBuiltDependencies` — pnpm 10 blocks
  lifecycle scripts and workerd/esbuild need theirs.
- **Dependabot `major` group**, so coupled majors arrive as one reviewable PR.

### Changed

- **`infra/` is an optional Cloudflare Access module.** It declares no
  `provider` and no `backend` block — you consume it from your own Terraform,
  with your own state and pipeline. An operator who doesn't want Access never
  installs Terraform at all.

  Access is no longer applied on every deploy. Application code changes weekly;
  a security perimeter changes maybe twice a year. Coupling them meant a
  routine merge could alter the security boundary — clear `ACCESS_POLICY_MODE`
  and the next unrelated deploy silently destroys the Access application — and
  it pinned `Access: Apps and Policies: Edit` onto the deploy credential.

  `variables.tf` drops from 16 variables to 6. One of the removed,
  `terraform_state_bucket`, was mandatory on every plan and referenced by zero
  HCL expressions.

- **CI and deployment are separate concerns.** `ci.yml` is the project's own
  gate: no credentials, no operator variables, runs on every PR and fork with
  zero setup. The `deploy-*.yml` workflows are a reference implementation
  needing only `CLOUDFLARE_API_TOKEN`; they skip when unconfigured and fail
  naming missing variables when half-configured.

- **The production approval gate is unchanged in substance.** It was always the
  GitHub Environment required-reviewer rule, never Terraform. Reviewers now
  read a `wrangler deploy --dry-run` binding list instead of a tfplan.

- **Bearer token seeding is out of band**:
  `openssl rand -hex 32 | wrangler secret put PACT_BROKER_TOKEN --name <worker>`.
  Rotation is the same command; effective immediately, no deploy.

- **`render-wrangler-dev.mjs` → `render-wrangler-config.mjs`**, now the single
  path to `wrangler.jsonc` for dev, test and deploy, so local config cannot
  drift from deployed config. It validates its own output and rejects
  non-integer rate limits.

- **Node floor** `>=18.0.0` → `>=22.12.0`. The old floor was already violated by
  the installed oxlint/oxfmt.

- **Dependencies**: typescript 5.9 → 7.0.2 (dropping
  `@typescript/native-preview`; `tsgo` → `tsc`), wrangler 3 → 4, vitest 2 → 4
  with `@cloudflare/vitest-pool-workers` 0.8 → 0.20, zod 3 → 4,
  `@cloudflare/workers-types` 4 → 5, `@types/node` 22 → 26, oxlint 1.61 → 1.76,
  oxfmt 0.42 → 0.61, hono → 4.12.33, plus `vite` ^7 as an explicit devDependency
  (vitest 4 needs ≥6; pnpm otherwise pins the vitest-2-era 5.4.21).

### Fixed

- **Rate limiting was never actually deployed.** wrangler 3 does not understand
  the `ratelimits` config key and silently dropped it, so the bindings added in
  1.x never reached the Worker; the middleware found them undefined and passed
  every request through. The wrangler 4 upgrade fixes this — both limiters now
  appear in the deploy binding list. The vitest pool bundles its own wrangler 4,
  which is why the unit test passed and nothing surfaced it.

- **Floating promise in `PactBrokerDO`'s constructor.**
  `ctx.blockConcurrencyWhile()` was unmarked — harmless in practice but
  invisible to every check in the toolchain, and the DO fires webhooks with
  retry loops, which is where a dropped promise disappears silently. Found by
  type-aware lint.

- **Three dead type assertions.** Two `as WebhookEvent[]` casts became redundant
  once zod 4 inferred `z.enum([...]).array()` precisely.

- **Worker bundle.** Named zod imports rather than `import { z }`, which makes
  `z.locales` reachable and defeats tree-shaking — worth ~279 KiB of locale
  files for languages this broker never uses.

- **`package.json` version.** It said `1.0.0` while tags ran to `v1.3.0`; the
  manifest and the tag now agree.

### Migration from 1.x

Deployment configuration changes completely. Roughly 20 minutes.

1. **Add `CLOUDFLARE_API_TOKEN`** as a repo secret if it isn't one already. It
   needs Workers Scripts: Edit, Workers Routes: Edit, and DNS: Edit.
2. **Set the per-environment vars** on `staging` and `production`:
   `CLOUDFLARE_ACCOUNT_ID`, `DOMAIN`, `WORKER_NAME`. Optionally
   `ALLOW_PUBLIC_READ`, `CORS_ALLOWED_ORIGINS`, `PUBLIC_BADGES`,
   `MUTATING_RATE_LIMIT_THRESHOLD`, `READ_RATE_LIMIT_THRESHOLD`.
3. **Seed the bearer token** on each Worker, using the *existing* value from
   Secrets Manager so the cutover is invisible to clients:
   ```bash
   wrangler secret put PACT_BROKER_TOKEN --name <worker-name>
   ```
4. **Confirm the required-reviewer rule** on the `production` GitHub
   Environment. It was always the real gate; now it is the only one.
5. **If you use Cloudflare Access**, move it into your own Terraform. Consume
   `infra/` as a module (see `infra/README.md`) and import the existing
   resources so the perimeter is not recreated:
   ```bash
   terraform import 'module.pact_broker_access.cloudflare_zero_trust_access_policy.broker[0]' <account_id>/<policy_id>
   terraform import 'module.pact_broker_access.cloudflare_zero_trust_access_application.broker[0]' <account_id>/<app_id>
   ```
6. **Delete** the old repo secrets and environment vars: `AWS_ACCESS_KEY_ID`,
   `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `TERRAFORM_STATE_BUCKET`,
   `SECRETS_PREFIX`, `SMOKE_TEST_BROKER_TOKEN`, `INFRA_DEPLOY_ENABLED`,
   `TF_WORKSPACE`, `ACCESS_POLICY_MODE`, `ACCESS_SERVICE_TOKEN_ID`.
7. **Deploy staging and verify**, then production.
8. **Decommission** the Secrets Manager entries and the S3 state bucket once a
   production deploy has gone green.

The custom domain transfers without downtime — `cloudflare_workers_custom_domain`
and wrangler's `custom_domain: true` create the same underlying binding, so
wrangler adopts the existing one rather than recreating it.

**Durable Object data is untouched.** The DO namespace is keyed on the Worker
name, which does not change.

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
