# pact-broker-workers

A lightweight Pact Broker implementation for Cloudflare Workers using Durable Objects for persistent storage.

## Overview

This project provides core Pact Broker functionality on Cloudflare's edge network. It uses a single SQLite-backed Durable Object for zero-latency data access and Drizzle ORM for type-safe queries.

### Architecture

```
Cloudflare Worker
├── Hono Router
│   ├── Auth Middleware (Bearer token)
│   └── API Routes
│
└── PactBrokerDO (Durable Object)
    └── SQLite Database
        ├── pacticipants
        ├── versions
        ├── tags
        ├── pacts
        └── verifications
```

### Features

- SQLite storage via Durable Objects (zero network latency)
- HAL-style API responses for `pact-broker-client` compatibility
- Bearer token authentication
- Pact publishing and retrieval
- Version tagging
- Verification result tracking
- Matrix queries and can-i-deploy checks

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm
- Cloudflare account

### Local Development

```bash
git clone https://github.com/bison-digital/pact-broker-workers.git
cd pact-broker-workers
pnpm install
cp .dev.vars.example .dev.vars  # Set PACT_BROKER_TOKEN
pnpm dev
```

### Deployment

```bash
npx wrangler login
npx wrangler secret put PACT_BROKER_TOKEN
pnpm deploy
```

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PACT_BROKER_TOKEN` | Bearer token for authentication | Required |
| `ALLOW_PUBLIC_READ` | Allow unauthenticated GET requests | `"false"` |

## API Reference

All endpoints require `Authorization: Bearer <token>` header unless `ALLOW_PUBLIC_READ=true`.

### Authentication

Requests without valid authentication return:

```json
{"error": "Unauthorized", "message": "Missing Authorization header"}
```

### Pacts

#### Publish Pact

```
PUT /pacts/provider/{provider}/consumer/{consumer}/version/{version}
```

Request body:
```json
{
  "consumer": {"name": "string"},
  "provider": {"name": "string"},
  "interactions": [],
  "metadata": {"pactSpecification": {"version": "2.0.0"}}
}
```

Response `201 Created` / `200 OK`:
```json
{
  "consumer": {"name": "string"},
  "provider": {"name": "string"},
  "consumerVersion": "string",
  "contentSha": "string",
  "createdAt": "string",
  "interactions": [],
  "_links": {}
}
```

#### Retrieve Pacts

| Endpoint | Description |
|----------|-------------|
| `GET /pacts/provider/{provider}/consumer/{consumer}/latest` | Latest pact |
| `GET /pacts/provider/{provider}/consumer/{consumer}/latest/{tag}` | Latest pact for tag |
| `GET /pacts/provider/{provider}/consumer/{consumer}/version/{version}` | Specific version |
| `GET /pacts/provider/{provider}/latest` | All latest pacts for provider |
| `GET /pacts/latest` | All latest pacts |

### Pacticipants

| Endpoint | Description |
|----------|-------------|
| `GET /pacticipants` | List all |
| `GET /pacticipants/{name}` | Get one |
| `GET /pacticipants/{name}/versions` | List versions |
| `GET /pacticipants/{name}/versions/{version}` | Get version |

### Tags

```
PUT /pacticipants/{name}/versions/{version}/tags/{tag}
```

Response `201 Created`:
```json
{
  "name": "string",
  "createdAt": "string",
  "_links": {}
}
```

```
GET /pacticipants/{name}/versions/{version}/tags
```

### Verifications

```
POST /pacts/provider/{provider}/consumer/{consumer}/pact-version/{sha}/verification-results
```

Request body:
```json
{
  "success": true,
  "providerApplicationVersion": "string",
  "buildUrl": "string"
}
```

Response `201 Created`:
```json
{
  "success": true,
  "providerApplicationVersion": "string",
  "buildUrl": "string",
  "verifiedAt": "string",
  "_links": {}
}
```

### Matrix and Can-I-Deploy

```
GET /matrix?pacticipant={name}&version={version}
GET /can-i-deploy?pacticipant={name}&version={version}&to={tag}
```

Response:
```json
{
  "summary": {
    "deployable": true,
    "reason": "All pacts verified successfully"
  },
  "matrix": [
    {
      "consumer": {"name": "string", "version": "string"},
      "provider": {"name": "string", "version": null},
      "pactVersion": {"sha": "string"},
      "verificationResult": {"success": true, "verifiedAt": "string"}
    }
  ],
  "_links": {}
}
```

### Health

```
GET /health
```

Response `200 OK`:
```json
{"status": "ok"}
```

No authentication required.

## Usage with pact-broker-client

```bash
# Publish
pact-broker publish ./pacts \
  --consumer-app-version 1.0.0 \
  --broker-base-url https://your-worker.workers.dev \
  --broker-token $TOKEN

# Can I Deploy
pact-broker can-i-deploy \
  --pacticipant my-consumer \
  --version 1.0.0 \
  --to prod \
  --broker-base-url https://your-worker.workers.dev \
  --broker-token $TOKEN
```

## Development

```bash
pnpm dev        # Start dev server
pnpm typecheck  # Type checking
pnpm test       # Run tests
pnpm format     # Format code
```

## Limitations

Not implemented:
- Webhooks
- HAL Browser UI
- Environments (use tags)
- Matrix badge endpoint

## License

MIT
