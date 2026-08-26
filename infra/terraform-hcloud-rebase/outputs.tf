output "ipv4_address" {
  description = "Public IPv4. Point `domain`'s A record here BEFORE the first boot, or Caddy's ACME challenge fails. This address is a `hcloud_primary_ip`, so it survives replacing the server."
  value       = hcloud_primary_ip.ipv4.ip_address
}

output "ipv6_network" {
  description = "Public IPv6 network assigned to the server. The host answers on ::1 of it — an AAAA record wants that address, not the network."
  value       = hcloud_primary_ip.ipv6.ip_address
}

output "api_url" {
  description = "Public base URL, once DNS resolves and Caddy has a certificate."
  value       = "https://${var.domain}"
}

output "health_url" {
  description = "Liveness endpoint. `/health` additionally does a database round-trip; `/livez` deliberately does not."
  value       = "https://${var.domain}/health"
}

output "ssh_command" {
  description = "Shell on the host. `docker compose -f /opt/rebase-compose.yml logs -f api` is where a failed boot explains itself."
  value       = "ssh root@${hcloud_primary_ip.ipv4.ip_address}"
}

output "db_tunnel_command" {
  description = <<-EOT
    Postgres is bound to loopback and blocked at the firewall, so reaching it
    means tunnelling. Run this, then point `rebase db push` at
    postgres://rebase:<postgres_password>@localhost:5433/rebase — needed for
    junction-table RLS on many-to-many relations and for any change that is not
    purely additive, neither of which boot performs.
  EOT
  value       = "ssh -N -L 5433:127.0.0.1:5432 root@${hcloud_primary_ip.ipv4.ip_address}"
}

output "server_id" {
  description = "Hetzner server id."
  value       = hcloud_server.this.id
}

output "volume_id" {
  description = "Hetzner volume id holding Postgres data, Caddy's certificates and the bundle cache. This is the resource to protect; the server is replaceable."
  value       = hcloud_volume.data.id
}

output "database_url" {
  description = "Connection string as the runtime sees it, from inside the compose network."
  value       = local.database_url
  sensitive   = true
}

output "jwt_secret" {
  description = "JWT_SECRET in effect. Read with `terraform output -raw jwt_secret`."
  value       = local.jwt_secret
  sensitive   = true
}

output "service_key" {
  description = "REBASE_SERVICE_KEY in effect. This bypasses row-level security — treat it as a superuser credential."
  value       = local.service_key
  sensitive   = true
}

output "postgres_password" {
  description = "Password for the `rebase` Postgres role."
  value       = local.postgres_password
  sensitive   = true
}
