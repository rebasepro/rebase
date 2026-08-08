# Unit 63 — `rebase eject`

Read-only audit, 2026-08-08. Scope: `packages/cli/src/commands/eject.ts`, its test, and
the payload under `packages/cli/templates/eject/`, traced through to what the emitted
project would actually install, typecheck, build and boot.

## Verdict

`rebase eject` is presented as the supported, trustworthy route off the managed runtime —
its own header calls it "the supported route", and the manifest, the docs table and two
other commands point at it. It is not a route that has ever been driven. Nothing in this
repository typechecks, compiles, installs or boots the four files it writes: the CLI's
`tsconfig.json` has `rootDir: "./src"` so `templates/` is invisible to `tsc`, the unit test
asserts only that files appear on disk and that two substrings occur in a compose file it
just wrote, and `rebase eject` is invoked in **zero** CI jobs and **zero** e2e tests — the
one e2e comment that mentions it (`e2e/tests/cli-init-e2e.ts:1103`) claims to cover "the
eject template" while running `docker compose build` on the *managed* compose file, never
having ejected. The result is what class 13 predicts. Ejecting a headless project emits an
entrypoint that cannot compile, because it imports two files `--headless` deleted. Ejecting
a stock project produces an image that never serves the frontend — twice over, once from a
`__dirname` that is two directories off under the compiled layout and once because the
Dockerfile never copies `frontend` at all — while the compose file it writes asserts the
opposite in a comment. Ejecting *anything* silently stops every cron job, and silently
deletes the `storage` and `telemetry` blocks from the user's `rebase.json`, because
`writeManifest` reconstructs the file from three fields and drops the rest. The one test
that would plausibly catch that last one — "leaves a manifest that still validates" — is
precisely the assertion the bug satisfies. On the positive side the *decision* logic is
careful and well tested: the double-eject guard, the never-overwrite rule for `Dockerfile`
and the compose file, `--dry-run`, and the refusals for static/unknown apps are all real
and all covered. The command decides correctly and then writes the wrong thing.

Counts: 5 high, 8 medium, 7 low.

---

## High

### H1. `rebase eject` silently deletes the `storage` and `telemetry` blocks from `rebase.json`

`packages/cli/src/commands/eject.ts:227` → `packages/cli/src/manifest.ts:577-586`

`writeManifest` does not write the manifest it was given. It builds a fresh object from
three fields:

```ts
const ordered = {
    $schema: manifest.$schema ?? "https://rebase.pro/schemas/rebase.json",
    rebase: manifest.rebase,
    apps: manifest.apps
};
fs.writeFileSync(filePath, `${JSON.stringify(ordered, null, 4)}\n`, "utf8");
```

`RebaseProjectManifest` declares two more top-level fields
(`packages/types/src/types/project_manifest.ts:202` `storage`, `:217` `telemetry`).
`parseManifest` reads `storage` back (`packages/cli/src/manifest.ts:382,391`) and never
reads `telemetry` at all. Either way, both are gone from the file after any write.

Failure scenario A — storage. A project declares `"storage": { "media": { "engine": "s3" } }`
and configures `S3_BUCKET__MEDIA`. The user runs `rebase eject`. `rebase.json` comes back
with the `storage` block deleted. `loadDeclaredStorageSources` (which the ejected entrypoint
calls at `templates/eject/backend/src/index.ts:33`) now reads "declared nothing" and
`resolveStorageSources` synthesizes a single default source from the *unsuffixed*
`S3_BUCKET`. Every upload that used to go to the `media` bucket now goes somewhere else or
501s. `rebase build` (`build.ts` passes `storage: manifest.storage`) and the console lose
the topology too. Nothing is printed.

Failure scenario B — telemetry. An organisation commits `"telemetry": false` specifically so
that the setting applies "for everyone who clones this repository, overriding each
developer's own opt-in". One developer runs `rebase eject`; the line is deleted from the
committed file and anonymous usage sharing turns back on for the whole team on the next pull.

The eject test at `eject.test.ts:122-130` ("leaves a manifest that still validates") is the
test that should have caught this and cannot: a manifest with the `storage` block removed
still validates.

Fix direction: `writeManifest` should spread the manifest and order keys, not enumerate
three of them; `parseManifest` must carry `telemetry` through. A round-trip test —
`parse(write(parse(x))) === x` on a manifest carrying every declared field — is the guard.
`apps.ts:155` is the other caller and has the same loss.

### H2. Ejecting a headless (`--headless` / BaaS) project emits an entrypoint that cannot compile

`packages/cli/templates/eject/backend/src/index.ts:20,23,90` vs
`packages/cli/src/commands/init.ts:795-809`

`applyHeadless` deletes exactly the files the eject payload imports:

```ts
fs.rmSync(path.join(targetDirectory, "config", "collections"), { recursive: true, force: true });
fs.rmSync(path.join(targetDirectory, "backend", "src", "schema.generated.ts"), { force: true });
fs.rmSync(path.join(targetDirectory, "frontend"), { recursive: true, force: true });
```

The payload imports `./schema.generated.js` (line 20) and
`../../config/collections/users.js` (line 23), and resolves `collectionsDir` to
`../../config/collections` (line 90). None of the three exists in a headless project.

This is not a hypothetical combination — it is the documented path. The BaaS overlay's own
tsconfig says so: *"it declares no collections, so there is no generated schema, and the
server entrypoint lives behind `rebase eject`"*
(`packages/cli/templates/overlays/baas/backend/tsconfig.json:19`). A headless user is told
the entrypoint is behind eject; eject hands them two `TS2307`s and, if they get past `tsc`,
an `ERR_MODULE_NOT_FOUND` at boot.

Fix direction: the payload needs a headless variant (no generated schema, no users
collection import, `introspectCollections` instead of `collectionsDir`), selected from the
same signal `applyHeadless` used — or eject must refuse a headless project with a message
that says why. Either way the BaaS tsconfig comment has to stop promising a working eject.

### H3. The ejected image never serves the frontend, and the compose file says it does

`packages/cli/templates/eject/backend/src/index.ts:194`,
`packages/cli/templates/eject/Dockerfile:36-38,65-69`,
`packages/cli/templates/eject/docker-compose.custom.yml:55-57`

Two independent defects, either one sufficient.

**(a) Wrong path.** In production the entrypoint calls:

```ts
serveSPA(app, { frontendPath: path.join(__dirname, "../../frontend/dist") });
```

Under the compiled layout `__dirname` is `<root>/backend/dist/backend/src` — the payload
itself states this twice: `templates/eject/backend/src/env.ts:12-18` ("the compiled output
lives at `backend/dist/backend/src/env.js` — two directories deeper") and
`eject.ts:274`, which writes `start: "node dist/backend/src/index.js"`. So `../../frontend/dist`
resolves to `<root>/backend/dist/frontend/dist`, not `<root>/frontend/dist`. The sibling
paths on lines 90–91 are correct precisely *because* the compiled config lands at
`dist/config/` — the frontend is the one that isn't in the compiled tree, and the relative
path was never adjusted. It needs `../../../../frontend/dist`.

**(b) The frontend is not in the image at all.** The Dockerfile copies `backend` and
`config` and nothing else. `frontend` is never copied, never installed, never built, never
carried into the runtime stage.

`serveSPA` fails soft — `packages/server/src/serve-spa.ts:115-119` logs a warning and
returns, with its own comment noting "a wrong path leaves the API answering perfectly while
the site 404s". So the observable result of a stock eject is: `docker compose -f
docker-compose.custom.yml up --build` succeeds, `/api/*` works, `/` returns 404, and the
only evidence is one warning line.

Meanwhile the compose file the same command wrote states as fact:

```yaml
# Your entrypoint serves the built frontend itself (see the `serveSPA`
# call in backend/src/index.ts), so this is one container, same origin.
CORS_ORIGINS: ${CORS_ORIGINS:?set CORS_ORIGINS to the origin you browse to}
```

and the CHANGELOG entry justifying `rebase build`'s custom-runtime skip rests on the same
claim ("static apps in the same repo still build, since an ejected entrypoint serves them
itself via `serveSPA`"). Class 5: text describing a mechanism that does not run.

Fix direction: fix the relative path; add `COPY frontend ./frontend` plus a
`pnpm --filter "*-frontend" run build` stage (or copy a prebuilt `frontend/dist`), and copy
the built assets into the runtime stage. A boot-time assertion that the SPA mount actually
found `index.html` would turn this class of bug loud.

### H4. Ejecting silently stops every cron job

`packages/cli/templates/eject/backend/src/index.ts:89-101` vs
`packages/server/src/boot/boot.ts:216-223`

The managed runtime passes `cronsDir: bundle.cronsDir` to `initializeRebaseBackend`. The
eject payload passes `collectionsDir` and `functionsDir` and no `cronsDir`. `init.ts:1666`
gates all cron loading on `if (config.cronsDir)`, so an ejected server loads zero jobs and
logs nothing about it.

`backend/crons` is a first-class, documented directory: `RebaseBackendAppConfig.crons`
exists, `synthesizeManifest` sets it when the directory is present
(`packages/cli/src/manifest.ts:505`), and `.env.example` instructs users to "add a cron file
in `backend/crons` that default-exports `createBackupCron`" for scheduled database backups.

Failure scenario: a project running nightly backups via `BACKUP_SCHEDULE` ejects. Backups
stop. The only signal is their absence, discovered when one is needed. The demo entrypoint
`app/backend/src/index.ts` *does* pass `cronsDir` — the eject payload is the copy that
drifted, and nothing compares them.

Fix direction: pass `cronsDir: path.resolve(__dirname, "../crons")`, and add a boot warning
when a `crons` directory exists but no `cronsDir` was configured (the same shape as the
existing "cron routes mounted but no jobs loaded" warning at `init.ts:1715`).

### H5. The ejected image never contains `rebase.json`, which the entrypoint reads at boot

`packages/cli/templates/eject/Dockerfile:34,66` vs
`packages/server/src/boot/sources.ts:394-447`

The entrypoint's first statement is
`const storageSources = loadDeclaredStorageSources(__dirname);`, whose docstring reads: *"A
custom runtime has no manifest… Since a custom image contains the repository anyway, reading
the file it already ships is what keeps one declaration authoritative for both runtimes."*

The Dockerfile it ships alongside copies `package.json pnpm-lock.yaml pnpm-workspace.yaml
.npmrc`, then `backend` and `config`. `rebase.json` is copied in neither stage. The loader
walks up five levels from `/app/backend/dist/backend/src`, finds no `rebase.json`, and
returns `[]` — which by design means "declared nothing", quietly.

So the mechanism that exists specifically so a custom runtime and the platform read one
list is inert in the only image eject knows how to build. Combined with H1, a multi-bucket
project loses its topology twice: once from the file, once from the image.

Fix direction: add `rebase.json` to both `COPY` lines. Since "absent" and "declared nothing"
are indistinguishable by design, the fix must be the copy, not a louder loader.

---

## Medium

### M1. `backend/src/index.ts` is overwritten with no warning — and one of the CLI's own messages tells users to do it

`packages/cli/src/commands/eject.ts:44-53`, `:210-218`; `packages/cli/src/manifest.ts:511-515`

The payload table marks the entrypoint `overwrite: true`, justified by a comment: *"it is
written even if something is already there — but only after the guard below has established
that this project is not already ejected."* The guard is `app.runtime === "custom"`
(`eject.ts:165`). That is not the same predicate. "This project is not already ejected" and
"there is no hand-written server here" differ exactly in the case the CLI itself warns
about:

```ts
if (!dockerfile && exists("backend/src/index.ts")) {
    console.warn(
        "⚠ backend/src/index.ts exists but this project's backend is managed — it is\n" +
        "    never loaded. Delete it, or run `rebase eject` to make it the entrypoint."
    );
}
```

Failure scenario: a user hand-wrote `backend/src/index.ts` (and `rebase dev` has been
running it, because `dev.ts:539-541` selects the entrypoint by *file existence*, not by
`runtime`). They see this warning, follow its second branch, and run `rebase eject`. The
manifest is `managed`, so the guard passes, and their server file is replaced by the
template. No prompt, no `--force`, no `.bak`. `--dry-run` reports it as `write
backend/src/index.ts`, indistinguishable from creating a new file. The same applies to
`backend/src/env.ts`.

Class 5, in its most expensive form: the remediation destroys the thing it claims to adopt.

Fix direction: treat an existing `backend/src/index.ts` as a distinct state — either refuse
without `--force`, or write the payload to `backend/src/index.rebase.ts` and say so; and
have `--dry-run` label an overwrite as an overwrite. The manifest warning should stop
implying eject preserves the file.

### M2. Nothing typechecks, builds or boots the payload, in this repo or in CI

`packages/cli/tsconfig.json:4,26-28`; `packages/cli/src/commands/eject.test.ts`;
`e2e/tests/cli-init-e2e.ts:1103`

`packages/cli/tsconfig.json` sets `"rootDir": "./src"` and `"include": ["src"]`, so
`templates/eject/backend/src/index.ts` — 228 lines calling nine `@rebasepro/server` exports,
two `@rebasepro/server-postgres` exports and ~20 env fields — is never seen by a compiler.
`grep -rn "eject" .github/` returns nothing. The only e2e mention is a comment claiming
coverage that does not exist:

```ts
// Still run compose build: the eject template adds services that DO
// declare `build:`, and a project that ejected must keep working here.
await execa("docker", ["compose", "build"], { cwd: projectPath, ... });
```

`rebase eject` is never invoked in that suite, and `docker compose build` with no `-f`
reads `docker-compose.yml`, not `docker-compose.custom.yml`. The comment describes a test
that was never written.

What `eject.test.ts` does assert is genuinely useful for the *decision* layer (H-guard,
overwrite rules, dry-run, refusals) but never touches the payload's correctness: the only
content assertions are `expect(custom).toContain("build:")` and
`toContain("dockerfile: Dockerfile")` — substring checks on a string the test just
generated, which is class 13 by definition.

Fix direction: a `tsconfig.templates.json` that compiles the payload against the workspace
packages would have caught H2 and would catch the next drift; and an e2e step that actually
runs `rebase eject`, builds the image, boots it, and fetches `/` and `/api/data/...` would
have caught H3, H4, H5 and M4.

### M3. `rebase.json` is written with `port: 8080` while every file eject writes uses 3001

`packages/cli/src/commands/eject.ts:225`;
`templates/eject/Dockerfile:77,81`; `templates/eject/docker-compose.custom.yml:48,54`;
`packages/server/src/env.ts:90`

Eject writes `port: app.port ?? 8080`. `RebaseBackendAppConfig.port` is documented as
"`runtime: "custom"` only. Port the container listens on."
(`packages/types/src/types/project_manifest.ts:96-97`). The container it just described
listens on 3001: the Dockerfile `EXPOSE 3001` and health-checks `localhost:3001`, the
compose file sets `PORT: "3001"` and publishes `${PORT:-3001}:3001`, and `loadEnv` defaults
`PORT` to `"3001"`.

So the manifest states a fact about the image that is false for the image in the same
commit. Today the SaaS orchestrator hardcodes 3001 (`saas/backend/src/k8s/orchestrator.ts:1441,1786`),
so nothing routes on it — which is worse, not better: the declaration is wrong *and*
unexercised, so the day something honours it, every ejected deploy fails its readiness
probe.

Fix direction: `port: app.port ?? 3001`, or read the value the payload actually uses from
one place.

### M4. The one command eject prints does not bring up a working stack

`packages/cli/src/commands/eject.ts:246` vs
`packages/cli/templates/eject/docker-compose.custom.yml:7-9`

Eject prints exactly one next step:

```
docker compose -f docker-compose.custom.yml up --build
```

The compose file it wrote thirty lines earlier documents three:

```
#   docker compose -f docker-compose.custom.yml up -d db
#   rebase db push                                    # once
#   docker compose -f docker-compose.custom.yml up --build
```

The middle line is load-bearing and specific to ejecting. The managed runtime creates
collection tables and applies RLS policies at boot — `ensureCollectionSchema` and
`ensureCollectionPolicies`, `packages/server/src/boot/boot.ts:215,265`. The eject payload
calls neither. Following the printed command against a fresh database therefore produces a
stack that boots, health-checks green, signs users in (auth tables *are* ensured by
`initializeRebaseBackend`) and returns nothing or 401 from every `/api/data/*` route,
because the tables do not exist and no policy grants the restricted role anything.

Fix direction: print the three-line sequence the compose file already documents, or make
`rebase db push` unnecessary. Not a two-line summary of a three-line procedure.

### M5. The Dockerfile cannot build an npm-scaffolded project, and its own advice does not cover that

`packages/cli/templates/eject/Dockerfile:9-10,34,41,44-45,48,66`

The header says:

```
# Assumes pnpm, which is what `rebase init` scaffolds a workspace for. On npm,
# swap the three pnpm lines below for `npm ci` and `npm run build --workspace`.
```

npm is a supported package manager for `rebase init` — `detectPackageManager` returns
`"npm"` as its *fallback* (`packages/cli/src/utils/package-manager.ts:146`) and the template
ships an npm `workspaces` array. An npm-scaffolded project has `package-lock.json` and no
`pnpm-lock.yaml`.

The failing line is not one of the three the header names. It is line 34:

```dockerfile
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
```

`docker build` fails there with "failed to compute cache key: pnpm-lock.yaml: not found",
before any of the swappable lines is reached. Line 66 in the runtime stage repeats it.
Class 5: remediation text that does not cover the failure it will actually produce.

Fix direction: either emit an npm variant of the Dockerfile when the project has a
`package-lock.json`, or extend the header to list every pnpm-specific line — including the
two `COPY`s.

### M6. `docker-compose.custom.yml` hardcodes `5432:5432` and reuses the managed stack's project name

`packages/cli/templates/eject/docker-compose.custom.yml:21,31-34,67-71` vs
`packages/cli/src/commands/init.ts:1240-1266`

`rebase init` picks a free host port for Postgres (`findAvailablePort(5432)`), writes it
into `DATABASE_URL`, and rewrites `docker-compose.yml`'s port mapping to match. That rewrite
happens at init time, on a file that exists then. `docker-compose.custom.yml` is written
later, by eject, and ships the literal `- "5432:5432"`.

Failure scenario: a developer with Postgres already on 5432 inits (gets 5433, `.env` says
`127.0.0.1:5433`), later ejects, and runs the printed command. The `db` service fails to
bind 5432, and if it does come up, `rebase db push` — step 2 of the compose header — talks
to the *other* Postgres on 5433. Two symptoms, one cause, neither pointing at it.

Separately, both compose files declare `name: {{PROJECT_NAME}}` and the same volumes, so
they are the same Compose project with different service names (`api` vs `backend`).
Alternating between them orphans containers and recreates `db` on each switch — the "going
back is a one-line change" promise costs more than one line in practice.

Fix direction: derive the custom compose's host port from `.env` at eject time (the value is
right there in `DATABASE_URL`), and give the custom stack its own project name.

### M7. `pnpm install --frozen-lockfile` runs against a workspace whose `frontend` package is absent from the build context — UNCONFIRMED

`packages/cli/templates/eject/Dockerfile:34-41`,
`packages/cli/templates/template/pnpm-workspace.yaml:1-4`

The scaffolded `pnpm-workspace.yaml` lists `frontend`, `backend`, `config`, and the lockfile
generated by `rebase init` has an importer for each. The Dockerfile copies
`pnpm-workspace.yaml` and the lockfile but only two of the three package directories, then
runs `pnpm install --frozen-lockfile`.

I could not confirm by execution (no installs in this audit) whether pnpm treats a lockfile
importer with no corresponding directory as `ERR_PNPM_OUTDATED_LOCKFILE` or ignores it.
Marked UNCONFIRMED. It is worth resolving because the fix for H3(b) — copying `frontend` —
removes the question entirely.

### M8. Every path the payload uses is hardcoded, ignoring the manifest fields that configure them

`packages/cli/templates/eject/backend/src/index.ts:20-23,90-91`;
`packages/types/src/types/project_manifest.ts:73-87`

`RebaseBackendAppConfig` declares `config`, `functions`, `crons`, `schema` and
`usersCollection` as overridable paths, and the managed boot honours all of them via the
bundle. The eject payload hardcodes `../../config/collections`, `../../config/storage.js`,
`../../config/collections/users.js`, `../functions` and `./schema.generated.js`, and eject
never substitutes anything but `{{PROJECT_NAME}}`.

Failure scenario: a project declares `"functions": "backend/handlers"` — legal, validated,
honoured by `rebase dev` and by every managed deploy. After eject the server loads
`backend/functions`, which does not exist, and every custom route 404s with no error at
boot.

Fix direction: either template these paths from the manifest at eject time, or have eject
refuse (with the field named) when the backend app declares a non-default path the payload
cannot express.

---

## Low

### L1. Other managed-boot configuration the payload silently drops

`packages/server/src/boot/boot.ts:216-252` vs `templates/eject/backend/src/index.ts:89-162`.
Beyond `cronsDir` (H4), the ejected entrypoint never passes: `callbacks`
(global lifecycle callbacks read from the config package — they stop firing), `dataSources`
/ `bootstrappers` for secondary databases, `storagePublicRead`,
`storageInsecureAllowAnyAuthenticated`, `basePath` (`REBASE_BASE_PATH` is ignored),
`compression`, `maxBodySize`, `logging` (`LOG_LEVEL` is ignored), `enableSwagger`,
`schemaVersion`/`runtimeVersion`, and `schemaEditor: false`. Each is a managed feature that
disappears at eject with no message. Worth a single explicit "what an ejected entrypoint does
not carry" list, in the payload's header comment, kept honest by a test that diffs the two
call sites.

### L2. `--dry-run` does not mention the `backend/package.json` rewrite

`eject.ts:195-207` lists the four payload files and `rebase.json`. It does not list
`backend/package.json`, which `restoreBackendScripts` (`:257-278`) mutates on the real run —
adding `main`, `dev` and `start`. A dry run's purpose is to enumerate what changes.

### L3. `rebase build` then `rebase start` is a loop on an ejected project

`build.ts:141-151` skips a custom backend and prints advice; `start.ts:63-71` falls back to
the backend workspace's `start` script when no bundle exists, i.e. `node
dist/backend/src/index.js`. Nothing in that chain ever runs `tsc`, so `npm run build && npm
start` at the project root (the two scripts the template's root `package.json` ships) fails
with a missing module. The advice printed by `build.ts` is the missing step, but it is
printed as prose rather than run.

### L4. `npm run build --workspace <app>` advised inside a pnpm workspace

`build.ts:148`. This repository has already fixed this exact class once — `init.ts`'s
ts-morph advice said `npm install` in a pnpm workspace (bug-classes sweep 2026-07-28). The
argument is also the *manifest app key*, not the workspace package name; they coincide only
because the stock scaffold names both `backend`.

### L5. `serveSPA`'s docstring cites a template path that no longer exists

`packages/server/src/serve-spa.ts:90-92` names
`packages/cli/templates/template/backend/src/index.ts` as one of its two callers. That file
was deliberately removed when the entrypoint moved behind eject
(`init.test.ts:113-124` asserts its absence). The live path is `templates/eject/backend/src/index.ts`.

### L6. `../../uploads` resolves to three different places

`templates/eject/backend/src/index.ts:152` passes `path.resolve(__dirname, "../../uploads")`
as the local-storage base: `<root>/uploads` in dev, `<root>/backend/dist/uploads` in
production, and the Dockerfile creates `/app/backend/uploads`
(`templates/eject/Dockerfile:72`) — none of which match. Masked today because the compose
file sets `STORAGE_PATH: /uploads`, so the fallback is never exercised in the one
configuration anyone runs.

### L7. There is no documentation page for `rebase eject`

`grep -rln "rebase eject" website/src/content/docs/docs/` returns the CHANGELOG and one
table row in `architecture/apps-and-repositories.md:27`. For a command framed as the trust
feature — the guarantee that you are not locked in — there is no page explaining what you
get, what you give up, or what to do next. Per the sidebar/llms.txt note in the docs-drift
work, absence from the sidebar also means absence from `llms.txt`.

---

## Checked and clean

- **Decision logic.** The double-eject guard (`eject.ts:165-169`), the "decide everything
  before writing anything" plan/apply split (`:181-193`), never overwriting `Dockerfile` or
  `docker-compose.custom.yml` (`:44-64`), leaving the scaffolded `docker-compose.yml`
  untouched, and the refusals for a static app and an undeclared app are all correct and all
  covered by `eject.test.ts`.
- **Declared dependencies.** Everything the payload imports — `hono`, `hono/cors`,
  `hono/secure-headers`, `@hono/node-server`, `@rebasepro/server`,
  `@rebasepro/server-postgres`, `dotenv`, `zod` — is declared in `backend/package.json` in
  *both* flavours (`templates/template/backend/package.json:15-22`,
  `templates/overlays/baas/backend/package.json:11-20`). No undeclared runtime dependency
  of the npm-hoisting class here.
- **`workspace:` protocol.** Eject emits no `package.json` and rewrites no dependency
  specifier, so it cannot introduce a `workspace:` range. `scripts/validate-no-workspace-protocol.sh`
  covers only `packages/*/package.json` and `rebase-agent-skills/package.json`, i.e. it does
  not look at templates at all — but that is an `init` exposure, not an eject one.
- **Dotfiles.** The eject payload contains no `.gitignore`/`.npmrc`-class file, so the
  npm-pack stripping problem does not reach it. `templates/` is listed in
  `packages/cli/package.json` `files`, so the payload does ship; `findCliRoot` locates it
  from `dist/` correctly.
- **API surface.** All nine `@rebasepro/server` imports resolve to real exports
  (`HonoEnv` via `export * from "./api/types"` at `index.ts:141`), `history: true` matches
  `HistoryConfig = boolean | { retention?: number }`, and every environment variable the
  payload reads is in `rebaseEnvSchema` (`packages/server/src/env.ts:88-137`). No obvious
  type error in the payload — which is luck, not process (see M2).
- **`CORS_ORIGINS`.** The compose file's `${CORS_ORIGINS:?…}` guard is satisfied: `rebase
  init` uncomments and fills it (`init.ts:1166-1168`). Same for `DATABASE_PASSWORD`,
  `JWT_SECRET` and `REBASE_SERVICE_KEY`.
- **`restoreBackendScripts`.** Uses `??=` throughout, so it never clobbers an existing
  script; tolerates a malformed `package.json` with a warning rather than a half-eject; and
  `tsx watch --include=` is the correct flag for tsx 4 (verified against
  `node_modules/tsx/dist/cli.mjs`: `include:{type:[String],description:"Additional paths &
  globs to watch"}`).
- **`node dist/backend/src/index.js`** is the right compiled path for the template's
  `tsconfig.json` (no `rootDir`, `include` spans `src`, `functions` and `../config`, so the
  inferred common root is the project root).
- **`schemaEditor`.** Not passed by the payload, but its default already disables in
  production (`init.ts:1127-1128`), so an ejected production image does not expose it.

---

## Open questions

1. **Has anyone ever completed an eject?** H2 (headless eject cannot compile) and H3 (no
   frontend in the image) are both first-command failures. Their coexistence suggests the
   payload has not been run end-to-end since it moved out of the scaffold. Worth asking
   before deciding how much of it to trust.
2. **M7** — pnpm's behaviour on a lockfile importer with no directory. One `docker build`
   settles it.
3. **`writeManifest`'s other caller.** `apps.ts:155` has the same lossy round-trip as H1.
   Is there a third path that writes `rebase.json` (the console, the control plane) with the
   same shape?
4. **Adjacent, outside unit 63 (UNCONFIRMED):** `dev.ts:549` inserts
   `--watch="<glob>"` into a `tsx watch` invocation. tsx 4's watch command declares
   `--include` and `--exclude`, not `--watch`; `app/backend/package.json` uses the same
   `--watch=` spelling. If tsx rejects or ignores it, the "watch the collections dir when
   auto-generation is off" behaviour never worked. One `tsx watch --watch=x` run decides it.
5. **Is `rebase cloud deploy` on an ejected project covered anywhere?** It is the other half
   of the eject story (build an image, ship it), and this audit found no test that exercises
   the custom-runtime deploy path either.
