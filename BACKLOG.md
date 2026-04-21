# Backlog

Things this broker deliberately does not do yet. Filed here so operators know what to expect, and so contributors know where a PR would land.

## Feature parity with the reference Pact Broker

### Webhooks
Not implemented. The reference broker fires HTTP webhooks on pact publish / verification result, which many teams use to trigger provider CI. Workarounds:
- Poll `pacts-for-verification` from provider CI on a schedule.
- Use the broker's response payload to decide whether to run verification inline.

### HAL Browser UI
Not implemented. Browsing pacts/pacticipants requires the HAL API directly (`curl … -H 'Accept: application/hal+json'`) or a HAL-aware client (`pact-broker` CLI). No server-rendered UI.

### Matrix badge endpoint
Not implemented. `GET /pacts/provider/{p}/consumer/{c}/badge` returns 404. Embed the `can-i-deploy` call in a README badge generator externally if needed.

## Operational gaps

### Durable Object SQLite snapshot / export
No built-in mechanism to export the broker's stored pacts, verifications, tags, or deployments. Cloudflare replicates DO storage internally but there's no point-in-time backup. Options to consider at production rollout:
- A scheduled Worker that walks the broker API and writes JSON to R2.
- Treat the broker as a CI gate only; keep consumer/provider pacts reproducible from CI artefacts so a broker loss is recoverable.

### Scheduled verification runs / reminders
Not implemented. The broker stores verification results passively; it does not remind providers that a consumer's pact is unverified.

### Multi-tenant or per-team auth
Single bearer token. No scoped tokens, per-team isolation, or audit log of who published what. Suitable for a single-org deployment.

## Test coverage

### Tier 1 suite (landed in v1.1.0)
Integration + unit tests live under `test/` — auth middleware, input validation, core pact flow, matrix / can-i-deploy, for-verification selectors, HAL builder. 82 tests + 2 skipped. CI drops `--passWithNoTests`; failing tests now block merges.

### Tier 2 follow-ups
- **Env-toggle auth cases** — `ALLOW_PUBLIC_READ=true` happy path and `PACT_BROKER_TOKEN` too-short → 500. Mutating `env` from the test scope doesn't propagate into the Worker's env. Needs a separate vitest project (or a second config file) with its own `miniflare.bindings`. Two tests skipped in `test/auth.test.ts` with TODOs.
- **Tags — deep behavior.** Add/remove tag idempotency, tag-on-nonexistent-version, tag name collisions.
- **Verifications — edge cases.** Multiple verifications per pact, latest-verification selection, success-after-failure.
- **Environments + deployments — in depth.** PUT/GET/DELETE env, deploy + undeploy, `isVersionDeployed`, cross-environment `deployed` selector.
- **Selector combinations in `for-verification`.** Multiple selectors on one request, pending-flag handling, notices content assertions.
- **Coverage reporting.** `--coverage` + GH job summary upload.

### Durable-object state isolation note
`@cloudflare/vitest-pool-workers` defaults to `isolatedStorage: true`, giving each test a fresh DO namespace. If a future test file needs to share state across tests (e.g. a large setup in `beforeAll`), scope state with unique pacticipant names (current pattern in `for-verification.test.ts`).

## Not goals (intentionally scoped out)

- **Deploy-to-Cloudflare button.** Conflicts with the IaC-only invariant — all prod changes flow through Terraform.
- **Replicating the reference broker's exact internal schema.** This broker aims for client-wire compatibility (`pact-broker-client` works against it), not internal SQL compatibility.
- **Horizontal scaling of the Durable Object.** Single-instance-per-broker is intentional; the workload is CI-volume, not user traffic, and DO-local SQLite is plenty.
