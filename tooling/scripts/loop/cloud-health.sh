#!/usr/bin/env bash
# Read-only health facts for Rebase Cloud on Hetzner (fsn1). Changes nothing.
# Usage: tooling/scripts/loop/cloud-health.sh [cp-ip]
# Reaches the cluster with the local kubeconfig first, else ssh root@<cp-ip> +
# kubectl there (read verbs only). Both are allowed only from the addresses on
# the Hetzner firewall (operator_cidrs in infra/hetzner/terraform.tfvars); when
# neither answers it says so, with this machine's address, and runs only the
# checks that work from outside.
set -u
CP="${1:-88.99.35.49}"
KCFG="${REBASE_FSN1_KUBECONFIG:-$HOME/.kube/rebase-fsn1-admin.yaml}"
# printf %q keeps jsonpath brackets and quotes intact through the remote shell.
K_ssh() { ssh -o BatchMode=yes -o ConnectTimeout=10 "root@$CP" "$(printf '%q ' kubectl "$@")" 2>&1; }
K_api() { kubectl --kubeconfig "$KCFG" --request-timeout=20s "$@" 2>&1; }
if [ -r "$KCFG" ] && K_api get --raw /readyz >/dev/null 2>&1; then
  K() { K_api "$@"; }; VIA="kube API ($KCFG)"
elif ssh -o BatchMode=yes -o ConnectTimeout=10 "root@$CP" true >/dev/null 2>&1; then
  K() { K_ssh "$@"; }; VIA="ssh root@$CP"
else
  K() { echo "(cluster unreachable)"; }; VIA=""
fi

section() { printf '\n## %s\n' "$1"; }

section "Access"
if [ -n "$VIA" ]; then
  echo "via $VIA"
else
  ip="$(curl -s -m 10 https://api.ipify.org || echo unknown)"
  echo "BLIND: neither the kube API nor ssh answers from this machine (egress $ip)."
  echo "It is most likely not on the Hetzner firewall's operator list (6443/22). Everything below"
  echo "that needs the cluster prints '(cluster unreachable)'; the outside-in curls still run."
  echo "Act: add { name = \"<who>-<where>\", cidr = \"$ip/32\" } to operator_cidrs and push the firewall rule."
fi

section "Nodes"
K get nodes --no-headers
# Judge memory by what the kernel can still hand out, not by `kubectl top`.
# top's percentage is working set (which counts active page cache) over
# ALLOCATABLE, and k3s reserves ~2.3 GiB on a control-plane node, so a cpx32
# server with ~1.5 GiB of process memory reads 95-103% there. availableBytes is
# what the kubelet's eviction threshold compares; MemoryPressure is its verdict;
# requests over allocatable is what decides whether the next pod still fits
# (and whether the autoscaler has to add a node).
# A node is LOW only when the kubelet could soon evict (available < 512Mi or
# MemoryPressure=True) or the next pod may not fit (requests > 90%). Anything
# else is OK however high top% reads (decided 2026-11-24: accept, no resize).
echo "-- memory: verdict | node | available | pressure | requests/allocatable | top% (info only, never a verdict)"
top="$(K top nodes --no-headers 2>/dev/null)"
for n in $(K get nodes -o jsonpath='{.items[*].metadata.name}' 2>/dev/null); do
  case "$n" in *unreachable*) continue ;; esac
  avail="$(K get --raw "/api/v1/nodes/$n/proxy/stats/summary" 2>/dev/null |
    python3 -c 'import json,sys; print(f"{json.load(sys.stdin)["node"]["memory"]["availableBytes"]/1048576:.0f}Mi")' 2>/dev/null || echo "?")"
  pressure="$(K get node "$n" -o jsonpath='{.status.conditions[?(@.type=="MemoryPressure")].status}')"
  req="$(K describe node "$n" 2>/dev/null | awk '/Allocated resources/{f=1} f && $1=="memory"{print $3; exit}')"
  pct="$(printf '%s\n' "$top" | awk -v n="$n" '$1==n{print $5}')"
  verdict=OK
  a="${avail%Mi}"; r="${req//[()%]/}"
  { [ "$pressure" = "True" ] || { [ "$a" != "?" ] && [ "${a:-0}" -lt 512 ]; } || [ "${r:-0}" -gt 90 ]; } && verdict=LOW
  printf '%s | %s | %s | MemoryPressure=%s | requests %s | top %s\n' "$verdict" "${n#rebase-fsn1-}" "$avail" "$pressure" "$req" "$pct"
done

section "Pods not Running/Completed, or restarting"
K get pods -A --no-headers | awk '$4!="Running" && $4!="Completed" {print} $4=="Running" && $5+0>3 {print "restarts: " $0}' | head -40

section "Deployments short of desired"
K get deploy -A --no-headers | awk '{split($3,a,"/"); if (a[1]!=a[2]) print}'

section "Rollouts stuck (Progressing=False)"
K get deploy -A -o jsonpath='{range .items[*]}{.metadata.namespace}/{.metadata.name} {range .status.conditions[?(@.type=="Progressing")]}{.status} {.reason}{end}{"\n"}{end}' | awk '$2=="False"'

section "Control plane"
K -n rebase-saas get deploy,pods --no-headers
K -n rebase-saas logs deploy/rebase-saas-control-plane --since=2h 2>/dev/null | grep -E 'ALERT_EVALUATOR_PASS' | tail -2
K -n rebase-saas logs deploy/rebase-saas-control-plane --since=2h 2>/dev/null | grep -ciE '"level":"(error|fatal)"|\bERROR\b' | xargs echo "error lines (2h):"
for u in https://app.rebase.pro https://api.rebase.pro/health https://rebase.pro; do
  printf '%s -> ' "$u"; curl -s -o /dev/null -m 15 -w '%{http_code} %{time_total}s %{remote_ip}\n' "$u"
done

section "Database probe failures by node (2h)"
# The health check opens a NEW connection (DNS + TCP + auth) with 2.5 s; pooled
# requests never notice what it catches. Failures concentrated on one node and
# absent on the others point at that node (2026-11-24: lost DNS answers on
# shared-auto), not at any database.
for ns in $(K get ns -o name 2>/dev/null | sed -n 's#^namespace/##p' | grep -E '^(rebase-tenant-|rebase-saas$)'); do
  for pod in $(K -n "$ns" get pods -l 'app in (rebase-backend,rebase-saas-control-plane)' -o jsonpath='{range .items[*]}{.metadata.name}:{.spec.nodeName}{" "}{end}' 2>/dev/null); do
    c="$(K -n "$ns" logs "${pod%%:*}" --since=2h 2>/dev/null | grep -c 'Health check failed')"
    [ "${c:-0}" -gt 0 ] && echo "${pod#*:} ${ns#rebase-tenant-} $c"
  done
done | awk '{n[$1]+=$3; d[$1]=d[$1]" "$2"="$3} END{for(k in n) print k": "n[k]" failures ("d[k]" )"}' | sed 's/^rebase-fsn1-//' | sort
echo "(nothing listed = no failures)"

section "Scheduled jobs: latest run failed, or suspended"
# A failure a later success superseded is history, not a problem (and with
# ttlSecondsAfterFinished it removes itself); only the latest run counts.
# A CronJob suspended on purpose says why in the annotation
# rebase.pro/suspended-reason (set in its manifest); that is information, not a
# finding. One suspended with no reason is a finding: nobody can tell whether it
# was meant.
# Fields are '|'-separated: an empty one (never succeeded, no reason) must not
# shift the rest the way runs of spaces do.
K get cronjob -A -o jsonpath='{range .items[*]}{.metadata.namespace}|{.metadata.name}|{.spec.suspend}|{.status.lastScheduleTime}|{.status.lastSuccessfulTime}|{.metadata.annotations.rebase\.pro/suspended-reason}{"\n"}{end}' 2>/dev/null |
  awk -F'|' '$3=="true" && $6!="" {print "suspended on purpose (info): " $1 "/" $2 " (" $6 ")"; next}
       $3=="true" {print "SUSPENDED, NO REASON RECORDED: " $1 "/" $2 " (last ran " ($4==""?"never":$4) ")"; next}
       $4!="" && ($5=="" || $5<$4) {print "LATEST RUN NOT SUCCESSFUL: " $1 "/" $2 " (scheduled " $4 ", last success " ($5==""?"never":$5) ")"}'
echo "-- one-off Jobs (no CronJob) that failed:"
K get jobs -A -o jsonpath='{range .items[*]}{.metadata.namespace}/{.metadata.name} {.metadata.ownerReferences[0].kind} {.status.failed}{"\n"}{end}' 2>/dev/null | awk '$2!="CronJob" && $NF+0>0 && $NF!="" {print $1}' | grep -v '^rebase-tenant-' || true

section "Tenant databases (CNPG)"
K get clusters.postgresql.cnpg.io -A --no-headers
echo "-- WAL archiving (last archived / failed):"
K get clusters.postgresql.cnpg.io -A -o jsonpath='{range .items[*]}{.metadata.namespace} {.status.firstRecoverabilityPoint} last={.status.lastSuccessfulBackup} cond={range .status.conditions[?(@.type=="ContinuousArchiving")]}{.status}{end}{"\n"}{end}'
echo "-- backups not completed, with no later completed backup of the same cluster:"
# CNPG never removes a Backup object, so a failure a later completed backup
# superseded stays listed for ever. It is history, not a problem.
K get backups.postgresql.cnpg.io -A -o jsonpath='{range .items[*]}{.metadata.namespace} {.metadata.name} {.spec.cluster.name} {.metadata.creationTimestamp} {.status.phase}{"\n"}{end}' 2>/dev/null |
  awk '{k=$1"/"$3} $5=="completed" {if ($4>done[k]) done[k]=$4; next} {bad[NR]=$0; key[NR]=k; at[NR]=$4}
       END {for (i in bad) if (at[i]>done[key[i]]) print bad[i]}' | tail -10

section "Tenant ingresses answer"
K get ingress -A -o jsonpath='{range .items[*]}{range .spec.rules[*]}{.host}{"\n"}{end}{end}' | sort -u | while read -r h; do
  [ -n "$h" ] || continue
  case "$h" in '*.'*) continue ;; esac  # a wildcard rule names no host to curl
  printf '%s -> ' "$h"; curl -s -o /dev/null -m 15 -w '%{http_code} %{time_total}s\n' "https://$h/"
done

section "Certificates not ready / expiring < 14d"
K get certificates.cert-manager.io -A -o jsonpath='{range .items[*]}{.metadata.namespace}/{.metadata.name} {range .status.conditions[?(@.type=="Ready")]}{.status}{end} {.status.notAfter}{"\n"}{end}' |
  awk -v lim="$(date -u -v+14d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '+14 days' +%Y-%m-%dT%H:%M:%SZ)" '$2!="True" || $3<lim'

section "Warning events (last 1h)"
K get events -A --field-selector type=Warning --sort-by=.lastTimestamp --no-headers 2>/dev/null | tail -20
