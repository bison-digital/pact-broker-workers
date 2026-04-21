# Shell out to `wrangler` for Worker secrets and deployment.
# Native Cloudflare provider can't cleanly own Worker code uploads, so we
# invoke the official tool via terraform_data + triggers_replace.
#
# Multi-environment story: every Terraform workspace materialises its OWN
# wrangler.jsonc from wrangler.jsonc.tmpl. There is no `env.<name>` block
# in the template — wrangler is always invoked with `--name ${var.worker_name}`.
# This avoids the `--name X --env Y` collision that would create phantom
# workers (e.g. `pact-broker-staging-staging`).

locals {
  wrangler_target_flag = "--name ${var.worker_name}"
  worker_dir           = "${path.module}/.."

  src_files = [for f in sort(fileset("${local.worker_dir}/src", "**/*")) : "${local.worker_dir}/src/${f}"]

  source_hash = sha256(join("", [for f in local.src_files : filesha256(f)]))

  # Secret names are static so they can be used as for_each keys (Terraform
  # disallows sensitive values in for_each keys). The values are passed into
  # the provisioner environment, never into the key.
  secret_names = toset(["PACT_BROKER_TOKEN"])

  # Sourced from AWS Secrets Manager (see secrets.tf). Secrets are not
  # Terraform inputs — they're operator-managed values Terraform reads at
  # apply time and pushes to the Worker.
  secret_values = {
    PACT_BROKER_TOKEN = data.aws_secretsmanager_secret_version.pact_broker_token.secret_string
  }
}

# ─── Worker secrets ──────────────────────────────────────────────
# Each secret is set via `printf | wrangler secret put`.
# Re-runs when EITHER the secret value OR the wrangler command changes —
# the command hash catches wrangler-flag fixes so they take effect on the
# next apply without needing an out-of-band value rotation.

locals {
  worker_secret_command = "printf '%s' \"$SECRET_VALUE\" | npx wrangler secret put $SECRET_NAME ${local.wrangler_target_flag}"
}

resource "terraform_data" "worker_secret" {
  for_each = local.secret_names

  triggers_replace = {
    value_hash   = sha256(local.secret_values[each.key])
    command_hash = sha256(local.worker_secret_command)
  }

  provisioner "local-exec" {
    working_dir = local.worker_dir
    command     = local.worker_secret_command
    environment = {
      SECRET_NAME          = each.key
      SECRET_VALUE         = local.secret_values[each.key]
      CLOUDFLARE_API_TOKEN = var.cloudflare_api_token
    }
  }
}

# ─── Materialised wrangler.jsonc ─────────────────────────────────
# Generated per workspace from wrangler.jsonc.tmpl, filled with values from
# this workspace's TF vars. wrangler.jsonc itself is gitignored (build
# artifact); the .tmpl is the source of truth.
resource "local_file" "wrangler_config" {
  filename = "${local.worker_dir}/wrangler.jsonc"
  content = templatefile("${local.worker_dir}/wrangler.jsonc.tmpl", {
    worker_name        = var.worker_name
    account_id         = var.cloudflare_account_id
    compatibility_date = var.wrangler_compatibility_date
    allow_public_read  = var.allow_public_read
  })
  file_permission = "0644"
}

# ─── Worker deployment ───────────────────────────────────────────
# Runs `wrangler deploy`. Re-runs when source code changes OR when the
# materialised wrangler.jsonc changes.
resource "terraform_data" "worker_deploy" {
  triggers_replace = {
    source_hash    = local.source_hash
    wrangler_jsonc = local_file.wrangler_config.content_sha256
  }

  depends_on = [
    terraform_data.worker_secret,
    local_file.wrangler_config,
  ]

  provisioner "local-exec" {
    working_dir = local.worker_dir
    command     = "npx wrangler deploy ${local.wrangler_target_flag}"
    environment = {
      CLOUDFLARE_API_TOKEN  = var.cloudflare_api_token
      CLOUDFLARE_ACCOUNT_ID = var.cloudflare_account_id
    }
  }
}
