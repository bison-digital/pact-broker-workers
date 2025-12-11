# CLAUDE.md

Project-specific instructions for Claude Code.

## Project Overview

**pact-broker-workers** is a lightweight Pact Broker implementation running on Cloudflare Workers with Durable Objects for storage.

### Tech Stack
- **Runtime**: Cloudflare Workers
- **Framework**: Hono
- **Database**: SQLite via Durable Objects
- **ORM**: Drizzle
- **Language**: TypeScript
- **Package Manager**: pnpm

## Development Commands

```bash
pnpm dev          # Start local dev server (port 9090)
pnpm deploy       # Deploy to Cloudflare
pnpm typecheck    # Run TypeScript checks
pnpm test         # Run tests
pnpm format       # Format code with Prettier
```

## Project Structure

```
src/
├── index.ts                    # Worker entry point, Hono app setup
├── durable-objects/
│   └── pact-broker.ts          # PactBrokerDO - main business logic
├── routes/
│   ├── index.ts                # Health and root endpoints
│   ├── pacts.ts                # Pact CRUD operations
│   ├── pacticipants.ts         # Pacticipant/version/tag operations
│   ├── verifications.ts        # Verification result endpoints
│   └── matrix.ts               # Matrix and can-i-deploy endpoints
├── db/
│   ├── schema.ts               # Drizzle schema definitions
│   └── migrations.ts           # SQLite migrations
├── middleware/
│   └── auth.ts                 # Bearer token authentication
├── services/
│   └── hal.ts                  # HAL link builder
└── types/
    └── index.ts                # TypeScript type definitions
```

## Key Files

- `wrangler.jsonc` - Cloudflare Workers configuration
- `.dev.vars` - Local development secrets (not committed)
- `src/durable-objects/pact-broker.ts` - All database operations live here

## Coding Conventions

### TypeScript
- Strict mode enabled
- Use explicit return types for public functions
- Prefer `interface` over `type` for object shapes
- Use Drizzle's inferred types (`$inferSelect`, `$inferInsert`)

### API Design
- All responses include HAL `_links` for discoverability
- Use proper HTTP status codes (201 for created, 404 for not found)
- Error responses follow `{ error: string, message: string }` format

### Naming
- Files: kebab-case (`pact-broker.ts`)
- Types/Interfaces: PascalCase (`PactResponse`)
- Functions/Variables: camelCase (`getLatestPact`)
- Database tables: snake_case (`consumer_version_id`)

---

## Git Workflow & SOPs

### Commit Message Format

Use [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

#### Types
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation only
- `style` - Formatting, missing semicolons, etc.
- `refactor` - Code change that neither fixes a bug nor adds a feature
- `perf` - Performance improvement
- `test` - Adding or updating tests
- `build` - Build system or external dependencies
- `ci` - CI configuration
- `chore` - Other changes that don't modify src or test files

#### Scopes (optional)
- `api` - API routes
- `do` - Durable Object
- `db` - Database/schema
- `auth` - Authentication
- `deps` - Dependencies

#### Examples
```
feat(api): add matrix query endpoint

fix(do): handle null verification results in can-i-deploy

docs: update API endpoint documentation

refactor(db): extract common query patterns

chore(deps): update drizzle-orm to 0.38.0
```

### Commit Rules

1. **Atomic commits** - Each commit should represent one logical change
2. **Present tense** - "add feature" not "added feature"
3. **Imperative mood** - "fix bug" not "fixes bug"
4. **No trailing period** - In the subject line
5. **72 character limit** - For subject line
6. **Blank line** - Between subject and body (if body exists)

### Tagging & Releases

#### Version Format
Use semantic versioning without `v` prefix:

```
MAJOR.MINOR.PATCH
```

Examples: `1.0.0`, `1.2.3`, `2.0.0-beta.1`

#### When to Tag
- `MAJOR` - Breaking API changes
- `MINOR` - New features (backward compatible)
- `PATCH` - Bug fixes (backward compatible)

#### Tagging Process
```bash
# Ensure you're on main with clean working directory
git checkout main
git pull origin main
git status  # Should be clean

# Update version in package.json
# Create commit
git add package.json
git commit -m "chore: bump version to X.Y.Z"

# Create annotated tag
git tag -a X.Y.Z -m "Release X.Y.Z"

# Push commit and tag
git push origin main
git push origin X.Y.Z
```

#### Tag Message Format
```
Release X.Y.Z

Highlights:
- Feature A
- Fix for B
- Improvement to C
```

### Branch Naming

```
<type>/<short-description>
```

Examples:
- `feat/webhook-support`
- `fix/matrix-query-timeout`
- `docs/api-examples`
- `refactor/extract-services`

### Pull Request Guidelines

1. **Title**: Use conventional commit format
2. **Description**: Include what changed and why
3. **Link issues**: Reference related issues
4. **Tests**: Ensure tests pass
5. **Review**: Self-review before requesting

---

## Testing

### Local Testing
```bash
# Start dev server
pnpm dev

# Test endpoints
curl -H "Authorization: Bearer local-dev-token" http://localhost:9090/health
```

### Test Token
The local dev token is set in `.dev.vars`:
```
PACT_BROKER_TOKEN=local-dev-token
```

---

## Deployment

### First-time Setup
```bash
npx wrangler login
npx wrangler secret put PACT_BROKER_TOKEN
```

### Deploy
```bash
pnpm deploy
```

### Verify Deployment
```bash
curl https://pact-broker-workers.<subdomain>.workers.dev/health
```
