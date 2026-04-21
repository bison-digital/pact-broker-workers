# pact-broker-workers — infra (Terraform)

> **Do not run `terraform apply` against `production` from a workstation.** The `deploy-production.yml` GitHub Actions workflow has the environment protection rule and is the single auditable path for production changes. Local apply against the `production` workspace will succeed but bypasses the approval gate.

Terraform project that manages the Cloudflare Worker stack: Worker custom domain, the bearer-token secret (sourced from AWS Secrets Manager), and the Worker code deploy. Uses `wrangler` as a subprocess for secret injection and the actual code upload — Terraform owns lifecycle and triggers, wrangler owns the upload.

## Turnkey model

**No operator-specific strings are committed to this repo.** Everything that varies between operators (AWS account, Cloudflare zone, domain, worker name, state bucket, secrets prefix) lives in GitHub Actions variables/secrets (for CI) and in a local `.envrc` (for workstation apply). To take ownership of this stack:

1. Fork this repo to your GitHub organisation (or adopt it as a downstream) — see [README — Forking for your organisation](../README.md#forking-for-your-organisation).
2. Create your S3 state bucket + AWS credentials + Cloudflare API token.
3. Configure GitHub Actions repo + environment variables/secrets per the [Required inputs](#required-inputs) tables below.
4. Seed AWS Secrets Manager with `<secrets_prefix>/<workspace>/pact-broker-token`.
5. Push to `main` → staging deploys automatically; manual-dispatch `deploy-production.yml` for prod.

No HCL edits. No tfvars edits.

## Workspaces

Workspace names are operator-chosen. Each workspace maps to one Cloudflare Worker + one custom-domain binding + one Durable Object namespace. Typical layout is a `staging` workspace and a `production` workspace. Each workspace needs a matching GitHub Environment (Settings → Environments) holding that workspace's variables.

### Durable Object note

The Pact Broker stores all state in a single SQLite-backed Durable Object (`PactBrokerDO`). When you split environments by Worker *name* (as this project does — never by `wrangler --env`), each Worker gets its own independent DO namespace with its own SQLite database and migration history. Data does not cross environments.

## Prerequisites

- Terraform 1.14.8+ (`brew install hashicorp/tap/terraform`)
- Node.js 22+ and pnpm (for `wrangler`, invoked by Terraform)
- AWS credentials for the account holding the Terraform state bucket and Secrets Manager entries
- Cloudflare API token with Workers Scripts + Workers Routes + DNS edit rights on the zone that owns your chosen domain

The Worker's bearer token (`PACT_BROKER_TOKEN`) is **not** a Terraform input — it lives in AWS Secrets Manager and is read at apply time. See [`secrets.tf`](secrets.tf) for the path convention and seeding command.

## Required inputs

All inputs come from environment variables. CI sets them via GitHub Actions vars/secrets; workstations via a gitignored `.envrc`.

### Repo-level GH Actions vars

| Var | TF var | Example |
| --- | --- | --- |
| `AWS_REGION` | `aws_region` | `eu-west-1` |
| `TERRAFORM_STATE_BUCKET` | `terraform_state_bucket` | `your-org-terraform-state` |
| `CLOUDFLARE_ACCOUNT_ID` | `cloudflare_account_id` | 32-char hex |

### Repo-level GH Actions secrets

| Secret | Purpose |
| --- | --- |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Terraform backend (S3 state) + Secrets Manager reads |
| `CLOUDFLARE_API_TOKEN` | Cloudflare provider auth (Workers + DNS edit) |
| `CLOUDFLARE_ZONE_ID` | Zone ID for the custom-domain resource |

### Per-environment GH Actions vars (create one environment per workspace)

| Var | TF var | Example |
| --- | --- | --- |
| `DOMAIN` | `domain` | `pact-broker-staging.your-domain.com` |
| `WORKER_NAME` | `worker_name` | `pact-broker-staging` |
| `SECRETS_PREFIX` | `secrets_prefix` | `pact-broker` (or operator-specific like `cupa-pact-broker`) |

### Per-environment GH Actions secrets

| Secret | Purpose |
| --- | --- |
| `SMOKE_TEST_BROKER_TOKEN` | Optional: authenticated smoke test on deploys. Matches the value seeded into `<secrets_prefix>/<workspace>/pact-broker-token`. |

### Local `.envrc` (gitignored; loaded via [direnv](https://direnv.net/))

Matches the GH Actions values above. Every `vars.X` becomes `export TF_VAR_<snake>=…`. Example for a staging workspace:

```bash
# Cloudflare credentials
export TF_VAR_cloudflare_api_token="…"
export TF_VAR_cloudflare_zone_id="…"
export TF_VAR_cloudflare_account_id="…"

# AWS + state
export TF_VAR_aws_region="eu-west-1"
export TF_VAR_terraform_state_bucket="your-org-terraform-state"

# Per-workspace
export TF_VAR_domain="pact-broker-staging.your-domain.com"
export TF_VAR_worker_name="pact-broker-staging"
export TF_VAR_secrets_prefix="pact-broker"
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

One-time, per workspace, before the first `terraform apply`:

```bash
aws secretsmanager create-secret \
  --name "<secrets_prefix>/<workspace>/pact-broker-token" \
  --secret-string "$(openssl rand -hex 32)" \
  --recovery-window-in-days 0
```

To rotate later: `aws secretsmanager put-secret-value --secret-id "<secrets_prefix>/<workspace>/pact-broker-token" --secret-string "$(openssl rand -hex 32)"` then re-run `terraform apply` (which re-runs `wrangler secret put` because the value hash changed).

## How the wrangler handoff works

`wrangler.tf` declares a `local_file` that materialises `wrangler.jsonc` and two kinds of `terraform_data`:

1. **`local_file.wrangler_config`** — generates `wrangler.jsonc` from [`wrangler.jsonc.tmpl`](../wrangler.jsonc.tmpl) per workspace, interpolating the worker name, account ID, compatibility date, and `ALLOW_PUBLIC_READ` flag. The generated `wrangler.jsonc` is gitignored. Edit static settings (DO bindings, migrations, observability) in the `.tmpl` file.
2. **`worker_secret`** — runs `wrangler secret put PACT_BROKER_TOKEN` via `local-exec`, triggered when either the secret value or the wrangler command changes.
3. **`worker_deploy`** — runs `wrangler deploy` via `local-exec`, triggered when `src/` content or the materialised `wrangler.jsonc` changes. Depends on `local_file.wrangler_config` and all `worker_secret` resources so it always runs last.

Wrangler is always invoked with `--name ${var.worker_name}`, never `--env`. This avoids the `--name X --env Y` collision class that creates phantom workers.

## CI

Three workflows in `.github/workflows/`:

- `ci.yml` — PR check. `checks` runs lint/format/type-check/tests. `infra-plan` binds to the `staging` GH Environment, runs `terraform plan` with all `TF_VAR_*` injected from vars/secrets, comments the plan on the PR.
- `deploy-staging.yml` — push to `main`. Auto-applies to the `staging` workspace, then smoke-checks `/health` and (optionally) the authenticated data path.
- `deploy-production.yml` — manual dispatch only. Plan job → required-reviewer approval (via the `production` GH Environment gate) → apply job that replays the saved tfplan.

All three use `hashicorp/setup-terraform@v4` pinned to `1.14.8`.

## State backend

S3 bucket configured per-operator via `backend.hcl` (bucket name is your choice — see [`backend.hcl.example`](backend.hcl.example)). Native S3 locking via `use_lockfile = true` — no DynamoDB lock table. Enable versioning + server-side encryption on your bucket.

## Rollback

- **Plan-level**: `terraform plan -destroy` then `terraform apply` to destroy the current workspace. Production destroys are gated by the GitHub environment protection in CI. **Destroying a workspace deletes the Durable Object and all Pact data it holds** — there is no cross-environment fallback. Export first if the data matters (see "Backup considerations" below).
- **Revert-level**: `git revert` on the HCL changes and re-run `apply`. State history in the S3 bucket keeps you safe.

## Backup considerations

The broker stores pacts, verifications, tags, and deployment history in the `PactBrokerDO` Durable Object's SQLite storage. Durable Object storage is durable and replicated inside Cloudflare's edge, but there is no built-in export or point-in-time backup. For production deployments, consider:

- Periodic snapshot export via a scheduled Worker that queries the broker API and writes JSON to R2.
- Treating the broker as source-of-truth only for CI gating — rebuilding contracts from consumer/provider CI artifacts is always possible.

This project does not ship a snapshot/export mechanism today; call it out in your operational runbook.

## Caveats

- **Cloudflare provider pinned at `= 5.19.0-beta.5`** (see `versions.tf`). This picks up the `cloudflare_workers_custom_domain.environment` fix (attribute is now `Computed`, no longer triggers a forced-replacement diff). Pin moves to `~> 5.19` once Cloudflare cuts 5.19.0 stable.
- **`worker_secret` uses `local-exec` with sensitive env vars**. Standard Terraform pattern for handing secrets to external CLIs, but the value briefly exists in the subprocess environment. CloudTrail logs the corresponding `GetSecretValue` calls.
- **`wrangler.jsonc` is generated**, not committed. Don't hand-edit — your edits get overwritten on the next apply. Edit `wrangler.jsonc.tmpl` for static settings, or add a Terraform variable and template interpolation for dynamic ones.
