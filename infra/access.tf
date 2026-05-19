# ─── Cloudflare Access (opt-in service-token perimeter) ──────────
#
# Optional second authentication layer in front of the broker's custom
# domain. When access_policy_mode is "" (default), nothing in this file
# is provisioned — the broker stays reachable as a plain custom-domain
# Worker and only the Worker's bearer-token middleware
# (src/middleware/auth.ts) authenticates requests. When the operator
# sets access_policy_mode to "pinned_token" or "any_valid_token", a
# Cloudflare Access application is put in front of the custom domain so
# unauthenticated traffic is rejected at the edge before reaching the
# Worker; the Worker's bearer-token check then runs as an independent
# second factor behind it.
#
# What Terraform owns here: the Access application + its policy.
# What it deliberately does NOT own: the service tokens themselves.
# Issuing and rolling service tokens is a manual operator action (via
# the Cloudflare dashboard or a separate, token-only Terraform pass)
# so the CI Cloudflare API token can be scoped to `Access: Apps and
# Policies: Edit` without granting the credential-minting capability
# `Access: Service Tokens: Edit`.

resource "cloudflare_zero_trust_access_policy" "broker" {
  count      = var.access_policy_mode == "" ? 0 : 1
  account_id = var.cloudflare_account_id
  name       = var.worker_name

  # "non_identity" — policy is satisfied by a valid service token rather
  # than an interactive identity.
  decision = "non_identity"

  # var.access_policy_mode is validated to "pinned_token" or
  # "any_valid_token" at this point (the "" disabled case is filtered
  # out by the count gate above), so the else-branch covers exactly the
  # any_valid_token case.
  #   pinned_token    → admits ONLY the named service token.
  #   any_valid_token → admits any valid account service token; bounded
  #                     by the Worker's bearer-token layer behind Access.
  include = var.access_policy_mode == "pinned_token" ? [
    { service_token = { token_id = var.access_service_token_id } }
    ] : [
    { any_valid_service_token = {} }
  ]
}

resource "cloudflare_zero_trust_access_application" "broker" {
  count      = var.access_policy_mode == "" ? 0 : 1
  account_id = var.cloudflare_account_id
  name       = var.worker_name
  type       = "self_hosted"
  domain     = var.domain

  app_launcher_visible      = false
  auto_redirect_to_identity = false

  policies = [{
    id         = cloudflare_zero_trust_access_policy.broker[0].id
    precedence = 1
  }]
}
