# Pact publish order — consumer-first for any contract change

For any change that extends or modifies the API contract, **publish the
new consumer pact first**, then open the provider PR. Doing it in the
reverse order silently bypasses the PR-level pact gate.

This document is operator-facing: it describes the workflow your
consumer and provider teams should follow when this broker is the gate
between them.

## Why ordering matters

A typical setup has two distinct pact-verification jobs in the
provider's CI. They look similar in CI logs but mean different things.

| Job                                  | Workflow                | Targets                             | Gates? |
| ------------------------------------ | ----------------------- | ----------------------------------- | ------ |
| Pact verify (per-PR gate)            | the provider's PR check | the PR's preview / ephemeral build  | **Yes — blocks merge on failure** |
| Pact provider verification (advisory) | post-deploy job         | staging or production               | Often no — `continue-on-error: true` |

Both jobs pull the **latest** consumer pact from this broker at the
moment the job runs. Without `can-i-deploy` gating between consumer and
provider versions, the order in which the consumer pact lands on the
broker decides what version the provider's PR is gated against.

That means:

- If the new pact is **not yet on the broker** when the provider PR's
  gate runs, the gate verifies the PR's preview against the **old**
  pact. For additive changes (most contract extensions) the new
  provider satisfies the old pact trivially → green gate → merge →
  staging deploys → broken code ships.
- If the new pact **is on the broker** when the gate runs, the gate
  verifies against the new contract surface. A missing field, type
  mismatch, or accidentally-removed key fails the gate.

The post-deploy advisory job updates the broker's matrix view but does
not protect staging from drift, because it runs after the deploy and is
typically non-blocking.

## The correct sequence

For any change that touches:

- The provider's API contract (TypeSpec / OpenAPI / Zod / response
  schemas)
- The consumer's pact fixtures or factories

…the order is:

1. **Consumer: prepare and publish the new pact.**

   ```bash
   # Run from the consumer's repo
   # 1. Commit the contract-extension changes
   git add <consumer-test-fixtures-or-schemas>
   git commit -m "..."

   # 2. Regenerate the pact JSON file from the consumer tests
   #    (exact command depends on the consumer's tooling — phpunit,
   #    jest, etc.)

   # 3. Publish to the broker
   #    Using pact-broker-client:
   pact-broker-client publish path/to/pact.json \
     --broker-base-url https://${BROKER_HOSTNAME} \
     --broker-token $PACT_BROKER_TOKEN \
     --consumer-app-version $(git rev-parse HEAD) \
     --branch $(git branch --show-current)
   ```

2. **Confirm the broker has it.**

   ```bash
   curl -s -H "Authorization: Bearer $PACT_BROKER_TOKEN" \
     "https://${BROKER_HOSTNAME}/pacts/provider/${PROVIDER}/consumer/${CONSUMER}/latest" \
     | jq -r '.metadata.consumerVersion'
   # should match the SHA that was just published
   ```

3. **Then open the provider PR.**

   ```bash
   # Run from the provider's repo
   git checkout -b feature/contract-change origin/main
   # ... make changes ...
   git push -u origin feature/contract-change
   gh pr create ...
   ```

   The PR's pact gate pulls the broker's latest pact (now the new one)
   and verifies the PR's build against it. A drift between the new
   pact and the PR's provider code blocks the merge.

## Doing it the wrong way around (worked example)

Recorded as the canonical mistake.

A real change shipped in this layout:

- Provider TypeSpec extended on a consumer-driven feature (additive).
- Consumer schemas regenerated, fixtures extended, factory cleanup.
- The provider PR was opened **before** the new consumer pact was
  published. PR gate ran against the broker's pre-existing pacts (older
  contract surface). The new provider satisfied them trivially because
  the changes were additive optionals → green gate.
- Merge → staging deploy → post-deploy advisory ran → still verified
  against the older pacts (broker hadn't been updated yet) → green.
- Consumer pact then published. Post-deploy advisory job rerun against
  staging → verified the new contract surface → green.

It worked out fine because the changes were genuinely
backwards-compatible. But the gate did **not** protect against a
hypothetical case where the new provider had a missed field or type
mismatch — staging would have shipped that, and only the rerun would
have caught it.

## Recommended hardening

If you operate this broker and care about closing the loop, two
options — pick one:

- **Add a `can-i-deploy` step to the provider's `deploy-staging.yml`**
  that fails closed if the broker's latest pact has not been verified
  against the candidate provider version:
  ```bash
  pact-broker-client can-i-deploy \
    --pacticipant ${PROVIDER} \
    --version ${GIT_SHA} \
    --to-environment staging \
    --broker-base-url https://${BROKER_HOSTNAME} \
    --broker-token $PACT_BROKER_TOKEN
  ```
- **Make the post-deploy advisory job non-advisory** (drop
  `continue-on-error: true`) once the broker matrix is reliable enough
  that gating on it won't false-positive.

Either change closes the loop so a contract regression can't reach
staging silently.

## Cross-references

- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — the broker's API surface
  and matrix logic.
- The `can-i-deploy` endpoint:
  `GET /can-i-deploy?pacticipant=...&version=...&to=...`. Returns
  HTTP 200 + `{"summary": {"deployable": true|false, ...}}`.
- The `pact-broker-client` CLI is the canonical tool for publishing,
  retrieving, and gating: <https://github.com/pact-foundation/pact_broker-client>.
