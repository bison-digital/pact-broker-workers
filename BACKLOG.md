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

### Vitest integration suite for the Pact API
`@cloudflare/vitest-pool-workers` is wired in `vitest.config.ts` and CI runs `pnpm run test:run` — but no actual tests are written. The `--passWithNoTests` flag keeps CI green in the meantime. A production-quality suite would cover:
- Happy-path publish / retrieve / tag / deploy flows
- Consumer version selectors (latest, tag, branch, mainBranch, deployed)
- `for-verification` selector matching
- Matrix + `can-i-deploy` gating logic
- 401/400/404 error paths
- HAL-link shape regressions

## Not goals (intentionally scoped out)

- **Deploy-to-Cloudflare button.** Conflicts with the IaC-only invariant — all prod changes flow through Terraform.
- **Replicating the reference broker's exact internal schema.** This broker aims for client-wire compatibility (`pact-broker-client` works against it), not internal SQL compatibility.
- **Horizontal scaling of the Durable Object.** Single-instance-per-broker is intentional; the workload is CI-volume, not user traffic, and DO-local SQLite is plenty.
