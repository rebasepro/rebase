{{/*
Refusals.

Every check here guards a failure that produces no error at runtime — the
deployment comes up, readiness passes, and something quietly stops being true.
A chart that rendered them anyway would be handing over a cluster that looks
right, which is the state these are all about avoiding.

`fail` aborts the render, so none of this can be skipped by not reading it.
Each message names the value to change, because the reader is looking at a
failed `helm install` and has one screen to work from.
*/}}

{{- define "rebase.validate" -}}

{{/* ── Credentials ──────────────────────────────────────────────────────── */}}
{{- if not .Values.existingSecret }}
  {{- if not .Values.config.databaseUrl }}
    {{- fail "config.databaseUrl is required (or set existingSecret to a Secret carrying DATABASE_URL)." }}
  {{- end }}
  {{- if not .Values.config.jwtSecret }}
    {{- fail "config.jwtSecret is required (or set existingSecret). Use at least 32 random characters." }}
  {{- end }}
  {{- if not .Values.config.serviceKey }}
    {{- fail "config.serviceKey is required (or set existingSecret). Use at least 32 random characters." }}
  {{- end }}
{{- end }}

{{/* ── Bundle ───────────────────────────────────────────────────────────── */}}
{{- if not (has .Values.bundle.mode (list "image" "url")) }}
  {{- fail (printf "bundle.mode=%q is not a mode. Use \"image\" (bundle baked into your own image) or \"url\" (fetched at pod start)." .Values.bundle.mode) }}
{{- end }}
{{- if and (eq .Values.bundle.mode "url") (not .Values.bundle.url) }}
  {{- fail "bundle.mode=url needs bundle.url. With no bundle the runtime has no project to serve." }}
{{- end }}
{{/*
  `url` mode is served by the runtime fetching its own bundle at boot. That
  capability landed after 0.16.0, and the stock image at or below it looks only
  for a bundle already on disk: it exits with `No bundle found at /bundle.`
  before @rebasepro/server is imported, so every workload in the release
  crashloops — or, with the migration Job enabled, `helm install` aborts at the
  pre-install hook.

  The chart had no init container to fetch one either (`git log -S initContainers`
  over this directory is empty), so this mode has never worked in a published
  chart while values.yaml, the README's mode table and the `mode=image` refusal
  below all recommended it. Refusing is the whole fix: there is nothing to
  repair at runtime, and an operator reading a failed `helm install` has one
  screen to work from, so the message names the value to change.
*/}}
{{- if eq .Values.bundle.mode "url" }}
  {{- $tag := default .Chart.AppVersion .Values.image.tag }}
  {{- if and (eq .Values.image.repository "rebasepro/server") (semverCompare "<=0.16.0" $tag) }}
    {{- fail (printf "bundle.mode=url needs a runtime that fetches its own bundle, and rebasepro/server:%s cannot — it looks only for a bundle already on disk and exits with `No bundle found at /bundle.`. Pin image.tag to a release above 0.16.0, or use bundle.mode=image with a bundle baked into your own image." $tag) }}
  {{- end }}
{{- end }}
{{- if and (eq .Values.bundle.mode "image") (eq .Values.image.repository "rebasepro/server") }}
  {{- fail "bundle.mode=image means the bundle is baked into image.repository, but that is still the stock runtime image (rebasepro/server), which contains no project. Build one FROM rebasepro/server with `COPY dist-bundle /bundle` and set image.repository to it — or use bundle.mode=url." }}
{{- end }}

{{/* ── Topology variables in config.env ─────────────────────────────────── */}}
{{/*
Who decides the topology.

`config.env` is the operator's own environment for the project, and it is
rendered into the same `env` list the chart writes its topology decisions into.
Under `split` the chart's entry is written after the operator's and Kubernetes
takes the last one, so theirs silently does nothing. Unsplit — the default —
the chart writes no REBASE_ROLE at all, so theirs is the only one and it takes
effect.

That second case is why this refuses instead of ignoring. `REBASE_ROLE=worker`
on the single pod produces a deployment that serves no HTTP, and because
`/livez` and `/health` both answer on every role, the startup, liveness and
readiness probes all pass and the rollout reports success. Every request 404s.
The cloud shipped exactly this failure before pinning the same list.

Kept in step with `TOPOLOGY_ENV_VARS` in
`packages/server/src/deploy/pod-contract.ts` by `scripts/check-chart.mjs`,
which cannot import TypeScript and so compares the two lists as text.
*/}}
{{- $topologyEnv := list "REBASE_ROLE" "REBASE_FUNCTIONS_ONLY" "REBASE_FUNCTIONS_EXCLUDE" "REBASE_FUNCTIONS_UPSTREAM" "REBASE_CRON_SCHEDULER" "REBASE_JOB_WORKERS" "REBASE_RLS_AUDIT" "REBASE_MIGRATE_ON_BOOT" "TRUSTED_PROXY_HOPS" "REBASE_RATE_LIMIT_STORE" "REBASE_REQUIRE_SCHEMA_MATCH" -}}
{{- range $name, $value := .Values.config.env }}
  {{- if has $name $topologyEnv }}
    {{- fail (printf "config.env sets %s, which decides this release's topology and is the chart's to own. Set here it either does nothing (under split, the chart's value is written last and wins) or takes effect unsupervised (unsplit, where nothing overrides it) — and a wrong topology passes every probe, because /livez and /health answer on every role. Use `split` and the api/functions/worker blocks instead." $name) }}
  {{- end }}
{{- end }}

{{/* ── Topology ─────────────────────────────────────────────────────────── */}}
{{- if and (not .Values.split) (or .Values.functions.enabled .Values.worker.enabled) }}
  {{- fail "functions.enabled / worker.enabled do nothing while split=false — one process already serves everything. Set split=true to run them separately, or turn them off." }}
{{- end }}

{{- if and .Values.functions.enabled .Values.functions.only .Values.functions.exclude }}
  {{- if and (gt (len .Values.functions.only) 0) (gt (len .Values.functions.exclude) 0) }}
    {{- fail "functions.only and functions.exclude are mutually exclusive — set one or neither. Both together describes a selection nobody can read." }}
  {{- end }}
{{- end }}

{{/* ── Per-unit release ─────────────────────────────────────────────────────
     Pinning a unit is how one gets rolled without the others. Both refusals
     below are about a pin that cannot take effect: one unit means there is
     nothing to pin apart, and a baked-in bundle is not fetched from a URL. A
     pin that quietly does nothing is worse than no pin — the operator believes
     a unit is held at a version it is not held at. */}}
{{- range $name := list "api" "functions" "worker" }}
  {{- $unit := index $.Values $name }}
  {{- $pinned := or (and $unit.image (or $unit.image.repository $unit.image.tag)) $unit.bundleUrl }}
  {{- if and $pinned (not $.Values.split) }}
    {{- fail (printf "A unit pinned to its own build needs split=true: %s.image / %s.bundleUrl do nothing while one process serves everything, because there is no second unit to hold at a different build. Set split=true, or remove the pin." $name $name) }}
  {{- end }}
  {{- if and $unit.bundleUrl (ne $.Values.bundle.mode "url") }}
    {{- fail (printf "A per-unit bundle URL is only fetched when bundle.mode=url. %s.bundleUrl is set, but bundle.mode=%q, so the bundle comes from the image and that URL is never read. Use bundle.mode=url, or pin %s.image instead." $name $.Values.bundle.mode $name) }}
  {{- end }}
{{- end }}

{{/* ── Shared state ─────────────────────────────────────────────────────────
     The count of processes that serve HTTP and could therefore hold a private
     rate-limit budget. Static units are excluded: they mount no API surface.  */}}
{{- $httpUnits := int .Values.api.replicas }}
{{- if and .Values.split .Values.functions.enabled }}
  {{- $httpUnits = add $httpUnits (int .Values.functions.replicas) }}
{{- end }}

{{- if gt $httpUnits 1 }}
  {{- if eq .Values.sharedState.rateLimitStore "memory" }}
    {{- fail (printf "This topology runs %d processes that serve HTTP, and sharedState.rateLimitStore=memory gives each one its own budget — so every caller gets %d times the limit, with nothing in any log to say so. Use \"sql\" (or \"auto\", which picks it for you)." $httpUnits $httpUnits) }}
  {{- end }}
{{- end }}

{{- if not (has .Values.sharedState.rateLimitStore (list "auto" "sql" "memory")) }}
  {{- fail (printf "sharedState.rateLimitStore=%q is not a store. Use auto, sql, or memory." .Values.sharedState.rateLimitStore) }}
{{- end }}

{{/* ── Static apps ──────────────────────────────────────────────────────── */}}
{{- $seenPaths := dict }}
{{- $seenNames := dict }}
{{- range .Values.staticApps }}
  {{- if not .name }}
    {{- fail "every entry in staticApps needs a name — it is the Deployment and Service name." }}
  {{- end }}
  {{- if not .path }}
    {{- fail (printf "staticApps entry %q needs a path, e.g. /admin. Several apps share one host, so each has to say where it answers." .name) }}
  {{- end }}
  {{- if not (hasPrefix "/" .path) }}
    {{- fail (printf "staticApps entry %q has path %q, which must start with a slash." .name .path) }}
  {{- end }}
  {{- if hasKey $seenPaths .path }}
    {{- fail (printf "two staticApps claim path %q. The ingress would route both to whichever rule nginx sorted first, and the other would never answer." .path) }}
  {{- end }}
  {{- if hasKey $seenNames .name }}
    {{- fail (printf "two staticApps are named %q." .name) }}
  {{- end }}
  {{- if not .image }}
    {{- fail (printf "staticApps entry %q needs an image — a static bundle is its own build, not part of the backend's." .name) }}
  {{- end }}
  {{- if hasPrefix "/api" .path }}
    {{- fail (printf "staticApps entry %q claims %q, which is inside the API's own prefix. It would shadow routes the SDK depends on." .name .path) }}
  {{- end }}
  {{- $_ := set $seenPaths .path true }}
  {{- $_ := set $seenNames .name true }}
{{- end }}

{{/* ── Ingress ──────────────────────────────────────────────────────────── */}}
{{- if and .Values.ingress.enabled (not .Values.ingress.host) }}
  {{- fail "ingress.enabled needs ingress.host. Set ingress.enabled=false if something else fronts this release." }}
{{- end }}

{{/*
`push` is deliberately absent. The runtime image refuses it — "not supported by
the runtime image" — and this chart both validated it and recommended it, so a
values file that took the recommendation produced a migration Job that failed
four times and, with migrationJob.enabled=false, put the same value on the API
Deployment and crash-looped every pod.

The reason it is not there is not an omission to be corrected: applying
collection schema changes at boot is destructive, and `rebase db push` from a
checkout or CI dry-runs it, refuses destructive changes without confirmation,
and can take a backup first. None of that is available to a pod starting at 3am.
*/}}
{{- if eq .Values.migrationJob.mode "push" }}
  {{- fail "migrationJob.mode=push is refused by the runtime image, so a Job set to it fails and a release with migrationJob.enabled=false crash-loops the API instead. Use \"ensure\" — it creates missing tables, columns and enum types additively — and run `rebase db push` from a checkout or CI for a change that drops or rewrites something." }}
{{- end }}
{{- if not (has .Values.migrationJob.mode (list "ensure")) }}
  {{- fail (printf "migrationJob.mode=%q is not a mode. The only one the runtime image accepts is \"ensure\", which creates what is missing." .Values.migrationJob.mode) }}
{{- end }}

{{- end -}}
