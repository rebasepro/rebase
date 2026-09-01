# The production shape: the bundle is baked into an image, so the deployment has
# no runtime dependency on a bundle host being reachable.
#
#   rebase build
#   cat > Dockerfile <<'EOF'
#   FROM rebasepro/server:0.17.3
#   COPY dist-bundle /bundle
#   EOF
#   docker build -t registry.example.com/my-app:1.4.0 .
#   docker push registry.example.com/my-app:1.4.0
#
# Deploying a new version is then a change to one string here.

terraform {
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.68"
    }
  }
}

variable "ssh_public_keys" {
  description = "SSH public keys granted root access. In your own config this is usually [file(pathexpand(\"~/.ssh/id_ed25519.pub\"))]; it is a variable here so the example validates without a key on disk."
  type        = list(string)
}

variable "hcloud_token" {
  type      = string
  sensitive = true
}

provider "hcloud" {
  token = var.hcloud_token
}

module "rebase" {
  source = "../.."

  name        = "rebase-prod"
  domain      = "api.example.com"
  location    = "nbg1"
  server_type = "cx42"

  image = "registry.example.com/my-app:1.4.0"

  cors_origins    = ["https://app.example.com", "https://admin.example.com"]
  ssh_public_keys = var.ssh_public_keys

  # Narrow SSH to the office / VPN rather than the whole internet.
  ssh_source_ips = ["203.0.113.0/24"]

  data_volume_size  = 100
  enable_backups    = true
  delete_protection = true

  s3_bucket            = "example-uploads"
  s3_access_key_id     = var.s3_access_key_id
  s3_secret_access_key = var.s3_secret_access_key

  # Supplied rather than generated, so they are not in Terraform state.
  jwt_secret  = var.jwt_secret
  service_key = var.service_key
}

variable "s3_access_key_id" {
  type      = string
  sensitive = true
}

variable "s3_secret_access_key" {
  type      = string
  sensitive = true
}

variable "jwt_secret" {
  type      = string
  sensitive = true
}

variable "service_key" {
  type      = string
  sensitive = true
}

output "ipv4_address" {
  value = module.rebase.ipv4_address
}
