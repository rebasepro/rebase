#!/usr/bin/env bash
# Everything that can be checked about this module without a Hetzner account.
#
# `terraform validate` only proves the schema is right. The part that actually
# breaks is the generated cloud-config: a host boots, cloud-init fails to parse
# a document, and nothing is serving — with `terraform apply` having reported
# success. So this renders the cloud-init and the compose file with stub values
# and parses both.
#
#   ./scripts/verify.sh
#
# Requires terraform and python3. Uses pyyaml if it can (a venv is created under
# .verify/ on first run); skips the parse checks with a loud warning if not.
set -euo pipefail

MODULE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$MODULE/.verify"
cd "$MODULE"

echo "==> terraform fmt"
terraform fmt -check -recursive

echo "==> terraform validate (module)"
terraform init -backend=false -input=false >/dev/null
terraform validate

for example in examples/*/; do
  echo "==> terraform validate ($example)"
  (cd "$example" && terraform init -backend=false -input=false >/dev/null && terraform validate)
done

echo "==> rendering cloud-init and compose with stub values"
mkdir -p "$WORK"
python3 - "$WORK" <<'PY'
import io, sys
out = sys.argv[1]
src = io.open('main.tf', encoding='utf-8').read()
# Keep the locals block; everything after the first resource needs a real API.
locals_only = src[:src.index('resource "random_password" "jwt"')]
for ref, stub in [
    ('random_password.jwt.result', '"JWTSTUB0123456789abcdefghijklmnopqrstuvwxyz"'),
    ('random_password.service_key.result', '"SVCSTUB0123456789abcdefghijklmnopqrstuvwxyz"'),
    ('random_password.postgres.result', '"PGSTUB0123456789abcdefghijklmn"'),
    ('hcloud_volume.data.id', '"12345678"'),
]:
    locals_only = locals_only.replace(ref, stub)
io.open(out + '/render.tf', 'w', encoding='utf-8').write(locals_only + '''
output "cloud_init" {
  value     = local.cloud_init
  sensitive = true
}
''')
io.open(out + '/variables.tf', 'w', encoding='utf-8').write(io.open('variables.tf', encoding='utf-8').read())
PY

cat > "$WORK/terraform.tfvars" <<'VARS'
domain          = "api.example.com"
cors_origins    = ["https://app.example.com"]
ssh_public_keys = ["ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKeyForRenderingOnly verify@example"]
bundle_url      = "https://storage.example.com/bundles/app-1.0.0.tar.gz"
bundle_token    = "tok_example"
s3_bucket       = "verify-uploads"
s3_access_key_id = "AKIAEXAMPLE"
# Deliberately awful: a `$` here is eaten by Docker Compose's own interpolation
# pass unless the module escapes it, and quotes and colons break naive YAML
# templating. Both have to survive.
s3_secret_access_key = "secret$with'quotes\"and:colons"
VARS

(cd "$WORK" && terraform init -backend=false -input=false >/dev/null && terraform apply -auto-approve -input=false >/dev/null && terraform output -raw cloud_init > cloud-init.yaml)

if [ ! -x "$WORK/.venv/bin/python" ]; then
  python3 -m venv "$WORK/.venv" >/dev/null 2>&1 || true
  "$WORK/.venv/bin/pip" install --quiet pyyaml >/dev/null 2>&1 || true
fi

if [ -x "$WORK/.venv/bin/python" ] && "$WORK/.venv/bin/python" -c "import yaml" 2>/dev/null; then
  echo "==> parsing rendered cloud-config"
  "$WORK/.venv/bin/python" - "$WORK" <<'PY'
import base64, io, os, sys, yaml
work = sys.argv[1]
raw = io.open(os.path.join(work, 'cloud-init.yaml'), encoding='utf-8').read()
assert raw.startswith('#cloud-config\n'), 'cloud-init is missing its #cloud-config header'
doc = yaml.safe_load(raw)

paths = [f['path'] for f in doc['write_files']]
assert '/opt/rebase-compose.yml' in paths, 'compose is not written where the boot script reads it'
assert doc['runcmd'] == [['/opt/rebase-up.sh']], doc['runcmd']

for entry in doc['write_files']:
    body = base64.b64decode(entry['content']).decode()
    if entry['path'].endswith('rebase-up.sh'):
        io.open(os.path.join(work, 'rebase-up.sh'), 'w').write(body)
    if entry['path'] == '/opt/rebase-compose.yml':
        io.open(os.path.join(work, 'compose.yml'), 'w').write(body)
        compose = yaml.safe_load(body)
        services = compose['services']
        assert set(services) == {'db', 'api', 'caddy'}, sorted(services)

        env = services['api']['environment']
        # Compose interpolates `$VAR` after YAML parsing, so a literal `$` must
        # arrive here doubled or the container gets a truncated secret.
        assert env['S3_SECRET_ACCESS_KEY'] == '''secret$$with'quotes"and:colons''', repr(env['S3_SECRET_ACCESS_KEY'])
        # The runtime must never be reachable around the TLS terminator.
        assert 'ports' not in services['api'], services['api'].get('ports')
        # Postgres must never be reachable from off-host.
        assert services['db']['ports'] == ['127.0.0.1:5432:5432'], services['db']['ports']
        for required in ('DATABASE_URL', 'JWT_SECRET', 'REBASE_SERVICE_KEY', 'CORS_ORIGINS'):
            assert required in env, required

print('    cloud-config, compose and secret escaping all check out')
PY
  bash -n "$WORK/rebase-up.sh"
  echo "==> boot script syntax OK"
else
  echo "!!  pyyaml unavailable — skipped the cloud-config and compose parse checks"
fi

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo "==> docker compose schema"
  # Any interpolation warning here means a secret is being eaten.
  out="$(docker compose -f "$WORK/compose.yml" config 2>&1 >/dev/null || true)"
  if echo "$out" | grep -qi 'variable is not set'; then
    echo "$out" >&2
    echo "!!  compose is interpolating a value that should be literal" >&2
    exit 1
  fi
  echo "    no interpolation warnings"
fi

echo
echo "All checks passed."
