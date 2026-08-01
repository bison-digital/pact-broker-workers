# pact-broker-workers — infra (Terraform)

> **Do not run `terraform apply` against `production` from a workstation.** The `deploy-production.yml` GitHub Actions workflow has the environment protection rule and is the single auditable path for production changes. Local apply against the `production` workspace will succeed but bypasses the approval gate.

Terraform project that manages the Cloudflare Worker stack: the Worker custom domain, edge rate limiting, and the Worker code deploy. Uses `wrangler` as a subprocess for the code upload — Terraform owns lifecycle and triggers, wrangler owns the upload.

Terraform does **not** manage the bearer token. See [Seeding the bearer token](#seeding-the-bearer-token).

## Turnkey model

**No operator-specific strings are committed to this repo.** Everything that varies between operators (Cloudflare account and zone, domain, worker name, state bucket) lives in GitHub Actions variables/secrets (for CI) and in a local `.envrc` (for workstation apply). To take ownership of this stack:

1. Fork this repo to your GitHub organisation (or adopt it as a downstream) — see [README — Forking for your organisation](../README.md#forking-for-your-organisation).
2. Create your R2 state bucket + an R2 API token + a Cloudflare API token.
3. Configure GitHub Actions repo + environment variables/secrets per the [Required inputs](#required-inputs) tables below.
4. Seed the Worker's bearer token with `wrangler secret put` (see below).
5. Push to `main` → staging deploys automatically; manual-dispatch `deploy-production.yml` for prod.

No HCL edits. No tfvars edits.

## Workspaces

Workspace names are operator-chosen. Each workspace maps to one Cloudflare Worker + one custom-domain binding + one Durable Object namespace. Typical layout is a `staging` workspace and a `production` workspace. Each workspace needs a matching GitHub Environment (Settings → Environments) holding that workspace's variables.

### Durable Object note

The Pact Broker stores all state in a single SQLite-backed Durable Object (`PactBrokerDO`). When you split environments by Worker *name* (as this project does — never by `wrangler --env`), each Worker gets its own independent DO namespace with its own SQLite database and migration history. Data does not cross environments.

## Prerequisites

- Terraform 1.14.8+ (`brew install hashicorp/tap/terraform`)
- Node.js 22+ and pnpm (for `wrangler`, invoked by Terraform)
- An R2 API token with Object Read & Write on your Terraform state bucket
- Cloudflare API token with Workers Scripts + Workers Routes + DNS edit rights on the zone that owns your chosen domain

The Worker's bearer token (`PACT_BROKER_TOKEN`) is **not** a Terraform input, and Terraform never reads it. See [Seeding the bearer token](#seeding-the-bearer-token).

## Required inputs

All inputs come from environment variables. CI sets them via GitHub Actions vars/secrets; workstations via a gitignored `.envrc`.

### Repo-level GH Actions vars

| Var | TF var | Example |
| --- | --- | --- |
| `TERRAFORM_STATE_BUCKET` | — (backend config) | `your-org-terraform-state` |
| `CLOUDFLARE_ACCOUNT_ID` | `cloudflare_account_id` | 32-char hex |
| `INFRA_DEPLOY_ENABLED` | — | Set to `"true"` to enable the plan/deploy jobs in this fork. Upstream keeps it unset so CI skips Terraform plans and deploys, which need operator credentials the upstream doesn't hold. |

### Repo-level GH Actions secrets

| Secret | Purpose |
| --- | --- |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | R2 API token for the Terraform state bucket. The workflows map these onto the `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` env names because that is what the S3 protocol reads — it is a naming convention, not an AWS dependency. |
| `CLOUDFLARE_API_TOKEN` | Cloudflare provider auth (Workers + DNS edit) |
| `CLOUDFLARE_ZONE_ID` | Zone ID for the custom-domain resource |

### Per-environment GH Actions vars (create one environment per workspace)

| Var | TF var | Example |
| --- | --- | --- |
| `TF_WORKSPACE` | — (selects Terraform workspace) | `staging` or `dryrun` or `production` |
| `DOMAIN` | `domain` | `pact-broker-staging.your-domain.com` |
| `WORKER_NAME` | `worker_name` | `pact-broker-staging` |

### Per-environment GH Actions secrets

None. CI holds no broker credential of any kind — the post-deploy smoke test
is unauthenticated (see [CI](#ci)).

> If you are upgrading an existing fork, **delete the `SMOKE_TEST_BROKER_TOKEN`
> environment secret**. It was a standing copy of the live bearer token and now
> has no consumer.

### Local `.envrc` (gitignored; loaded via [direnv](https://direnv.net/))

Matches the GH Actions values above. Every `vars.X` becomes `export TF_VAR_<snake>=…`. Example for a staging workspace:

```bash
# Cloudflare credentials
export TF_VAR_cloudflare_api_token="…"
export TF_VAR_cloudflare_zone_id="…"
export TF_VAR_cloudflare_account_id="…"

# R2 credentials for the state backend (AWS_* names are the S3 protocol's
# convention — see backend.hcl.example)
export AWS_ACCESS_KEY_ID="…"
export AWS_SECRET_ACCESS_KEY="…"

# Per-workspace
export TF_VAR_domain="pact-broker-staging.your-domain.com"
export TF_VAR_worker_name="pact-broker-staging"
```

`.envrc` is gitignored — it holds your credentials and operator values only. See [`.envrc.example`](../.envrc.example).

## Plan + apply (workstation)

```bash
cd pact-broker-workers/infra
direnv allow                                      # loads .envrc on first use
terraform init -backend-config=backend.hcl
terraform workspace select -or-create staging
terraform plan
terraform apply
```

Production goes through CI (`deploy-production.yml`); see banner above.

## Seeding the bearer token

One-time, per Worker, before the first deploy. Run it from a workstation —
this value never passes through Terraform or CI:

```bash
openssl rand -hex 32 | wrangler secret put PACT_BROKER_TOKEN --name <worker_name>
```

To rotate, run exactly the same command again. It takes effect immediately;
no deploy is required. **Existing clients start receiving 401 the moment the
new value lands**, so publish the new token to consumer/provider CI first.

### Why this is not managed by Terraform

Terraform is convergent — to assert "the Worker's secret equals the source of
truth" it has to read the value on every apply. That makes the apply, and
therefore CI, a secret-reading principal, which is what previously required
long-lived AWS credentials as repo secrets.

It bought nothing. Cloudflare Worker secrets are durable: they survive every
deploy, and wrangler only removes one on an explicit `wrangler secret delete`.
There is no drift to correct. Seeding and rotation are operator events that
happen roughly twice in a deployment's life, not per-commit events.

What replaces the guarantee: `wrangler.jsonc.tmpl` declares the token under
`secrets.required`, so **`wrangler deploy` fails** if a Worker was never
seeded, rather than shipping a broker that rejects every request.

## How the wrangler handoff works

`wrangler.tf` declares a `local_file` that materialises `wrangler.jsonc` plus one `terraform_data`:

1. **`local_file.wrangler_config`** — generates `wrangler.jsonc` from [`wrangler.jsonc.tmpl`](../wrangler.jsonc.tmpl) per workspace, interpolating the worker name, account ID, compatibility date, and `ALLOW_PUBLIC_READ` flag. The generated `wrangler.jsonc` is gitignored. Edit static settings (DO bindings, migrations, observability) in the `.tmpl` file.
2. **`worker_deploy`** — runs `wrangler deploy` via `local-exec`, triggered when `src/` content or the materialised `wrangler.jsonc` changes. Depends on `local_file.wrangler_config` so it always runs last.

Wrangler is always invoked with `--name ${var.worker_name}`, never `--env`. This avoids the `--name X --env Y` collision class that creates phantom workers.

## CI

Three workflows in `.github/workflows/`:

- `ci.yml` — PR check. `checks` runs lint/format/type-check/tests. `infra-plan` binds to the `staging` GH Environment, runs `terraform plan` with all `TF_VAR_*` injected from vars/secrets, comments the plan on the PR.
- `deploy-staging.yml` — push to `main`. Auto-applies to the `staging` workspace, then runs the tokenless smoke test: `/health` must report `storage: "ok"` (which only happens after the Durable Object round-trip resolves) and `/pacticipants` must return 401.
- `deploy-production.yml` — manual dispatch only. Plan job → required-reviewer approval (via the `production` GH Environment gate) → apply job that replays the saved tfplan.

All three use `hashicorp/setup-terraform@v4` pinned to `1.14.8`.

## State backend

A **Cloudflare R2 bucket**, configured per-operator via `backend.hcl` — see [`backend.hcl.example`](backend.hcl.example) for the full block including the endpoint and the `skip_*` flags an S3-compatible endpoint needs.

The backend type in `versions.tf` is `s3`, meaning the S3 *protocol*. Terraform has no native R2 backend, and the S3 protocol is the portable choice: the same block works against R2, MinIO, Backblaze B2, or Amazon S3 if that is what you already run. Nothing here requires an AWS account.

Locking uses `use_lockfile = true`, a lock object guarded by a conditional write. R2 supports conditional writes on `PutObject`, but **verify this against your own bucket** before relying on it — if `init` or the first `apply` errors on the lock, set it to `false` and serialise applies through the GitHub Environment gate instead.

Enable versioning on your bucket. R2 encrypts at rest by default.

## Rollback

- **Plan-level**: `terraform plan -destroy` then `terraform apply` to destroy the current workspace. Production destroys are gated by the GitHub environment protection in CI. **Destroying a workspace deletes the Durable Object and all Pact data it holds** — there is no cross-environment fallback. Export first if the data matters (see "Backup considerations" below).
- **Revert-level**: `git revert` on the HCL changes and re-run `apply`. State history in the R2 bucket keeps you safe, provided you enabled versioning.

## Backup considerations

The broker stores pacts, verifications, tags, and deployment history in the `PactBrokerDO` Durable Object's SQLite storage. Durable Object storage is durable and replicated inside Cloudflare's edge, but there is no built-in export or point-in-time backup. For production deployments, consider:

- Periodic snapshot export via a scheduled Worker that queries the broker API and writes JSON to R2.
- Treating the broker as source-of-truth only for CI gating — rebuilding contracts from consumer/provider CI artifacts is always possible.

This project does not ship a snapshot/export mechanism today; call it out in your operational runbook.

## Edge rate limiting

`main.tf` provisions a `cloudflare_ruleset` in the `http_ratelimit` phase with two rules (mutating / read), both scoped to the broker hostname and keyed by `ip.src`.

- **Thresholds** — `mutating_rate_limit_threshold` (default 60/min) and `read_rate_limit_threshold` (default 600/min). Tune per deployment by overriding the vars.
- **Kill switch** — `enable_rate_limiting = false` skips provisioning the ruleset. Use this on the Cloudflare free plan, which doesn't expose `rate_limit` actions in the standard `http_ratelimit` phase. The in-Worker body size (1 MB on `PUT /pacts`) and schema validation remain regardless.

## Runtime environment variables

Beyond `PACT_BROKER_TOKEN` (secret) and `ALLOW_PUBLIC_READ` (existing), two new knobs are wired through `wrangler.jsonc.tmpl`:

- **`cors_allowed_origins`** — comma-separated origins that may talk to the broker from a browser. Empty/unset keeps the legacy permissive (`*`) behaviour. Once you host the HAL UI on a known domain, lock this down to that domain.
- **`public_badges`** — `"false"` forces bearer-token auth on `/pacts/.../badge`; any other value keeps badges public (the expected README-embed case).

## Caveats

- **Cloudflare provider tracks `~> 5.22`** (see `versions.tf`). It was previously pinned exactly to `5.19.0-beta.5` to pick up the `cloudflare_workers_custom_domain.environment` fix; 5.19.0 stable shipped and that workaround is retired.
- **State locking on R2 is unverified upstream.** `use_lockfile` needs conditional writes, which R2 supports on `PutObject`, but confirm it against your own bucket. See [State backend](#state-backend).
- **`wrangler.jsonc` is generated**, not committed. Don't hand-edit — your edits get overwritten on the next apply. Edit `wrangler.jsonc.tmpl` for static settings, or add a Terraform variable and template interpolation for dynamic ones.
