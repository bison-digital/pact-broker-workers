# CI / CD — Operator Handbook

The broker ships through a lightweight three-workflow GitHub Actions
pipeline. This document is the operator reference for what each workflow
does, what configuration it needs, and how to drive a deploy / rollback.

## Workflows

| Workflow                | Trigger                       | Effect                                                                                                                                                                                                                                            |
| ----------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`                | PR to main, push to main      | Lint, format check, type-check, vitest, `wrangler.jsonc.tmpl` route-block guard. If `vars.INFRA_DEPLOY_ENABLED=true` is set, also runs `terraform plan` against the staging workspace and posts the plan as a PR comment.                          |
| `deploy-staging.yml`    | push to main, manual dispatch | Re-runs the full check suite, then (when `vars.INFRA_DEPLOY_ENABLED=true`) terraform-applies to the `staging` workspace, runs `/health` + an authenticated `/pacticipants` smoke test against the staging URL.                                    |
| `deploy-production.yml` | manual dispatch               | Re-runs checks, terraform plan, **required-reviewer gate** (the `production` GitHub Environment), terraform apply to the `production` workspace, post-apply health + smoke. Reviewers see the plan summary on the run page before approving.       |

The `INFRA_DEPLOY_ENABLED` switch is intentional: upstream
(`bison-digital/pact-broker-workers`) doesn't carry deployment
credentials, so the deploy steps no-op. Operator forks set the var to
`true` and add their environment vars/secrets — deploy then activates.

## End-to-end flow

```
            ┌───────────────────┐
            │  PR opened / push │
            └─────────┬─────────┘
                      │
                      ▼
              ╔══════════════╗      checks fail → block merge
              ║   ci.yml     ║─────▶ wrangler routes-block guard
              ╚══════╤═══════╝       terraform plan posted as PR comment
                     │ merge to main  (only on operator forks)
                     ▼
       ┌──────────────────────────┐
       │   deploy-staging.yml     │      checks again
       │   (auto on push to main) │      terraform apply → staging workspace
       │                          │      smoke: /health + /pacticipants
       └────────────┬─────────────┘
                    │
                    │ human verifies staging
                    │ (visit /ui, sanity-check a few endpoints)
                    ▼
       ┌──────────────────────────┐
       │   deploy-production.yml  │      reviewer-approval gate
       │   (manual dispatch)      │      terraform apply → production workspace
       │                          │      smoke: /health + /pacticipants
       └──────────────────────────┘
```

There is no separate "release-publish" workflow and no image-promotion
step — the broker has no Docker artifact, just a Worker bundle. Each
deploy is a fresh `wrangler deploy` from the same source commit.
Promotion staging → production is a re-apply of the same `main` SHA into
the `production` Terraform workspace, gated by the reviewer rule.

## Required GitHub configuration

### Repo-level

**Vars**:

| Var                       | Used by                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| `INFRA_DEPLOY_ENABLED`    | Gates every deploy step. Set to `true` on operator forks; leave unset on upstream / personal forks. |
| `AWS_REGION`              | Every workflow that runs `terraform` or reads Secrets Manager                                       |
| `TERRAFORM_STATE_BUCKET`  | Every workflow that runs `terraform`                                                                |

**Secrets**:

| Secret                  | Used by                                  |
| ----------------------- | ---------------------------------------- |
| `AWS_ACCESS_KEY_ID`     | Every terraform / Secrets Manager step   |
| `AWS_SECRET_ACCESS_KEY` | Every terraform / Secrets Manager step   |
| `CLOUDFLARE_API_TOKEN`  | Every terraform step (Workers / DNS)     |

These can be overridden at the GH Environment level if staging and
production live in different AWS accounts.

### Per-environment (`staging`, `production`)

Each GH Environment must hold:

**Vars**: `CLOUDFLARE_ACCOUNT_ID`, `DOMAIN`, `WORKER_NAME`,
`SECRETS_PREFIX`. The `production` environment must also have the
**required-reviewer protection rule** configured. Without it,
`deploy-production.yml` will apply unconditionally — which defeats the
gating model.

**Secrets**: `CLOUDFLARE_ZONE_ID` (zone differs between operators; some
also override the AWS / Cloudflare credentials per environment).

The full list of inputs and the AWS Secrets Manager bootstrap command
live in [`infra/README.md`](../infra/README.md#required-inputs). Treat
that file as the canonical reference; this page only summarises.

## Runbooks

### First-time setup of a new operator fork

1. Fork `bison-digital/pact-broker-workers` to your org.
2. Set repo-level vars/secrets above.
3. Create `staging` and `production` GH Environments with their
   per-environment vars/secrets. Add the required-reviewer rule to
   `production`.
4. Seed the bearer token in AWS Secrets Manager — once per workspace:
   ```bash
   aws secretsmanager create-secret \
     --name "<your-secrets-prefix>/staging/pact-broker-token" \
     --secret-string "$(openssl rand -hex 32)" \
     --recovery-window-in-days 0
   aws secretsmanager create-secret \
     --name "<your-secrets-prefix>/production/pact-broker-token" \
     --secret-string "$(openssl rand -hex 32)" \
     --recovery-window-in-days 0
   ```
5. Set `vars.INFRA_DEPLOY_ENABLED=true` at repo scope.
6. Push a no-op commit to `main` (or trigger `deploy-staging.yml` via
   manual dispatch). Watch the staging deploy succeed, then dispatch
   `deploy-production.yml` for the first production apply.

### Deploy to staging

Auto on push to `main`. To re-trigger without a new commit:

- Actions → "Deploy to Staging" → Run workflow → branch `main`.

The deploy job is idempotent — re-running against the same SHA produces
no diff if nothing changed.

### Deploy to production

1. Confirm staging is green for the SHA you want to ship — check the
   most recent `deploy-staging.yml` run. Visit `/ui` and the matrix
   badge for a sanity check.
2. Actions → "Deploy to Production" → Run workflow → branch `main`.
3. The `plan` job runs unattended. Read its summary on the run page —
   the diff should match what you already saw on staging.
4. The `apply` job pauses for required-reviewer approval. Approve
   after the plan looks right.
5. The post-apply smoke job runs `/health` + an authenticated
   `/pacticipants` call against the production hostname. Green = done.

### Roll back production

There is no automated rollback workflow. The `wrangler deploy` model
means a rollback is "redeploy the previous SHA":

1. Identify the previous good SHA on `main` (look at recent
   `deploy-production.yml` runs — the SHA they applied is in the
   summary).
2. From a local checkout of the operator fork:
   ```bash
   git fetch origin
   git checkout <previous-good-sha>
   ```
3. Actions → "Deploy to Production" → Run workflow → choose the
   previous SHA as the ref. Approve the reviewer gate.

For DO data corruption (rare; rollback alone won't fix), see
[`docs/INCIDENT-RESPONSE.md`](INCIDENT-RESPONSE.md#do-storage-recovery).

### Rotate the bearer token

```bash
aws secretsmanager put-secret-value \
  --secret-id "<your-secrets-prefix>/<workspace>/pact-broker-token" \
  --secret-string "$(openssl rand -hex 32)"
```

Then trigger the appropriate deploy workflow. Terraform reads the new
value on apply and pushes it to the Worker via `wrangler secret put`.
**Existing clients will start receiving 401 immediately after the
deploy** — coordinate the publishing of the new token to consumer /
provider CI before rotating.

## Why the broker has no per-PR preview deploys

The companion middleware uses per-PR Cloudflare Worker preview
environments. The broker doesn't, by design:

- A broker preview would need its own Durable Object namespace seeded
  with realistic pact data, plus webhook / verification fixtures. The
  cost-to-value of maintaining that for every PR is poor.
- Vitest covers the route surface, the auth model, and the HAL shape.
  Most regressions are caught by the unit suite long before staging.
- Staging is the integration environment. Promote SHA → staging → eyes
  → production. If a regression slips past staging, the rollback path
  (redeploy previous SHA) takes ~2 minutes.
