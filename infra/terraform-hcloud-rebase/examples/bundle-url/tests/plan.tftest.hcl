# Plans this example as written, against mock providers, so a precondition
# that refuses it fails here rather than on the reader's first `terraform plan`.
# Runs with `terraform test`; needs no Hetzner account.

mock_provider "hcloud" {}
mock_provider "random" {}

variables {
  ssh_public_keys      = ["ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKeyForPlanningOnly plan@example"]
  hcloud_token         = "mock"
  s3_access_key_id     = "AKIAEXAMPLE"
  s3_secret_access_key = "example-secret"
}

run "plans_as_written" {
  command = plan
}
