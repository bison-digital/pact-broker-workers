variable "cloudflare_api_token" {
  description = "Cloudflare API token with Workers Scripts, Workers Routes, and DNS edit rights on the zone that owns your chosen domain."
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID that owns the Worker."
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for the zone you'll point at the Worker."
  type        = string
}

variable "domain" {
  description = "Custom domain the Worker binds to (e.g. pact-broker-staging.your-domain.com)."
  type        = string
}

variable "worker_name" {
  description = "Name of the Cloudflare Worker (matches wrangler.jsonc name field per env)."
  type        = string
}

variable "wrangler_compatibility_date" {
  description = "compatibility_date written into the materialised wrangler.jsonc. Bump when you want the Worker to opt into newer Workers runtime behaviour."
  type        = string
  default     = "2026-04-15"
}

variable "allow_public_read" {
  description = "If true, GET/HEAD requests on the broker bypass the bearer-token check. Default false."
  type        = string
  default     = "false"
  validation {
    condition     = contains(["true", "false"], var.allow_public_read)
    error_message = "allow_public_read must be the string \"true\" or \"false\" (Workers env vars are strings)."
  }
}

variable "enable_rate_limiting" {
  description = "If true, provision an edge Cloudflare rate-limit ruleset in front of the Worker. Requires a Cloudflare plan that exposes the rate_limit action in http_ratelimit (Pro+). Set to false on the free plan and rely on the in-Worker body-size + validation caps."
  type        = bool
  default     = true
}

variable "mutating_rate_limit_threshold" {
  description = "Max mutating requests per client IP per minute before the ratelimit rule fires."
  type        = number
  default     = 60
}

variable "read_rate_limit_threshold" {
  description = "Max read requests per client IP per minute before the ratelimit rule fires."
  type        = number
  default     = 600
}

variable "cors_allowed_origins" {
  description = "Comma-separated list of origins that may make cross-origin browser requests to the broker. Empty/unset = permissive (legacy). Set once you host the HAL UI on a known domain."
  type        = string
  default     = ""
}

variable "public_badges" {
  description = "If 'false', the SVG badge endpoint requires a bearer token. Any other value (including unset) leaves badges public."
  type        = string
  default     = "true"
}

# The Worker's bearer token (PACT_BROKER_TOKEN) is deliberately NOT a
# Terraform variable, and Terraform never reads it.
#
# Cloudflare Worker secrets are durable and survive every deploy — wrangler
# only removes one on an explicit `wrangler secret delete`. So there is
# nothing for Terraform to converge: the token is seeded once, out of band,
# and rotated when an operator decides to rotate it.
#
#   openssl rand -hex 32 | wrangler secret put PACT_BROKER_TOKEN --name <worker_name>
#
# Keeping the value out of the apply path is what lets CI hold no secret
# store credentials at all. `wrangler.jsonc.tmpl` declares the token under
# `secrets.required`, so `wrangler deploy` fails loudly if a Worker was
# never seeded rather than shipping an unauthenticated broker.
