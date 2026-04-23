# pact-broker-workers

A lightweight, production-grade Pact Broker for Cloudflare Workers. SQLite-backed Durable Object for state; Hono + Drizzle for the API. HAL-compatible with `pact-broker-client` and the Pact standard toolchain.

## Overview

```
Cloudflare Worker (Hono + auth + CORS)
  └── PactBrokerDO (Durable Object, SQLite)
        ├── pacticipants / versions / tags
        ├── pacts + verifications
        ├── environments + deployed_versions
        └── matrix / can-i-deploy / for-verification logic
```

### Features

- HAL-style API responses compatible with `pact-broker-client`
- Bearer-token auth (optional public-read mode)
- Pact publish + retrieve (latest / tag / branch / version selectors)
- Verification results and `pacts-for-verification`
- Matrix, `can-i-deploy`, deployments/environments tracking
- Zero external data store — all state in DO-local SQLite
- Turnkey production deployment via Terraform + GitHub Actions

### Not (yet) implemented

Webhooks, HAL Browser UI, matrix badge endpoint. See [`CHANGELOG.md`](CHANGELOG.md).

## Quick start (local development)

```bash
git clone https://github.com/bison-digital/pact-broker-workers.git
cd pact-broker-workers
pnpm install
cp .dev.vars.example .dev.vars     # set PACT_BROKER_TOKEN
pnpm run dev                       # auto-renders wrangler.jsonc + runs wrangler dev
```

Dev server listens on `http://localhost:9090`.

## Production deployment

Production deployment is driven by **Terraform** + **GitHub Actions**. The `infra/` directory is fully agnostic — every operator-specific value comes from environment variables (`TF_VAR_*` in `.envrc` for workstations, GH Actions env/secrets for CI). No HCL edits, no tfvars files.

See [`infra/README.md`](infra/README.md) for the full walkthrough, including:

- required GitHub Actions vars/secrets
- the AWS Secrets Manager bootstrap command
- plan/apply commands for workstation runs
- the three GitHub Actions workflows (`ci.yml`, `deploy-staging.yml`, `deploy-production.yml`)

The three workflows enforce a consistent shape:

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `ci.yml` | PR | lint / test / type-check / `terraform plan` on staging |
| `deploy-staging.yml` | push to `main` | auto-apply to staging, `/health` + authenticated smoke |
| `deploy-production.yml` | manual dispatch | plan → required-reviewer gate → apply → smoke |

## Forking for your organisation

This repository is the **upstream** for the Pact Broker product. To run the broker in your organisation's Cloudflare account, fork this repo (keep `upstream` as a remote) and add only the operator-specific config that can't live upstream:

1. **Fork** `bison-digital/pact-broker-workers` to your GitHub org. Keep this repo as `upstream`:

   ```bash
   git remote add upstream git@github.com:bison-digital/pact-broker-workers.git
   ```

2. **Populate your GitHub Environments** (`staging` and `production`) with the vars and secrets listed in [`infra/README.md`](infra/README.md#required-inputs). Repo-level secrets (AWS + Cloudflare credentials) go at repo scope; per-workspace values go at environment scope.

3. **Seed your bearer token** in AWS Secrets Manager, once per workspace:

   ```bash
   aws secretsmanager create-secret \
     --name "<your-secrets-prefix>/<workspace>/pact-broker-token" \
     --secret-string "$(openssl rand -hex 32)" \
     --recovery-window-in-days 0
   ```

4. **Create `infra/backend.hcl`** in your fork pointing at your S3 state bucket (see [`infra/backend.hcl.example`](infra/backend.hcl.example)). This file is gitignored — safe to commit on a private fork if you prefer, but not required.

5. **Run CI.** Push a trivial change to a PR branch to verify `ci.yml` green-lights. Merge to `main` to deploy staging. Run `deploy-production.yml` manually when ready.

### Staying in sync with upstream

```bash
git fetch upstream
git merge upstream/main                    # latest
# or:
git merge upstream/v1.2.3                  # specific tagged release
```

Because `infra/` is agnostic, these merges should be clean. If you get a conflict in `infra/`, something committed downstream shouldn't be there — it belongs in `.envrc` or a GitHub Environment variable. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the convention.

## Configuration reference

| Variable | Description | Default |
| --- | --- | --- |
| `PACT_BROKER_TOKEN` | Bearer token. **Secret** — sourced from AWS Secrets Manager by Terraform, pushed to the Worker via `wrangler secret put`. | required |
| `ALLOW_PUBLIC_READ` | If `"true"`, `GET`/`HEAD` requests bypass bearer auth. | `"false"` |
| `CORS_ALLOWED_ORIGINS` | Comma-separated list of origins allowed by CORS. Unset = permissive (`*`). Once you host the HAL UI on a known domain, set this to that domain so browsers can't talk to the broker from anywhere. | `""` (permissive) |
| `PUBLIC_BADGES` | Set to `"false"` to require a bearer token on `GET /pacts/provider/{p}/consumer/{c}/badge`. Any other value leaves badges public (the usual README-embed case). | `"true"` |

Edge-level mitigations provisioned by Terraform:

- **Rate limiting** — two rulesets on the broker hostname: mutating requests (`PUT`/`POST`/`DELETE`) are capped at `mutating_rate_limit_threshold` per IP per minute; reads at `read_rate_limit_threshold`. Both gated by `enable_rate_limiting` (default `true`). Requires a CF plan that supports the `http_ratelimit` phase (Pro+); disable on free tier.

## API reference

All endpoints require `Authorization: Bearer <token>` unless `ALLOW_PUBLIC_READ=true`. Three public exceptions: `/health`, `/ui` (HAL browser — the page itself, API calls from it still need a token), and `GET /pacts/provider/{p}/consumer/{c}/badge` (unless `PUBLIC_BADGES=false`).

### Pacts

| Method | Path | Description |
| --- | --- | --- |
| `PUT` | `/pacts/provider/{provider}/consumer/{consumer}/version/{version}` | Publish |
| `GET` | `/pacts/provider/{provider}/consumer/{consumer}/latest` | Latest pact |
| `GET` | `/pacts/provider/{provider}/consumer/{consumer}/latest/{tag}` | Latest for tag |
| `GET` | `/pacts/provider/{provider}/consumer/{consumer}/version/{version}` | Specific version |
| `GET` | `/pacts/provider/{provider}/consumer/{consumer}/pact-version/{sha}` | Fetch by content SHA |
| `GET` | `/pacts/provider/{provider}/latest` | All latest for provider |
| `GET` | `/pacts/latest` | All latest |
| `GET` | `/pacts/provider/{provider}/for-verification` | Consumer selectors (branches, tags, deployed, mainBranch) |

### Verifications

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/pacts/provider/{provider}/consumer/{consumer}/pact-version/{sha}/verification-results` | Publish verification result |

### Pacticipants, tags, environments

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/pacticipants` | List |
| `GET` | `/pacticipants/{name}` | Get one |
| `GET` | `/pacticipants/{name}/versions` | List versions |
| `GET` | `/pacticipants/{name}/versions/{version}` | Get version |
| `PUT` | `/pacticipants/{name}/versions/{version}/tags/{tag}` | Add tag |
| `GET` | `/pacticipants/{name}/versions/{version}/tags` | List tags |
| `GET`/`PUT` | `/environments/{name}` | Manage environment |

### Matrix / can-i-deploy

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/matrix?pacticipant={name}&version={version}` | Matrix query |
| `GET` | `/can-i-deploy?pacticipant={name}&version={version}&to={tag}` | Deploy gate |

### Webhooks

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/webhooks` | List webhooks |
| `POST` | `/webhooks` | Create (JSON: `events`, `url` (must be `https://`), optional `consumer`, `provider`, `headers`, `body` template, `enabled`, `description`) |
| `GET` | `/webhooks/{id}` | Get one |
| `PUT` | `/webhooks/{id}` | Update (partial) |
| `DELETE` | `/webhooks/{id}` | Delete |
| `POST` | `/webhooks/{id}/execute` | Fire manually (for testing) |
| `GET` | `/webhooks/{id}/executions` | Delivery log |

Events supported: `contract_published`, `provider_verification_published`. Delivery is best-effort with three retries (200 ms / 800 ms / 3200 ms back-off). Every attempt is logged, including failures.

### Badges

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/pacts/provider/{p}/consumer/{c}/badge?tag=...&label=...` | SVG verification badge — public unless `PUBLIC_BADGES=false` |

### Browser UI

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/ui` | Minimal HAL browser. Prompts the user for the bearer token (never leaves the tab). |

### Health

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/health` | none — returns `{"status":"ok"}` |

### Observability

Every response carries `X-Request-Id` (either the caller's, if they sent a safe one, or a new UUID). The Worker emits a single JSON log line per request with `requestId`, `method`, `path`, `status`, and `durationMs`, and a matching line on error with the stack trace.

## Using with `pact-broker-client`

```bash
pact-broker publish ./pacts \
  --consumer-app-version 1.0.0 \
  --broker-base-url https://your-broker-domain.com \
  --broker-token $PACT_BROKER_TOKEN

pact-broker can-i-deploy \
  --pacticipant my-consumer \
  --version 1.0.0 \
  --to prod \
  --broker-base-url https://your-broker-domain.com \
  --broker-token $PACT_BROKER_TOKEN
```

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Infra changes must keep `infra/` agnostic — no operator-specific strings in committed files.

## License

MIT. See [`LICENSE`](LICENSE).
