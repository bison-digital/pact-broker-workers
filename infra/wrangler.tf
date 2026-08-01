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
}

# ─── Worker secrets: deliberately not managed here ───────────────
#
# Terraform does not read, write, or hash PACT_BROKER_TOKEN. Worker secrets
# are durable across deploys, so there is no invariant to converge — and
# converging one would mean the apply (and therefore CI) needed read access
# to wherever the value lives. That is precisely how this project ended up
# with an AWS Secrets Manager dependency, and why it no longer has one.
#
# Seed once per Worker, from a workstation or the Cloudflare dashboard:
#
#   openssl rand -hex 32 | wrangler secret put PACT_BROKER_TOKEN --name <worker_name>
#
# See the note at the bottom of variables.tf.

# ─── Materialised wrangler.jsonc ─────────────────────────────────
# Generated per workspace from wrangler.jsonc.tmpl, filled with values from
# this workspace's TF vars. wrangler.jsonc itself is gitignored (build
# artifact); the .tmpl is the source of truth.
resource "local_file" "wrangler_config" {
  filename = "${local.worker_dir}/wrangler.jsonc"
  content = templatefile("${local.worker_dir}/wrangler.jsonc.tmpl", {
    worker_name          = var.worker_name
    account_id           = var.cloudflare_account_id
    compatibility_date   = var.wrangler_compatibility_date
    allow_public_read    = var.allow_public_read
    cors_allowed_origins = var.cors_allowed_origins
    public_badges        = var.public_badges
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

  depends_on = [local_file.wrangler_config]

  provisioner "local-exec" {
    working_dir = local.worker_dir
    command     = "npx wrangler deploy ${local.wrangler_target_flag}"
    environment = {
      CLOUDFLARE_API_TOKEN  = var.cloudflare_api_token
      CLOUDFLARE_ACCOUNT_ID = var.cloudflare_account_id
    }
  }
}
