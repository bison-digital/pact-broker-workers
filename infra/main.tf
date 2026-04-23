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

# ─── Edge rate limiting ──────────────────────────────────────────
# Two rules, both scoped to the broker hostname:
#   * Mutating methods (PUT/POST/DELETE) capped at `mutating_rate_limit_threshold` per minute per IP.
#   * Read methods (GET/HEAD) capped at `read_rate_limit_threshold` per minute per IP.
# Gated by `enable_rate_limiting`; disable on plans that don't expose
# the rate_limit action in http_ratelimit phase rulesets (free tier).

resource "cloudflare_ruleset" "pact_broker_rate_limit" {
  count       = var.enable_rate_limiting ? 1 : 0
  zone_id     = var.cloudflare_zone_id
  name        = "${var.worker_name}-rate-limit"
  description = "Per-IP rate limits for the ${var.worker_name} Pact broker."
  kind        = "zone"
  phase       = "http_ratelimit"

  rules = [
    {
      action = "block"
      ratelimit = {
        characteristics     = ["ip.src"]
        period              = 60
        requests_per_period = var.mutating_rate_limit_threshold
        mitigation_timeout  = 60
      }
      expression  = "(http.host eq \"${var.domain}\" and (http.request.method eq \"PUT\" or http.request.method eq \"POST\" or http.request.method eq \"DELETE\"))"
      description = "Throttle mutating writes per IP"
      enabled     = true
    },
    {
      action = "block"
      ratelimit = {
        characteristics     = ["ip.src"]
        period              = 60
        requests_per_period = var.read_rate_limit_threshold
        mitigation_timeout  = 60
      }
      expression  = "(http.host eq \"${var.domain}\" and (http.request.method eq \"GET\" or http.request.method eq \"HEAD\"))"
      description = "Throttle reads per IP"
      enabled     = true
    },
  ]

  depends_on = [cloudflare_workers_custom_domain.pact_broker]
}
