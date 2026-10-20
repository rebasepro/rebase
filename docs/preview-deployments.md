# Preview deployments

A preview is a build served on an address of its own, such as
`https://songbuzz--new-quiz.rebase.website`. Production keeps serving what it
served before. The owner can see a change on the real platform, and share it,
before anyone using the app gets it.

The CLI half ships from this repository: `rebase cloud deploy --preview`,
`--preview-name`, and `rebase cloud previews`. The control plane's half lives
in `saas` and has not been built. It is specified in
[What the control plane must add](#what-the-control-plane-must-add). Until it
exists, the CLI refuses `--preview` with `previews_unavailable` and deploys
nothing.

## What the user sees

```bash
rebase cloud deploy --preview                 # the backend, with its folded static apps
rebase cloud deploy game --preview            # one static app alone
rebase cloud deploy --preview-name new-quiz   # a stable name: the same address on every deploy
rebase cloud previews                         # name, address, app, backend, expiry
rebase cloud previews delete new-quiz --yes
```

On success the deploy prints the preview's address, says which backend its
pages call, and says that production is unchanged. In JSON mode, the result
carries `preview: { name, url, app, backend, status, deploymentId, expiresAt }`.

## The two kinds

| What was deployed | `backend` | What its pages talk to |
| --- | --- | --- |
| A static app by name (`deploy game --preview`) | `production` | The production backend, through the preview's own host: `/api` is forwarded to production's Service |
| The backend (`deploy --preview`), with every static app folded in | `preview` | Its own backend pod, on an **empty database of its own** |

**Why a static preview forwards `/api` instead of calling production
cross-origin.** A folded or scaffolded frontend calls its API by a relative
path. On a preview host with no backend, that path would 404. Calling
production's host directly would need the preview origin in production's
`CORS_ORIGINS`, and changing that means restarting production. Forwarding
`/api` from the preview host keeps the request same-origin and leaves
production's configuration alone. The price is that a sign-in on a static
preview is a real production session, and writes made there are production
writes. `backend: "production"` is how the CLI says so.

**Why a backend preview never uses production's database.** A managed pod boots
with `REBASE_MIGRATE_ON_BOOT=ensure` (`packages/server/src/boot/provision.ts`).
Pointed at production's database, it would add the preview's tables and
columns there, and `ensureCollectionPolicies` would rewrite production's RLS
policies to the preview's rules. Its crons and job workers would also run
against production data. A copy of production's data is a possible later
option (`--preview-data copy`). It is not the default, because a copy carries
personal data to a less guarded address.

## Why the CLI talks to a separate function

A preview is triggered by `POST /api/functions/previews/<projectId>`. It is
never `deploy` with a flag on it. `deploy`'s `POST /` reads the fields it knows
and ignores the rest. An older control plane that received `preview: {}` would
therefore deploy the build to production, which is the one outcome previews
exist to prevent. An unknown function, on the other hand, is a 404
`FUNCTION_NOT_FOUND` (or `No route for …` on older servers), and the CLI turns
that into `previews_unavailable`. The safety comes from the route, so it does
not depend on any server remembering to check a field.

The bundle is still uploaded through `deploy/bundle/upload`. Storing an archive
deploys nothing.

## What the CLI leaves out of a preview

Each of these would change the production project, so a preview does without:

- **No rebuild source.** The stored source is what a platform upgrade rebuilds
  production from. If a preview's source replaced it, the next rollout would
  ship the preview to production.
- **No `declaredApps`.** Registering apps, and the hostnames they name, writes
  the production project's apps registry and `project_domains`.
- **No `--source`, `--eject`, or container build.** A preview is a bundle.
  Each of those builds an image for production. They are refused with `usage`.
  A backend without `runtime: "managed"` is refused with
  `preview_unsupported`.

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
envelope: a 4xx with `details.intakeCode` and `details.hint`. Suggested codes
are `PREVIEW_LIMIT`, `PREVIEW_NAME_TOO_LONG`, and `PREVIEW_NEEDS_MANAGED_DB`.

`GET /api/functions/previews/<projectId>` answers `{ previews: Preview[] }`.
`DELETE /api/functions/previews/<projectId>/<name>` answers `{ success: true }`,
or a 404 that is not `FUNCTION_NOT_FOUND` when no preview has that name.

## What the control plane must add

Everything below is in `saas`. Paths are relative to `saas/backend`. They were
read on saas `main` at `325851c`.

### Records

- **A `previews` table**, unique on `(project_id, name)`. Columns: `app`,
  `kind` (static or backend), `status`, `host`, `bundle_id`,
  `static_deployment_id`, `database_name`, `created_at`, `updated_at`,
  `expires_at`, `deleted_at`.
- **A `preview_deployments` table** with the columns of `deployments`, plus
  `preview_id`. This table must be separate from `deployments`, because that
  table's newest row means "what production runs" to:
  - `blockingDeployment` (the per-project deploy lock, `functions/deploy.ts`
    ~3784), and through it fleet moves and billing;
  - `statusFromHistory` and the stale-deployment reaper, which set the project
    to `failed`;
  - `/rollback`, which accepts any successful row with a bundle;
  - redeploy's `sourceRef` reuse;
  - the console's history;
  - every CLI already installed (`cloud logs`, `cloud status`).

  A preview row in `deployments` would be reported as production by all of
  them, and old clients cannot be updated to filter it.
- **Its own lock.** One build per preview name at a time. It never takes the
  project's lock, so a preview build does not block a production deploy.

### Naming and hosts

- The host is `<subdomain>--<name>.<tenantBaseDomain>`. With no name given, the
  control plane picks 6 random base-36 characters.
- `utils/subdomain.ts` allows `--` today, so a project could register
  `songbuzz--x` and collide with a preview host. `rejectSubdomain` must refuse
  `--` in new subdomains. Existing rows that hold one must be checked first.
- One DNS label is at most 63 characters. Refuse `PREVIEW_NAME_TOO_LONG` when
  `subdomain.length + 2 + name.length > 63`. The CLI caps names at 24
  characters.
- DNS already resolves: `*.rebase.website` is a wildcard A record. TLS does
  not, unless `REBASE_WILDCARD_TLS` is on (`k8s/wildcard-tls.ts`). With it
  off, every preview host costs one HTTP-01 certificate from the 50-per-week
  budget for `rebase.website`. Turn wildcard TLS on before previews ship.

### A backend preview

These objects go in the project's namespace (`tenantNamespaceOf`), and none of
them reuses a production name:

- **Deployment `rebase-preview-<name>`** with pod label
  `app: rebase-preview-<name>`. The label must differ from production's:
  Service `rebase-backend` selects `app: rebase-backend`
  (`k8s/external-backend.ts`). A preview pod carrying that label would take
  production traffic. Run one replica on the smallest dial, with no PDB and no
  autoscaling.
- **Its own Service and its own Ingress, `rebase-preview-<name>`.** Never add a
  rule to `rebase-ingress`. Its rules are replaced wholesale on every
  production deploy (orchestrator ~3668-3850).
- **Its own database.** Run `CREATE DATABASE preview_<name>` on the project's
  CNPG cluster, owned by a role of its own. It starts empty, and boot's
  `ensure` builds the schema. A bring-your-own-database project is refused with
  `PREVIEW_NEEDS_MANAGED_DB`, because the platform cannot create a database on
  someone else's server.
- **Its own secrets:**
  - a fresh `JWT_SECRET`, so production sessions are not valid on the preview;
  - a fresh `REBASE_SERVICE_KEY`;
  - `rebase-platform-env`-shaped `DATABASE_URL`s pointing at the preview
    database.
- **Customer env** (`rebase-tenant-env`) is copied, because the app needs its
  configuration. This also copies live third-party keys. Say so in the console,
  and add `env set --preview` overrides later.
- **Extra env:**
  - `REBASE_PREVIEW=<name>`, so app code can tell where it runs;
  - `CORS_ORIGINS=https://<preview host>`;
  - crons and job workers off by default (`REBASE_CRON_SCHEDULER`,
    `REBASE_JOB_WORKERS`), because a cron that sends email does so with
    production's keys.
- **Storage** goes under a `previews/<name>/` prefix of the project's bucket,
  or none.
- **The bundle** is fetched the way production fetches it: the bundle route
  accepts any bundle of the project with the project's service key.
- **Never** write the `projects` row (`status`, `runtimeMode`,
  `activeBundleId`, `rebuildSource`), the apps registry, or `project_domains`.
- **Cap the count.** The namespace quota is 20 Deployments, so cap backend
  previews at 3 per project. A fourth is refused with `PREVIEW_LIMIT`, whose
  hint names `rebase cloud previews delete`.

### A static preview

- Publish to the existing immutable prefix,
  `sites/<projectId>/<app>/<previewDeploymentId>/` (`static/hosting.ts`).
  Never move `apps.staticDeploymentId`, which is production's pointer.
- Pin the prefix against static retention, which keeps 3 per app
  (`static/deploy-static.ts`). Otherwise three production deploys delete a
  live preview's files.
- Route the preview host: files from that prefix, and `/api` to production's
  `rebase-backend` Service. Production static hosting goes through whatever
  serves `apps[].staticDeploymentId` today. The front door
  (`front-door/route-table.ts`) runs only when `REBASE_STATIC_BUCKET` is set,
  and it was not found set in `infra/`. **Verify which path serves static apps
  in production before building this.**

### Expiry and deletion

- `expires_at` is the last deploy to the preview plus 7 days. Deploying the
  same name again extends it.
- A cron in `crons/` (`defineCron`, hourly) reaps expired previews. `DELETE`
  does the same work synchronously:
  1. delete the Deployment, Service, Ingress and Secrets;
  2. drop the database and its role;
  3. delete the site prefix;
  4. release the host;
  5. set `deleted_at`.
- Deleting a project deletes its namespace, which takes the k8s objects. Its
  previews' site prefixes and databases need the same sweep.
- Bundles: `managed/bundle-gc.ts` is a planner with no runner. When one is
  built, a live preview's `bundle_id` counts as referenced.

### Billing

A backend preview is a running pod. Meter it like any unit at its dial. A
static preview is files, and counts as storage.

## Not in this change

- **`rebase cloud previews promote <name>`**, which ships a preview's bundle to
  production. It is a production bundle deploy by id, the path rollback already
  has, so it needs no rebuild.
- **Previews from git pushes.** Deploy hooks already filter by branch
  (`hookEffectiveBranch`). A hook could create a preview named after the
  branch.
- **A Previews panel in the console.**
- **Seeding a preview database** with a copy of production, or with fixtures.
