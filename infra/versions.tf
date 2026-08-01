terraform {
  required_version = "~> 1.7"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.22"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
  }

  # State backend. `s3` here means the S3 *protocol*, not Amazon S3 — this
  # project's reference backend is a Cloudflare R2 bucket, so an operator
  # needs nothing outside their Cloudflare account. Terraform has no native
  # R2 backend, and the S3 protocol is the portable choice: the same block
  # works against R2, MinIO, Backblaze B2, or Amazon S3 if that is what an
  # operator already runs.
  #
  # Everything operator-specific (bucket, key, endpoint, and the skip_*
  # flags an S3-compatible endpoint needs) comes from a
  # `-backend-config=backend.hcl` flag at `terraform init`, so no operator
  # ever edits this file. See infra/backend.hcl.example.
  backend "s3" {
    encrypt              = true
    workspace_key_prefix = "env"
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
