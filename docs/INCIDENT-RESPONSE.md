# Incident Response Playbook

Triage-first procedures for the most common broker failure modes.
Symptom → likely cause → fix.

For pipeline mechanics (deploy, rollback) see [`docs/CICD.md`](CICD.md).
This playbook only references the workflows; it doesn't re-document them.

## Table of Contents

1. [Quick Reference](#quick-reference)
2. [`/health` returns non-200](#health-returns-non-200)
3. [401 spike from clients](#401-spike-from-clients)
4. [413 Payload Too Large on publish](#413-payload-too-large-on-publish)
5. [DO storage approaching the cap](#do-storage-approaching-the-cap)
6. [DO storage recovery](#do-storage-recovery)
7. [Webhook delivery failures](#webhook-delivery-failures)
8. [Custom domain unbinding](#custom-domain-unbinding)
9. [Complete outage](#complete-outage)
10. [Post-incident](#post-incident)

---

## Quick Reference

```bash
# Health probe (uses the production HOSTNAME)
curl -fsS "https://${HOSTNAME}/health"

# Authenticated smoke
curl -fsS -H "Authorization: Bearer ${PACT_BROKER_TOKEN}" \
  "https://${HOSTNAME}/pacticipants"

# Tail worker logs
WRANGLER_ENV=production wrangler tail --format json

# Errors only
WRANGLER_ENV=production wrangler tail \
  --format json --search '"level":"error"'

# Re-deploy a previous SHA (rollback)
gh workflow run deploy-production.yml --ref <previous-good-sha>

# Rotate the bearer token
aws secretsmanager put-secret-value \
  --secret-id "${SECRETS_PREFIX}/${WORKSPACE}/pact-broker-token" \
  --secret-string "$(openssl rand -hex 32)"
gh workflow run deploy-production.yml --ref main
```

---

## `/health` returns non-200

**Symptom:** `curl /health` returns 5xx, or times out.

`/health` is the simplest possible endpoint — it doesn't even reach the
DO. A failure here means the Worker isn't running, the route binding is
broken, or Cloudflare itself is degraded.

### Step 1 — Is it the route or the Worker?

```bash
# Direct Worker URL (bypasses the custom domain)
curl -fsS "https://${WORKER_NAME}.${CLOUDFLARE_ACCOUNT_SUBDOMAIN}.workers.dev/health"
```

- **Worker URL works, custom domain doesn't** → custom-domain binding
  drift. See [Custom domain unbinding](#custom-domain-unbinding).
- **Both fail** → the Worker isn't deployed. Re-run
  `deploy-production.yml`.

### Step 2 — Check Cloudflare's status page

`https://www.cloudflarestatus.com/` — if Workers is degraded, your
deploy isn't going to fix it. Keep an eye on it; the broker will recover
when Cloudflare does.

### Step 3 — Re-deploy

If neither of the above explains it, the simplest recovery is to re-run
the production deploy. The `wrangler deploy` step is idempotent.

---

## 401 spike from clients

**Symptom:** consumer/provider CI logs spike with 401 from the broker;
access log shows `status=401` on previously-working clients.

### Cause

The bearer token in clients no longer matches `PACT_BROKER_TOKEN` in
the Worker. Almost always one of:

1. **Mid-rotation drift.** Token was rotated in AWS Secrets Manager
   but the deploy that pushes it to the Worker hasn't run yet — or
   ran but the consumer/provider pipelines still have the old token.
2. **Deploy applied without the secret read.** A failed Secrets Manager
   read at apply time can leave the Worker with a stale value.

### Fix

```bash
# 1. Confirm what the Worker currently has
WRANGLER_ENV=production wrangler secret list

# 2. Re-apply terraform — re-reads from Secrets Manager and re-pushes
gh workflow run deploy-production.yml --ref main

# 3. Confirm clients have the same value
# (whatever provisioning system you use for consumer/provider CI)
```

If you're rotating deliberately (suspected leak), update Secrets
Manager **first**, redeploy, then update consumer/provider CI to use
the new token. Brief 401s during the rotation window are expected.

---

## 413 Payload Too Large on publish

**Symptom:** consumer's publish step fails with HTTP 413; broker access
log shows `status=413` on a `PUT /pacts/...`.

### Cause

The publish exceeded the 10 MB body limit (`MAX_BODY_SIZE` in
`src/index.ts`). Real pacts are usually <100 KB, so 10 MB means the
consumer is generating fixture-bloated pacts (e.g. embedded base64
images, very long arrays).

### Fix

Trim the consumer fixture, not the broker. Pacts should describe
contract shape, not carry test payloads. If the consumer truly needs
to publish a big interaction set, split into multiple consumer
pacticipants — one per logical surface.

Raising `MAX_BODY_SIZE` is **not recommended**: very large pacts
exercise the DO's per-row write throughput hard and create unbounded
storage growth. Investigate the consumer-side pact generation first.

---

## DO storage approaching the cap

**Symptom:** Cloudflare DO dashboard shows `PactBrokerDO` storage
trending toward 8 GB or higher.

### Cause

Cloudflare's per-DO SQLite cap is ~10 GB. The broker grows
monotonically — every published pact and verification adds rows.
Without retention, growth is unbounded.

### Fix

Add retention. Two pragmatic options:

1. **Prune by version count per pacticipant.** Use the API to delete
   old versions for noisy consumers:
   ```bash
   # List versions
   curl -H "Authorization: Bearer $PACT_BROKER_TOKEN" \
     "https://${HOSTNAME}/pacticipants/${CONSUMER}/versions"

   # Delete a specific version (cascades to its pacts and verifications)
   curl -X DELETE -H "Authorization: Bearer $PACT_BROKER_TOKEN" \
     "https://${HOSTNAME}/pacticipants/${CONSUMER}/versions/${VERSION}"
   ```
   Keep the most recent N versions per pacticipant; prune older ones.

2. **Prune by date.** Same as above but driven by a "delete versions
   created before <date>" loop.

There is no built-in retention scheduler today (`BACKLOG.md` tracks the
feature). Run a one-off cleanup script from a workstation when storage
crosses 8 GB; consider a cron Worker if you need it ongoing.

If you've already hit the cap, the broker will start rejecting writes
with 5xx. Prune via the API even at the cap — deletes don't need
write headroom because SQLite reclaims space inside the same file.

---

## DO storage recovery

**Symptom:** broker is responding but data looks wrong — missing pacts,
phantom verifications, or migration errors at startup. Suspected DO
state corruption.

This is rare. Cloudflare durability is reliable; corruption usually
traces to a botched migration that was deployed and partially-rolled
back.

### Step 1 — Confirm the data is genuinely lost

```bash
# Pull the full pact list
curl -fsS -H "Authorization: Bearer $PACT_BROKER_TOKEN" \
  "https://${HOSTNAME}/pacts/latest" | jq

# Compare to what consumers think they published most recently
# (consumer-side CI history is the canonical source)
```

If the broker is missing data the consumer CI knows it published, the
DO has lost rows.

### Step 2 — Restore from a periodic dump

If you've been running periodic API dumps via `pact-broker-client`
(or a custom dumper), import them:

```bash
# Using pact-broker-client (Ruby gem or Docker)
pact-broker-client publish \
  --consumer-app-version <version> \
  --broker-base-url https://${HOSTNAME} \
  --broker-token $PACT_BROKER_TOKEN \
  /path/to/dumped-pact.json
```

Replay verifications similarly. Order matters: pacticipants → pacts →
verifications → environments → deployments.

### Step 3 — If there is no dump

There is no automated DO snapshot today. Recovery from a corrupted DO
without an external dump means: ask consumer/provider CI to re-publish
the most recent pacts (they have local copies in their build artefacts),
and accept that the historical matrix is gone.

This is the strongest argument for setting up a periodic external dump
to R2 or S3. `BACKLOG.md` tracks the feature; until then, operators
should treat DO durability as 9s-good but not 11s-good.

---

## Webhook delivery failures

**Symptom:** webhook target reports it's not receiving events, or
broker log shows webhook delivery warnings.

### Triage

```bash
# List webhook executions for a specific webhook
curl -H "Authorization: Bearer $PACT_BROKER_TOKEN" \
  "https://${HOSTNAME}/webhooks/${WEBHOOK_UUID}/executions" | jq
```

Each execution carries the HTTP status, response body, and attempt
count. Three retries with exponential backoff before the attempt is
abandoned.

### Common causes

1. **Webhook target offline.** Most common. Once the target is back,
   manually re-fire:
   ```bash
   curl -X POST -H "Authorization: Bearer $PACT_BROKER_TOKEN" \
     "https://${HOSTNAME}/webhooks/${WEBHOOK_UUID}/execute"
   ```
2. **HTTPS-only enforcement.** The broker rejects non-HTTPS webhook
   URLs at registration time. If a target moved to HTTPS but the
   webhook config still points at HTTP, re-register.
3. **Auth header drift.** If the webhook config carries an
   `Authorization` header for the target, and that target rotated its
   token, the header in the webhook needs updating too:
   `PUT /webhooks/{uuid}` with the new headers.

---

## Custom domain unbinding

**Symptom:** `https://${HOSTNAME}/health` returns 522 / 530 / Cloudflare
error page; the workers.dev URL works fine.

### Cause

The Cloudflare custom-domain binding is owned by Terraform
(`cloudflare_workers_custom_domain.pact_broker` in `infra/main.tf`). The
binding can drift if someone hand-edited it via the Cloudflare dashboard
or if a Terraform apply was killed mid-create.

### Fix

```bash
# 1. Inspect current state
terraform -chdir=infra state show cloudflare_workers_custom_domain.pact_broker

# 2. Re-apply (CI or workstation; CI preferred for production)
gh workflow run deploy-production.yml --ref main
```

Terraform is idempotent here — a re-apply re-creates the binding. If
the dashboard shows a phantom CNAME for the hostname pointing at a
deleted Worker, delete it manually before re-applying.

---

## Complete outage

**Symptom:** broker is unreachable on both the custom domain and the
workers.dev URL; Cloudflare dashboard shows the Worker exists but every
request errors.

### Step 1 — Stop the bleed

```bash
# Re-deploy the previous good SHA
gh workflow run deploy-production.yml --ref <last-known-good-sha>
```

Wrangler deploys are bit-identical for the same source SHA. If the
last good deploy was 2 hours ago, re-running it produces the same
Worker bundle as before.

### Step 2 — Identify the cause

While the rollback runs, capture:

- Most recent Worker version in `wrangler deployments list` (CI output
  has this for the bad deploy)
- Most recent worker tail output before the outage
- Any Cloudflare incidents on the status page in the last hour
- Most recent Terraform plan (if a deploy was in flight)

### Step 3 — Don't bypass Terraform / wrangler

If the rollback workflow itself fails, don't manually
`wrangler deploy` from a workstation against production. Terraform
holds the auth-token + custom-domain state; a hand-deploy can leave
state divergent and create a follow-on outage. Escalate first; the
companion proxy repo has a documented case where a manual deploy
during an incident took twice as long to fully recover.

### Step 4 — When Cloudflare itself is the cause

If `cloudflarestatus.com` shows Workers degraded, no deploy will
help. The broker recovers automatically when Cloudflare recovers.
Communicate the dependency to consumer/provider CI owners — pact
publishing and verification will fail closed during the outage.

---

## Post-incident

Document with the standard template:

- **What** — user-visible symptoms; which clients were affected.
- **When** — timeline (first user report, first internal alert,
  rollback start, recovery confirmed).
- **Impact** — how many requests, how many minutes, which
  pacticipants.
- **Root cause** — why it happened. Avoid "human error" — name the
  guard that didn't catch it.
- **Resolution** — what fixed it.
- **Prevention** — alert that should have fired, test that should
  have caught it, tooling that would have shortened recovery. Track
  these as concrete follow-ups.

If the incident exposed a missing alert or a triage step that wasn't
in this playbook, update this file alongside the post-mortem.
