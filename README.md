# pact-broker-workers

A lightweight, edge-native [Pact Broker](https://docs.pact.io/pact_broker) built with [Hono](https://hono.dev), TypeScript, and [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/).

## Features

- Zero-latency SQLite storage via Durable Objects
- HAL-style API responses compatible with `pact-broker-client`
- Bearer token authentication
- Core Pact Broker functionality:
  - Publish and retrieve pacts
  - Version and tag management
  - Verification results
  - Matrix queries
  - Can-I-Deploy checks

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm (or npm/yarn)
- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works!)

### Local Development

```bash
# Clone the repository
git clone https://github.com/your-username/pact-broker-workers.git
cd pact-broker-workers

# Install dependencies
pnpm install

# Create local secrets file
cp .dev.vars.example .dev.vars
# Edit .dev.vars and set your PACT_BROKER_TOKEN

# Start the dev server
pnpm dev
```

### Deploy to Cloudflare

```bash
# Login to Cloudflare
npx wrangler login

# Set your auth token as a secret
npx wrangler secret put PACT_BROKER_TOKEN

# Deploy!
pnpm deploy
```

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PACT_BROKER_TOKEN` | Bearer token for API authentication | Yes |
| `ALLOW_PUBLIC_READ` | Set to `"true"` to allow unauthenticated GET requests | No (default: `"false"`) |

### wrangler.jsonc

The main configuration file. Key settings:

- `name`: Your worker name (appears in the URL)
- `compatibility_date`: Cloudflare Workers compatibility date
- `durable_objects.bindings`: DO binding configuration

## API Endpoints

All endpoints require `Authorization: Bearer <token>` header (unless `ALLOW_PUBLIC_READ=true` for GET requests).

### Pacts

| Method | Endpoint | Description |
|--------|----------|-------------|
| `PUT` | `/pacts/provider/{provider}/consumer/{consumer}/version/{version}` | Publish a pact |
| `GET` | `/pacts/provider/{provider}/consumer/{consumer}/latest` | Get latest pact |
| `GET` | `/pacts/provider/{provider}/consumer/{consumer}/latest/{tag}` | Get latest pact for tag |
| `GET` | `/pacts/provider/{provider}/consumer/{consumer}/version/{version}` | Get specific version |
| `GET` | `/pacts/provider/{provider}/latest` | Get all latest pacts for provider |
| `GET` | `/pacts/latest` | Get all latest pacts |

### Pacticipants & Versions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/pacticipants` | List all pacticipants |
| `GET` | `/pacticipants/{name}` | Get pacticipant details |
| `GET` | `/pacticipants/{name}/versions` | List versions |
| `GET` | `/pacticipants/{name}/versions/{version}` | Get version details |
| `PUT` | `/pacticipants/{name}/versions/{version}/tags/{tag}` | Tag a version |
| `GET` | `/pacticipants/{name}/versions/{version}/tags` | Get tags for version |

### Verifications

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/pacts/provider/{provider}/consumer/{consumer}/pact-version/{sha}/verification-results` | Publish verification |

### Matrix & Can-I-Deploy

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/matrix?pacticipant={name}&version={version}` | Query verification matrix |
| `GET` | `/can-i-deploy?pacticipant={name}&version={version}&to={tag}` | Check deployment safety |

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check (no auth required) |
| `GET` | `/` | Index with HAL links |

## Usage Examples

### With pact-broker-client CLI

```bash
# Publish a pact
pact-broker publish ./pacts \
  --consumer-app-version 1.0.0 \
  --broker-base-url https://your-worker.your-subdomain.workers.dev \
  --broker-token YOUR_TOKEN

# Can I deploy?
pact-broker can-i-deploy \
  --pacticipant my-consumer \
  --version 1.0.0 \
  --to-environment production \
  --broker-base-url https://your-worker.your-subdomain.workers.dev \
  --broker-token YOUR_TOKEN
```

### With curl

```bash
# Set your broker URL and token
BROKER_URL="http://localhost:9090"
TOKEN="your-token"

# Publish a pact
curl -X PUT \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "consumer": {"name": "my-consumer"},
    "provider": {"name": "my-provider"},
    "interactions": [
      {
        "description": "a request for users",
        "request": {"method": "GET", "path": "/users"},
        "response": {"status": 200, "body": []}
      }
    ],
    "metadata": {"pactSpecification": {"version": "2.0.0"}}
  }' \
  "$BROKER_URL/pacts/provider/my-provider/consumer/my-consumer/version/1.0.0"

# Get latest pact
curl -H "Authorization: Bearer $TOKEN" \
  "$BROKER_URL/pacts/provider/my-provider/consumer/my-consumer/latest"

# Tag a version
curl -X PUT \
  -H "Authorization: Bearer $TOKEN" \
  "$BROKER_URL/pacticipants/my-consumer/versions/1.0.0/tags/main"

# Publish verification result
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"success": true, "providerApplicationVersion": "2.0.0"}' \
  "$BROKER_URL/pacts/provider/my-provider/consumer/my-consumer/pact-version/PACT_SHA/verification-results"

# Can I deploy?
curl -H "Authorization: Bearer $TOKEN" \
  "$BROKER_URL/can-i-deploy?pacticipant=my-consumer&version=1.0.0"
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Cloudflare Worker                      │
│  ┌─────────────────────────────────────────────────┐   │
│  │                  Hono Router                     │   │
│  │  - Auth middleware (Bearer token)               │   │
│  │  - API routes                                   │   │
│  └─────────────────────────────────────────────────┘   │
│                          │                              │
│                          │ RPC                          │
│                          ▼                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │           PactBrokerDO (Durable Object)         │   │
│  │  ┌───────────────────────────────────────────┐  │   │
│  │  │          SQLite (embedded)                │  │   │
│  │  │  - pacticipants, versions, tags           │  │   │
│  │  │  - pacts, verifications                   │  │   │
│  │  └───────────────────────────────────────────┘  │   │
│  │  Drizzle ORM for type-safe queries              │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Development

```bash
# Run type checks
pnpm typecheck

# Run tests
pnpm test

# Format code
pnpm format
```

## Limitations

This is a lightweight implementation focused on core functionality. Not yet implemented:

- Webhooks
- HAL Browser UI
- Environments (use tags instead)
- Branches (basic support via query param)
- Matrix badge endpoint
- Pact verification webhook triggers

## Contributing

Contributions welcome! Please open an issue or PR.

## License

MIT
