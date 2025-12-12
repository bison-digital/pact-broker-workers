# CLAUDE.md

Project context for Claude Code.

## Stack

| Component | Technology |
|-----------|------------|
| Runtime | Cloudflare Workers |
| Framework | Hono |
| Database | SQLite (Durable Objects) |
| ORM | Drizzle |
| Language | TypeScript |
| Package Manager | pnpm |

## Commands

```bash
pnpm dev        # Dev server (port 9090)
pnpm deploy     # Deploy to Cloudflare
pnpm typecheck  # TypeScript checks
pnpm test       # Run tests
pnpm format     # Prettier
```

## Structure

```
src/
├── index.ts                    # Entry point
├── durable-objects/
│   └── pact-broker.ts          # DO with all DB operations
├── routes/
│   ├── index.ts                # Health, root
│   ├── pacts.ts                # Pact CRUD
│   ├── pacticipants.ts         # Pacticipants, versions, tags
│   ├── verifications.ts        # Verification results
│   └── matrix.ts               # Matrix, can-i-deploy
├── db/
│   ├── schema.ts               # Drizzle schema
│   └── migrations.ts           # SQLite migrations
├── middleware/
│   └── auth.ts                 # Bearer token auth
├── services/
│   └── hal.ts                  # HAL link builder
└── types/
    └── index.ts                # Type definitions
```

## Conventions

### Code Style
- Strict TypeScript
- Explicit return types on public functions
- `interface` over `type` for objects
- Drizzle inferred types (`$inferSelect`, `$inferInsert`)

### Naming
- Files: `kebab-case.ts`
- Types: `PascalCase`
- Functions/vars: `camelCase`
- DB columns: `snake_case`

### API
- HAL `_links` in all responses
- Error format: `{ error: string, message: string }`
- Status codes: 201 (created), 200 (ok), 404 (not found), 401 (unauthorized)

## Git

### Commits

Format: `<type>(<scope>): <description>`

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`

Scopes: `api`, `do`, `db`, `auth`, `deps`

Rules:
- Present tense, imperative mood
- No trailing period
- 72 char limit on subject

### Tags

Semantic versioning without `v` prefix: `1.0.0`, `1.2.3`

```bash
git tag -a X.Y.Z -m "Release X.Y.Z"
git push origin X.Y.Z
```

### Branches

Format: `<type>/<description>`

Examples: `feat/webhooks`, `fix/matrix-query`

## Testing

```bash
pnpm dev
curl -H "Authorization: Bearer local-dev-token" http://localhost:9090/health
```

Token in `.dev.vars`: `PACT_BROKER_TOKEN=local-dev-token`

## Deployment

```bash
npx wrangler login
npx wrangler secret put PACT_BROKER_TOKEN
pnpm deploy
```
