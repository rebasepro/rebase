#!/usr/bin/env bash
# Re-verifies every claim in the explainer "view-side-door" against a real,
# throwaway Postgres: initdb into a temp dir, start it on a spare TCP port
# (localhost only, no Unix socket), run scripts/proof/view-side-door.sql as
# its superuser, compare the output with view-side-door.expected, stop the
# server and delete the cluster. Never touches any other database.
#
#   pnpm proof:view-side-door                    # newest Homebrew Postgres
#   PG_BIN=/path/to/bin pnpm proof:view-side-door
#   PORT=54999 ... (default 54871)
#   UPDATE=1 ...                                 # rewrite the expected file
#
# On Postgres 14 the diff fails at the first `security_invoker`: that is the
# "Postgres 15+" claim, and the reason the version is printed first.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
sql="$here/proof/view-side-door.sql"
expected="$here/proof/view-side-door.expected"
port="${PORT:-54871}"

if [[ -z "${PG_BIN:-}" ]]; then
    for d in /opt/homebrew/opt/postgresql@18/bin /opt/homebrew/opt/postgresql@17/bin /opt/homebrew/opt/postgresql@16/bin /opt/homebrew/opt/postgresql@15/bin; do
        [[ -x "$d/initdb" ]] && PG_BIN="$d" && break
    done
fi
if [[ -z "${PG_BIN:-}" || ! -x "$PG_BIN/initdb" ]]; then
    echo "proof: no Postgres binaries found; set PG_BIN to a directory with initdb, pg_ctl and psql" >&2
    exit 2
fi

if (echo > "/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    echo "proof: port $port is in use; set PORT to a free one" >&2
    exit 2
fi

dir="$(mktemp -d "${TMPDIR:-/tmp}/rebase-proof.XXXXXX")"
cleanup() {
    "$PG_BIN/pg_ctl" -D "$dir/data" -m immediate stop >/dev/null 2>&1 || true
    rm -rf "$dir"
}
trap cleanup EXIT

export LANG=C LC_ALL=C
"$PG_BIN/initdb" -D "$dir/data" -U postgres -A trust --locale=C >/dev/null
"$PG_BIN/pg_ctl" -D "$dir/data" -o "-p $port -k '' -c listen_addresses=127.0.0.1" -l "$dir/log" -w start >/dev/null

psql=("$PG_BIN/psql" -h 127.0.0.1 -p "$port" -U postgres -X -q)
echo "proof: $("${psql[@]}" -Atc 'select version()')"
"${psql[@]}" -c 'create database proof' >/dev/null

out="$dir/out"
"${psql[@]}" -d proof -e -f "$sql" > "$out" 2>&1 || true
# psql prefixes errors from a file with its name and line; drop those so the
# expected file does not depend on where the repo lives.
sed -E 's#^psql:[^:]+:[0-9]+: ##' "$out" > "$out.clean"

if [[ -n "${UPDATE:-}" ]]; then
    cp "$out.clean" "$expected"
    echo "proof: wrote $expected"
    exit 0
fi
if diff -u "$expected" "$out.clean"; then
    echo "proof: OK — every statement and result matches view-side-door.expected"
else
    echo "proof: FAILED — the output above differs from view-side-door.expected" >&2
    exit 1
fi
