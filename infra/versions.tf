terraform {
  required_version = "~> 1.7"

  required_providers {
    cloudflare = {
      source = "cloudflare/cloudflare"
      # Pinned exact to 5.19.0-beta.5 to pick up the
      # `cloudflare_workers_custom_domain.environment` fix (attribute
      # is now `Computed`, no longer forces replacement on drift).
      # v5.18 had the provider bug that required a
      # `lifecycle { ignore_changes = [environment] }` band-aid.
      # When Cloudflare cuts 5.19.0 stable, swap this to "~> 5.19".
      version = "= 5.19.0-beta.5"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.42"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
  }

  # Backend uses partial configuration: bucket / key / region come from a
  # `-backend-config=backend.hcl` flag at `terraform init`. Each operator
  # points Terraform at their own state bucket without editing this file.
  # See infra/backend.hcl.example.
  backend "s3" {
    use_lockfile         = true
    encrypt              = true
    workspace_key_prefix = "env"
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

# AWS provider — used to read the Worker's bearer-token secret from
# Secrets Manager. Region defaults to eu-west-1 but is overridable per
# workspace via TF_VAR_aws_region.
provider "aws" {
  region = var.aws_region
}
