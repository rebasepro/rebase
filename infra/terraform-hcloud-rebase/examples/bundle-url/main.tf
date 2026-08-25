# The quickstart shape: the published runtime fetches your bundle at boot.
#
#   rebase build                       # produces ./dist-bundle
#   tar czf app.tar.gz -C dist-bundle .
#   # upload app.tar.gz somewhere with a stable URL
#
# The URL is fetched on every start, not just the first, so it has to keep
# working unattended — a signed URL that expires means a host rebooted at 3am
# stays down until someone reissues it.

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

  name     = "rebase-staging"
  domain   = "api.example.com"
  location = "fsn1"

  bundle_url   = "https://storage.example.com/bundles/app-1.4.0.tar.gz"
  bundle_token = var.bundle_token

  cors_origins    = ["https://app.example.com"]
  ssh_public_keys = var.ssh_public_keys

  # Hetzner Object Storage, in the same datacenter as the server. The bucket and
  # its credentials are created in the Hetzner console — the Terraform provider
  # does not manage Object Storage.
  s3_bucket            = "example-uploads"
  s3_access_key_id     = var.s3_access_key_id
  s3_secret_access_key = var.s3_secret_access_key
}

variable "bundle_token" {
  type      = string
  sensitive = true
  default   = null
}

variable "s3_access_key_id" {
  type      = string
  sensitive = true
}

variable "s3_secret_access_key" {
  type      = string
  sensitive = true
}

output "ipv4_address" {
  value = module.rebase.ipv4_address
}

output "api_url" {
  value = module.rebase.api_url
}
