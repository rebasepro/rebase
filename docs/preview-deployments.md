# Preview deployments

A preview is a build served on an address of its own, such as
`https://songbuzz--new-quiz.rebase.website`. Production keeps serving what it
served before. The owner can see a change on the real platform, and share it,
before anyone using the app gets it.

Both halves have shipped. The CLI half is in this repository:
`rebase cloud deploy --preview`, `--preview-name`, `rebase cloud previews`,
`rebase cloud logs --preview` and `rebase cloud env … --preview`. The control
plane's half is in `saas`: `backend/functions/previews.ts`,
`backend/src/previews/` and `backend/crons/preview-reaper.ts`. What it needs
outside the code before it works on a cluster (the CNPG `databases` grant,
wildcard TLS, the front door) is in saas `docs/preview-deployments-rollout.md`.
A control plane without the `previews` function answers 404, and the CLI
refuses `--preview` with `previews_unavailable` and deploys nothing.

## What the user sees

```bash
rebase cloud deploy --preview                 # the backend, with its folded static apps
rebase cloud deploy --preview-name new-quiz   # a stable name: the same address on every deploy
rebase cloud previews                         # name, address, app, backend, expiry
rebase cloud logs --preview new-quiz          # its build log; --runtime for what its backend prints
rebase cloud previews delete new-quiz --yes
```

On success the deploy prints the preview's address, says which backend its
pages call, says that production is unchanged, and checks that the address
answers (the same live check as a production deploy; `--live-timeout 0` skips
it). In JSON mode the result carries
`preview: { name, url, app, backend, status, deploymentId, expiresAt }`, and
`live` / `liveChecks` once followed.

## The two kinds

| What was deployed | `backend` | What its pages talk to |
| --- | --- | --- |
| The backend (`deploy --preview`), with every static app folded in | `preview` | Its own backend pod, on an **empty database of its own** |
| A static app by name (`deploy game --preview`) | `production` | Production's backend, with `/api` forwarded from the preview's host |

**Static previews are not served on Rebase Cloud yet.** They need the static
front door, which is not running in production (no `REBASE_STATIC_BUCKET`), so
the control plane refuses them with `PREVIEW_STATIC_UNSERVED` before
publishing anything, and the CLI says so. Preview the backend instead: the
preview pod serves the static apps folded into it.

**Why a static preview would forward `/api` instead of calling production
cross-origin.** A folded or scaffolded frontend calls its API by a relative
path, which would 404 on a host with no backend. Calling production's host
directly would need the preview origin in production's `CORS_ORIGINS`, which
means restarting production. Forwarding keeps the request same-origin. The
price is that a sign-in there is a real production session, and writes are
production writes; `backend: "production"` is how the CLI says so.

**Why a backend preview never uses production's database.** A managed pod
boots with `REBASE_MIGRATE_ON_BOOT=ensure`
(`packages/server/src/boot/provision.ts`). Pointed at production's database it
would add the preview's tables there, `ensureCollectionPolicies` would rewrite
production's RLS policies to the preview's rules, and its crons would run
against production data. A copy of production's data is not offered: it
carries personal data to a less guarded address.

## Why the CLI talks to a separate function

A preview is triggered by `POST /api/functions/previews/<projectId>`, never by
`deploy` with a flag on it. `deploy`'s `POST /` ignores fields it does not
know, so an older control plane handed `preview: {}` would deploy the build to
production — the one outcome previews exist to prevent. An unknown function is
a 404 (`FUNCTION_NOT_FOUND`, or `No route for …` on older servers), which the
CLI turns into `previews_unavailable`. The safety is a property of the route.

The bundle is still uploaded through `deploy/bundle/upload`. Storing an archive
deploys nothing.

## What the CLI leaves out of a preview

Each of these would change the production project:

- **No rebuild source.** The stored source is what a platform upgrade rebuilds
  production from; a preview's would ship the preview to production.
- **No `declaredApps`.** Registering apps and their hostnames writes the
  production apps registry and `project_domains`.
- **No `--source`, `--eject`, or container build.** Each builds an image for
  production; they are refused with `usage`. A backend without
  `runtime: "managed"` is refused with `preview_unsupported`.

## The contract

`POST /api/functions/previews/<projectId>`, with the bundle deploy body
(`bundleDeployBody`) minus `rebuildSource` and `declaredApps`, plus
`preview: { name?: string }`:

```json
{
  "success": true,
  "deployment": { "id": "<row in preview_deployments>" },
  "preview": {
    "name": "new-quiz",
    "url": "https://songbuzz--new-quiz.rebase.website",
    "app": "backend",
    "backend": "preview",
    "status": "deploying",
    "expiresAt": "2026-10-27T10:00:00.000Z"
  }
}
```

The CLI refuses an answer with no `preview.url`. It follows the build by
reading `preview-deployments/<id>`, which has the same `status` and `logs`
columns and heartbeat format as `deployments`. Refusals use the deploy's
envelope, a 4xx with `details.intakeCode` and `details.hint`:
`PREVIEW_NAME_INVALID`, `PREVIEW_NAME_TOO_LONG`, `PREVIEW_LIMIT`,
`PREVIEW_KIND_CHANGED`, `PREVIEW_NEEDS_MANAGED_DB`, `PREVIEW_NEEDS_PRODUCTION`,
`PREVIEW_UNSUPPORTED`, `PREVIEW_STATIC_UNSERVED`; a backend preview on an org
with no card on file gets the deploy's 402 `billing_required`, and a second
build of the same name while one runs gets 409 `deploy_in_progress`.

`GET /api/functions/previews/<projectId>` answers `{ previews: Preview[] }`.
`DELETE /api/functions/previews/<projectId>/<name>` answers `{ success: true }`,
or a 404 `not_found` (never `FUNCTION_NOT_FOUND`) when no preview has that
name. `GET|POST /…/<projectId>/env` and `DELETE /…/<projectId>/env/<key>` hold
the previews' own environment overrides.

A token minted with `--can deploy` covers the trigger, the follow, `previews`
and `previews delete`; `--can logs` covers `logs --preview`; `--can env`
covers the env overrides
(`packages/cli/src/commands/cloud/token-capabilities.ts`).

## What the control plane does

Paths are relative to `saas/backend`.

### Records

- **`previews`**, unique on `(project_id, name)`: `app`, `kind`, `status`,
  `host`, `bundle_id`, `static_deployment_id`, `database_name`, timestamps,
  `expires_at`, `deleted_at`. A deleted preview's row is revived by the next
  deploy of its name.
- **`preview_deployments`**, the columns of `deployments` plus `preview_id`.
  Separate from `deployments` because that table's newest row means "what
  production runs" to the deploy lock, `statusFromHistory`, the stale-deploy
  reaper, `/rollback`, the console's history and every CLI already installed.
- **Its own lock.** One build per preview name at a time; it never takes the
  project's lock.

### Names and hosts

- The host is `<subdomain>--<name>.<base domain>`, on the base domain of the
  cluster production is served from (`requireProjectBaseDomain`), so a project
  on `fsn1.rebase.website` gets `shop--feat.fsn1.rebase.website`. With no name
  given, the control plane picks 6 random base-36 characters.
- `rejectNewSubdomain` refuses `--` in a new project's subdomain, so a project
  cannot take a preview's host.
- `<subdomain>--<name>` must fit one 63-character DNS label
  (`PREVIEW_NAME_TOO_LONG`). The CLI caps names at 24 characters.
- With `REBASE_WILDCARD_TLS` off, every preview host costs one HTTP-01
  certificate from `rebase.website`'s 50-per-week budget, and the address can
  answer a minute after the pod is ready — which is what the CLI's live check
  waits for.

### A backend preview

In the project's namespace, none reusing a production name
(`src/previews/k8s.ts`):

- **Deployment, Service and Ingress `rebase-preview-<name>`**, pod label
  `app: rebase-preview-<name>` (production's Service selects
  `app: rebase-backend`). One replica at the default dial, no PDB, no
  autoscaling, scheduled on the project's capacity class like its app unit
  (`appScheduling`), never on spot. The Ingress carries production's nginx
  settings (body size, 600s proxy timeouts).
- **Its own database**, a CNPG `Database` resource on the project's cluster,
  owned by a managed role of its own (`spec.managed.roles`), dropped with the
  resource (`databaseReclaimPolicy: delete`) and capped at 10 connections, with
  the pod's pools held under it (`REBASE_DB_POOL_MAX=4`). It starts empty;
  boot's `ensure` builds the schema. It shares production's Postgres instance
  and disk, which is not capped — see the rollout doc. New clusters revoke
  `CONNECT` on production's database from `PUBLIC`, so a preview role cannot
  open it. Bring-your-own-database projects are refused
  (`PREVIEW_NEEDS_MANAGED_DB`).
- **Its own Secrets**: `-platform` (database URLs, a fresh `JWT_SECRET` and
  `REBASE_SERVICE_KEY`, kept across redeploys) and `-env` (production's env,
  minus storage configuration, plus the `env … --preview` overrides). Live
  third-party keys are copied unless overridden, and the build log says so.
- **Pinned env**: `REBASE_PREVIEW=<name>`; `CORS_ORIGINS` = the preview's host
  plus the project's own `CORS_ORIGINS` (or the preview override of it);
  crons and job workers off.
- **Storage**: each declared server source is a directory in a 1Gi emptyDir,
  gone with the pod. Never a prefix of production's bucket: the runtime cannot
  confine a source to a prefix, so the bucket's credentials would reach
  production's files.
- **The bundle**: fetched with a token scoped to the project and the preview
  name (`previewBundleToken`), for a bundle a live backend preview of that name
  was deployed with (`previewMayFetchBundle`) — never the project's service
  key.
- **Never** the `projects` row, the apps registry, `project_domains` or
  `deployments`.
- **At most 3** live backend previews per project (`PREVIEW_LIMIT`; the
  namespace quota is 20 Deployments).
- **Billing**: one app unit at the default dial and the project's capacity
  class, merged onto its app lines. Starting one runs the deploy's card-on-file
  gate. A first build that fails before any pod exists is torn down at once,
  so it is neither billed nor counted against the limit.

### Expiry and deletion

- `expires_at` is the last deploy plus 7 days.
- `crons/preview-reaper.ts` (hourly) tears expired previews down — skipping one
  whose build is running, re-reading each row before it acts — and fails
  builds a control-plane restart stranded. `DELETE` does the same teardown at
  once: workload and Secrets, then the database and role, then a static
  prefix, then the row is marked deleted and the subscription re-synced.
- A build that finds its preview deleted when it finishes tears down what it
  applied.
- Pausing a project scales its previews to zero with it. Deleting a project
  deletes the namespace, the preview rows cascade, and `sites/<id>/` goes with
  its stored code.
- Bundles: `managed/bundle-gc.ts` is a planner with no runner. A runner must
  count `previews.bundle_id` and `preview_deployments.bundle_id` as referenced.

## Not built

- **`rebase cloud previews promote <name>`**, shipping a preview's bundle to
  production — a production bundle deploy by id, the path rollback has.
- **Previews from git pushes.** Deploy hooks already filter by branch.
- **A Previews panel in the console.**
- **Seeding a preview database** with a copy of production or with fixtures.
- **Extensions in a preview database.** Mirroring production's needs CNPG
  1.26's `Database.spec.extensions`; the fleet runs 1.25.1.
