# ── What runs here ───────────────────────────────────────────────────────────
#
# A Rebase deployment is two things: the published runtime image, and your
# project's bundle. This module never learns anything about the project — it
# provisions a host and points the runtime at a bundle. That is deliberate: the
# same bundle runs under `docker compose`, on Rebase Cloud, under the Helm
# chart, and here. A variable that encoded something project-shaped would be a
# variable that made this deployment target different from the others.

variable "bundle_url" {
  description = <<-EOT
    HTTPS URL the runtime fetches its bundle from on every start (REBASE_BUNDLE_URL).

    This is the same mechanism the Helm chart's `bundle.mode: url` and Cloud Run
    use — a `rebase build` tarball at a stable, non-expiring URL. The fetch runs
    on every boot, not just the first, so the URL must still work when the host
    reboots at 3am.

    Mutually exclusive with `image`. Exactly one of the two is required.
  EOT
  type        = string
  default     = null
}

variable "bundle_token" {
  description = "Bearer token for `bundle_url`, if it is not public (REBASE_BUNDLE_TOKEN). Does not expire."
  type        = string
  default     = null
  sensitive   = true
}

variable "image" {
  description = <<-EOT
    A container image with the bundle already baked in:

        FROM rebasepro/server:0.17.3
        COPY dist-bundle /bundle

    Preferred for production — the deployment then has no runtime dependency on
    a bundle host being reachable. Mutually exclusive with `bundle_url`.
  EOT
  type        = string
  default     = null
}

variable "runtime_version" {
  description = "Tag of `rebasepro/server` to run. Ignored when `image` is set. Pin it; `latest` makes a reboot a version bump."
  type        = string
  default     = "latest"
}

# ── Host ─────────────────────────────────────────────────────────────────────

variable "name" {
  description = "Name prefix for every created resource."
  type        = string
  default     = "rebase"

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{0,30}$", var.name))
    error_message = "name must be lowercase alphanumeric with hyphens, 1-31 characters."
  }
}

variable "location" {
  description = "Hetzner location. `fsn1` (Falkenstein), `nbg1` (Nuremberg) and `hel1` (Helsinki) keep data in the EU; `ash`/`hil` (US) and `sin` (Singapore) do not."
  type        = string
  default     = "fsn1"
}

variable "server_type" {
  description = "Hetzner server type. `cx32` (4 vCPU / 8GB) is a comfortable floor for the runtime plus Postgres; `cx22` works for staging."
  type        = string
  default     = "cx32"
}

variable "image_os" {
  description = "Base OS image for the server."
  type        = string
  default     = "ubuntu-24.04"
}

variable "ssh_public_keys" {
  description = "SSH public keys granted root access, as OpenSSH-format strings. Required — a host with no key is a host you cannot debug."
  type        = list(string)

  validation {
    condition     = length(var.ssh_public_keys) > 0
    error_message = "At least one SSH public key is required."
  }
}

variable "ssh_source_ips" {
  description = "CIDRs allowed to reach port 22. Defaults to the whole internet; narrow it to your own address if you can."
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
}

variable "data_volume_size" {
  description = <<-EOT
    Size in GB of the attached volume holding Postgres data, Caddy's certificates
    and the unpacked bundle.

    This volume is the reason to use Terraform rather than the shell recipe: it
    outlives the server, so rebuilding the host does not destroy the database.
    Hetzner's minimum is 10GB and volumes can grow but never shrink.
  EOT
  type        = number
  default     = 20

  validation {
    condition     = var.data_volume_size >= 10
    error_message = "Hetzner volumes start at 10GB."
  }
}

variable "enable_backups" {
  description = "Hetzner's automatic server snapshots (+20% of server cost). Independent of, and no substitute for, `rebase db backup`."
  type        = bool
  default     = true
}

variable "delete_protection" {
  description = "Hetzner-side delete protection on the server and volume. `terraform destroy` fails while this is on — which is the point."
  type        = bool
  default     = false
}

# ── Public surface ───────────────────────────────────────────────────────────

variable "domain" {
  description = <<-EOT
    Domain Caddy serves the API on, and requests a Let's Encrypt certificate for.

    Its A record must already point at `ipv4_address` before the host first
    boots, or the ACME challenge fails and Caddy backs off. The chicken-and-egg
    fix is to apply once with `create_server = false`, set DNS from the
    `ipv4_address` output, then apply again.
  EOT
  type        = string
}

variable "cors_origins" {
  description = "Origins allowed to call this API (CORS_ORIGINS). The runtime refuses to boot in production without one — deliberately, because a permissive default is one nobody revisits."
  type        = list(string)

  validation {
    condition     = length(var.cors_origins) > 0
    error_message = "At least one origin is required; the runtime will not start without it."
  }
}

variable "acme_email" {
  description = "Contact address for Let's Encrypt expiry notices. Optional but worth setting."
  type        = string
  default     = null
}

# ── Secrets ──────────────────────────────────────────────────────────────────
#
# Left unset these are generated and stored IN TERRAFORM STATE IN PLAINTEXT.
# That is true of every `random_password` in every module, and it is fine for a
# state file in an encrypted backend and not fine for one in a git repository.
# Pass them in from a secret manager for anything you would be upset to leak.

# ─── The first account ───────────────────────────────────────────────────────
#
# This module brings a public hostname, DNS and a Let's Encrypt certificate up
# before its operator has opened a browser. A fresh Rebase database has no
# users, and the registration policy admits the first registration and promotes
# it to admin — so between `terraform apply` finishing and the operator signing
# up, the deployment belongs to whoever gets there first.
#
# So the module ships with self-registration off and asks who the first account
# is. The runtime creates it once, while the user table is still empty.

variable "admin_email" {
  description = "Email of the first admin account, created at first boot. Required unless allow_self_registration is true."
  type        = string
  default     = null
}

variable "admin_password" {
  description = "Password for the first admin account, min 12 chars. Generated if unset and admin_email is set; read with `terraform output -raw admin_password`. Change it after the first sign-in."
  type        = string
  default     = null
  sensitive   = true

  validation {
    condition     = var.admin_password == null ? true : length(var.admin_password) >= 12
    error_message = "admin_password must be at least 12 characters."
  }
}

variable "allow_self_registration" {
  description = "Leave the public sign-up form open instead of seeding an admin. The first person to reach it becomes this deployment's administrator, so this is off by default."
  type        = bool
  default     = false
}

variable "jwt_secret" {
  description = "JWT_SECRET, min 32 chars. Generated if unset. Changing it invalidates every issued token."
  type        = string
  default     = null
  sensitive   = true

  validation {
    condition     = var.jwt_secret == null ? true : length(var.jwt_secret) >= 32
    error_message = "jwt_secret must be at least 32 characters."
  }
}

variable "service_key" {
  description = "REBASE_SERVICE_KEY, min 32 chars. Generated if unset. This key bypasses row-level security — treat it as a database superuser credential."
  type        = string
  default     = null
  sensitive   = true

  validation {
    condition     = var.service_key == null ? true : length(var.service_key) >= 32
    error_message = "service_key must be at least 32 characters."
  }
}

variable "postgres_password" {
  description = "Password for the `rebase` Postgres role. Generated if unset. Changing it after first boot does NOT change the existing role's password."
  type        = string
  default     = null
  sensitive   = true
}

# ── Storage ──────────────────────────────────────────────────────────────────
#
# The runtime hard-fails at production boot when storage is left local, because
# the container filesystem is destroyed on restart and a `local` backend in
# production is silent data loss. So this module forces the choice rather than
# letting it surface as a boot crash after apply reports success.

variable "s3_bucket" {
  description = <<-EOT
    S3-compatible bucket for uploads. Hetzner Object Storage lives in the same
    datacenters as the server — endpoint `https://<location>.your-objectstorage.com`.

    Buckets and their credentials are issued in the Hetzner console; the
    Terraform provider does not manage Object Storage, so these are inputs.
  EOT
  type        = string
  default     = null
}

variable "s3_endpoint" {
  description = "S3 endpoint URL. Defaults to Hetzner Object Storage in `location` when `s3_bucket` is set."
  type        = string
  default     = null
}

variable "s3_region" {
  description = "S3 region. Defaults to `location`."
  type        = string
  default     = null
}

variable "s3_access_key_id" {
  description = "S3 access key ID."
  type        = string
  default     = null
  sensitive   = true
}

variable "s3_secret_access_key" {
  description = "S3 secret access key."
  type        = string
  default     = null
  sensitive   = true
}

variable "force_local_storage" {
  description = "Set true only when the project stores no uploads at all. Acknowledges that any file written to the container is lost on restart."
  type        = bool
  default     = false
}

# ── Runtime behaviour ────────────────────────────────────────────────────────

variable "migrate_on_boot" {
  description = <<-EOT
    REBASE_MIGRATE_ON_BOOT. `ensure` (default) provisions collection tables and
    their RLS additively on every start — so a first apply against an empty
    volume comes up serving them. It never alters a column type, drops anything
    or edits an existing enum label; those go through `rebase db push` from a
    checkout, where the destructive-change gate is in reach. `none` opts out.
  EOT
  type        = string
  default     = "ensure"

  validation {
    condition     = contains(["ensure", "none"], var.migrate_on_boot)
    error_message = "migrate_on_boot must be \"ensure\" or \"none\"."
  }
}

variable "extra_env" {
  description = "Additional environment variables for the runtime container, merged last. The escape hatch for anything this module does not model."
  type        = map(string)
  default     = {}
}

variable "postgres_image" {
  description = "Postgres image. pgvector's build of Postgres 18 — a `{ type: \"vector\" }` property compiles to VECTOR(n), which stock Postgres answers with `type \"vector\" does not exist`. Pinned to a major on purpose: a floating major turns a reboot into an incompatible data directory."
  type        = string
  default     = "pgvector/pgvector:pg18"
}
