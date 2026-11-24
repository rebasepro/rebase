#!/usr/bin/env bash
# The documented first run of a new Rebase project, timed step by step.
#
#   tooling/scripts/loop/fresh-init.sh <scratch-dir> [options]
#
#     --cli <spec>       package spec to run init from (default @rebasepro/cli@latest)
#     --pm pnpm|npm      pnpm dlx … / npx … (default pnpm)
#     --registry <url>   serve packages from this registry (a local Verdaccio);
#                        HOME is isolated under <scratch-dir> either way
#     --keep             leave `rebase dev` running at the end (for browser checks);
#                        stop it later with: fresh-init.sh <scratch-dir> --stop
#     --stop             stop a run left with --keep, and exit
#
# Steps, as website/src/content/docs/docs/getting-started/quickstart.md and
# init's own "Next steps" tell a new user: init (interactive, every default
# taken) → install → dev (managed PGlite, no DATABASE_URL) → seed → add a table
# the documented way → generate the SDK + run the example → build → doctor.
#
# Never inside the repository: <scratch-dir> must be outside it (installs are GBs).
# Telemetry is disabled for every command (REBASE_TELEMETRY_DISABLED=1), so loop
# runs never reach the analytics warehouse.
#
# Exit status is non-zero when any step fails. The last lines are a timings
# table and the warning counts the noise check reads.
set -uo pipefail

DIR="${1:-}"
[ -n "$DIR" ] || { sed -n '2,22p' "$0"; exit 2; }
shift
CLI_SPEC="@rebasepro/cli@latest"
PM="pnpm"
REGISTRY=""
KEEP=0
STOP=0
while [ $# -gt 0 ]; do
    case "$1" in
        --cli) CLI_SPEC="$2"; shift 2 ;;
        --pm) PM="$2"; shift 2 ;;
        --registry) REGISTRY="$2"; shift 2 ;;
        --keep) KEEP=1; shift ;;
        --stop) STOP=1; shift ;;
        *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
done

REPO="$(cd "$(dirname "$0")/../../.." && pwd -P)"
mkdir -p "$DIR"
DIR="$(cd "$DIR" && pwd -P)"
case "$DIR/" in "$REPO"/*) echo "refusing: $DIR is inside the repository" >&2; exit 2 ;; esac

APP="$DIR/my-app"
LOGS="$DIR/logs"
PIDFILE="$DIR/dev.pid"
mkdir -p "$LOGS" "$DIR/home"

export HOME="$DIR/home"
export REBASE_TELEMETRY_DISABLED=1
export CI=""   # init must see an interactive run, as a user's terminal is
if [ -n "$REGISTRY" ]; then
    export npm_config_registry="$REGISTRY"
    printf 'registry=%s\n' "$REGISTRY" > "$HOME/.npmrc"
fi

strip() { sed 's/\x1b\[[0-9;?]*[a-zA-Z]//g' | tr '\r' '\n'; }

stop_dev() {
    if [ -f "$PIDFILE" ]; then
        local pid
        pid="$(cat "$PIDFILE")"
        kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
        for _ in $(seq 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
        kill -KILL -- "-$pid" 2>/dev/null || true
        rm -f "$PIDFILE"
    fi
    # The managed database is a detached daemon `dev` reuses; it outlives dev.
    if [ -d "$APP" ]; then (cd "$APP" && $PM exec rebase db stop >/dev/null 2>&1 || true); fi
}

if [ "$STOP" = 1 ]; then stop_dev; echo "stopped"; exit 0; fi

declare -a STEP_NAMES=() STEP_SECS=() STEP_RESULTS=()
FAILED=0
record() { STEP_NAMES+=("$1"); STEP_SECS+=("$2"); STEP_RESULTS+=("$3"); [ "$3" = ok ] || FAILED=1; }

# run_step <name> <command…>: run in $APP (or $DIR before init), log, time.
run_step() {
    local name="$1"; shift
    local start end status
    start=$(date +%s)
    ( cd "$([ -d "$APP" ] && echo "$APP" || echo "$DIR")" && "$@" ) > "$LOGS/$name.log" 2>&1
    status=$?
    end=$(date +%s)
    record "$name" "$((end - start))" "$([ $status = 0 ] && echo ok || echo "FAIL($status)")"
    echo "── $name: $([ $status = 0 ] && echo ok || echo "FAILED ($status)") in $((end - start))s (log: $LOGS/$name.log)"
    return $status
}

# ── 1. init, interactively, taking every default (Enter every 2s) ──────────
rm -rf "$APP"
if [ "$PM" = pnpm ]; then INIT=(pnpm dlx "$CLI_SPEC" init my-app); else INIT=(npx -y "$CLI_SPEC" init my-app); fi
# The feeder dies of SIGPIPE once init exits; the status that counts is init's.
init_cmd() {
    (for _ in $(seq 150); do sleep 2; printf '\r'; done) 2>/dev/null | script -q /dev/null "${INIT[@]}"
    return "${PIPESTATUS[1]}"
}
run_step init init_cmd || { echo "init failed"; }
[ -d "$APP" ] || { echo "no project was created"; strip < "$LOGS/init.log" | tail -30; exit 1; }
if [ -n "$REGISTRY" ]; then printf '\nregistry=%s\n' "$REGISTRY" >> "$APP/.npmrc"; fi

# ── 2. install, as the quickstart says ─────────────────────────────────────
run_step install "$PM" install

# ── 3. dev: managed PGlite, both servers, wait for the banner ──────────────
start=$(date +%s)
set -m
( cd "$APP" && exec "$PM" run dev ) > "$LOGS/dev.log" 2>&1 &
echo $! > "$PIDFILE"
set +m
for _ in $(seq 180); do
    grep -q "Rebase is ready" "$LOGS/dev.log" && break
    kill -0 "$(cat "$PIDFILE")" 2>/dev/null || break
    sleep 1
done
ADMIN_URL="$(strip < "$LOGS/dev.log" | grep -o 'Admin: http://[^ ]*' | head -1 | cut -d' ' -f2)"
API_URL="$(strip < "$LOGS/dev.log" | grep -o 'API:   http://[^ ]*' | head -1 | awk '{print $2}')"
health="$(curl -s -o /dev/null -w '%{http_code}' "$API_URL/health" 2>/dev/null)"
admin="$(curl -s -o /dev/null -w '%{http_code}' "$ADMIN_URL" 2>/dev/null)"
if [ -n "$API_URL" ] && [ "$health" = 200 ] && [ "$admin" = 200 ]; then r=ok; else r="FAIL(health=$health admin=$admin)"; fi
record dev "$(( $(date +%s) - start ))" "$r"
echo "── dev: $r in $(( $(date +%s) - start ))s — Admin $ADMIN_URL · API $API_URL"

# ── 4. seed (init's "Once it is running" step 1) ──────────────────────────
run_step seed "$PM" run seed

# ── 5. add a table the documented way; boot creates it ────────────────────
start=$(date +%s)
cat > "$APP/backend/schema/products.ts" <<'EOF'
import { defineTable, col } from "@rebasepro/server/schema";

export const products = defineTable("products", {
    columns: {
        id:          col.uuid().primaryKey().defaultRandom(),
        name:        col.text().notNull(),
        price:       col.numeric().notNull().validate({ min: 0 }),
        description: col.text(),
        active:      col.boolean().default(true),
        createdAt:   col.timestamp({ withTimezone: true }).onCreateNow(),
    },
    // Takes the defaultRls the scaffold's index.ts exports: everyone reads, admins write.
    rls: "inherit",
});
EOF
printf '\nexport { products } from "./products";\n' >> "$APP/backend/schema/index.ts"
SERVICE_KEY="$(grep '^REBASE_SERVICE_KEY=' "$APP/.env" | cut -d= -f2-)"
code=000
for _ in $(seq 90); do
    code="$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $SERVICE_KEY" "$API_URL/api/data/products" 2>/dev/null)"
    [ "$code" = 200 ] && break
    sleep 1
done
record add-table "$(( $(date +%s) - start ))" "$([ "$code" = 200 ] && echo ok || echo "FAIL(GET products=$code)")"
echo "── add-table: GET /api/data/products → $code in $(( $(date +%s) - start ))s"

# ── 6. typed SDK + the example script that queries it ─────────────────────
run_step generate-sdk "$PM" run generate:sdk
grep -q "products" "$APP/generated/sdk/database.types.ts" || record sdk-has-products 0 "FAIL(no products in generated types)"
run_step example "$PM" run example

# ── 7. build, 8. doctor ───────────────────────────────────────────────────
run_step build "$PM" run build
run_step doctor "$PM" exec rebase doctor

if [ "$KEEP" = 1 ]; then
    echo "dev left running (pid $(cat "$PIDFILE")): Admin $ADMIN_URL · API $API_URL — stop with: $0 $DIR --stop"
else
    stop_dev
fi

# ── noise check + timings ─────────────────────────────────────────────────
echo
echo "noise:"
echo "  init warnings:  $(strip < "$LOGS/init.log" | grep -ciE 'warn|deprecated|ERR_' || true)"
echo "  dev WARN lines: $(strip < "$LOGS/dev.log" | grep -c 'WARN' || true)"
strip < "$LOGS/dev.log" | grep 'WARN' | sed 's/^ *//' | sort | uniq -c | sort -rn | head -10 | sed 's/^/    /'
echo "  dev ERROR lines: $(strip < "$LOGS/dev.log" | grep -cE 'ERROR|❌' || true)"
echo
printf '| %-16s | %6s | %s\n' step secs result
printf '|------------------|--------|--------\n'
for i in "${!STEP_NAMES[@]}"; do
    printf '| %-16s | %6s | %s\n' "${STEP_NAMES[$i]}" "${STEP_SECS[$i]}" "${STEP_RESULTS[$i]}"
done
exit $FAILED
