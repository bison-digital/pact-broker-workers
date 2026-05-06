# Contributing

## Local workflow

```bash
pnpm install --frozen-lockfile
pnpm run dev                  # renders wrangler.jsonc then runs wrangler dev
pnpm run lint                 # oxlint (--deny-warnings)
pnpm run format               # oxfmt write
pnpm run format:check         # oxfmt check
pnpm run type-check           # tsgo --noEmit
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

- **Lint**: `oxlint` with `--deny-warnings`. Config at `.oxlintrc.json`.
  Don't disable rules inline without a short comment on why.
- **Format**: `oxfmt`. Enforced via `format:check` in CI.
- **Types**: `tsgo --noEmit` (TypeScript's native-speed compiler, installed
  as `@typescript/native-preview`). `strict: true` + `noUncheckedIndexedAccess`
  are on by default; don't weaken them. Avoid `any` unless you've documented
  a concrete reason in a single-line comment next to the cast.
- **Comments**: prefer well-named code over explanatory comments. When a
  comment is warranted, it describes *why*, not *what*.
- **Tests**: co-locate unit tests as `*.test.ts` beside the code they cover.

## Infrastructure changes

The `infra/` directory must stay **operator-agnostic**. No organisation-
or deployment-specific strings in committed files. Everything operator-
specific flows through `TF_VAR_*` (see [`infra/README.md`](infra/README.md)).

If you're tempted to hardcode a value in HCL, it probably belongs in
`variables.tf` as a `TF_VAR_*`. Exception: values that are genuinely
product-wide (the Durable Object class name, the KV binding layout) live
in `wrangler.jsonc.tmpl` / `infra/main.tf` directly.

## Downstream forks

This repo is the upstream for deployments of the Pact Broker. Operators
who maintain a deployment keep a downstream fork and pull tagged
releases from here. The full playbook for fork operators lives in
[`docs/UPGRADING.md`](docs/UPGRADING.md).

The fork holds only operator-specific config — `infra/backend.hcl`,
`.envrc`, and GitHub Environment vars/secrets. Nothing committed
upstream should need patching downstream. If you're tempted to commit
something operator-specific to a fork, file an upstream issue first —
the right shape is usually a new `TF_VAR_*` upstream so every operator
benefits.

## Releases

Upstream cuts tagged releases on `main`. Operators watch the
[Releases page](https://github.com/bison-digital/pact-broker-workers/releases)
to know when to sync.

### Semver policy

- **Major** (`v2.0.0`, `v3.0.0`) — breaking changes to the
  operator-facing config surface: Terraform variables, GH Actions
  vars/secrets, env vars, the bearer-token shape, the HAL API shape.
  Operators must read the release notes and may need to update their
  environment config.
- **Minor** (`v1.3.0`, `v1.4.0`) — new features. Backwards-compatible.
  Operators pull at their own cadence.
- **Patch** (`v1.2.1`, `v1.2.2`) — bug fixes and security patches.
  Operators pull promptly.

### When to cut a tag

After a meaningful PR (or set of PRs) merges to `main`. Not every PR
needs a tag. Reasonable rhythms:

- Bundle a few merged PRs into a minor release every 2-4 weeks if
  there's been substantive change.
- Cut a patch immediately for a security fix — don't wait for the
  next minor.
- Tag a major when introducing a breaking config change. Migration
  notes go in the CHANGELOG entry.

### Release procedure

1. **Update `CHANGELOG.md`** with a new entry. Match the existing
   shape: `## X.Y.Z — YYYY-MM-DD`, then `### Added`, `### Changed`,
   `### Not included` (intentional follow-ups). Open this as a PR
   alongside any other content for the release; merge via squash.

2. **Tag from `main`** after the CHANGELOG PR is merged:

   ```bash
   git checkout main && git pull origin main
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```

3. **Cut the GitHub Release.** The body is the CHANGELOG entry for
   this version:

   ```bash
   gh release create vX.Y.Z \
     --title "vX.Y.Z" \
     --notes-from-tag
   ```

   Or paste the CHANGELOG section into the release body via the web
   UI if you prefer. Either way, the release notes for `vX.Y.Z` should
   render the same content as the `## X.Y.Z` block in CHANGELOG.

4. **Bump `package.json`'s `version`** in a follow-up PR if you want
   it to track. Some operators surface this value via
   `process.env.npm_package_version`; others don't care. The CHANGELOG
   and the git tag are the canonical version sources, not
   `package.json`.

### Operator notification

There is no separate notification channel for releases. The GitHub
Releases page is the canonical announcement — operators watch it via
"Watch → Custom → Releases" on the GitHub UI. Don't email or DM
operators about routine releases; the release notes do the work.

For breaking releases, mention the breaking-change set in the
CHANGELOG's `### Changed` heading clearly enough that an operator
skimming the release page will spot it.

## Questions

Open an issue or discussion.
