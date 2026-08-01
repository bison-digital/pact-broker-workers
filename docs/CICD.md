# CI / CD — Operator Handbook

This repo ships two different things, and it's worth being clear which is which
before configuring anything.

| | Audience | Runs |
| --- | --- | --- |
| **`ci.yml`** | The project itself | Every PR and push, on this repo and every fork. Holds no credentials and deploys nothing. You do not configure it. |
| **`deploy-staging.yml` / `deploy-production.yml`** | Operators | A **reference implementation** for deploying your own broker. Inert until you configure a GitHub Environment. |

Earlier versions blurred these into one pipeline gated behind an
`INFRA_DEPLOY_ENABLED` variable. That flag is gone: the project's own CI always
runs, and the deploy workflows are yours to adopt, adapt, or delete.

## What a deploy needs

One credential and a handful of values. No Terraform, no state backend, no
bucket, no cloud account other than Cloudflare.

**Repo-level secret**

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Workers Scripts: Edit, plus Workers Routes: Edit and DNS: Edit on the zone — wrangler creates the custom domain and its certificate. |

**Per-environment vars** — one GitHub Environment per workspace (`staging`,
`production`):

| Var | Required | Meaning |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | yes | Account that owns the Worker |
| `DOMAIN` | yes | Hostname the Worker binds to |
| `WORKER_NAME` | yes | Worker name, e.g. `pact-broker-production` |
| `ALLOW_PUBLIC_READ` | no | `"true"` lets GET/HEAD skip auth. Default `"false"` |
| `CORS_ALLOWED_ORIGINS` | no | Comma-separated origins. Empty = permissive |
| `PUBLIC_BADGES` | no | `"false"` requires auth on badges. Default public |
| `MUTATING_RATE_LIMIT_THRESHOLD` | no | Writes per IP per minute. Default `60` |
| `READ_RATE_LIMIT_THRESHOLD` | no | Reads per IP per minute. Default `600` |

The `production` environment must also carry a **required-reviewer rule**
(Settings → Environments → production → Required reviewers). That rule *is* the
approval gate. Without it, production deploys unattended.

**Not here: the broker's bearer token.** CI never reads or writes it. See
[Seeding the bearer token](#seeding-the-bearer-token).

The deploy workflows are inert in two stages:

- **No `WORKER_NAME`** → the job **skips**. Upstream and personal forks stay
  green, with no opt-in flag to remember: the thing that enables the deploy is
  the same config the deploy needs.
- **Partially configured** → the job **fails**, listing the missing variables,
  before touching Cloudflare.

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

Each deploy is a fresh `wrangler deploy` from the same source commit. Promotion
staging → production re-deploys the same `main` SHA into the production Worker,
behind the reviewer rule.

### Why the reviewer sees a dry-run, not a plan

The `preflight` job runs unattended *before* the gate and publishes
`wrangler deploy --dry-run` output to the run summary — the binding list, the
bundle size, and any build failure. `--dry-run` needs no credentials and
contacts nothing.

This replaced a `terraform plan` artifact. It answers a narrower question —
"does this build, and are the bindings what I expect" rather than "what will
change" — because a Worker deploy has no diff to show: it either replaces the
script or it doesn't. Anything genuinely stateful (the Durable Object and its
data) is untouched by a deploy either way.

### What the smoke test proves

Both deploy workflows run the same two unauthenticated checks:

1. `/health` must return `storage: "ok"`, which only happens once
   `PactBrokerDO.healthCheck()` has resolved — so it proves the Worker, the DO
   binding and its SQLite storage all work.
2. `/pacticipants` must return **401**, proving the auth middleware is live. A
   200 here fails the deploy; nothing previously caught a broker accidentally
   serving data without auth.

Neither needs a token, which is what lets CI hold no broker credential at all.

## Seeding the bearer token

Once per Worker, from a workstation. This value never passes through CI:

```bash
openssl rand -hex 32 | wrangler secret put PACT_BROKER_TOKEN --name pact-broker-production
```

Worker secrets are durable — they survive every subsequent deploy, and wrangler
only removes one on an explicit `wrangler secret delete`. So there is nothing
for a pipeline to re-push, and no reason for CI to hold the value.

`wrangler.jsonc.tmpl` declares the token under `secrets.required`, so
**`wrangler deploy` fails** if a Worker was never seeded, rather than shipping a
broker that rejects every request.

### Rotate the bearer token

```bash
openssl rand -hex 32 | wrangler secret put PACT_BROKER_TOKEN --name <worker-name>
```

Effective immediately; no deploy needed. **Existing clients start receiving 401
the moment the new value lands**, so publish the new token to consumer/provider
CI *before* rotating.

## Runbooks

### First-time setup

1. Fork `bison-digital/pact-broker-workers` to your org.
2. Add `CLOUDFLARE_API_TOKEN` as a repo secret.
3. Create `staging` and `production` GitHub Environments with the vars above.
   Add the required-reviewer rule to `production`.
4. Seed the bearer token on each Worker (above).
5. Push to `main`. Staging deploys automatically. Dispatch
   `deploy-production.yml` when you're happy.

The first deploy creates the Worker, the Durable Object namespace, the custom
domain and its certificate. Nothing to provision beforehand.

### Deploy to staging

Automatic on push to `main`. To re-trigger without a commit: Actions → "Deploy
to Staging" → Run workflow. Re-running the same SHA is harmless.

### Deploy to production

1. Confirm staging is green for the SHA you want. Visit `/ui`.
2. Actions → "Deploy to Production" → Run workflow → branch `main`.
3. `preflight` runs unattended. Read the deploy preview in the run summary.
4. Approve the reviewer gate.
5. The smoke test runs.

### Roll back production

A rollback is "redeploy the previous SHA":

1. Find the last good SHA from a previous `deploy-production.yml` run.
2. Actions → "Deploy to Production" → Run workflow → choose that ref.
3. Approve the gate.

Cloudflare also keeps prior Worker versions — `wrangler rollback --name <worker>`
reverts to the previous deployment immediately, which is faster if you need to
stop the bleeding before working out which commit to ship.

**Neither touches Durable Object data.** For DO corruption see
[`INCIDENT-RESPONSE.md`](INCIDENT-RESPONSE.md).

## Cloudflare Access

Access is **not** applied by these workflows. It is an optional Terraform
module you run from your own configuration — see
[`infra/README.md`](../infra/README.md).

That separation is deliberate. Application code changes weekly; a security
perimeter changes maybe twice a year. If they shared a pipeline, every routine
merge could alter the security boundary — clear one variable and the next
unrelated deploy silently destroys the Access application, reviewed by nobody.
It would also pin `Access: Apps and Policies: Edit` onto the deploy credential
permanently.

## Why no per-PR preview deploys

- A broker preview needs its own DO namespace seeded with realistic pact data
  plus webhook and verification fixtures. Poor cost-to-value per PR.
- Vitest covers the route surface, auth model, rate limiting and HAL shape.
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
