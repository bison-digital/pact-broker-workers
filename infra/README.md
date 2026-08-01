# Cloudflare Access module (optional)

A Terraform **module** that puts a Cloudflare Access service-token perimeter in
front of the broker's custom domain, so it isn't reachable from the open web.

**It is optional and off by default.** The broker deploys and runs without it —
`wrangler deploy` needs nothing from this directory. If you don't want Access,
you never need Terraform at all.

## Why this isn't run by CI

Your Worker code changes weekly. A security perimeter changes maybe twice a
year. Applying them from the same pipeline means every routine merge can alter
the security boundary — clear one variable and the next unrelated deploy
silently destroys the Access application, reviewed by nobody. It would also
force `Access: Apps and Policies: Edit` onto the deploy credential permanently.

So this is a module, not a root configuration. It declares **no `provider`
block and no `backend` block**: you consume it from your own Terraform, with
your own provider, state and pipeline. We give you the resource definitions;
what runs them is yours.

## What it provisions

Two account-scoped resources, both gated on `access_policy_mode`:

| Resource | Purpose |
| --- | --- |
| `cloudflare_zero_trust_access_policy.broker` | `decision = "non_identity"` — satisfied by a service token, not an interactive login |
| `cloudflare_zero_trust_access_application.broker` | `type = "self_hosted"` on `var.domain`, hidden from the App Launcher |

When enabled, clients must send `CF-Access-Client-Id` and
`CF-Access-Client-Secret` **in addition to** the `Authorization: Bearer` token
the Worker checks. The two layers are independent: Access rejects at the edge,
the Worker's bearer check (`src/middleware/auth.ts`) runs behind it as a second
factor.

## Inputs

| Variable | Required | Notes |
| --- | --- | --- |
| `cloudflare_api_token` | yes | Needs only `Access: Apps and Policies: Edit` |
| `cloudflare_account_id` | yes | Both resources are account-scoped |
| `worker_name` | yes | Names the Access app and policy |
| `domain` | yes | Hostname to protect — the Worker's custom domain |
| `access_policy_mode` | no (default `""`) | `""` \| `pinned_token` \| `any_valid_token` |
| `access_service_token_id` | only when pinned | Service-token UUID |

### `access_policy_mode`

| Value | Effect |
| --- | --- |
| `""` *(default)* | **Off.** Zero resources provisioned. The broker is a plain custom-domain Worker behind its bearer-token check. |
| `"pinned_token"` | **On, strict.** Admits only the one service token in `access_service_token_id`. |
| `"any_valid_token"` | **On, loose.** Admits any service token issued in the account, bounded by the Worker's bearer check behind it. |

With the default, `terraform apply` provisions nothing — the module is a no-op
until you set a mode.

## Usage

```hcl
provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

module "pact_broker_access" {
  source = "github.com/bison-digital/pact-broker-workers//infra?ref=v2.0.0"

  cloudflare_api_token  = var.cloudflare_api_token
  cloudflare_account_id = "your-account-id"
  worker_name           = "pact-broker-production"
  domain                = "pact-broker.your-domain.com"

  access_policy_mode      = "pinned_token"
  access_service_token_id = "your-service-token-uuid"
}
```

Pin `?ref=` to a tag so an upstream change can't alter your perimeter without
you choosing it.

### Issuing the service token

Terraform deliberately does **not** own service tokens. Create one in the
Cloudflare dashboard (Zero Trust → Access → Service Auth) and pass its UUID as
`access_service_token_id`.

This is why the API token above needs only `Access: Apps and Policies: Edit`
and never `Access: Service Tokens: Edit` — the credential that manages the
perimeter cannot mint credentials that pass through it.

## Ordering

Deploy the Worker first so the custom domain exists, then apply this module.
`domain` is a plain string, so Terraform cannot enforce that ordering for you —
pointing an Access application at a hostname that doesn't resolve yet applies
cleanly and simply protects nothing.

## Turning it off

Set `access_policy_mode = ""` and apply. Both resources are destroyed and the
broker falls back to bearer-token auth alone.

Do **not** delete the module from your config to disable it — that orphans the
Access application, leaving the perimeter up with nothing managing it.
