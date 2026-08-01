# Inputs for the optional Cloudflare Access module. Six variables, all of
# which the two resources in access.tf consume directly.
#
# The Worker itself takes no Terraform inputs — it is deployed by
# `wrangler deploy` and configured through environment variables read by
# scripts/render-wrangler-config.mjs. See docs/CICD.md.

variable "cloudflare_api_token" {
  description = "Cloudflare API token used by the root module's provider. Needs only `Access: Apps and Policies: Edit` (account-scoped) for this module — deliberately NOT `Access: Service Tokens: Edit`, since service tokens are issued by hand (see access.tf)."
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID. Both Access resources are account-scoped."
  type        = string
}

variable "worker_name" {
  description = "Name of the Cloudflare Worker. Used as the name of the Access application and policy so they are identifiable per environment."
  type        = string
}

variable "domain" {
  description = "Hostname the Access application sits in front of — the same custom domain the Worker is bound to (e.g. pact-broker.your-domain.com)."
  type        = string
}

# ─── Cloudflare Access (opt-in, default OFF) ─────────────────────
# When access_policy_mode == "" the Access application + policy
# resources in access.tf are NOT provisioned and the broker stays
# reachable behind only the Worker's bearer-token check.

variable "access_policy_mode" {
  description = "Cloudflare Access policy posture. \"\" disables the perimeter entirely (default — no Access resources provisioned). \"pinned_token\" admits only the specific access_service_token_id. \"any_valid_token\" admits any service token issued in the account."
  type        = string
  default     = ""
  validation {
    condition     = contains(["", "pinned_token", "any_valid_token"], var.access_policy_mode)
    error_message = "access_policy_mode must be \"\" (disabled), \"pinned_token\", or \"any_valid_token\"."
  }
}

variable "access_service_token_id" {
  description = "Cloudflare Access service-token UUID admitted by the access policy when access_policy_mode == \"pinned_token\". Service tokens are issued manually via the Cloudflare dashboard, never by CI."
  type        = string
  default     = ""
  validation {
    condition     = var.access_policy_mode != "pinned_token" || length(trimspace(var.access_service_token_id)) > 0
    error_message = "access_service_token_id must be set when access_policy_mode is \"pinned_token\"."
  }
}

# The Worker's bearer token (PACT_BROKER_TOKEN) is not a Terraform variable
# and Terraform never reads it. It is seeded once, out of band:
#
#   openssl rand -hex 32 | wrangler secret put PACT_BROKER_TOKEN --name <worker_name>
#
# Worker secrets survive every deploy, so there is nothing to converge.
