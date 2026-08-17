{{/*
Names, labels, and the one thing that matters here: deriving each unit's
environment from the topology rather than asking an operator to restate it.

The variables below are the ones a human gets wrong silently. `REBASE_ROLE` on
the wrong unit serves no HTTP while `/health` still answers, so readiness passes
and every request 404s. A missing `REBASE_MIGRATE_ON_BOOT=none` is a boot
refusal on a non-provisioning role — correct, and on Kubernetes that is a crash
loop with its reason in a log nobody is watching. `TRUSTED_PROXY_HOPS` off by
one puts every caller in one rate-limit bucket.

The chart knows all three from the values it was given. So it writes them, and
`config.env` cannot override them: a value that cannot apply is worse than no
value, because the deployment then looks configured.
*/}}

{{- define "rebase.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "rebase.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "rebase.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "rebase.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
app.kubernetes.io/name: {{ include "rebase.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{/* Selector labels for one unit. `component` is what separates the units. */}}
{{- define "rebase.selectorLabels" -}}
app.kubernetes.io/name: {{ include "rebase.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "rebase.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "rebase.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "rebase.secretName" -}}
{{- if .Values.existingSecret -}}
{{- .Values.existingSecret -}}
{{- else -}}
{{- printf "%s-config" (include "rebase.fullname" .) -}}
{{- end -}}
{{- end -}}

{{- define "rebase.image" -}}
{{- printf "%s:%s" .Values.image.repository (default .Chart.AppVersion .Values.image.tag) -}}
{{- end -}}

{{/*
Whether anything other than the api provisions the schema.

One answer, derived once: the Job owns DDL when it is enabled, and otherwise the
api does exactly what an unsplit deployment already does. Two places deciding
this independently is how you get either nobody provisioning or a race.
*/}}
{{- define "rebase.jobOwnsSchema" -}}
{{- if .Values.migrationJob.enabled -}}true{{- else -}}false{{- end -}}
{{- end -}}

{{/* Resolved rate-limit store: `auto` becomes sql as soon as a second HTTP
     process exists, and memory otherwise — the default that costs nothing. */}}
{{- define "rebase.rateLimitStore" -}}
{{- $store := .Values.sharedState.rateLimitStore -}}
{{- if eq $store "auto" -}}
  {{- $httpUnits := int .Values.api.replicas -}}
  {{- if and .Values.split .Values.functions.enabled -}}
    {{- $httpUnits = add $httpUnits (int .Values.functions.replicas) -}}
  {{- end -}}
  {{- if gt $httpUnits 1 -}}sql{{- else -}}memory{{- end -}}
{{- else -}}
  {{- $store -}}
{{- end -}}
{{- end -}}

{{/*
The environment shared by every backend unit.

Secrets arrive by reference, never by value: a Deployment's env is readable by
anyone who can read Deployments, which is a wider set than anyone who can read
Secrets.
*/}}
{{- define "rebase.commonEnv" -}}
- name: PORT
  value: {{ .Values.service.port | quote }}
- name: NODE_ENV
  value: production
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ include "rebase.secretName" . }}
      key: DATABASE_URL
- name: JWT_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ include "rebase.secretName" . }}
      key: JWT_SECRET
- name: REBASE_SERVICE_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "rebase.secretName" . }}
      key: REBASE_SERVICE_KEY
{{- if .Values.config.corsOrigins }}
- name: CORS_ORIGINS
  value: {{ .Values.config.corsOrigins | quote }}
{{- else if .Values.ingress.host }}
- name: CORS_ORIGINS
  value: {{ printf "https://%s" .Values.ingress.host | quote }}
{{- end }}
- name: REBASE_RATE_LIMIT_STORE
  value: {{ include "rebase.rateLimitStore" . | quote }}
{{- if eq .Values.bundle.mode "url" }}
- name: REBASE_BUNDLE_URL
  value: {{ .Values.bundle.url | quote }}
{{- if .Values.bundle.token }}
- name: REBASE_BUNDLE_TOKEN
  valueFrom:
    secretKeyRef:
      name: {{ include "rebase.secretName" . }}
      key: REBASE_BUNDLE_TOKEN
{{- end }}
{{- else }}
- name: REBASE_BUNDLE
  value: {{ .Values.bundle.path | quote }}
{{- end }}
{{- range $key, $value := .Values.config.env }}
- name: {{ $key }}
  value: {{ $value | quote }}
{{- end }}
{{- end -}}

{{/*
The topology environment for one unit, written by the chart and not overridable.

Mirrors what the platform pins for a managed pod, for the same reason: these are
statements about who decides, and a deployment where the operator and the chart
both have an opinion is one where the failure is invisible.
*/}}
{{- define "rebase.roleEnv" -}}
{{- $role := .role -}}
{{- $root := .root -}}
{{- if $root.Values.split }}
- name: REBASE_ROLE
  value: {{ $role | quote }}
{{- end }}
{{- $provisions := and (eq (include "rebase.jobOwnsSchema" $root) "false") (or (eq $role "api") (eq $role "all")) -}}
{{- if $provisions }}
- name: REBASE_MIGRATE_ON_BOOT
  value: {{ $root.Values.migrationJob.mode | quote }}
{{- else }}
{{/* Every non-provisioning process, including the api when the Job owns DDL.
     The runtime REFUSES to boot a functions or worker role that would also
     provision, so omitting this is a crash loop rather than a race. */}}
- name: REBASE_MIGRATE_ON_BOOT
  value: "none"
{{- end }}
{{- if eq $role "functions" }}
{{- with $root.Values.functions.only }}
- name: REBASE_FUNCTIONS_ONLY
  value: {{ join "," . | quote }}
{{- end }}
{{- with $root.Values.functions.exclude }}
- name: REBASE_FUNCTIONS_EXCLUDE
  value: {{ join "," . | quote }}
{{- end }}
{{/* This unit sits behind the ingress only — one hop, same as the api. It is
     stated rather than left to the default because the api-side proxy path
     (REBASE_FUNCTIONS_UPSTREAM) would add a second hop, and the difference
     between them is every caller sharing one rate-limit bucket. */}}
- name: TRUSTED_PROXY_HOPS
  value: "1"
{{- end }}
{{- if eq $role "worker" }}
{{- if ne (toString $root.Values.worker.cronScheduler) "<nil>" }}
- name: REBASE_CRON_SCHEDULER
  value: {{ $root.Values.worker.cronScheduler | quote }}
{{- end }}
{{- if ne (toString $root.Values.worker.jobWorkers) "<nil>" }}
- name: REBASE_JOB_WORKERS
  value: {{ $root.Values.worker.jobWorkers | quote }}
{{- end }}
{{- end }}
{{- if and (eq $role "api") $root.Values.split $root.Values.functions.enabled }}
{{/* Cron and the job queue stay on the api by default, so a two-unit split is
     complete without a worker. With a worker present they move there, and this
     is what takes them off the request path. */}}
{{- if $root.Values.worker.enabled }}
- name: REBASE_CRON_SCHEDULER
  value: "false"
- name: REBASE_JOB_WORKERS
  value: "false"
{{- end }}
{{- end }}
{{- end -}}

{{/*
Scratch space for a fetched bundle.

`mode: url` re-fetches on every pod start rather than depending on a volume
surviving a reschedule — a pod that comes back on another node has to be able to
get its own project, or the deployment is one eviction away from an empty
container.

The runtime downloads and unpacks into a temporary directory of its own
choosing, and `REBASE_BUNDLE` is deliberately NOT set in this mode because an
explicit path always wins over a URL. So what this mounts is writable scratch at
/tmp, not a bundle directory: the download is several hundred megabytes for a
project with real dependencies, and a node whose ephemeral storage fills up
evicts pods for reasons that read as unrelated.
*/}}
{{- define "rebase.bundleVolumes" -}}
{{- if eq .Values.bundle.mode "url" }}
- name: bundle-scratch
  emptyDir: {}
{{- end }}
{{- end -}}

{{- define "rebase.bundleVolumeMounts" -}}
{{- if eq .Values.bundle.mode "url" }}
- name: bundle-scratch
  mountPath: /tmp
{{- end }}
{{- end -}}
