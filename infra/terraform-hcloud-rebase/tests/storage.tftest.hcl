# What the module hands the runtime for storage, applied against mock providers.
# Runs with `terraform test`; needs no Hetzner account.

# hcloud ids are numbers wherever one resource names another; a mock's default
# id is a random string, so each referenced resource gets a numeric one.
mock_provider "hcloud" {
  mock_resource "hcloud_firewall" {
    defaults = { id = "101" }
  }
  mock_resource "hcloud_ssh_key" {
    defaults = { id = "102" }
  }
  mock_resource "hcloud_volume" {
    defaults = { id = "103" }
  }
  mock_resource "hcloud_primary_ip" {
    defaults = { id = "104" }
  }
  mock_resource "hcloud_server" {
    defaults = { id = "105" }
  }
}
mock_provider "random" {}

variables {
  domain          = "api.example.com"
  cors_origins    = ["https://app.example.com"]
  ssh_public_keys = ["ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKeyForPlanningOnly plan@example"]
  image           = "registry.example.com/my-app:1.4.0"
}

run "local_storage_lives_on_the_data_volume" {
  # Apply, not plan: the compose file embeds generated secrets, which are
  # unknown until applied. Against mock providers nothing is created.
  command = apply

  variables {
    force_local_storage = true
  }

  # FORCE_LOCAL_STORAGE=true tells the runtime a durable volume is mounted at
  # the storage path, and it then serves uploads from there. Without the mount
  # that path is the container's own filesystem, and every upload is gone at
  # the next restart — the data loss the runtime's guard exists to prevent.
  assert {
    condition     = lookup(local.compose_env, "FORCE_LOCAL_STORAGE", null) == "true" && lookup(local.compose_env, "STORAGE_PATH", null) == "/storage/uploads"
    error_message = "local storage is forced but STORAGE_PATH does not point under the mounted /storage"
  }
  assert {
    condition     = contains(yamldecode(local.compose).services.api.volumes, "/mnt/rebase-data/storage:/storage")
    error_message = "local storage is forced but nothing durable is mounted at /storage"
  }
}

run "object_storage_mounts_nothing" {
  # Apply, not plan: the compose file embeds generated secrets, which are
  # unknown until applied. Against mock providers nothing is created.
  command = apply

  variables {
    s3_bucket            = "uploads"
    s3_access_key_id     = "AKIAEXAMPLE"
    s3_secret_access_key = "example-secret"
  }

  assert {
    condition     = !contains(keys(local.compose_env), "FORCE_LOCAL_STORAGE") && !contains(keys(local.compose_env), "STORAGE_PATH")
    error_message = "a bucket is configured but the runtime was told to store files locally"
  }
  assert {
    condition     = !contains(yamldecode(local.compose).services.api.volumes, "/mnt/rebase-data/storage:/storage")
    error_message = "a bucket is configured but the data volume is mounted for local storage"
  }
}
