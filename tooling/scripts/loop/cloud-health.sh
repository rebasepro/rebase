#!/usr/bin/env bash
# Read-only health facts for Rebase Cloud on Hetzner (fsn1). Changes nothing.
# Usage: tooling/scripts/loop/cloud-health.sh [cp-ip]
# Reaches the cluster with ssh root@<cp-ip> + kubectl there (read verbs only).
set -u
CP="${1:-88.99.35.49}"
# printf %q keeps jsonpath brackets and quotes intact through the remote shell.
K() { ssh -o BatchMode=yes -o ConnectTimeout=10 "root@$CP" "$(printf '%q ' kubectl "$@")" 2>&1; }

section() { printf '\n## %s\n' "$1"; }

section "Nodes"
K get nodes --no-headers
K top nodes --no-headers 2>/dev/null || echo "(metrics-server unavailable)"

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

section "Tenant databases (CNPG)"
K get clusters.postgresql.cnpg.io -A --no-headers
echo "-- WAL archiving (last archived / failed):"
K get clusters.postgresql.cnpg.io -A -o jsonpath='{range .items[*]}{.metadata.namespace} {.status.firstRecoverabilityPoint} last={.status.lastSuccessfulBackup} cond={range .status.conditions[?(@.type=="ContinuousArchiving")]}{.status}{end}{"\n"}{end}'
echo "-- backups failed in the last runs:"
K get backups.postgresql.cnpg.io -A --no-headers 2>/dev/null | awk '$NF!="completed"' | tail -10

section "Tenant ingresses answer"
K get ingress -A -o jsonpath='{range .items[*]}{range .spec.rules[*]}{.host}{"\n"}{end}{end}' | sort -u | while read -r h; do
  [ -n "$h" ] || continue
  printf '%s -> ' "$h"; curl -s -o /dev/null -m 15 -w '%{http_code} %{time_total}s\n' "https://$h/"
done

section "Certificates not ready / expiring < 14d"
K get certificates.cert-manager.io -A -o jsonpath='{range .items[*]}{.metadata.namespace}/{.metadata.name} {range .status.conditions[?(@.type=="Ready")]}{.status}{end} {.status.notAfter}{"\n"}{end}' |
  awk -v lim="$(date -u -v+14d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '+14 days' +%Y-%m-%dT%H:%M:%SZ)" '$2!="True" || $3<lim'

section "Warning events (last 1h)"
K get events -A --field-selector type=Warning --sort-by=.lastTimestamp --no-headers 2>/dev/null | tail -20
