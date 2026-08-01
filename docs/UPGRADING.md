# Upgrading from upstream

This repository is the **upstream** for the Pact Broker product. If you
operate a fork of it (e.g. for your organisation's deployment), this
document is the playbook for pulling new releases from upstream into
your fork.

If you're working *on* the upstream itself, see
[`CONTRIBUTING.md`](../CONTRIBUTING.md#releases) instead — that covers
how releases are cut and tagged.

## How upstream is released

- `bison-digital/pact-broker-workers` cuts tagged releases on the
  `main` branch using semver. Tags look like `v1.2.0`.
- Each tag has a corresponding GitHub Release whose body comes from
  the [`CHANGELOG.md`](../CHANGELOG.md) entry for that version.
- Releases are the **canonical announcement** — there is no separate
  notification channel. Operators watch the
  [Releases page](https://github.com/bison-digital/pact-broker-workers/releases)
  (the "Watch → Custom → Releases" option on GitHub does this).

Semver policy:

- **Major** — breaking changes to the operator-facing config surface
  (GitHub Actions vars/secrets, the environment variables the config
  renderer reads, the bearer-token shape, the HAL API shape).
- **Minor** — new features. Operators can pull at their own cadence.
- **Patch** — bug fixes and security patches. Pull promptly.

## One-time setup (each operator fork)

When you first fork the upstream, point a remote at it so you can
fetch tagged releases:

```bash
git remote add upstream git@github.com:bison-digital/pact-broker-workers.git
git fetch upstream --tags
```

Verify:

```bash
git remote -v
# origin    git@github.com:<your-org>/<your-fork>.git (fetch)
# origin    git@github.com:<your-org>/<your-fork>.git (push)
# upstream  git@github.com:bison-digital/pact-broker-workers.git (fetch)
# upstream  git@github.com:bison-digital/pact-broker-workers.git (push)
```

You only do this once. Going forward, `git fetch upstream --tags`
brings in any new tags published since you last looked.

## Pulling a release

The whole flow takes ~5 minutes for a typical release.

```bash
# 1. See what's available
git fetch upstream --tags
git tag -l 'v*' --sort=-v:refname | head -5

# 2. Read the release notes
#    Open https://github.com/bison-digital/pact-broker-workers/releases/tag/v1.3.0
#    Pay attention to:
#    - Anything in "Changed" — may need operator action
#    - "Not included" — sets expectations
#    - Migration notes for major-version bumps

# 3. Branch off your main and merge the tag
git checkout main && git pull origin main
git checkout -b sync/upstream-v1.3.0
git merge v1.3.0    # the tag is the merge target

# 4. Resolve conflicts if any. See "Common conflict zones" below.

# 5. Run the local verify loop (same one CI uses)
pnpm install --frozen-lockfile
pnpm run lint
pnpm run format:check
pnpm run type-check
pnpm run test:run

# 6. Push and open a PR against your own main
git push -u origin sync/upstream-v1.3.0
gh pr create \
  --title "Sync upstream v1.3.0" \
  --body "Merges bison-digital/pact-broker-workers v1.3.0. See upstream release notes: https://github.com/bison-digital/pact-broker-workers/releases/tag/v1.3.0"
```

CI on the PR runs the full check suite, plus a `config-renders` job that
renders `wrangler.jsonc` with operator-shaped values and dry-runs a deploy.
**Read the dry-run's binding list** — if the upstream release added or
renamed a binding, that is where you will see it before it reaches your
Worker.

After merge, your `deploy-staging.yml` runs automatically against the
new SHA. Sanity-check staging (`/health`, `/ui`, a couple of pact
publishes from a test consumer if you have one). When happy, dispatch
`deploy-production.yml` manually as you would for any change.

## Common conflict zones

Most syncs are conflict-free. The places conflicts do show up:

### `wrangler.jsonc.tmpl`

Upstream periodically bumps `compatibility_date`, adds new bindings, or
adjusts the migrations block. Your fork shouldn't have edits here in
the first place — the file is operator-agnostic by design and operator
config flows through environment variables read by
`scripts/render-wrangler-config.mjs`, not template edits.

If a conflict appears here, **take upstream's version verbatim**. If
you've genuinely customised the template (don't), the right pattern is
to file an upstream issue describing why so the customisation can land
upstream and become reusable.

### `scripts/render-wrangler-config.mjs`

Upstream may add new environment variables here. Your fork shouldn't have
edits in this file — every operator-specific value is an env var with a
local-dev default, so there is nothing to customise.

If upstream adds a new variable, resolution is two-step:

1. Take upstream's version verbatim.
2. After merging, set the new variable in your `staging` and `production`
   GitHub Environments if you need a non-default value. The renderer's
   defaults are chosen so that *not* setting it is always safe.

The release notes call out new vars in the "Changed" section — check
there before merging.

### `.github/workflows/`

Two different things live here, and they merge differently.

`ci.yml` is the upstream project's own gate. It holds no credentials and
needs no configuration, so take upstream's version verbatim — a conflict
here means you edited it, which you shouldn't.

`deploy-staging.yml` and `deploy-production.yml` are a **reference
implementation**. Upstream keeps them operator-agnostic — every value comes
from GitHub Environment vars, and they fail fast with a named-variable error
when unconfigured, so they are inert on forks that haven't set them up.

If you have deliberately customised the deploy workflows for your
organisation (extra approval steps, a different notification, deploying from
a different trigger), that is legitimate — this is the one place a fork is
expected to diverge. Merge upstream's changes selectively and keep your
customisations. Everywhere else, take upstream verbatim.

### `package.json` / `pnpm-lock.yaml`

Always take upstream's version. Don't add operator-specific dependencies
to a fork — that's a strong signal you should fork upstream's design and
upstream the change instead.

### `CHANGELOG.md`

Should never conflict — your fork shouldn't append entries to it.
Upstream owns the changelog. If a conflict shows up here, take
upstream's version.

## Verification after merging

Before pushing the sync PR, run the full local verify loop. This is the
same loop CI runs:

```bash
pnpm install --frozen-lockfile
pnpm run lint
pnpm run format:check
pnpm run type-check
pnpm run test:run
```

For deploy-config changes, also render and dry-run with your own values:

```bash
DOMAIN=pact-broker-staging.your-domain.com \
WORKER_NAME=pact-broker-staging \
CLOUDFLARE_ACCOUNT_ID=… \
  pnpm run render-config

# --dry-run needs no credentials and contacts nothing
pnpm exec wrangler deploy --dry-run --outdir /tmp/preview
```

If anything fails locally, fix it on the sync branch before pushing.
The PR's CI will run the same checks; failing at PR-level is fine but
slower than catching it locally.

## When a release goes wrong on staging

If the staging deploy of a sync goes red, the cleanest recovery is to
revert the sync merge:

```bash
git revert -m 1 <sync-merge-sha>
git push
```

This rolls staging back to the pre-sync state. Re-deploy
`deploy-staging.yml` against the reverted main to confirm. Then go back
and figure out what the sync needs (file an upstream issue if it's a
genuine upstream regression; otherwise fix forward and re-sync).

## When you've fallen many releases behind

Pulling `v1.5.0` directly into a fork that's stuck on `v1.0.0` is fine
in principle but can compound conflicts. Two-step it:

```bash
git merge v1.1.0
# resolve, verify, commit
git merge v1.2.0
# resolve, verify, commit
# ... etc
```

Each intermediate tag is a smaller diff, and the per-step conflicts
are easier to reason about. You can squash-merge the resulting branch
when opening the PR if you don't want the chain in your history.

## Why no automated sync workflow

Pulling upstream is rare enough (every few weeks at most) and the
review overhead of a sync PR is non-trivial enough (read the release
notes, eyeball the plan diff, sanity-check staging) that automating
the trigger doesn't save much. Operators preferred a reliable manual
playbook over a fragile automation. If that calculus changes, the
right path is a `chore: sync upstream` GH Action that opens the same
PR this playbook produces — design is straightforward, just deferred.
