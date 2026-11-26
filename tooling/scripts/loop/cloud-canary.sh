#!/usr/bin/env bash
# The documented path from nothing to a live Rebase Cloud project, timed step by
# step: create → scaffold → link → deploy → verify what is actually serving →
# delete the project again.
#
#   tooling/scripts/loop/cloud-canary.sh <scratch-dir> [options]
#
#     --cli <command>    the CLI to drive, as a user has it (default: rebase, the
#                        globally installed one)
#     --keep             leave the scaffold on disk (default: only logs/ is kept)
#
# It leaves nothing behind in the cloud. Each run creates its own project,
# `loop-canary-<UTC date>`, in the Rebase Team organization, and deletes it when
# the script exits, however it exits (an EXIT trap: a failed step, Ctrl-C, a
# kill). A new slug per run because a deleted project's subdomain cannot be
# used again. On the way out it also deletes any other `loop-canary` /
# `loop-canary-<8 digits>` project a crashed run left, and fails if one is
# still listed afterwards. The slug is not an option: this script cannot name,
# deploy to or delete a project outside that pattern. It never sets env or
# cron. It refuses when nobody is signed in, when there is no Rebase Team
# organization, or when the link that `cloud link` wrote names another project.
#
# "Live" is checked from outside, because the platform's own status can say
# healthy while the old version serves: the page, /health, an asset whose bytes
# must equal the local build's, the boot line carrying this deployment's id,
# the pod's restart count, the error lines since the deploy, and one SQL query.
#
# Uses the signed-in session in ~/.rebase/credentials.json (or REBASE_TOKEN).
# Telemetry is disabled for every command. Never inside the repository.
# Exit status is non-zero when any step fails; the last lines are a table.
set -uo pipefail

SLUG="loop-canary-$(date -u +%Y%m%d)"   # this run's project; created and deleted here
CANARY_SLUG_RE='^loop-canary(-[0-9]{8})?$'   # the only slugs this script may touch
ORG_NAME="Rebase Team"                      # test projects go here, never in a client's org
HOST="https://$SLUG.rebase.website"

DIR="${1:-}"
[ -n "$DIR" ] || { sed -n '2,25p' "$0"; exit 2; }
shift
CLI="rebase"
KEEP=0
while [ $# -gt 0 ]; do
    case "$1" in
        --cli) CLI="$2"; shift 2 ;;
        --keep) KEEP=1; shift ;;
        *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
done

REPO="$(cd "$(dirname "$0")/../../.." && pwd -P)"
mkdir -p "$DIR"
DIR="$(cd "$DIR" && pwd -P)"
case "$DIR/" in "$REPO"/*) echo "refusing: $DIR is inside the repository" >&2; exit 2 ;; esac

APP="$DIR/$SLUG"
LOGS="$DIR/logs"
mkdir -p "$LOGS"
export REBASE_TELEMETRY_DISABLED=1

strip() { sed 's/\x1b\[[0-9;?]*[a-zA-Z]//g' | tr '\r' '\n'; }
# One field of a JSON document on stdin, by dotted path; empty when absent.
jget() { python3 -c '
import json, sys
try:
    v = json.load(sys.stdin)
    for k in sys.argv[1].split("."):
        v = v[int(k)] if isinstance(v, list) else v[k]
    print("" if v is None else v)
except Exception:
    pass' "$1"; }

declare -a STEP_NAMES=() STEP_SECS=() STEP_RESULTS=()
FAILED=0
record() { STEP_NAMES+=("$1"); STEP_SECS+=("$2"); STEP_RESULTS+=("$3"); case "$3" in ok*) ;; *) FAILED=1 ;; esac; }
finish() {
    echo
    printf '| %-14s | %5s | %s\n' step secs result
    printf '|----------------|-------|--------\n'
    for i in "${!STEP_NAMES[@]}"; do
        printf '| %-14s | %5s | %s\n' "${STEP_NAMES[$i]}" "${STEP_SECS[$i]}" "${STEP_RESULTS[$i]}"
    done
    [ "$KEEP" = 1 ] || rm -rf "$APP"
    exit "$FAILED"
}
# Slugs of every project, in any organization, that matches the canary pattern.
canary_slugs() { "$CLI" cloud projects list --all-orgs --json 2>/dev/null | python3 -c '
import json, re, sys
pat = re.compile(sys.argv[1])
def walk(x):
    if isinstance(x, dict):
        s = x.get("slug")
        if isinstance(s, str) and x.get("id") and pat.match(s): print(s)
        for v in x.values(): walk(v)
    elif isinstance(x, list):
        for v in x: walk(v)
try: walk(json.load(sys.stdin))
except json.JSONDecodeError: pass' "$CANARY_SLUG_RE" | sort -u; }
# Runs on every exit. Deletes this run's project and any canary an earlier run
# left, then reads the list back: a canary still there turns the exit red.
TEARDOWN_DONE=0
teardown() {
    local status=$? left s
    [ "$TEARDOWN_DONE" = 0 ] || return
    TEARDOWN_DONE=1
    trap - EXIT INT TERM
    for s in $(canary_slugs); do
        [[ "$s" =~ $CANARY_SLUG_RE ]] || continue
        echo "── teardown: deleting $s"
        ( cd "$DIR" && "$CLI" cloud projects delete "$s" --yes ) >> "$LOGS/teardown.log" 2>&1
    done
    left="$(canary_slugs | tr '\n' ' ')"
    if [ -n "$left" ]; then
        echo "── teardown: FAILED, still listed: $left(log: $LOGS/teardown.log)" >&2
        echo "   delete by hand: rebase cloud projects delete <slug> --yes" >&2
        status=1
    else
        echo "── teardown: ok, no canary project is left"
    fi
    exit "$status"
}
trap teardown EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# run_step <name> <command…>: run in $APP (or $DIR before init), log, time.
run_step() {
    local name="$1"; shift
    local start status
    start=$(date +%s)
    ( cd "$([ -d "$APP" ] && echo "$APP" || echo "$DIR")" && "$@" ) > "$LOGS/$name.log" 2>&1
    status=$?
    record "$name" "$(( $(date +%s) - start ))" "$([ $status = 0 ] && echo ok || echo "FAIL($status)")"
    echo "── $name: $([ $status = 0 ] && echo ok || echo "FAILED ($status)") (log: $LOGS/$name.log)"
    return $status
}
# cloud <args…>: one `rebase cloud` call from the scaffold, stdout only (JSON when piped).
cloud() { ( cd "$APP" && "$CLI" cloud "$@" 2>>"$LOGS/cloud.stderr.log" ); }

echo "CLI: $CLI $("$CLI" --version 2>/dev/null | tail -1) ($(command -v "$CLI"))"

# ── 0. signed in, and this run's project exists (created here) ────────────
start=$(date +%s)
who="$("$CLI" cloud whoami 2>/dev/null | jget user.email)"
ORG_ID="$("$CLI" cloud orgs list --json 2>/dev/null | python3 -c '
import json, sys
try:
    for o in json.load(sys.stdin).get("organizations", []):
        if o.get("name") == sys.argv[1]: print(o["id"]); break
except Exception: pass' "$ORG_NAME")"
# Every organization: the canary lives in Rebase Team whatever org is selected.
project_id() { "$CLI" cloud projects list --all-orgs --json 2>/dev/null | python3 -c '
import json, sys
def walk(x):
    if isinstance(x, dict):
        if x.get("slug") == sys.argv[1] and x.get("id"):
            print(x["id"]); raise SystemExit
        for v in x.values(): walk(v)
    elif isinstance(x, list):
        for v in x: walk(v)
try: walk(json.load(sys.stdin))
except json.JSONDecodeError: pass' "$SLUG"; }
if [ -z "$who" ]; then
    record preflight "$(( $(date +%s) - start ))" "FAIL(not signed in: rebase cloud login)"; finish
elif [ -z "$ORG_ID" ]; then
    record preflight "$(( $(date +%s) - start ))" "FAIL(no organization named $ORG_NAME; nothing created)"; finish
fi
record preflight "$(( $(date +%s) - start ))" ok
PROJECT_ID="$(project_id)"
if [ -z "$PROJECT_ID" ]; then
    # --org is explicit: the selected organization can be a client's.
    run_step create "$CLI" cloud projects create --name "$SLUG" --subdomain "$SLUG" --org "$ORG_ID" --yes || finish
    PROJECT_ID="$(project_id)"
    [ -n "$PROJECT_ID" ] || { record created 0 "FAIL(create said ok, but no project with slug $SLUG is listed)"; finish; }
fi
echo "── preflight: signed in, $SLUG is $PROJECT_ID in $ORG_NAME"

# ── 1. scaffold, as the quickstart does without a terminal ────────────────
rm -rf "$APP"
run_step init "$CLI" init "$SLUG" --yes --install || finish
[ -d "$APP" ] || { record scaffold 0 "FAIL(no project directory)"; finish; }

# ── 2. the path init offers, before linking: it must say what to do ───────
start=$(date +%s)
( cd "$APP" && pnpm run deploy ) > "$LOGS/deploy-unlinked.log" 2>&1
if strip < "$LOGS/deploy-unlinked.log" | grep -q "rebase cloud link"; then r=ok; else r="FAIL(unlinked deploy did not name \`rebase cloud link\`)"; fi
record unlinked-hint "$(( $(date +%s) - start ))" "$r"

# ── 3. link, and check what the link names before anything is uploaded ────
run_step link "$CLI" cloud link --project "$SLUG" || finish
linked_id="$(jget projectId < "$APP/.rebase/cloud.json")"
linked_slug="$(jget slug < "$APP/.rebase/cloud.json")"
if [ "$linked_id" != "$PROJECT_ID" ] || [ "$linked_slug" != "$SLUG" ]; then
    record link-target 0 "FAIL(linked to $linked_slug/$linked_id, expected $SLUG/$PROJECT_ID; nothing deployed)"; finish
fi

# ── 4. deploy: init's own last step ───────────────────────────────────────
DEPLOY_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
run_step deploy pnpm run deploy || { strip < "$LOGS/deploy.log" | tail -25; finish; }
DEPLOYMENT="$(strip < "$LOGS/deploy.log" | sed -n 's/.*✓ Deployed .*(deployment \([0-9a-f-]*\)).*/\1/p' | tail -1)"
strip < "$LOGS/deploy.log" | sed -n '/✓ Deployed/,$p'
start=$(date +%s)
if [ -z "$DEPLOYMENT" ]; then r="FAIL(no deployment id in the summary)"
elif ! strip < "$LOGS/deploy.log" | grep -q "✓ Live:"; then r="FAIL(deploy did not confirm live)"
# The scaffold's own CLI prints this line, so it names the slug only from the
# release that carries the fix; an older one names the project by id.
elif ! strip < "$LOGS/deploy.log" | grep -q "✓ Deployed $SLUG "; then r="ok (summary names the project by id, not $SLUG)"
else r=ok; fi
record deploy-summary 0 "$r"

# ── 5. from outside: the page, health, and the bytes of this build ────────
start=$(date +%s)
page="$(curl -s -m 20 -o "$LOGS/index.html" -w '%{http_code}' "$HOST/")"
health="$(curl -s -m 20 "$HOST/health" | jget status)"
auth="$(curl -s -m 20 -o /dev/null -w '%{http_code}' "$HOST/api/auth/config")"
anon="$(curl -s -m 20 -o /dev/null -w '%{http_code}' "$HOST/api/data/posts")"
if [ "$page" = 200 ] && [ "$health" = ok ] && [ "$auth" = 200 ] && [ "$anon" = 401 ]; then r=ok
else r="FAIL(/=$page health=$health auth/config=$auth anonymous posts=$anon, want 200 ok 200 401)"; fi
record http "$(( $(date +%s) - start ))" "$r"

start=$(date +%s)
asset="$(grep -o 'assets/index-[A-Za-z0-9_-]*\.js' "$APP/frontend/dist/index.html" 2>/dev/null | head -1)"
served="$(grep -o 'assets/index-[A-Za-z0-9_-]*\.js' "$LOGS/index.html" 2>/dev/null | head -1)"
if [ -z "$asset" ]; then r="FAIL(no entry script in the local build)"
elif [ "$asset" != "$served" ]; then r="FAIL(serving $served, built $asset: an older build is live)"
elif [ "$(curl -s -m 30 "$HOST/$asset" | shasum -a 256 | cut -d' ' -f1)" != "$(shasum -a 256 "$APP/frontend/dist/$asset" | cut -d' ' -f1)" ]; then
    r="FAIL($asset differs from the local build)"
else r="ok ($asset)"; fi
record same-build "$(( $(date +%s) - start ))" "$r"

# ── 6. what the platform says, held against what the pod printed ──────────
start=$(date +%s)
cloud status > "$LOGS/status.json"
cloud debug pod > "$LOGS/pod.json"
cloud debug boot > "$LOGS/boot.json"
cloud debug errors --since 15m > "$LOGS/errors.json"
cloud debug logs --previous --tail 40 > "$LOGS/previous.json" 2>/dev/null || true
st="$(jget status < "$LOGS/status.json")"; blocked="$(jget blockedOn < "$LOGS/status.json")"
last="$(jget lastDeploy.id < "$LOGS/status.json")"; lastst="$(jget lastDeploy.status < "$LOGS/status.json")"
avail="$(jget placement.replicas.available < "$LOGS/pod.json")"; want="$(jget placement.replicas.desired < "$LOGS/pod.json")"
if [ "$st" = active ] && [ -z "$blocked" ] && [ "$last" = "$DEPLOYMENT" ] && [ "$lastst" = success ] && [ -n "$avail" ] && [ "$avail" = "$want" ]; then r=ok
else r="FAIL(status=$st blockedOn=$blocked lastDeploy=$last/$lastst replicas=$avail/$want)"; fi
record status "$(( $(date +%s) - start ))" "$r"

# The boot line names the deployment it is serving; status cannot fake that.
if grep -q "deploymentId.*$DEPLOYMENT" "$LOGS/boot.json"; then r=ok; else r="FAIL(no boot line carries deployment $DEPLOYMENT)"; fi
record boot-is-this 0 "$r"

# Restarts and errors are findings about the platform, not a failed canary:
# reported, with the crashed instance's last lines kept in logs/previous.json.
restarts="$(jget pods.0.restarts < "$LOGS/boot.json")"
errors="$(jget matched < "$LOGS/errors.json")"
record restarts 0 "ok (${restarts:-?} restart(s) of the app container$([ "${restarts:-0}" != 0 ] && echo "; reason in $LOGS/previous.json"))"
record error-lines 0 "ok (${errors:-?} error/warning line(s) since $DEPLOY_AT; $LOGS/errors.json)"

start=$(date +%s)
rows="$(cloud db query "select count(*) from posts" | jget results.0.rows.0.count)"
record db-query "$(( $(date +%s) - start ))" "$([ -n "$rows" ] && echo "ok (posts: $rows)" || echo "FAIL(no answer to select count(*) from posts)")"

finish
