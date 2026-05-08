# Monitoring and Observability

The broker is small. A handful of signals cover everything worth
watching — primarily the access log, Cloudflare's built-in Workers
analytics, and the Durable Object usage dashboard.

## Health endpoint

`GET /health` — unauthenticated, always returns 200 with body
`{"status":"ok"}` when the Worker is reachable. The DO is contacted on
every other endpoint, so a healthy `/health` plus a passing
`/pacticipants` call is a strong end-to-end signal.

The deploy workflows run both as a post-apply smoke test:

```bash
curl -fsS "https://${HOSTNAME}/health"
curl -fsS -H "Authorization: Bearer ${PACT_BROKER_TOKEN}" \
  "https://${HOSTNAME}/pacticipants"
```

A failure of either is the deploy-failure signal. Treat sustained
non-200 on `/health` for >2 minutes as alertable.

## Access log

`src/index.ts` emits one structured JSON line per request, served via
Cloudflare's worker logs (visible in `wrangler tail` or the dashboard's
"Logs" tab). Sample line:

```json
{
  "ts": "2026-04-19T12:00:00.000Z",
  "level": "info",
  "requestId": "7f3e8d2a-4b1c-9e6f-2a8b-5c7d9e1f3a4b",
  "method": "POST",
  "path": "/pacts/provider/ProductAPI/consumer/DrupalCuProduct/version/abc123",
  "status": 201,
  "durationMs": 42
}
```

The `Authorization` header and request body are deliberately not
logged. The `requestId` echoes the inbound `X-Request-Id` if the client
provided one — useful for tracing a single contract publish across
consumer CI logs and broker logs.

### Tail logs from a workstation

```bash
# Tail the staging worker
WRANGLER_ENV=staging wrangler tail \
  --format json \
  --search '"level":"error"'

# Errors only, last 24h, from the dashboard
# (Cloudflare → Workers → <worker-name> → Logs tab → filter by level)
```

### Useful filters

| Filter                                 | What it tells you                                  |
| -------------------------------------- | -------------------------------------------------- |
| `level=error`                          | Unhandled exceptions, DO calls that threw         |
| `status=401`                           | Auth misconfiguration / token rotation in flight  |
| `status=413`                           | Pact body exceeded the 10 MB limit                |
| `path /webhooks` and `level=warn`      | Webhook delivery failures (best-effort)           |
| `durationMs > 1000`                    | Slow DO operation — usually a large pact retrieval |

## Cloudflare-side signals

The Worker and Durable Object both report to Cloudflare's dashboard:

- **Workers Analytics** (Workers & Pages → `<worker-name>` → Analytics).
  Request rate, error rate (4xx / 5xx split), CPU time, sub-request
  count. The broker is mostly DO calls, so CPU stays low and request
  duration tracks DO latency.
- **Durable Objects → `PactBrokerDO`**. Storage size, request rate,
  storage operations. Watch storage size over time — it grows
  monotonically with publish volume; sudden jumps usually mean a
  consumer started publishing oversized fixtures.
- **Custom Domain** (Workers Routes / Custom Domains). Should always
  show "Active". A non-active state means the route binding diverged
  from Terraform; re-apply infra to recover.

## Recommended alerts

| Alert                                                | Threshold                              | Severity |
| ---------------------------------------------------- | -------------------------------------- | -------- |
| `/health` non-200 for 2 min                          | Single sustained failure               | Critical |
| Error log rate > 1/min for 5 min                     | Sustained handler errors               | Warning  |
| 5xx response rate > 1% for 5 min                     | Bug or DO degradation                  | Critical |
| 401 burst > 20 in 5 min                              | Token mismatch (rotation in progress?) | Warning  |
| DO storage growth > 100 MB in 1 hour                 | Likely a runaway publisher             | Warning  |
| DO storage > 8 GB                                    | Approaching the 10 GB SQLite ceiling   | Critical |
| Webhook delivery failure rate > 10% for 1 hour       | A webhook target is offline            | Warning  |

The first three are the load-bearing ones. The DO-storage alerts are
the unique-to-this-architecture ones — there is no equivalent on
"normal" infrastructure where a database has TB-scale headroom.

## Webhook delivery observability

Webhook attempts and outcomes are queryable via the API — there is no
separate log surface for them. Useful endpoints:

```bash
# List configured webhooks
GET /webhooks

# Recent execution history for a webhook
GET /webhooks/{webhook-uuid}/executions
```

Each execution record carries the HTTP status, response body, and
attempt count. Three retries with exponential backoff, then the
attempt is recorded as failed and is not retried automatically — set
the webhook target back online and use `POST /webhooks/{uuid}/execute`
to manually re-fire the most recent event.

## What's deliberately not here

- **Per-pacticipant publish dashboards.** The Pact Broker UI / matrix
  view at `/ui` is the canonical place to see per-pacticipant state.
  Adding a separate metrics dashboard would duplicate it.
- **Custom metrics emission.** Workers Analytics + the access log
  already provide the signal an operator needs. The broker doesn't push
  metrics to a separate observability stack.
- **DO request timing percentiles broken down by route.** The access
  log carries `durationMs` per request — query the log if you need a
  percentile breakdown rather than baking it into a metrics pipeline.
