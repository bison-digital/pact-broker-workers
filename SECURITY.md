# Security model

## Reporting a vulnerability

Please **do not open a public issue** for suspected vulnerabilities. Use GitHub's private vulnerability reporting on this repo's Security tab, with the smallest reproducible case you can share.

## Scope

This policy covers the Hono Worker (`src/`), the Durable Object schema (`src/db/`), and the optional Cloudflare Access module (`infra/`). Out of scope: upstream Cloudflare infrastructure itself, and the consumer applications that publish pacts.

## Hardening in place

### Authentication and access control

- **Bearer-token middleware.** The Worker accepts one `PACT_BROKER_TOKEN`, held only as a Cloudflare Worker secret, validated with a constant-time compare (`src/middleware/auth.ts`). Single shared token is the reference Pact Broker model and is fine for single-org deployments; multi-team deployments would need scoped tokens + an audit table (see `BACKLOG.md`).
- **Optional edge perimeter.** A Cloudflare Access service-token policy can be put in front of the custom domain (`infra/access.tf`). When enabled (`access_policy_mode = "pinned_token"` or `"any_valid_token"`), unauthenticated traffic is rejected before reaching the Worker; the bearer-token middleware then runs as an independent second factor. The default `access_policy_mode = ""` provisions no Access resources and leaves the broker behind only the Worker's bearer-token check.
- **`ALLOW_PUBLIC_READ` kill-switch (default off).** Setting `allow_public_read = "true"` exposes all `GET` / `HEAD` requests without auth — intended for a public read tier. The default keeps it off; audit your env vars before applying.

### Request validation

- **Path parameters** on every route are validated via the schemas in `src/lib/validation.ts`. Out-of-format input returns `400` with a generic envelope — error messages do not echo the supplied value.
- **Body size** is enforced via Hono's streaming `bodyLimit` middleware — chunked encoding and malformed Content-Length cannot bypass.
- **Content-Type** must be `application/json` on `POST`/`PUT`.

### CORS

The CORS middleware in `src/index.ts` reads a comma-separated `CORS_ALLOWED_ORIGINS` env var. Origin echoing happens only when the request Origin is on the allowlist.

### Error envelopes

The global handler (`src/index.ts`) returns a sanitised `{error, message, requestId}` shape; full detail is logged server-side only. The `Authorization` header is explicitly filtered from the access log.

### Secrets

`PACT_BROKER_TOKEN` is a Cloudflare Worker secret and lives nowhere else — not in git, not in Terraform state, and not in CI. It is seeded once, out of band:

```bash
openssl rand -hex 32 | wrangler secret put PACT_BROKER_TOKEN --name <worker-name>
```

Worker secrets are durable across deploys, so nothing needs to re-push the value. `wrangler.jsonc.tmpl` declares it under `secrets.required`, which carries the name but never the value, so `wrangler deploy` fails if a Worker was never seeded rather than shipping a broker that rejects every request.

### Dependencies

`.github/dependabot.yml` watches the npm and github-actions ecosystems weekly, grouped by minor/patch and by major. Major-version bumps require a full local verify loop green before merge.
