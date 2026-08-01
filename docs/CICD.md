# CI / CD — Operator Handbook

This project ships two different things, and it is worth being clear about
which is which before you configure anything.

| | Audience | Runs |
| --- | --- | --- |
| **`ci.yml`** | The project itself | Every PR and push, on this repo and every fork. Holds no credentials and deploys nothing. You do not configure it. |
| **`deploy-staging.yml` / `deploy-production.yml`** | Operators | A **reference implementation** for deploying your own broker. Inert until you configure a GitHub Environment. |

Earlier versions blurred these into one pipeline gated behind an
`INFRA_DEPLOY_ENABLED` variable. That flag is gone: the project's own CI
always runs, and the deploy workflows are yours to adopt, adapt, or delete.

## What a deploy actually needs

One credential and a handful of values. There is no Terraform, no state
backend, no bucket, and no second cloud account.

**Repo-level secret**

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Workers Scripts: Edit, plus Workers Routes: Edit and DNS: Edit on the zone (wrangler creates the custom domain). |

**Per-environment vars** — create one GitHub Environment per workspace
(`staging`, `production`):

| Var | Required | Meaning |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | yes | Account that owns the Worker |
| `DOMAIN` | yes | Hostname the Worker binds to, e.g. `pact-broker.example.com` |
| `WORKER_NAME` | yes | Worker name, e.g. `pact-broker-production` |
| `ALLOW_PUBLIC_READ` | no | `"true"` lets GET/HEAD skip auth. Default `"false"` |
| `CORS_ALLOWED_ORIGINS` | no | Comma-separated origins. Empty = permissive |
| `PUBLIC_BADGES` | no | `"false"` requires auth on badges. Default public |
| `MUTATING_RATE_LIMIT` | no | Writes per IP per minute. Default `60` |
| `READ_RATE_LIMIT` | no | Reads per IP per minute. Default `600` |

The `production` environment must also carry a **required-reviewer rule**
(Settings → Environments → production → Required reviewers). That rule *is*
the approval gate. Without it, production deploys unattended.

**Not here: the broker's bearer token.** CI never reads or writes it. See
[Seeding the bearer token](#seeding-the-bearer-token).

The deploy workflows are inert in two stages:

- **No `WORKER_NAME`** on the environment → the job **skips**. Upstream and
  personal forks stay green; there is no opt-in flag to remember, because the
  thing that enables the deploy is the same config the deploy needs.
- **Partially configured** → the job **fails** with a list of the missing
  variables, before touching Cloudflare.

## End-to-end flow

```
        ┌───────────────────┐
        │  PR opened / push │
        └─────────┬─────────┘
                  ▼
          ╔══════════════╗   format / lint / type-check / test
          ║   ci.yml     ║   + operator-shaped config render
          ╚══════╤═══════╝     and wrangler deploy --dry-run
                 │ merge to main
                 ▼
   ┌──────────────────────────┐
   │   deploy-staging.yml     │  checks again on the exact SHA
   │   (auto on push to main) │  wrangler deploy
   │                          │  smoke: /health storage:ok + 401
   └────────────┬─────────────┘
                │ human verifies staging (/ui, a few endpoints)
                ▼
   ┌──────────────────────────┐
   │  deploy-production.yml   │  preflight: checks + dry-run preview
   │  (manual dispatch)       │  ── required-reviewer gate ──
   │                          │  wrangler deploy
   │                          │  smoke: /health storage:ok + 401
   └──────────────────────────┘
```

Each deploy is a fresh `wrangler deploy` from the same source commit.
Promotion staging → production re-deploys the same `main` SHA into the
production Worker, behind the reviewer rule.

### Why the reviewer sees a dry-run, not a plan

The `preflight` job runs unattended *before* the gate and publishes
`wrangler deploy --dry-run` output to the run summary — the binding list,
the bundle size, and any build failure. `--dry-run` needs no credentials and
contacts nothing.

This is what replaced the `terraform plan` artifact. It answers a narrower
question — "does this build, and are the bindings what I expect" rather than
"what will change" — because a Worker deploy has no diff to show: it either
replaces the script or it does not. Anything genuinely stateful (the Durable
Object and its data) is untouched by a deploy either way.

## Seeding the bearer token

Once per Worker, from a workstation. This value never passes through CI:

```bash
openssl rand -hex 32 | wrangler secret put PACT_BROKER_TOKEN --name pact-broker-production
```

Worker secrets are durable — they survive every subsequent deploy, and
wrangler only removes one on an explicit `wrangler secret delete`. So there
is nothing for a pipeline to re-push, and no reason for CI to hold the value.

`wrangler.jsonc.tmpl` declares the token under `secrets.required`, so
**`wrangler deploy` fails** if a Worker was never seeded, rather than shipping
a broker that rejects every request.

### Rotate the bearer token

```bash
openssl rand -hex 32 | wrangler secret put PACT_BROKER_TOKEN --name <worker-name>
```

Effective immediately; no deploy needed. **Existing clients start receiving
401 the moment the new value lands**, so publish the new token to
consumer/provider CI *before* rotating.

## Runbooks

### First-time setup

1. Fork `bison-digital/pact-broker-workers` to your org.
2. Add `CLOUDFLARE_API_TOKEN` as a repo secret.
3. Create `staging` and `production` GitHub Environments with the vars above.
   Add the required-reviewer rule to `production`.
4. Seed the bearer token on each Worker (above).
5. Push to `main`. Staging deploys automatically. Dispatch
   `deploy-production.yml` when you are happy.

The first deploy creates the Worker, the Durable Object namespace, the custom
domain, and its certificate. Nothing to provision beforehand.

### Deploy to staging

Automatic on push to `main`. To re-trigger without a commit: Actions →
"Deploy to Staging" → Run workflow. Re-running against the same SHA is
harmless.

### Deploy to production

1. Confirm staging is green for the SHA you want. Visit `/ui`.
2. Actions → "Deploy to Production" → Run workflow → branch `main`.
3. `preflight` runs unattended. Read the deploy preview in the run summary.
4. Approve the reviewer gate.
5. The smoke test runs `/health` and the unauthenticated 401 check.

### Roll back production

A rollback is "redeploy the previous SHA":

1. Find the last good SHA from a previous `deploy-production.yml` run.
2. Actions → "Deploy to Production" → Run workflow → choose that ref.
3. Approve the gate.

Cloudflare also keeps prior Worker versions — `wrangler rollback --name <worker>`
reverts to the previous deployment immediately, which is faster if you need
to stop the bleeding before working out which commit to ship.

**Neither touches Durable Object data.** For DO corruption see
[`docs/INCIDENT-RESPONSE.md`](INCIDENT-RESPONSE.md).

## Why no per-PR preview deploys

- A broker preview needs its own DO namespace seeded with realistic pact
  data plus webhook and verification fixtures. Poor cost-to-value per PR.
- Vitest covers the route surface, auth model, rate limiting and HAL shape.
  Most regressions die there.
- Staging is the integration environment, and rollback takes ~2 minutes.

## Adapting this to another CI system

Nothing here is GitHub-specific except the workflow syntax and the reviewer
gate. The whole deploy is:

```bash
pnpm install --frozen-lockfile
pnpm run deploy          # renders wrangler.jsonc, then wrangler deploy
```

with `CLOUDFLARE_API_TOKEN` and the environment variables in the table above.
Any runner that can set environment variables and run Node will do.
