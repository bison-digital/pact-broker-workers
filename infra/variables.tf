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

variable "aws_region" {
  description = "AWS region for the AWS provider (Secrets Manager reads)."
  type        = string
  default     = "eu-west-1"
}

variable "terraform_state_bucket" {
  description = "S3 bucket holding this project's Terraform state. MUST match the bucket configured in your backend.hcl. No default — required so operators can't accidentally write to the wrong bucket."
  type        = string
}

variable "secrets_prefix" {
  description = "Prefix under which Worker secrets are stored in AWS Secrets Manager. Full path resolves to `<prefix>/<workspace>/pact-broker-token`. Override per operator so multiple deployments in the same AWS account don't collide."
  type        = string
  default     = "pact-broker"
}

variable "wrangler_compatibility_date" {
  description = "compatibility_date written into the materialised wrangler.jsonc. Bump when you want the Worker to opt into newer Workers runtime behaviour."
  type        = string
  default     = "2024-12-01"
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

# The Worker's bearer token (PACT_BROKER_TOKEN) is NOT a Terraform
# variable — it lives in AWS Secrets Manager under
# `<secrets_prefix>/<workspace>/pact-broker-token` and is read at apply
# time. See secrets.tf.
