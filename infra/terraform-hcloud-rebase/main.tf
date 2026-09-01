locals {
  # Exactly one of these decides how the project reaches the runtime. The
  # precondition on hcloud_server enforces it; this just names the outcome.
  uses_bundle_url = var.bundle_url != null
  runtime_image   = coalesce(var.image, "rebasepro/server:${var.runtime_version}")

  # Can the pinned runtime fetch its own bundle?
  #
  # `bundle_url` sets REBASE_BUNDLE_URL and nothing else: there is no fetch step
  # in this module, by design, because the runtime is supposed to do it. That
  # capability landed after 0.16.0. At or below it the entrypoint looks only for
  # a bundle already on disk and exits with `No bundle found at /bundle.` before
  # the server is imported — so `terraform apply` succeeds, reports a healthy
  # plan, and leaves a container restart-looping behind Caddy serving 502s.
  #
  # `latest` is not a pass, and it is the default value of `runtime_version`.
  # Whatever it resolves to on Docker Hub on any given day is unknowable from
  # here, and it moves between one apply and the next — so an unparseable tag is
  # treated as unable, which is the safe direction.
  runtime_parts = try([for p in split(".", split("-", var.runtime_version)[0]) : tonumber(p)], [])
  # The whole comparison sits inside `try(..., false)`, and that is load-bearing
  # rather than defensive style. Terraform does NOT short-circuit `&&`: guarding
  # with `length(parts) == 3 && parts[0] > 0` still evaluates the index, and
  # indexing an empty list yields UNKNOWN rather than an error. A precondition
  # whose condition is unknown does not fail — it DEFERS. So the guarded form let
  # `latest` through, which is both the default value and the one broken case
  # this exists to catch. Anything unparseable now falls to false, which refuses.
  runtime_can_fetch_bundle = try(
    local.runtime_parts[0] > 0 ||
    (local.runtime_parts[0] == 0 && local.runtime_parts[1] > 16) ||
    (local.runtime_parts[0] == 0 && local.runtime_parts[1] == 16 && local.runtime_parts[2] > 0),
    false
  )

  jwt_secret        = coalesce(var.jwt_secret, random_password.jwt.result)
  service_key       = coalesce(var.service_key, random_password.service_key.result)
  postgres_password = coalesce(var.postgres_password, random_password.postgres.result)

  data_root = "/mnt/rebase-data"

  # Derived from the volume id rather than read from `linux_device`:
  # that attribute is only populated once the volume is attached, and the
  # attachment depends on the server whose boot script needs this path.
  # Hetzner guarantees this by-id path for an attached volume.
  data_device = "/dev/disk/by-id/scsi-0HC_Volume_${hcloud_volume.data.id}"

  s3_enabled  = var.s3_bucket != null
  s3_endpoint = coalesce(var.s3_endpoint, "https://${var.location}.your-objectstorage.com")
  s3_region   = coalesce(var.s3_region, var.location)

  # `db` and `api` talk over the compose network, so this host name is the only
  # place the database is reachable from. Nothing publishes 5432 to the world.
  database_url = "postgres://rebase:${local.postgres_password}@db:5432/rebase"

  storage_env = local.s3_enabled ? {
    STORAGE_TYPE         = "s3"
    S3_BUCKET            = var.s3_bucket
    S3_ENDPOINT          = local.s3_endpoint
    S3_REGION            = local.s3_region
    S3_ACCESS_KEY_ID     = coalesce(var.s3_access_key_id, "")
    S3_SECRET_ACCESS_KEY = coalesce(var.s3_secret_access_key, "")
    } : {
    FORCE_LOCAL_STORAGE = "true"
  }

  bundle_env = local.uses_bundle_url ? merge(
    {
      REBASE_BUNDLE_URL = var.bundle_url
      # A fixed directory, not a fresh temp dir per boot: a restart then costs a
      # manifest check rather than a download and an `npm ci`. It lives on the
      # attached volume so a host rebuild does not re-pay either.
      REBASE_BUNDLE_FETCH_DIR = "/bundle-cache"
    },
    var.bundle_token == null ? {} : { REBASE_BUNDLE_TOKEN = var.bundle_token }
  ) : {}

  runtime_env = merge(
    {
      DATABASE_URL           = local.database_url
      JWT_SECRET             = local.jwt_secret
      REBASE_SERVICE_KEY     = local.service_key
      CORS_ORIGINS           = join(",", var.cors_origins)
      PORT                   = "8080"
      REBASE_MIGRATE_ON_BOOT = var.migrate_on_boot
      # Caddy is the only thing in front of the runtime, and it appends the
      # caller to X-Forwarded-For. Without this every request looks like it came
      # from the Caddy container and all callers share one rate-limit bucket.
      TRUSTED_PROXY_HOPS = "1"
    },
    local.storage_env,
    local.bundle_env,
    var.extra_env,
  )

  # Docker Compose interpolates `$VAR` in its own file, AFTER the YAML is
  # parsed — so a `$` inside a secret is silently eaten and the container
  # receives a truncated value. `yamlencode` cannot prevent this; it is a second
  # substitution pass over already-valid YAML. `$$` is compose's escape for a
  # literal `$`.
  #
  # Generated secrets are alphanumeric and never hit this. A *supplied* one can:
  # an S3 secret access key containing `$with` cost a compose warning and a
  # wrong credential, which surfaces much later as a storage 403.
  compose_env = { for k, v in local.runtime_env : k => replace(v, "$", "$$") }

  # ── The stack ──────────────────────────────────────────────────────────────
  #
  # This is `infra/docker/docker-compose.selfhost.yml` with two host-specific
  # changes and no others: state lives on the attached volume rather than in a
  # named Docker volume, and Caddy terminates TLS in front. Every image, every
  # environment variable and the bundle contract are identical, because the
  # point of a bundle is that the same one runs under compose, on Rebase Cloud,
  # under the Helm chart and here. If those two files ever disagree about
  # anything else, this one is wrong.
  #
  # Built with `yamlencode` rather than a text template so that a `$`, a colon
  # or a newline inside a generated secret cannot produce invalid YAML.
  compose = yamlencode({
    name = "rebase"
    services = {
      db = {
        image   = var.postgres_image
        restart = "unless-stopped"
        environment = {
          POSTGRES_USER     = "rebase"
          POSTGRES_PASSWORD = replace(local.postgres_password, "$", "$$")
          POSTGRES_DB       = "rebase"
        }
        # `/var/lib/postgresql`, NOT `/var/lib/postgresql/data`: the 18 image
        # places data in a major-versioned subdirectory so pg_upgrade --link can
        # run without crossing a mount boundary. Mounting the old path leaves it
        # treating the volume as unused and restart-looping.
        volumes = ["${local.data_root}/postgres:/var/lib/postgresql"]
        # Bound to loopback: reachable through an SSH tunnel for `rebase db push`,
        # not from the internet. The firewall blocks 5432 too — this is the
        # second lock, for the day someone widens the first.
        ports = ["127.0.0.1:5432:5432"]
        healthcheck = {
          test     = ["CMD-SHELL", "pg_isready -U rebase -d rebase"]
          interval = "5s"
          timeout  = "5s"
          retries  = 12
        }
      }

      api = {
        image       = local.runtime_image
        restart     = "unless-stopped"
        depends_on  = { db = { condition = "service_healthy" } }
        environment = local.compose_env
        volumes = concat(
          local.uses_bundle_url ? ["${local.data_root}/bundle-cache:/bundle-cache"] : [],
          # A bundle baked into the image already sits at /bundle; nothing to mount.
          [],
        )
        # No published ports. Caddy reaches this over the compose network, so
        # 8080 is never exposed and cannot be hit around the TLS terminator.
        expose = ["8080"]
      }

      caddy = {
        image      = "caddy:2-alpine"
        restart    = "unless-stopped"
        depends_on = ["api"]
        ports      = ["80:80", "443:443", "443:443/udp"]
        volumes = [
          "${local.data_root}/caddy/Caddyfile:/etc/caddy/Caddyfile:ro",
          # Certificates. On the attached volume so a host rebuild does not
          # re-issue them and walk into Let's Encrypt's rate limit.
          "${local.data_root}/caddy/data:/data",
          "${local.data_root}/caddy/config:/config",
        ]
      }
    }
  })

  caddyfile = <<-EOT
    {
    ${var.acme_email == null ? "" : "  email ${var.acme_email}"}
    }

    ${var.domain} {
      reverse_proxy api:8080
    }
  EOT

  cloud_init = "#cloud-config\n${yamlencode({
    package_update  = true
    package_upgrade = false
    packages        = ["docker.io", "docker-compose-v2", "ca-certificates"]

    write_files = [
      {
        path        = "/opt/rebase-compose.yml"
        encoding    = "b64"
        content     = base64encode(local.compose)
        permissions = "0600"
      },
      {
        path        = "/opt/rebase-caddyfile"
        encoding    = "b64"
        content     = base64encode(local.caddyfile)
        permissions = "0644"
      },
      {
        path        = "/opt/rebase-up.sh"
        encoding    = "b64"
        permissions = "0700"
        content = base64encode(<<-EOT
          #!/bin/bash
          # Bring the stack up once the data volume is actually mounted.
          #
          # Terraform attaches the volume AFTER the server is created, so at the
          # moment cloud-init starts the device may not exist yet. Polling for it
          # is the difference between a first boot that works and one that starts
          # Postgres against the root disk and silently puts the database
          # somewhere `terraform taint` will destroy.
          set -euo pipefail

          DEVICE="${local.data_device}"
          ROOT="${local.data_root}"

          for _ in $(seq 1 60); do
            [ -b "$DEVICE" ] && break
            sleep 5
          done
          if [ ! -b "$DEVICE" ]; then
            echo "data volume $DEVICE never appeared; refusing to start" >&2
            exit 1
          fi

          # The volume is created with an ext4 filesystem already. Format only if
          # it is genuinely blank, so a re-run can never wipe live data.
          if ! blkid "$DEVICE" >/dev/null 2>&1; then
            mkfs.ext4 -F "$DEVICE"
          fi

          mkdir -p "$ROOT"
          grep -q "$ROOT" /etc/fstab || \
            echo "$DEVICE $ROOT ext4 discard,nofail,defaults 0 0" >> /etc/fstab
          mountpoint -q "$ROOT" || mount "$ROOT"

          mkdir -p "$ROOT/postgres" "$ROOT/caddy/data" "$ROOT/caddy/config" "$ROOT/bundle-cache"
          cp /opt/rebase-caddyfile "$ROOT/caddy/Caddyfile"

          # The runtime image runs as the unprivileged `node` user (UID 1000).
          # Anything it writes to a bind mount — the unpacked bundle and its
          # installed dependencies — needs to be its to write, or the boot fails
          # with EACCES somewhere far from the cause.
          chown -R 1000:1000 "$ROOT/bundle-cache"

          systemctl enable --now docker
          docker compose -f /opt/rebase-compose.yml up -d

          # Wait for the runtime to report healthy, and record the outcome.
          #
          # Without this the host finishes cloud-init successfully whether or not
          # anything is serving, and a bundle that fails to fetch looks identical
          # to one that worked — `terraform apply` says "Apply complete" either
          # way. The marker file is the thing to `cat` when the domain does not
          # answer. First boot legitimately takes minutes: the bundle downloads
          # and its dependencies install before the first request is served.
          CID=$(docker compose -f /opt/rebase-compose.yml ps -q api)
          for _ in $(seq 1 120); do
            STATE=$(docker inspect -f '{{.State.Health.Status}}' "$CID" 2>/dev/null || echo starting)
            [ "$STATE" = "healthy" ] && break
            sleep 5
          done

          if [ "$STATE" = "healthy" ]; then
            echo "rebase: runtime healthy" > /opt/rebase-status
          else
            {
              echo "rebase: runtime did NOT become healthy (last state: $STATE)"
              echo "logs:  docker compose -f /opt/rebase-compose.yml logs api"
            } > /opt/rebase-status
            docker compose -f /opt/rebase-compose.yml logs --tail 50 api >&2 || true
          fi
          cat /opt/rebase-status
        EOT
        )
      },
    ]

    runcmd = [["/opt/rebase-up.sh"]]
  })}"
}

resource "random_password" "jwt" {
  length = 48
  # Alphanumeric on purpose. These values land in a YAML document and in shell
  # environments; a `$` or a quote in a generated secret is a class of bug that
  # only shows up on the one apply that happens to produce one.
  special = false
}

resource "random_password" "service_key" {
  length  = 48
  special = false
}

resource "random_password" "postgres" {
  length  = 32
  special = false
}

resource "hcloud_ssh_key" "this" {
  for_each = { for key in var.ssh_public_keys : substr(md5(key), 0, 8) => key }

  name       = "${var.name}-${each.key}"
  public_key = each.value
}

# Separate from the server so the address survives a rebuild. DNS pointing at a
# host you can no longer replace without changing DNS is not a host you will
# replace.
resource "hcloud_primary_ip" "ipv4" {
  name        = "${var.name}-ipv4"
  type        = "ipv4"
  location    = var.location
  auto_delete = false
  labels      = { managed_by = "terraform", app = var.name }

  lifecycle {
    # Losing the address means losing the DNS record that points at it.
    prevent_destroy = false
  }
}

resource "hcloud_primary_ip" "ipv6" {
  name        = "${var.name}-ipv6"
  type        = "ipv6"
  location    = var.location
  auto_delete = false
  labels      = { managed_by = "terraform", app = var.name }
}

resource "hcloud_firewall" "this" {
  name   = "${var.name}-firewall"
  labels = { managed_by = "terraform", app = var.name }

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = var.ssh_source_ips
  }

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "80"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "443"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # HTTP/3. Caddy advertises it; without this the browser retries over TCP and
  # the only symptom is that it feels slower than it should.
  rule {
    direction  = "in"
    protocol   = "udp"
    port       = "443"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    direction  = "in"
    protocol   = "icmp"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # No rule for 5432. Reach Postgres over the SSH tunnel in the `db_tunnel_command`
  # output; a database port open to the internet is how a Rebase deployment gets
  # its rows read around row-level security rather than through it.
}

resource "hcloud_volume" "data" {
  name              = "${var.name}-data"
  size              = var.data_volume_size
  location          = var.location
  format            = "ext4"
  delete_protection = var.delete_protection
  labels            = { managed_by = "terraform", app = var.name }

  lifecycle {
    # Growing is fine; anything that would replace this volume destroys the
    # database. Size changes apply in place because Hetzner volumes can grow.
    ignore_changes = [format]
  }
}

resource "hcloud_server" "this" {
  name        = var.name
  image       = var.image_os
  server_type = var.server_type
  location    = var.location
  ssh_keys    = [for key in hcloud_ssh_key.this : key.id]

  firewall_ids = [hcloud_firewall.this.id]
  backups      = var.enable_backups

  delete_protection  = var.delete_protection
  rebuild_protection = var.delete_protection

  user_data = local.cloud_init
  labels    = { managed_by = "terraform", app = var.name }

  public_net {
    ipv4_enabled = true
    ipv4         = hcloud_primary_ip.ipv4.id
    ipv6_enabled = true
    ipv6         = hcloud_primary_ip.ipv6.id
  }

  lifecycle {
    precondition {
      condition     = (var.bundle_url != null) != (var.image != null)
      error_message = <<-EOT
        Set exactly one of `bundle_url` or `image`.

        `bundle_url` points the published runtime at a `rebase build` tarball it
        fetches on every start — the same mechanism the Helm chart and Cloud Run
        use. `image` runs an image with the bundle already baked in. Setting
        both is ambiguous; setting neither leaves the runtime with no project to
        serve, and it will refuse to boot rather than serve an empty schema.
      EOT
    }

    precondition {
      condition     = var.bundle_url == null || var.image != null || local.runtime_can_fetch_bundle
      error_message = <<-EOT
        `bundle_url` needs a runtime that fetches its own bundle, and
        `rebasepro/server:${var.runtime_version}` cannot.

        This module sets REBASE_BUNDLE_URL and relies on the runtime to download
        the tarball at boot. That landed after 0.16.0. At or below it the
        entrypoint looks only for a bundle already on disk and exits with
        `No bundle found at /bundle.` — so this apply would succeed and leave a
        container restart-looping behind a proxy serving 502s.

        `latest` is not a way around it, and it is the default: what a floating
        tag resolves to cannot be checked from here, and it moves under a
        deployment between one apply and the next.

        Pin `runtime_version` to a release above 0.16.0, or bake the bundle into
        an image and pass `image` instead.
      EOT
    }

    precondition {
      condition     = local.s3_enabled || var.force_local_storage
      error_message = <<-EOT
        Configure `s3_bucket` (with its endpoint and credentials), or set
        `force_local_storage = true`.

        The runtime hard-fails at production boot when storage is left local,
        because the container filesystem is destroyed on every restart and a
        `local` backend in production is silent data loss. Failing here is the
        same refusal, moved to where the error is still readable.
      EOT
    }

    precondition {
      condition     = !local.s3_enabled || (var.s3_access_key_id != null && var.s3_secret_access_key != null)
      error_message = "s3_bucket is set, so s3_access_key_id and s3_secret_access_key are required."
    }
  }
}

resource "hcloud_volume_attachment" "data" {
  volume_id = hcloud_volume.data.id
  server_id = hcloud_server.this.id
  automount = false
}
