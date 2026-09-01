# terraform-hcloud-rebase

Terraform module that runs a [Rebase](https://rebase.pro) backend on a Hetzner
Cloud server: the published runtime and Postgres under Docker Compose, TLS from
Caddy, and state on a volume that outlives the host.

```hcl
module "rebase" {
  source = "rebasepro/rebase/hcloud"

  domain          = "api.example.com"
  cors_origins    = ["https://app.example.com"]
  ssh_public_keys = [file(pathexpand("~/.ssh/id_ed25519.pub"))]

  bundle_url = "https://storage.example.com/bundles/app-1.4.0.tar.gz"

  s3_bucket            = "example-uploads"
  s3_access_key_id     = var.s3_access_key_id
  s3_secret_access_key = var.s3_secret_access_key
}
```

## The module knows nothing about your project

A Rebase deployment is two separable things: the published runtime image, and a
**bundle** — the output of `rebase build`. The same bundle runs under
`docker compose` on a laptop, on Rebase Cloud, under the Helm chart on
Kubernetes, and here. Hetzner is a host for it, not a variant of it.

So this module takes no project configuration at all. It provisions
infrastructure and points the runtime at a bundle, using `REBASE_BUNDLE_URL` —
the same mechanism the Helm chart's `bundle.mode: url` uses. Nothing you
configure here has to be undone to run the same project somewhere else, and
moving hosts is a change of infrastructure, not of application.

## Two ways to supply the bundle

Set exactly one. The module refuses to plan otherwise.

**`bundle_url`** — the runtime downloads and unpacks the bundle on every start.
Quickest to get going, and the bundle is swappable without touching Terraform.
The fetch runs on *every* boot, not just the first, so the URL must be stable
and non-expiring: a signed URL that has expired means a host rebooted overnight
stays down until a human reissues it. The unpacked copy is cached on the data
volume, so a restart costs a manifest check rather than a re-download and an
`npm ci`.

**`image`** — an image with the bundle already inside:

```dockerfile
FROM rebasepro/server:0.17.3
COPY dist-bundle /bundle
```

Preferred for production: the deployment then has no runtime dependency on a
bundle host being reachable, and rolling forward is a one-line change.

## Point DNS before the first apply

Caddy requests a Let's Encrypt certificate on first boot, and the ACME HTTP
challenge only succeeds if `domain` already resolves to the host. The address is
a `hcloud_primary_ip` created independently of the server, so you can get it
first:

```bash
terraform apply -target=hcloud_primary_ip.ipv4
```

Set the A record to that address, then run a full `terraform apply`. Because the
address is a primary IP it survives replacing the server, so this is a one-time
step rather than something to redo on every rebuild.

## The volume is the thing worth protecting

Postgres data, Caddy's certificates and the bundle cache all live on an attached
`hcloud_volume`, not on the server's own disk. Replacing the host — a resize, a
`terraform taint`, an OS bump — leaves the database where it is. That, more than
the provisioning, is the reason to use this rather than the shell recipe.

Two things it does not protect against, both of which need
[`rebase db backup`](https://rebase.pro/docs/deployment/backups):

- **A Postgres major upgrade is not in-place.** The image is pinned to a major
  on purpose; Postgres refuses to start against a data directory written by an
  older one. Dump, recreate the volume, restore.
- **`enable_backups`** is Hetzner's server snapshot. It is a disaster-recovery
  floor, not a database backup — it has no consistency guarantee for a running
  Postgres and no per-table restore.

## Storage is a required decision

The runtime hard-fails at production boot when storage is left local, because
the container filesystem is destroyed on every restart and a `local` backend in
production is silent data loss. This module makes you choose at plan time rather
than discovering it in a crash loop after `apply` reported success: set
`s3_bucket` (with endpoint and credentials), or set `force_local_storage = true`
if the project stores no uploads at all.

Hetzner Object Storage is S3-compatible and lives in the same datacenters —
`https://fsn1.your-objectstorage.com` and friends, which is the default endpoint
for your `location`. Buckets and their credentials are issued in the Hetzner
console; the Terraform provider does not manage Object Storage, so they are
inputs here.

## Secrets and state

Leave `jwt_secret`, `service_key` and `postgres_password` unset and they are
generated — **into Terraform state, in plaintext**. That is fine for state in an
encrypted remote backend and not fine for state in a git repository. Pass them
in from a secret manager for anything you would mind leaking.

`service_key` bypasses row-level security. Treat it as a database superuser
credential, not as an API key.

## Day two

```bash
# Did it come up?
ssh root@$(terraform output -raw ipv4_address) cat /opt/rebase-status

# Why not?
ssh root@$(terraform output -raw ipv4_address) \
  docker compose -f /opt/rebase-compose.yml logs api

# Schema changes boot does not make: junction-table RLS for many-to-many
# relations, and anything not purely additive. Postgres is bound to loopback
# and blocked at the firewall, so reach it through a tunnel.
eval "$(terraform output -raw db_tunnel_command)" &
rebase db push --database-url "postgres://rebase:$(terraform output -raw postgres_password)@localhost:5433/rebase"
```

Upgrading the runtime is a change to `runtime_version` (or `image`) followed by
`terraform apply`; the host re-pulls and restarts, and the bundle is untouched.

First boot legitimately takes several minutes — the bundle downloads and its
dependencies install before anything is served. `/opt/rebase-status` records the
outcome either way, so a deployment that never became healthy says so instead of
looking identical to one that worked.

## What it deliberately does not do

One server, no cluster. No load balancer, no read replica, no Kubernetes, and no
split of the runtime into separate `functions`/`worker` processes. Those are
real things Rebase supports — they are just not what a single-host module should
grow into. For multi-node, use the Helm chart on a Hetzner Kubernetes cluster.

It also does not manage DNS. Hetzner DNS has its own provider; this module
outputs the address and stays out of it.

## Requirements

| Name | Version |
| --- | --- |
| terraform | >= 1.5 |
| hcloud | ~> 1.68 |
| random | ~> 3.6 |

Validated against hcloud provider 1.68.0 — `hcloud_primary_ip` only accepts
`location` from a recent enough provider, which is why the floor is not lower.

<!-- BEGIN_TABLES -->

### Inputs

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `cors_origins` | `list(string)` | **required** | Origins allowed to call this API (CORS_ORIGINS). The runtime refuses to boot in production without one — deliberately, because a permissive default is one nobody revisits. |
| `domain` | `string` | **required** | Domain Caddy serves the API on, and requests a Let's Encrypt certificate for. |
| `ssh_public_keys` | `list(string)` | **required** | SSH public keys granted root access, as OpenSSH-format strings. Required — a host with no key is a host you cannot debug. |
| `acme_email` | `string` | `null` | Contact address for Let's Encrypt expiry notices. Optional but worth setting. |
| `bundle_token` | `string` | `null` | Bearer token for `bundle_url`, if it is not public (REBASE_BUNDLE_TOKEN). Does not expire. |
| `bundle_url` | `string` | `null` | HTTPS URL the runtime fetches its bundle from on every start (REBASE_BUNDLE_URL). |
| `data_volume_size` | `number` | `20` | Size in GB of the attached volume holding Postgres data, Caddy's certificates and the unpacked bundle. |
| `delete_protection` | `bool` | `false` | Hetzner-side delete protection on the server and volume. `terraform destroy` fails while this is on — which is the point. |
| `enable_backups` | `bool` | `true` | Hetzner's automatic server snapshots (+20% of server cost). Independent of, and no substitute for, `rebase db backup`. |
| `extra_env` | `map(string)` | `{}` | Additional environment variables for the runtime container, merged last. The escape hatch for anything this module does not model. |
| `force_local_storage` | `bool` | `false` | Set true only when the project stores no uploads at all. Acknowledges that any file written to the container is lost on restart. |
| `image` | `string` | `null` | A container image with the bundle already baked in: |
| `image_os` | `string` | `ubuntu-24.04` | Base OS image for the server. |
| `jwt_secret` | `string` | `null` | JWT_SECRET, min 32 chars. Generated if unset. Changing it invalidates every issued token. |
| `location` | `string` | `fsn1` | Hetzner location. `fsn1` (Falkenstein), `nbg1` (Nuremberg) and `hel1` (Helsinki) keep data in the EU; `ash`/`hil` (US) and `sin` (Singapore) do not. |
| `migrate_on_boot` | `string` | `ensure` | REBASE_MIGRATE_ON_BOOT. `ensure` (default) provisions collection tables and their RLS additively on every start — so a first apply against an empty volume comes up serving them. It never alters a column type, drops anything or edits an existing enum label; those go through `rebase db push` from a checkout, where the destructive-change gate is in reach. `none` opts out. |
| `name` | `string` | `rebase` | Name prefix for every created resource. |
| `postgres_image` | `string` | `pgvector/pgvector:pg18` | Postgres image. pgvector's build of Postgres 18 — a `{ type: "vector" }` property compiles to VECTOR(n), which stock Postgres answers with `type "vector" does not exist`. Pinned to a major on purpose: a floating major turns a reboot into an incompatible data directory. |
| `postgres_password` | `string` | `null` | Password for the `rebase` Postgres role. Generated if unset. Changing it after first boot does NOT change the existing role's password. |
| `runtime_version` | `string` | `latest` | Tag of `rebasepro/server` to run. Ignored when `image` is set. Pin it; `latest` makes a reboot a version bump. |
| `s3_access_key_id` | `string` | `null` | S3 access key ID. |
| `s3_bucket` | `string` | `null` | S3-compatible bucket for uploads. Hetzner Object Storage lives in the same datacenters as the server — endpoint `https://<location>.your-objectstorage.com`. |
| `s3_endpoint` | `string` | `null` | S3 endpoint URL. Defaults to Hetzner Object Storage in `location` when `s3_bucket` is set. |
| `s3_region` | `string` | `null` | S3 region. Defaults to `location`. |
| `s3_secret_access_key` | `string` | `null` | S3 secret access key. |
| `server_type` | `string` | `cx32` | Hetzner server type. `cx32` (4 vCPU / 8GB) is a comfortable floor for the runtime plus Postgres; `cx22` works for staging. |
| `service_key` | `string` | `null` | REBASE_SERVICE_KEY, min 32 chars. Generated if unset. This key bypasses row-level security — treat it as a database superuser credential. |
| `ssh_source_ips` | `list(string)` | `["0.0.0.0/0", "::/0"]` | CIDRs allowed to reach port 22. Defaults to the whole internet; narrow it to your own address if you can. |

### Outputs

| Name | Description |
| --- | --- |
| `ipv4_address` | Public IPv4. Point `domain`'s A record here BEFORE the first boot, or Caddy's ACME challenge fails. This address is a `hcloud_primary_ip`, so it survives replacing the server. |
| `ipv6_network` | Public IPv6 network assigned to the server. The host answers on ::1 of it — an AAAA record wants that address, not the network. |
| `api_url` | Public base URL, once DNS resolves and Caddy has a certificate. |
| `health_url` | Liveness endpoint. `/health` additionally does a database round-trip; `/livez` deliberately does not. |
| `ssh_command` | Shell on the host. `docker compose -f /opt/rebase-compose.yml logs -f api` is where a failed boot explains itself. |
| `db_tunnel_command` | Postgres is bound to loopback and blocked at the firewall, so reaching it means tunnelling. Run this, then point `rebase db push` at postgres://rebase:<postgres_password>@localhost:5433/rebase — needed for junction-table RLS on many-to-many relations and for any change that is not purely additive, neither of which boot performs. |
| `server_id` | Hetzner server id. |
| `volume_id` | Hetzner volume id holding Postgres data, Caddy's certificates and the bundle cache. This is the resource to protect; the server is replaceable. |
| `database_url` | Connection string as the runtime sees it, from inside the compose network. *(sensitive)* |
| `jwt_secret` | JWT_SECRET in effect. Read with `terraform output -raw jwt_secret`. *(sensitive)* |
| `service_key` | REBASE_SERVICE_KEY in effect. This bypasses row-level security — treat it as a superuser credential. *(sensitive)* |
| `postgres_password` | Password for the `rebase` Postgres role. *(sensitive)* |

<!-- END_TABLES -->

## License

MIT.
