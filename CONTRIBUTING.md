# Contributing

## Local workflow

```bash
pnpm install --frozen-lockfile
pnpm run dev                  # renders wrangler.jsonc then runs wrangler dev
pnpm run lint                 # eslint
pnpm run format               # prettier write
pnpm run format:check         # prettier check
pnpm run typecheck            # tsc --noEmit
pnpm run test:run             # vitest run (via @cloudflare/vitest-pool-workers)
```

Local dev requires a `.dev.vars` file with at minimum:

```
PACT_BROKER_TOKEN=local-dev-token
```

See `.dev.vars.example`.

`wrangler.jsonc` is generated — on production it's rendered by Terraform
(`infra/wrangler.tf`), locally it's rendered by `scripts/render-wrangler-dev.mjs`
(the `predev` / `predeploy` hooks in `package.json` do this automatically).
Edit `wrangler.jsonc.tmpl` for any static config changes.

## Pull-request flow

1. Branch off `main`.
2. Keep PRs focused — one concern per PR. Squash-merge style; the branch
   commits can be scrappy but the squashed message is what ships.
3. If you touch `infra/`: include a `terraform plan` summary in the PR
   description. CI will also post one targeting staging.
4. Wait for CI green. On merge to `main`, `deploy-staging.yml` auto-applies
   to the staging workspace (for consumers who have staging wired up).

## Code style

- **Lint**: `eslint`. Don't disable rules inline without a short comment on
  why.
- **Format**: `prettier`. Enforced via `format:check` in CI.
- **Types**: `tsc --noEmit`. `strict: true` + `noUncheckedIndexedAccess` are
  on by default; don't weaken them. Avoid `any` unless you've documented a
  concrete reason in a single-line comment next to the cast.
- **Comments**: prefer well-named code over explanatory comments. When a
  comment is warranted, it describes *why*, not *what*.
- **Tests**: co-locate unit tests as `*.test.ts` beside the code they cover.

## Infrastructure changes

The `infra/` directory must stay **operator-agnostic**. No bison/cupa/other
customer strings in committed files. Everything operator-specific flows
through `TF_VAR_*` (see [`infra/README.md`](infra/README.md)).

If you're tempted to hardcode a value in HCL, it probably belongs in
`variables.tf` as a `TF_VAR_*`. Exception: values that are genuinely
product-wide (the Durable Object class name, the KV binding layout) live
in `wrangler.jsonc.tmpl` / `infra/main.tf` directly.

## Downstream forks

This repo is the upstream for deployments of the Pact Broker. If your
organisation maintains a deployment, keep a downstream fork and pull
updates from here:

```bash
git remote add upstream git@github.com:bison-digital/pact-broker-workers.git
git fetch upstream
git merge upstream/main          # or upstream/v1.2.3 for a specific tag
```

The fork holds only your operator-specific config — `infra/backend.hcl`,
`.envrc`, and GitHub Environment vars/secrets. Nothing committed upstream
should need patching downstream.

## Questions

Open an issue or discussion.
