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
- Verification results and `pacts-for-verification`, including provider version branches (`pb:branch-version`)
- Matrix, `can-i-deploy`, deployments/environments tracking
- Zero external data store — all state in DO-local SQLite
- Per-IP rate limiting enforced in the Worker (works on every Cloudflare plan)
- Turnkey deployment via wrangler + GitHub Actions — Cloudflare only, no other cloud and no IaC state to manage
- Optional Cloudflare Access perimeter if you don't want the broker on the open web

## Documentation

| Doc | Audience | Use when |
| --- | --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Operators, contributors | You want to understand the Worker + Durable Object topology, the request lifecycle, the auth model, or where to find a specific piece of code. |
| [`docs/CICD.md`](docs/CICD.md) | Operators | Deploying, rolling back, configuring GitHub Environments, rotating the bearer token. |
| [`docs/MONITORING.md`](docs/MONITORING.md) | Operators | What signals to watch (`/health`, access log, DO storage, Cloudflare analytics) and which alerts to set. |
| [`docs/INCIDENT-RESPONSE.md`](docs/INCIDENT-RESPONSE.md) | On-call | Triage playbooks for the common failure modes: 401 spikes, payload-too-large, DO storage near cap, custom-domain unbinding, complete outage. |
| [`docs/UPGRADING.md`](docs/UPGRADING.md) | Fork operators | Pulling tagged upstream releases into your fork. The manual sync playbook with worked examples and conflict-resolution guidance. |
| [`docs/PUBLISH-ORDER.md`](docs/PUBLISH-ORDER.md) | Consumers / providers | Why consumer-pact publishing must precede provider PRs, and how to wire `can-i-deploy` to close the loop. |
| [`infra/README.md`](infra/README.md) | Operators | The optional Cloudflare Access module — how to put a service-token perimeter in front of the broker. |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Maintainers, contributors | Local workflow, code style, infra-agnostic conventions, releases. |

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

Deployment is `wrangler deploy`, driven by **GitHub Actions**. There is no
infrastructure-as-code state, no bucket, and no cloud account other than
Cloudflare. The first deploy creates the Worker, its Durable Object namespace,
the custom domain and its certificate.

Everything operator-specific comes from environment variables, which
`scripts/render-wrangler-config.mjs` interpolates into `wrangler.jsonc` before
each deploy. Nothing operator-specific is committed.

```bash
# The entire deploy, on any CI system:
CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… \
DOMAIN=pact-broker.example.com WORKER_NAME=pact-broker-production \
  pnpm run deploy
```

See [`docs/CICD.md`](docs/CICD.md) for the full walkthrough.

| Workflow | Audience | Trigger | What it does |
| --- | --- | --- | --- |
| `ci.yml` | the project | PR + push | format / lint / type-check / test, plus an operator-shaped config render and deploy dry-run. No credentials; runs everywhere with no setup. |
| `deploy-staging.yml` | operators | push to `main` | checks, `wrangler deploy`, tokenless `/health` + 401 smoke |
| `deploy-production.yml` | operators | manual dispatch | checks + deploy preview → required-reviewer gate → deploy → smoke |

The two `deploy-*.yml` workflows are a **reference implementation**. They are
inert until you configure a GitHub Environment, and yours to adapt or replace —
nothing in the broker depends on them.

## Forking for your organisation

This repository is the **upstream** for the Pact Broker product. To run the broker in your organisation's Cloudflare account, fork this repo (keep `upstream` as a remote) and add only the operator-specific config that can't live upstream:

1. **Fork** `bison-digital/pact-broker-workers` to your GitHub org. Keep this repo as `upstream`:

   ```bash
   git remote add upstream git@github.com:bison-digital/pact-broker-workers.git
   ```

2. **Add `CLOUDFLARE_API_TOKEN`** as a repo secret, and populate `staging` / `production` GitHub Environments with the vars in [`docs/CICD.md`](docs/CICD.md#what-a-deploy-needs). Add the required-reviewer rule to `production` — that rule is the approval gate.

3. **Seed your bearer token**, once per Worker. This never passes through CI:

   ```bash
   openssl rand -hex 32 | wrangler secret put PACT_BROKER_TOKEN --name <worker-name>
   ```

   Worker secrets survive every deploy, so rotation is the same command again. `wrangler deploy` fails if a Worker was never seeded, so you cannot accidentally ship an unconfigured broker.

4. **Nothing else to provision.** No state backend, no bucket, no DNS record — `wrangler deploy` creates the Worker, the custom domain and its certificate on first run. Cloudflare Access, if you want it, is a separate opt-in module (see [`infra/README.md`](infra/README.md)).

5. **Run CI.** Push a trivial change to a PR branch to verify `ci.yml` green-lights. Merge to `main` to deploy staging. Run `deploy-production.yml` manually when ready.

### Staying in sync with upstream

See [`docs/UPGRADING.md`](docs/UPGRADING.md) for the full playbook — the
short version:

```bash
git fetch upstream --tags
git tag -l 'v*' --sort=-v:refname | head -5
git checkout -b sync/upstream-v1.3.0
git merge v1.3.0
# verify locally, push, open PR
```

Pull tagged releases (not raw `upstream/main`). Each tag has a GitHub
Release whose body comes from [`CHANGELOG.md`](CHANGELOG.md) — read it
before merging. Conflicts in the workflows usually mean operator-specific
values leaked into committed files; they belong in GitHub Environment vars.
See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the convention.

## Configuration reference

| Variable | Description | Default |
| --- | --- | --- |
| `PACT_BROKER_TOKEN` | Bearer token. **Secret** — set once with `wrangler secret put`; never held by Terraform or CI. | required |
| `ALLOW_PUBLIC_READ` | If `"true"`, `GET`/`HEAD` requests bypass bearer auth. | `"false"` |
| `CORS_ALLOWED_ORIGINS` | Comma-separated list of origins allowed by CORS. Unset = permissive (`*`). Once you host the HAL UI on a known domain, set this to that domain so browsers can't talk to the broker from anywhere. | `""` (permissive) |
| `PUBLIC_BADGES` | Set to `"false"` to require a bearer token on `GET /pacts/provider/{p}/consumer/{c}/badge`. Any other value leaves badges public (the usual README-embed case). | `"true"` |

Edge and in-Worker mitigations:

- **Rate limiting** — two rulesets on the broker hostname: mutating requests (`PUT`/`POST`/`DELETE`) are capped at `mutating_rate_limit_threshold` per IP per minute; reads at `read_rate_limit_threshold`. Both gated by `enable_rate_limiting` (default `true`). Requires a CF plan that supports the `http_ratelimit` phase (Pro+); disable on free tier.
- **Cloudflare Access (optional, default OFF)** — when `access_policy_mode` is set to `"pinned_token"` or `"any_valid_token"`, a service-token policy in front of the custom domain rejects unauthenticated traffic at the edge. The Worker's bearer-token check runs as an independent second layer behind it. Default `""` provisions no Access resources. See [`SECURITY.md`](SECURITY.md) and [`infra/README.md`](infra/README.md#cloudflare-access-optional-perimeter).

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
| `PUT` | `/pacticipants/{name}/branches/{branch}/versions/{version}` | Put a version on a branch (`pb:branch-version`) |
| `PUT` | `/pacticipants/{name}/versions/{version}/tags/{tag}` | Add tag |
| `GET` | `/pacticipants/{name}/versions/{version}/tags` | List tags |
| `GET`/`PUT` | `/environments/{name}` | Manage environment |

### Matrix / can-i-deploy

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/matrix?pacticipant={name}&version={version}` | Matrix query. Narrow the provider side with `tag=` or `environment=` |
| `GET` | `/can-i-deploy?pacticipant={name}&version={version}&to={target}` | Deploy gate. `to` may name an environment, a tag or a branch |

`summary` follows the reference broker: `deployable` is **tri-state**
(`true` / `false` / `null` — `null` means something is unverified, which is not
the same as failed), `reason` carries *every* applicable reason joined with
newlines, and `success` / `failed` / `unknown` counts sit alongside. A `notices`
array repeats the reasons with a `type`.

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

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Deployment changes must stay operator-agnostic — no operator-specific strings in committed files; everything varies through environment variables.

## License

MIT. See [`LICENSE`](LICENSE).
