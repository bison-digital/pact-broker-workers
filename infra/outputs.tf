output "worker_name" {
  description = "Worker name (matches wrangler.jsonc name field per env)."
  value       = var.worker_name
}

output "worker_domain" {
  description = "Fully-qualified Worker custom domain."
  value       = var.domain
}

output "broker_base_url" {
  description = "Base URL clients should point pact-broker-client at."
  value       = "https://${var.domain}"
}
