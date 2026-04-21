# ─── Worker bearer token — read from AWS Secrets Manager ─────────
#
# Source-of-truth model: AWS Secrets Manager owns the entire lifecycle of
# this value (creation, rotation, deletion). Terraform only READS it and
# pushes the current value to the Worker via wrangler secret put
# (see wrangler.tf).
#
# Why Terraform doesn't own the resource:
#   - Seeding is a one-time operator task, not something that should
#     live in HCL alongside everything else (keeps the TF graph clean).
#   - Ownership-by-operator makes the operational model honest: the
#     canonical way to rotate the broker token is Secrets Manager, not
#     `terraform apply`.
#
# Bootstrap (per-workspace, ONE TIME, before the first `terraform apply`):
#
#   aws secretsmanager create-secret \
#     --name "<secrets_prefix>/<workspace>/pact-broker-token" \
#     --secret-string "$(openssl rand -hex 32)" \
#     --recovery-window-in-days 0
#
# `--recovery-window-in-days 0` disables AWS's 30-day soft-delete so a
# mis-seeded value can be deleted and recreated without waiting out the
# recovery window.

data "aws_secretsmanager_secret_version" "pact_broker_token" {
  secret_id = "${var.secrets_prefix}/${terraform.workspace}/pact-broker-token"
}
