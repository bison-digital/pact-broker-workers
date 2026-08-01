# This directory is a Terraform MODULE, not a root configuration.
#
# It deliberately declares no `provider` block and no `backend` block — both
# belong to the root module that consumes this one. That is what keeps the
# Cloudflare Access perimeter optional: an operator who does not want it never
# installs Terraform, and one who does wires this into their own state and
# pipeline rather than adopting ours.
#
# See README.md in this directory for a worked `module {}` example.

terraform {
  # 1.9+ is required: `access_service_token_id` uses cross-variable validation
  # (its condition references `access_policy_mode`), which earlier versions
  # reject at parse time.
  required_version = ">= 1.9"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.19"
    }
  }
}
