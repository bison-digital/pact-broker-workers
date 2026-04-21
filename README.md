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

## API reference

All endpoints require `Authorization: Bearer <token>` unless `ALLOW_PUBLIC_READ=true`. Except `/health`.

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

### Health

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/health` | none — returns `{"status":"ok"}` |

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
