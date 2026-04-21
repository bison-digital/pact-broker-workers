# ─── Worker custom domain ────────────────────────────────────────
# Depends on the Worker being deployed first (wrangler deploy creates it).
#
# This resource is the SOLE OWNER of the Worker's custom-domain binding.
# Do not re-introduce a "routes" block in wrangler.jsonc.tmpl: wrangler
# would then call PUT /zones/<zone>/workers/routes on every deploy,
# duplicating ownership and forcing an extra Workers Routes: Edit
# permission onto the CI token. Terraform owns this binding; wrangler
# is only responsible for uploading the Worker script.

resource "cloudflare_workers_custom_domain" "pact_broker" {
  account_id = var.cloudflare_account_id
  zone_id    = var.cloudflare_zone_id
  hostname   = var.domain
  service    = var.worker_name

  depends_on = [terraform_data.worker_deploy]
}
