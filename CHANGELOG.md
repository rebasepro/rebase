# Changelog

## [Unreleased]

### Added

- **`admin.display` — one block for how a record presents itself.** A record shows up as a heading, a card, a row, a board tile and a reference chip, and each of those needs to know which property is the title, which is the image, which is the status. That was `admin.titleProperty` and a great deal of per-surface guessing: the detail view had grown its own copy of the title logic and the two had already drifted, so the same record could be headed one way in the list and another way when you opened it.

  `display` names the roles instead — `title`, `subtitle`, `image`, `status`, `date`, `tags` — and one resolver (`entity-display.ts`, `useEntityDisplay`, cached) answers for every surface: the table, list, board and card bindings, the preview slots, the form, the entity views and `useColumnsIds`. The property paths are checked against your own properties the way the rest of the `admin` block is, so a renamed field is a compile error rather than a column that quietly stops appearing.

  ```diff ts
   import { defineCollection } from "@rebasepro/admin-types";

   export default defineCollection({
       name: "Posts",
       slug: "posts",
       table: "posts",
       properties: { title: { name: "Title", type: "string" } },
  -    admin: { titleProperty: "title" }
  +    admin: { display: { title: "title" } }
   });
  ```

  **`admin.titleProperty` still works.** It is deprecated, not removed: it shipped in 0.13.0 and is still read at runtime, with `display.title` winning when both are set. Postgres introspection codegen emits the new block, and the collections docs and skill are updated in all six locales.

- **The self-host runtime image is published by the release, not by remembering to.** The scaffolded `docker-compose.yml` presents `rebase build` + `docker compose up` as the way to self-host and pins `REBASE_VERSION` to the released version, but nothing published `rebasepro/server` on a release — `cloudbuild-runtime.yaml` has had a Docker Hub push for months and runs only when someone types `gcloud builds submit`. So the first command in the file a new project is handed ended at `pull access denied for rebasepro/server, repository does not exist`. The release workflow now builds and pushes it (amd64 + arm64) after npm and the tag, then verifies the tag is pullable from outside with no credentials.

  `scripts/check-runtime-image.mjs` keeps it honest: every image reference in a shipped compose file must have an automatically-triggered publisher, and a build config only a human can run does not count. `verify-selfhost.mts` could never have caught this — its own header says what it leaves out, "a container and an image tag".

- **`rebase skills install --agent all`**, for scripted and CI use. Without a TTY the command has to be told which agents to install for, because a scaffolded project ships a marker file for every one of them (`.cursorrules`, `CLAUDE.md`, `.windsurfrules`, `AGENTS.md`) and detection therefore has no signal — guessing would install four agents' skills unasked.

### Fixed

- **A monthly cron job spun at 112 iterations a second instead of waiting.** `setTimeout` holds its delay in a 32-bit signed integer: past ~24.8 days Node does not wait and does not throw, it clamps the delay to 1 ms and fires immediately. `scheduleNext` had a floor on the delay and no ceiling, so a job like `0 4 3 * *` — whose next slot sits about 30 days out for most of the month — woke at once, claimed its own future slot, lost the race against that claim on the next wake, logged *claimed by another instance*, and rescheduled into the same overflow. A tenant ran this way for a day and a half: 1.9 GB of logs, a `cron_claims` INSERT every 9 ms, and the job itself never running. Pod restarts did not clear it, because the claim that makes it skip is a persistent row.

  Three things were wrong and all three are fixed. Delays past the ceiling are now slept in hops and re-derived on waking, so the cron expression stays the source of truth. A fire that arrives **before** its slot no longer claims — an early wake is also what a backwards NTP step or a resumed VM looks like, and claiming on one is unrecoverable, because the claim is permanent and the real run is skipped when it comes due. And startup now releases claims on slots that have not happened yet, which can only come from an early fire, so a database already poisoned by this heals on the next deploy rather than silently skipping one run.

- **A collection whose slug contains slashes rendered a blank page.** `getCollection("content/de-DE/podcasts")` never tried an exact match. It split on `/`, read the pieces as collection/entityId/subcollection, looked for a root collection called `content`, found none and threw — and the catch logged at `console.debug` and returned undefined, which `RebaseRoute` renders as `null`. The result was an empty content pane inside working chrome: the sidebar, the nav highlight and the breadcrumb all still resolved, because those read the collections array directly rather than the registry. One app had thirty-five collections unreachable this way, seven content types across five locales.

  A slug is allowed to contain slashes and some drivers need it to — a Firestore collection partitioned by locale is *named* `content/de-DE/podcasts`, it is not a path to walk. An exact slug match now runs before the path walker, on the id-trimmed path, so a record inside such a collection still resolves to it. And an unresolved collection renders "Collection not found" naming the path, and warns at `console.warn`: returning bare `null` is what made a one-line lookup bug look like missing data, with nothing above `debug` to search for.

- **`optionalAuth` returned 500 on backends that do not issue JWTs.** A backend authenticating through an adapter — Firebase, Clerk, anything with its own tokens — never calls `configureJwt`, so verifying a bearer token threw. That turned a route which had already decided anonymous callers were fine into a 500 for every request that happened to carry a token. The tolerate-the-absence-of-auth paths ask `isJwtConfigured()` first now. The signing paths still throw when it is false, because asking a server that cannot mint a token to mint one is worth hearing about.

- **The read-only record kept the layout the form left behind.** Reading a record and editing it drew the same data two different ways. The form resolves sections, grid spans and a metadata rail from the collection; the read-only view was a flat two-column table of every value — 4/12 label against 8/12 value, no grouping, no second column. A boolean and a markdown body got the same room, an email wrapped over two lines while half the pane beside it stayed empty, and pressing Edit rearranged the record you were just looking at.

  It resolves its layout with `resolveFormLayout` now — the same call the form makes — and renders each field through the same `FieldBlock` and grid span, with a `PropertyPreview` where the form puts a control. So it gets the configured sections, the derived grouping when there are none, the per-type widths with row filling, and the rail with the sidebar fields and the id/created/updated block, folding into a trailing group on a pane too narrow for it. Two things fell out of sharing the resolver: `additionalFields` need a form context the delete dialog has none of, so they are dropped before the layout resolves rather than skipped while rendering (skipping left a hole where a full row had been allocated); and previews take `hideLabel`, because `BooleanPreview` printed the property name beside its checkbox, which under a field label read as "VIP" above a checkbox saying "VIP".

- **The X that hid the list looked like it closed the record.** The split view's list-hiding control sat on the record's own app bar wearing an X, which every convention reads as "close the thing I am attached to". It is a double chevron now, pointing at what actually moves, matching the sidebar toggle. Hiding the list had also been a one-way trip — `#full` replaced the collection and left browser Back as the only route back — so showing it again is the same single route (dropping the hash), offered only where the URL would genuinely resolve to a split.

  The detail view's back arrow moves from the trailing edge, where it sat among the record's own actions, to the leading edge the edit view has always used; where the chevron renders it goes entirely, since both reach the same collection and the chevron keeps the record open. And the breadcrumb is a link now rather than inert text that looked like one, carrying the view mode so a collection reached from one of its own records comes back as you left it. Overlays keep plain text: they already sit on top of that collection, and navigating would dismiss the record as a side effect.

- **The drawer's tooltips were on in the one place they were noise, and off everywhere they were needed.** The collapse/expand toggle carried a tooltip saying "Collapse" while the row it was attached to already said *Collapse* in plain text beside the chevron — the tooltip only backed off while the drawer floated open under the pointer, which is the other state where the word is already on screen. It now shows up only on a bare rail, where the chevron stands alone.

  The navigation entries had the opposite problem. Their tooltip's `open` was controlled by a flag that was true only while the drawer was hovered-but-not-open — and in exactly that state the entries are told the drawer *is* open, which forced the same tooltip shut. The two conditions could never both hold, so no entry tooltip could ever appear in any state. That went unnoticed while hover-expansion was unconditional, because the floating panel's labels covered for it; with `autoOpenDrawer={false}` now a real setting, it left a rail of unlabelled icons with nothing to identify them. Each row now owns its own tooltip state, so they follow the pointer one at a time rather than firing in unison, and they answer to keyboard focus as well. `tooltipsOpen` and `adminMenuOpen` are deprecated no-ops on `DrawerNavigationGroup` and `DrawerNavigationItem`.

  Both tooltips are *masked* where the label already says the same thing, rather than unmounted or switched to uncontrolled — either of those moves a Radix tooltip between controlled and uncontrolled mid-life, which strands whatever it was last told. The first attempt at this fix did exactly that and left a tooltip hanging beside the rail, naming a row the pointer had left seconds earlier. Masking has its own version of the trap: a hidden tooltip never hears the pointer leave, so the stale `true` is dropped on the way *into* the masked state rather than waiting for a close that will not come.

- **An open dropdown left the drawer floating indefinitely.** The collapse-on-mouseleave already declined to fire while a popover was up — its content is portalled outside the drawer, so reaching for it registers as leaving. But nothing fires a second `mouseleave` when that popover finally closes, so the drawer just stayed expanded over the content until the pointer happened to cross it again. The collapse is owed now, not cancelled: the drawer watches for the popover to go and collapses then, unless the pointer came back in the meantime.

- **Two admins on one origin shared a drawer, and the stored state broke server rendering.** The persisted open/closed state used one flat `rebase-drawer-open` key, so a second admin on the same origin — a different `basePath`, its own navigation — silently overwrote the first one's. The key is namespaced by base path now. Reading it also happened during the first render, which is a client-only fact and made the first client render disagree with server-rendered HTML; it is applied in a layout effect instead, before paint, so nothing flashes and nothing mismatches. The unreleased flat key is not migrated: a drawer starts collapsed once, and the next toggle sticks.

- **The drawer's collapse control was a `div` pretending to be a button** — `role="button"` plus a hand-rolled Enter/Space handler, where a `<button>` gets all of it from the platform.

- **Resizing across the layout breakpoint dropped the navigation over the content.** One piece of state drives two different things: the expanded rail on large layouts and the modal sheet on small ones. Narrowing the window with the rail expanded carried that `true` across the breakpoint, so the sheet — overlay and all — appeared over the content unasked, which is the exact outcome the persistence rules were written to avoid. Crossing to a small layout now resets it, and widening again restores the stored choice.

- **The navigation drawer remembers whether you collapsed it, and stops expanding on its own.** Two separate reasons the drawer kept turning up open. First, `autoOpenDrawer` was destructured in `Scaffold` and then never read, so the hover handlers were attached unconditionally: an admin passing `autoOpenDrawer={false}` still got a rail that floated open whenever the pointer crossed it. It is honoured now. Hover expansion remains the default — it is what every admin has always had — and `autoOpenDrawer={false}` genuinely turns it off. Second, the open/closed state was plain `useState` — every reload threw the choice away. It is persisted in `localStorage`, keyed by the admin's base path, so the last toggle is what you get back. `defaultDrawerOpen` still seeds the very first visit and is ignored after that. Small layouts are excluded from persistence on purpose: there the drawer is a modal sheet, and restoring it would drop an overlay over the content on load.

- **Upgrading from 0.12 renamed the foreign-key column and then refused to boot, permanently.** 0.13 derives `category_id` where 0.12 derived `categorie_id`, and boot-ensure renames the database column to match — that half worked, data intact. Then relation validation read the project's checked-in `backend/src/schema.generated.ts`, which the previous release generated and which still says `categorie_id`, and killed the boot. Restarting could not help: the rename was already applied, so every boot failed the same way. The message made it worse by describing the wrong artifact — "`through.targetColumn: "category_id"` is not a column on the junction table", about a column the database *did* have — and advising `through.targetColumn: "categorie_id"`, which by then existed nowhere. Following the fix instructions broke the relation for good.

  Three changes. `rebase dev` now detects a generated schema that names foreign keys under the old rule and regenerates it before the backend starts, so the upgrade does what the 0.13 note said it did. `rebase schema stale` reports the same thing for a build or a CI step, and exits non-zero. And when a stale schema does reach the runtime, the boot error names the generated file as the stale artifact, says to run `rebase schema generate`, and no longer suggests pinning the migrated-away column. `rebase build` was never affected — it regenerates the schema from the collections already.

  Both halves of this had unit tests that passed. The ensure-plan test proved a RENAME is emitted, from a hand-written schema map; the relation-validation test proved a missing junction column is reported, from a registry built to agree with its collections. Neither could see the bug, because it only exists where the two disagree — and no test built a registry from a *stale* generated schema. `legacy-fk-rename-boot-seam.test.ts` is that seam.

- **`rebase.dataAsAdmin.projects.find()` did not typecheck** — nor did `data.products.find()` on the Entity accessor — for any project without a generated `Database` type. The untyped branch of `RebaseSdkData` and `RebaseData` declared their index signature as `SDKCollectionClient | ((slug: string) => SDKCollectionClient)`, unioning in the `collection` method's own signature on the theory that a named property must satisfy the index signature it sits beside. It does not here: `collection` is declared in a separate member of an intersection. The union bought nothing and cost property-style access — the form the type's own `@example` shows, the scaffolded function template uses, and the 0.13 `rebase.data` migration note tells you to write. `collection("projects")` was the only spelling that compiled.

  The migration note shipped uncompiled because it is a ```diff fence, and the docs verifier only ever typechecked `ts`/`js` blocks. Language-tagged diffs (```diff ts) are compiled now — the added lines, with removed lines blanked so diagnostics keep pointing at the right line of the doc.

- **A scaffolded project could not build its own `config` workspace.** `config/tsconfig.json` pins `types: ["node"]` — deliberately, to stop tsc sweeping pnpm's virtual store — but `config/package.json` never depended on `@types/node`, and under pnpm's isolated layout there is none reachable from that directory. `pnpm -r build`, and the workspace's own `build` script, failed with `TS2688: Cannot find type definition file for 'node'` one minute after `rebase init`. `check:templates` could not catch it: it compiles the collection files with its own `typeRoots` pointed at the repo, which is right for what it checks and is exactly why the omission survived. It now also asserts that every ambient type a template tsconfig pins is a declared dependency of the workspace pinning it.

- **A project scaffolded by a prerelease CLI pinned a runtime image tag that cannot exist.** `.env` pins `REBASE_VERSION` to the version of the CLI that scaffolded, which is right for a stable release and wrong for every canary: only stable publishes `rebasepro/server`, so `docker compose up` died on `manifest unknown` — the same dead end as the missing-repository bug the pinning was added to prevent. A prerelease falls back to `latest` now, with a comment in the file saying that it floats and to pin an exact version before deploying. That fallback is correct rather than merely available: a bundle declares the runtime range it needs (`^1`), the image supplies only `@rebasepro/server`, and the framework a bundle runs is installed from its own `deps.declared` at boot, so the current stable runtime boots a canary bundle by design.

- **`/api/health` answered 404.** Health lives at `/health`, outside `basePath`, because that is what an orchestrator probes — but every other route a developer touches is under `/api`, so the first place anyone looks returned "not found" and read as a broken server. It is served at both paths now.

- **`rebase init --headless --introspect` contradicted itself**, announcing "collections generated!" and then "There are no collection files" in the next paragraph. The closing note now depends on whether introspection actually produced them.

### Testing & CI

- **The gates that would have caught this release's bugs.** Each of the fixes above had passing unit tests on both sides of it and none in between, because every fixture built its own input and so could never let the two sources of truth disagree. Five gates close that shape: `legacy-fk-rename-boot-seam.test.ts` builds a registry from a *stale* generated schema while the database has been migrated; `generated-schema-staleness.test.ts` pins the detector including its no-false-positive cases; `check:runtime-image` refuses a shipped compose file naming an image no automatically-triggered workflow publishes; `check:templates` additionally asserts every ambient type a template tsconfig pins is a declared dependency of the workspace pinning it; and the docs verifier compiles language-tagged ```diff fences, so migration guidance is checked rather than just written.

- **The driver floor is measured rather than discovered.** Two capabilities, not one: serving tables that already exist is the fleet-rollout case and every driver back to 0.10.0 manages it, which is what the skew pass asserts. *Creating* them at boot is separate, and drivers before 0.13.0 do not expose it — the runtime logs "Collection tables will NOT be created" and every `/api/data` route 500s on a missing relation the moment a project adds a collection or deploys fresh. CI now measures both.

- **The bundle corpus boots against every driver a project may still carry.** `stage()` lent the whole donor `node_modules`, so both halves came from this checkout and every run booted current-driver against current-server — a pairing that exists on no tenant anywhere. Production is the opposite: `docker/entrypoint.mjs` symlinks only `@rebasepro/server` from the image over a bundle's own copy, so a managed project runs today's server against whatever driver it was built with.

- **`@rebasepro/server`'s API surface is frozen.** It is the one package the entrypoint substitutes into an already-built bundle, so its exports are the only ones that change underneath tenant code on a schedule nobody rebuilding chose. Changes to it now have to be declared.

- **Two dead paths deleted, and what they knew kept.** `FetchService.fetchWithDrizzleQuery` was private with no callers, kept alive only by a test reaching in through `(service as any)` — the worst arrangement available, since the guarantee read as covered while the path that actually serves it had none. That guarantee (a null belongsTo must not inline as a row) moved to `row-pipeline-null-relation.test.ts` against `toRestRow`, which is what production runs, and was checked by deleting the guard and watching it fail. `resetConsole` went too: it snapshotted "the originals" after `configureLogLevel` had already replaced them, so it captured the no-ops and restored them over themselves. Neither was public — `api-surface/server.api.txt` is unchanged. Corpus fixtures are renamed after the `bundleFormat` they carry, since `v2` collided with the runtime contract major, which decides something else entirely.

## [0.13.0] - 2026-08-03

### Breaking

- **`rebase.data` is gone — use `rebase.dataAsAdmin`.** The server singleton had two names for one accessor, and the shorter one gave no hint of what it does: `rebase.data` and `rebase.dataAsAdmin` were the same admin-scoped, **RLS-bypassing** driver. `data` is the name a browser client uses for its *user-scoped* accessor, so the same expression meant "whatever this user may read" on the client and "everything, no policies" on the server. That is a bad thing to have to remember at a call site that reads fine either way.

  ```diff ts
   import { rebase } from "@rebasepro/server";

  - const { data: rows } = await rebase.data.projects.find();
  + const { data: rows } = await rebase.dataAsAdmin.projects.find();
  ```

  `RebaseServerClient` now extends `Omit<RebaseClient, "data">`, so this is a compile error rather than a silent privilege. **The property still exists at runtime**, aliasing `dataAsAdmin`, so an untyped JavaScript caller keeps working instead of failing on `undefined` mid-upgrade — the type is the contract, and it is the type that changed.

  Unaffected, because their accessor is genuinely user-scoped and was never deprecated: `context.client.data` in entity callbacks, and `client.data` in a cron handler — both are `RebaseClient`. Also unaffected: `rebase.data` in a **generated SDK** or browser app, which is a different object entirely.

  For user-scoped queries inside a request handler, neither name is right: use the request-scoped driver (`c.var.driver`), which carries the caller's identity so RLS applies.

- **Every other deprecated export is gone too.** Ten more symbols carrying `@deprecated`, removed rather than carried across the 1.0 line. After 1.0 a deprecated export costs a major to remove, so the choice was to drop them now or keep them until 2.0 — and each one was an alias for something already exported under a better name, so keeping them only bought a second way to write the same line.

  | Removed | From | Use instead |
  | --- | --- | --- |
  | `buildCollection` | `@rebasepro/common` | `defineCollection` |
  | `buildProperty` | `@rebasepro/common` | a plain property object |
  | `RebaseUser` | `@rebasepro/client` | `User` from `@rebasepro/types` |
  | `RebaseTokens` | `@rebasepro/client` | `AuthTokens` from `@rebasepro/types` |
  | `UserInfo` | `@rebasepro/app` | `User` from `@rebasepro/types` |
  | `Session` | `@rebasepro/app` | `DeviceSession` from `@rebasepro/types` |
  | `AuthApiError` | `@rebasepro/app` | `RebaseApiError` from `@rebasepro/types` |
  | `DatabaseConnection` | `@rebasepro/server` | `DriverConnection` |
  | `createApiKeyRateLimiter` | `@rebasepro/server` | `createDataRateLimiter` |
  | `resolveChannelBusConfig` | `@rebasepro/server-postgres` | `resolveChannelBusSetting` |

  Every one is a rename at the import site. The three that are not purely cosmetic:

  `createApiKeyRateLimiter` **skipped every request that was not API-key-authenticated**, which on a normal deployment is nearly all of them — a limiter that reads as protection and passed the traffic you would want limited. `createDataRateLimiter` covers signed-in users and anonymous callers too, and has been the wired default since it landed.

  `buildCollection` / `buildProperty` were **announced as removed in 0.11 and were not** — the note went into the changelog and into the collections docs, and both functions kept shipping from `@rebasepro/common` for two more minors. Anyone who read the note migrated; anyone who did not kept a working build. Now the code matches what was published, and the collections docs no longer name a version the removal did not happen in.

  `DatabaseConnection` is still a name you can import from `@rebasepro/server` — that is the point of removing it. Two different shapes answered to it: a local alias for `DriverConnection`, and the canonical `DatabaseConnection` from `@rebasepro/types` that the package re-exports. Deleting the alias leaves one. If your import resolved to the alias, it was the driver connection and wants `DriverConnection`; if it type-checks unchanged, it was already the canonical one.

- **Default foreign-key column names were mangled for irregular plurals, and are fixed.** `generateForeignKeyName` singularized by chopping a trailing `s` off the snake-cased name, which produced `categorie_id` for `categories`, `addres_id` for `addresses`, never `child_id` (it gave `children_id`), and — because `toSnakeCase` splits on every capital before the chop — `ur_l_id` for `URLs`. It singularizes first now, with the package's real `singular()`, then snake-cases. Two guards: a double-`s` ending is never a plural marker, and a name that singularizes to nothing keeps its original.

  **This changes the default column name for affected relations**, so an existing database has the old name. Boot-ensure migrates it: when a table carries the relation column under its pre-singularization name and not its current one, it emits `ALTER TABLE … RENAME COLUMN "categorie_id" TO "category_id"` rather than `ADD COLUMN`. In Postgres a rename is metadata-only — the values stay put and the column's indexes and constraints travel with it. Adding was the actual bug: it created the new column empty beside the populated old one, every statement succeeded, and the relation then read the empty one.

  If you named the column explicitly, nothing changes — this is only the default.

- **`firestoreToCMSModel` and `cmsToFirestoreModel` are renamed** to `firestoreToRebaseModel` and `rebaseToFirestoreModel` in `@rebasepro/firebase`. They reached consumers through the package barrel's `export *`, so this is a breaking rename with no alias — a shim would keep the word in the API it is being removed from. (`toCmsRow` → `toFlatRow` moves with them, but is internal to `server-postgres`.)

- **MongoDB search matched no field.** `buildSearchConditions` selected searchable columns with `prop?.dataType === "string"`. No property in `@rebasepro/types` has ever had a `dataType` field — a real collection carries `type` — so the loop matched nothing for every collection a user could declare, `orConditions` came back empty, and the fallback turned every search into a `$text` query, which needs a text index and throws `IndexNotFound` without one. The suite passed because its fixtures were written with the same wrong key.

- **`admin.widthPercentage` is gone — use `admin.span`.** Field width is a span over a shared four-column grid now, so two fields line up whatever order they were declared in. A raw percentage could not line up with anything: `33` and `35` produced different widths that looked like a mistake, and nothing snapped to a common edge.

  ```diff
  - admin: { widthPercentage: 50 }
  + admin: { span: 2 }
  ```

  If you are migrating: `≤30 → 1`, `≤55 → 2`, `≤80 → 3`, otherwise `4`. Spans are ignored where the form is too narrow for two columns — the side panel, the split pane, a phone — which was also true of percentages.

- **`RebaseAuthConfig` is gone from `@rebasepro/admin-types` — use `RebaseAuthViewConfig`.** It was a compatibility alias for a name that collides head-on with `RebaseAuthConfig` in `@rebasepro/server`, which configures the *backend* auth: JWT secrets, OAuth providers, password hooks. Two unrelated shapes under one name, exported from two packages whose whole job is to be imported together.

- **`react-router` 8, and `react-router-dom` is gone** — react-router 8 deletes the `react-router-dom` package outright. It was only ever a v6-compatibility shim: everything DOM-specific had already collapsed into `react-router` itself in v7.

  `@rebasepro/admin`, `app`, `studio` and `plugin-ai` now peer `react-router ^8.3.0`. Two imports move, and only one of them is a rename:

  ```diff
  - import { createBrowserRouter, RouterProvider } from "react-router-dom";
  + import { createBrowserRouter } from "react-router";
  + import { RouterProvider } from "react-router/dom";
  ```

  Everything else — `useNavigate`, `useLocation`, `useSearchParams`, `useParams`, `Link`, `NavLink`, `Outlet`, `Navigate`, `Route`, `Routes`, `MemoryRouter`, `useBlocker` — is the same name from `react-router`. `RouterProvider` is the exception: it lives in `react-router/dom`.

  The floors underneath move with it, because react-router 8 requires them: `react` and `react-dom` peers go to `>=19.2.7` (were `>=19.0.0`), and `engines.node` on `@rebasepro/admin` and `app` to `>=22.22.0` (was `>=20`). Declaring `>=20` while a mandatory peer needs 22.22 is a promise the package cannot keep.

  This closes GHSA-qwww-vcr4-c8h2, which has no fix on the 7.x line. That advisory is an RSC-mode CSRF bypass and nothing here uses RSC mode, so the vulnerable path was unreachable — but 8.3.0 is the only patched release, and the alternative was staying on a package that no longer exists.

  **If you test with Jest**, budget for this: react-router 8 is ESM-only, and it breaks ts-jest's CommonJS output in two unrelated ways. react-router guards a Vite HMR hook with `import.meta.hot`, which is a *syntax* error in CJS — and ts-jest cannot fix it, because TypeScript emits `import.meta` verbatim under `module: commonjs`. Separately, react-router depends on `cookie-es` 3, which ships `.mjs` only, and TypeScript keys module format off the file extension, so it will not emit CJS for a `.mjs` input whatever `module` says. Every affected suite dies at module load with zero tests run, which reads as a broken config rather than a dependency-format problem. `scripts/jest/react-router-esm-transform.cjs` in this repo handles both and is a reasonable thing to copy. Vitest is unaffected.

- **`rebase cloud deploy --source` on a managed project now needs `--force`.** It ejects the project to a custom container image, and until now it did that on the strength of `--source` alone — read as self-evidently a deliberate eject. It is not. `--source` answers *which source gets built* — this directory, rather than the months-old archive the control plane is holding — and the eject is a side effect of that answer, not something the caller named. Someone reaching for `--source .` because they want their working tree deployed has the right instinct and no reason to expect a runtime change.

  That is how a live project got flipped from `runtime.mode: managed` to `custom`, discovered afterwards from `rebase cloud status` showing `frameworkVersion: null`. The bare form had been refused for the identical reason since the release below; `--source` was the hole left in it. Both forms are now the same rule: a container-image build of a project the platform runs as managed happens only when `--force` says to.

  ```diff
  - rebase cloud deploy --source .        # ejected, with a warning
  + rebase cloud deploy --bundle          # stay on managed — almost always what was meant
  + rebase cloud deploy --source . --force  # eject on purpose
  ```

  The refusal carries `code: "managed_project"`, which is what it already used, so a caller already branching on that code needs no change.

- **`rebase db branch` keeps the name you give it.** Branch names were stripped of everything outside `[a-zA-Z0-9_]`, so `rebase db branch create my-feature` answered `✓ Branch "myfeature" created` — a different name than the one asked for, and the only one `list` would ever show.

  ```diff
  - $ rebase db branch create my-feature
  -   ✓ Branch "myfeature" created successfully.
  + $ rebase db branch create my-feature
  +   ✓ Branch "my-feature" created successfully.
  ```

  Nothing needed the stripping: every identifier the branch service builds is double-quoted, which is what makes a hyphen safe, and the validator used for `--from` had always accepted hyphens — the two disagreed about the same character class. A name that *cannot* be represented (a space, a dot, a slash) is now refused with `Invalid branch name: only letters, digits, underscores, and hyphens are allowed.` rather than quietly turned into a different one. Names are also capped at 60 characters, because Postgres truncates identifiers past 63 bytes silently, which is the same rename by another route.

  **Branches created before this keep the name they were stored under.** `my-feature` from an older release is recorded as `myfeature`, and that is what `list` shows and what `delete` takes. `delete` and `info` now read the database name from the metadata row instead of re-deriving it, so those older branches drop the database they actually own — re-deriving would have aimed at `rb_my-feature`, which is either nothing or somebody else's database.

### Security

- **`realtime.requireAuth: true` opened the socket instead of closing it.** The connection handler seeds every session with `authenticated: !requireAuth`, so a `requireAuth` that resolves false does not skip a later check — it marks each connecting client as *already authenticated*. Both sockets computed it as

  ```ts
  authConfig.requireAuth !== false && !!authConfig.jwtSecret
  ```

  which ANDs the one setting whose entire purpose is to demand authentication together with the presence of a **local** secret. On a server that authenticates through an `AuthAdapter` — or through anything other than `auth.jwtSecret` — that expression is false, so asking for authentication was what granted it, silently, to everyone who connected.

- **The socket answered the opposite of the HTTP routes.** One product decision — "does this server require an authenticated caller?" — with two enforcement points that each computed it. `init.ts` had `resolveRequireAuth`: no auth configured means auth is required, an `AuthAdapter` always means required, and only an explicit `requireAuth: false` opens it. The socket carried its own copy, and the two disagreed on the case that matters most: with no auth configuration at all, `/api/data` answered 401 to every read while the socket admitted everyone and served the same rows. Not a weaker gate on the socket — the opposite answer.

  The socket's expression is gone rather than corrected; both enforcement points call `resolveRequireAuth`, and the tests pin that they agree rather than restating each answer separately.

- **`policy.authenticated()` admitted anonymous visitors.** There were two sentinels for "nobody is signed in". The types, the policy compiler, the JavaScript evaluator and the anonymous-grant linter were all built on `ANONYMOUS_USER_ID` (`'anonymous'`); the request path scoped unauthenticated callers as `'anon'`. So `policy.authenticated()` — the sanctioned, documented way to write "signed in", the thing the linter *tells you to use* — compiled to `auth.uid() <> 'anonymous'` and was true for every signed-out caller.

  The linter had it exactly backwards, too: it flagged `auth.uid() <> 'anon'` as a Supabase habit comparing against "a string no caller ever has", when `'anon'` was the only spelling that worked.

  This is worse than a default that fails open, because it inverts a rule the author wrote deliberately. A policy that reads as a lockdown was a full grant, and nothing about it looked wrong at any layer — in one deployment it left `INSERT` on companies, company memberships and jobs open to anonymous callers, and a membership row is a privilege boundary: every anonymous visitor shares one uid, so a single claim is a membership held by the internet.

  The request path now reports `ANONYMOUS_USER_ID` everywhere it scopes a caller — the JWT and adapter middlewares, the websocket handshake, the realtime service, and the rate limiter's "is this a real user" check. New: `ANONYMOUS_USER_IDS` (every spelling, newest first) and `isAnonymousUid()`.

  **Existing databases are fixed by upgrading the server**, without regenerating a single policy: a stored `auth.uid() <> 'anonymous'` starts excluding anonymous callers the moment they report that id. `policy.authenticated()` now compiles to `NOT IN ('anonymous', 'anon')` rather than a single literal, because a policy is written into the database and outlives the server that generated it — one spelling is a hole in whichever direction the versions happen to skew.

  **What breaks:** a policy that *grants* to anonymous callers by comparing `auth.uid() = 'anon'` stops matching. That fails closed, and `policy.not(policy.authenticated())` is the supported way to say it.

- **`auth.requireAuth: false` no longer un-gates cron, logs, backups and the schema editor.** That flag answers a question about the data plane — must a caller present a token to read `/api/data`, or does RLS alone decide? — and `false` is the answer the server itself recommends at boot to anyone serving a public website from their own backend. It was also, silently, the switch that decided whether the admin surfaces were gated at all.

  So the documented configuration for a public job board or marketing site mounted `POST /api/cron/:id/trigger`, `GET /api/logs` and `/api/admin/backups` for anyone who could reach the service. A single `warn` per surface at boot was the only notice, and on a `--allow-unauthenticated` Cloud Run deployment "anyone who can reach the service" means the internet. Anyone whose cron jobs spend a metered third-party quota was paying for that.

  Admin surfaces are now gated whenever there is authentication to gate them with — an `AuthAdapter`, or a `jwtSecret` — independent of `requireAuth`. Whether anonymous callers may read your posts has no bearing on whether they may run your cron jobs.

  **If you deploy with `requireAuth: false`**, calls to these routes that previously succeeded unauthenticated now answer 401. They accept what every other admin surface accepts: an admin JWT, the service key, or an `rk_` API key created with `admin: true` — the API-key pre-auth runs ahead of the JWT check, so a scheduler holding an admin key keeps working. Point Cloud Scheduler (or whatever triggers your jobs) at an admin key before upgrading.

  One thing comes *back*: `/api/meta/contract` is served again on these deployments. It is only mounted when it can be gated, so a public-data-plane project had been 404ing it, and with it typed client generation from another repository.

- **A backend with no authentication at all now refuses its admin surfaces instead of serving them open.** With no `AuthAdapter` and no `auth.jwtSecret` there is no credential this server could check a caller against, so it cannot tell an admin from the internet. It used to mount cron, logs, backups and the schema editor anyway, ungated, with one `warn` per surface at boot as the entire defence.

  They now answer **501 `ADMIN_SURFACE_UNAVAILABLE`**, with a message naming the missing switch. They stay mounted rather than disappearing on purpose: an unexplained 404 on `/api/cron` reads as a broken path or a failed deploy and gets debugged as one. A token does not change the answer — there is nothing to verify it against.

  This is unlikely to touch you: every scaffolded backend and the bundle runtime configure `auth.jwtSecret` (the runtime *requires* it, and auto-generates one in development), so the affected shape is a hand-rolled entrypoint that passes no `auth` — or one whose `JWT_SECRET` quietly failed to reach the container, which is precisely the deployment that should not be serving a cron trigger to anonymous callers.

  The data plane is unaffected and still answers 401 there: "show me a token" is a truthful thing to say about `/api/data`, and a dishonest one about a surface no token can open.

- **Every `overrides:` entry is a bounded security floor now.** An override replaces each transitive consumer's own range, so a bare `>=X` is not a floor — it is a floating pin that drags in the next major to publish, whatever asked for what.

  One of them had inverted completely: `js-yaml: ">=4.2.0 <5"` pinned the tree *at* 4.2.0, which is precisely the version GHSA-52cp-r559-cp3m says to leave (patched in 4.3.0). The pin meant to protect was the thing holding the exposure. `uuid` had meanwhile floated from its 11.x floor to 14 unnoticed.

  Closes 12 further advisories across `brace-expansion` (three live majors, so its floors are keyed per-major rather than forcing one on every consumer), `js-yaml`, `react-router`, `shell-quote` and `protobufjs`. Re-resolving moved no package version, so the bounds themselves are hardening only.

- **`@hono/node-server` in the scaffolded backend goes from `^1.19.12` to `^2.0.12`**, closing GHSA-frvp-7c67-39w9 (a `serve-static` path traversal on Windows via an encoded backslash). The 1.x line has no patch, and `@rebasepro/server` already peered `^2.0.12` — a new project was being handed an adapter two majors behind the server consuming it.

### Fixed

- **`customProps` in the collection editor was marked deprecated by accident.** It carried a `@deprecated Superseded by span` tag that belonged to `widthPercentage` and slid onto the next field along when that one was deleted. `customProps` is live — it is how a custom `Field` or `Preview` receives its props, and `PropertyFieldBinding` reads it on every render. Nothing about the behaviour changed; the tag is gone, so editors stop striking through a supported field and suggesting a replacement that does something else entirely.

- **The eject warning was suppressed exactly where it mattered.** The warning above the refusal — the one that exists because ejecting "is not something to discover from a runtime version going blank" — was printed behind `!isJsonMode()`. JSON mode latches on whenever stdout is not a TTY, so piping the command, or running it from CI or a coding agent, deleted the warning outright, and the deploy's JSON payload carried no equivalent field. The one case with nobody watching the terminal was the one case that said nothing.

  Warnings now go to stderr in every output mode — stderr is not the JSON stream, so it cannot corrupt a parser — and only their *formatting* depends on the mode. Whether a warning is emitted at all no longer does. The deploy payload gains `warnings: [{code, message, hint}]` and a denormalised `ejectsManagedRuntime` boolean for CI to test directly; both fields are always present, so `false` never has to be told from absent.

- **`deploy` printed human progress to stdout in JSON mode**, ahead of the result object, breaking any parser reading it — the `🚀 Triggering deployment…` banner on both the source and managed-bundle paths, the source upload's size line, and on the bundle path the entire build transcript (`Building bundle…`, the compiler's own log lines, frontend folding, `Uploading bundle…`). Progress goes through one `progress()` helper now, which drops it in JSON mode. The rule it settles: progress is not a result and disappears when stdout belongs to the JSON; a *warning* is not a result either, but goes to stderr and never disappears.

- **A project that had never deployed reported `custom · your own image`.** `projects.runtime_mode` is a record of what the last deploy made a project, and it carried `DEFAULT 'custom'` from the migration that added it — which was a true statement about the projects that existed *then*, and applied to every row created ever after. So a project created seconds ago, which had never built anything, named a container image nobody had built. Most visibly right after the console's create wizard, whose runtime step defaults to Managed and says outright that the choice is intent and writes no mode.

  It also blunted the one signal that catches an accidental eject: `custom` was equally the resting value of a project nothing had happened to, so it could not distinguish "a source build moved you off managed" from "nothing has happened here yet."

  The column stops defaulting (control plane migration `0040_runtime_mode_undecided`), making NULL the honest third state, and `rebase cloud status` and the console's overview, infrastructure and apps headers all read it as "not deployed yet" rather than inventing an image. Every non-display reader already coerced absent to `custom` before use, so nothing else changes. Existing rows are deliberately **not** backfilled — a row saying `custom` today may be a project that really did ship source, and there is no way to tell those apart from the ones the default flattened.

- **Several concurrent realtime subscriptions hung on a cold page load.** A view that opens more than one at once — a Kanban board opens one per column — reported `Subscription timed out` for all but one of them, thirty seconds in. The socket was healthy: probed directly, six concurrent `subscribe_collection` frames all answered inside 15ms. The frames were never sent.

  `ensureAuthenticated` published its in-flight guard only *after* awaiting the token getter, so every caller arriving in that gap started an attempt of its own — and the message queue flushing on connect delivers exactly that. Each attempt then registered under ``auth_${Date.now()}``, the one request id with no random suffix, so attempts in the same millisecond collided in a `Map` and only the last survived. One promise settled; the frames waiting behind the others never reached the socket. Client-side navigation skips the path (`isAuthenticated` is already true), which is why the same view worked on every visit after the first.

- **Kanban drag-and-drop put cards in the wrong place, and did not persist a column change at all.** `handleDragOver` moves the card between columns while the pointer is still down, so looking it up by id at drop time finds it in its *destination* — the board reported every cross-column drop as a same-column reorder and never wrote the column property. Separately, the drop handler passed every card in every column to `onItemsReorder`, whose consumer reads it as the target column and takes the moved card's neighbours from it to compute a sort key.

  Also: releasing over a column rather than a card no longer forces an append (which sent a card dropped mid-column to the bottom), dropping onto an empty column no longer aborts the save, and collision detection is `closestCorners` — the default only reports a target while the dragged rect overlaps one, so a card held over a gap reported nothing.

- **Board sort keys are `fractional-indexing` keys the database can sort.** The library's default base62 output only orders correctly under byte comparison, and the sort is done by Postgres, whose default collation is not byte comparison: under `en_US.UTF-8`, `"aa"` sorts before `"aC"`. A board dragged around enough to reach the upper-case digits stopped agreeing with its own keys. Keys are base36 and single case now. Existing keys no longer validate, which is what surfaces the board's **Initialize** bar — and that bar works now: it only ever looked for a *null* order value, so a column full of unusable-but-present values offered a button that updated nothing and never went away.

- **Kanban columns could not be scrolled.** A `flex-1` item defaults to `min-height: auto`, so the view holding the board grew to the board's full content height — 1230px inside an 883px area — and the ancestor's `overflow-hidden` cut off the rest. Each column had a working scroller that never reached its limit.

- **A failed column subscription rendered as an empty column.** Entities cleared, no error surfaced, "No items" under a header still counting eleven of them. It falls back to a one-shot read, reports a failure only if that fails too, and no longer waits out the client's full 30-second watchdog before painting anything.

- **Date previews required a `Date` instance**, so every audit column in every revision-history entry rendered as a red "Unexpected value" box. History is raw API payload, where a timestamp is still the string Postgres sent. Any value that unambiguously names a date is accepted now.

- **Chips lost three quarters of their palette.** A cleanup flattened `CHIP_COLORS` from four tones per hue to one, which left every `colorScheme="blueDark"` resolving to `undefined` — a chip with a colour in its config rendering with no colour at all — and made seeded chips pick from ten schemes, so a five-value enum routinely drew the same background three times. The tones are generated from a per-hue table now, and `ChipColorKey` is a real union rather than `keyof Record<string, …>`, which is why none of it was a type error.

- **The Firebase example compiles again.** It had not built since the property-options split, which made `url` a statement about the data — it feeds `format: "uri"` into the OpenAPI contract — and moved presentation to `admin.urlPreview`. The example's `admin: { url: "image" }` had both halves in the wrong place, and `expanded` likewise belongs in the `admin` block.

### Added

- **`User` is exported from `@rebasepro/client` and `@rebasepro/app`.** The removals above tell a caller to import `User` from `@rebasepro/types`, which was not an instruction a browser app could follow: it installs the client (or app) package alone, and `@rebasepro/types` is *that package's* dependency, not a specifier resolvable from its own project. So the deprecated aliases were removable in a monorepo and stranding anywhere else. `User` now sits beside `RebaseSession`, `AuthTokens` and `DeviceSession`, which were already re-exported for exactly this reason.

- **The entity form has a layout.** It had exactly one — a single centred column of full-width cards in declaration order — and one escape hatch, `formView.Builder`, which replaces the whole form. Nothing in between.

  There is now a four-column grid, titled sections that collapse, and a metadata rail for the fields that describe a record rather than constitute it. All of it is derived by default: a collection that configures nothing gets a two-column form, its id and audit timestamps in the rail, long text and arrays full width, short enums and booleans narrow. `admin.form` is for when the derived answer is wrong. See [Form Layout](/docs/frontend/form-layout).

  On the demo's products form this is 2932px of scroll down to 1587px, and 219px of dead space above the first field down to 24px.

- **The record's identity and its actions live in persistent chrome.** The title, the id and the Save/Discard buttons used to sit *inside* the scrolling form, so the moment you touched the wheel nothing on screen said which record you were editing. They are in a bar above it now, which is also what let the 320px footer holding two buttons go away entirely.

- **JSON and revision history moved out of the tab strip and into a record inspector.** They were the first two tabs — icon-only, unlabelled, ahead of the record you opened the page to edit. They are developer tools, so they sit behind the overflow (`⋮`) menu and open in a panel beside the form; the tab strip is for destinations. Old `#json` / `#history` URLs open the inspector on the pane they name.

- **Two gates for things that were rotting silently.** `pnpm check:examples` typechecks `examples/*`, which were in no pipeline and no root script — `pnpm build` covers `./packages/*` and `./app` only — which is why the Firebase example above stayed broken for weeks. They resolve `@rebasepro/*` to built output the way an installing user does, rather than to source the way `pnpm typecheck` does, so they catch a class of drift the source-resolving gate structurally cannot see.

  `pnpm check:generated` regenerates the committed website artifacts (`llms.txt`, `sitemap.md`, the changelog mirror) and fails on a diff. `llms.txt` had been sitting a commit behind the docs it summarises.

## [0.12.0] - 2026-07-29

### Breaking

- **`rebase.json` is rebuilt around one authored runtime** — the manifest had four unrelated fields named `mode`, an app type (`admin`) with no mechanism behind it, and a managed-vs-custom distinction nobody had written down.

  A backend now declares `runtime: "managed" | "custom"` — who owns the process, independent of where it runs. It used to be *inferred* from the presence of `backend/src/index.ts`, which every scaffolded project had, so every project predating the manifest silently landed on the custom runtime. App types reduce to `backend` and `static`: the admin is an ordinary static app, because `RebaseAdmin` takes its collections as a build-time prop, so a platform-hosted admin was precluded by the component's interface rather than merely unimplemented. Top-level `runtime` becomes `rebase`, so the word means exactly one thing. In the bundle manifest, `mode` becomes `kind: "backend" | "static"`, `entry.static` becomes a list, and `entry.admin` is gone — format-1 bundles still boot, and the format is 2.

  `backend.mode` (`cms`/`baas`) is deleted outright. Where collections come from was never an independent choice: it is whether `<config>/collections` exists.

  Static apps declare a `path` and several are served from one process — the API at `/api`, a site at `/`, the admin at `/admin`, one container. Three ways that could fail silently are now caught: an app built with Vite's default `base: "/"` but served at `/admin` (blank page, every asset 404, no server error) fails `rebase build`; `serveSPA` orders longest-path-first *and* excludes siblings, so a miss under `/admin` can no longer be answered with the site's index.html; and folding appends to `entry.static` rather than overwriting it, which used to let a second app silently replace the first in a bundle that still looked complete.

- **`mode: "cms" | "baas"` is gone from the server as well** — removing `backend.mode` from the manifest left the identical pair standing one layer down: `RebaseBackendConfig.mode`, authored by anyone who ejects and passed to every driver, plus a wire field, a dev env var and an init flag.

  It was never independent of the collections. The Postgres bootstrapper already guarded `mode === "baas" && collections.length === 0`, so the flag could only agree with them or contradict them — and when it contradicted, the server warned and threw the declared collections away. Everything derives from one question now: did any collections resolve?

  - `RebaseBackendConfig.mode` — deleted, and derived *after* the collections directory is loaded, so a `collectionsDir` pointing at nothing falls through to introspection instead of serving an empty API and never looking at the database.
  - `DriverInitConfig.mode` → `introspectCollections`. A driver may contribute collections only when it was asked to describe the schema, so it can no longer inject whatever the database happens to contain into a project that declared its own.
  - `RebaseProjectContract.mode` — removed from `/api/meta/contract` and `/api/meta/schema-version`. Nothing in the CLI, codegen, client or console ever read it.
  - `REBASE_DEV_MODE` — deleted.
  - `rebase init --flavor cms|baas` → `--headless`.

  One behaviour change: declaring collections alongside what used to be `mode: "baas"` now **serves** them instead of discarding them.

- **The CMS-named exports are called what they are** — `useCMSContext`/`CMSContext` → `useAdminContext`/`AdminContext`, `registerCMS`/`unregisterCMS` → `registerAdmin`/`unregisterAdmin`, `CMSBasePropertyNoName` → `AdminBasePropertyNoName`, `CMSNavigationContent` → `AdminNavigationContent`. Smaller than it looks: outside `packages/admin` and `admin-types` these had no consumers.

  Seven locale files did say "CMS" in user-visible strings — "CMS Users", "CMS View" and translated sentences in es/pt/de/fr/it/hi — and the two keys carrying it in the public `RebaseTranslations` type are renamed with them. One collision worth knowing about: `studio_sql_admin` already existed as a different string, so `studio_sql_cms` became `studio_sql_collections_label` rather than being merged onto it.

  `packages/firebase` is deliberately untouched: `FireCMS`, `firestoreToCMSModel` and the optional `DataDriver.delegateToCMSModel` are heritage from a different product, and renaming an optional method on a public driver contract breaks a third-party driver *silently* — an unimplemented optional method is simply never called. That waits for a driver-contract major.

- **A scaffolded project self-hosts the same artifact Rebase Cloud runs** — the template declared `runtime: "managed"` and shipped a compose file that built two custom images, one of which ended in `CMD ["pnpm","start"]` — running the entrypoint the managed runtime never loads, and which is no longer scaffolded. `docker compose up` on a fresh `rebase init` was not merely inconsistent with the project's own manifest; it was broken, building an image around a file that did not exist.

  The scaffolded compose now runs the managed shape — Postgres, plus `rebasepro/server` with `./dist-bundle` mounted — so one container serves the API at `/api` and the admin at `/`, same origin, no CORS between them and no nginx. The frontend image and its `nginx.conf` are gone for the same reason the backend one is: the runtime serves those assets.

  Image-building moves into `rebase eject`, which writes the Dockerfile and a `docker-compose.custom.yml` together and does **not** touch the scaffolded compose — so going back stays a one-line change in `rebase.json` rather than a restore from git.

- **Nine presentation options move into a property's `admin` block** — `fixedFilter`, `includeId` and `includeEntityLink` on a reference or a relation; `widget` on a relation; `sortable` and `canAddElements` on an array; `previewProperties` on a map. The collection half of that split shipped in 0.11 and moved all 38 keys; the property half moved most of its options and left these behind, under a section marker in `properties.ts` that read `─── UI configuration ───`. A backend-only install went on shipping them with nothing to render them.

  ```diff
    tags: {
        name: "Tags",
        type: "relation",
        relation: { kind: "manyToMany", target: () => tagsCollection },
  -     widget: "dialog",
  -     includeId: false,
  +     admin: { widget: "dialog", includeId: false },
    }
  ```

  Writing one at the top level is now a config error naming the fix, the same way the 0.11 collection keys are — `validate-config` reads them off `ADMIN_PROPERTY_KEYS`, so nothing is silently ignored.

  `widget` is the one to check first, because it was never working: `AdminRelationOptions` already declared it and the admin only ever read *that* one, so every top-level `widget: "dialog"` had been quietly rendering a `select`. Moving it into `admin` is what makes an existing declaration take effect.

  Two options that look like the same case stayed on the property, and deliberately: `propertiesOrder`, because `sortProperties` in `@rebasepro/common` reads it recursively and a driver calls that — a core package cannot see the `admin` block at all; and `keyValue`, because it says the map has no declared shape, which is what the OpenAPI generator emits `additionalProperties` from.

- **The SQL-only fields are rejected on a document-store collection** — `table`, `relations` and `disableDefaultPolicies` are declared on `PostgresCollectionConfig` alone, and `columnType`/`columnName` are omitted from the Firestore and MongoDB property maps. A MongoDB collection could be written with a table name and a `columnType: "bigserial"`, and nothing anywhere read either.

  `DataSourceCapabilities` had been reporting this all along — `supportsRelations` and `supportsColumnTypes` are both `false` for the document engines — and the engine-specific collection and property types existed too. The two were never joined, so call sites checked the capability at runtime and then read a field the base type had to declare for them. That is why the fields were on the base.

  Engine-agnostic code narrows with the new `isRelationalCollectionConfig`, which *is* that capability check with the narrowing attached, so a custom SQL engine registered through `registerDataSourceCapabilities` is included rather than excluded by a hardcoded `"postgres"`.

  `securityRules` is **not** part of this and stays driver-agnostic. It is a contract about who may read and write which rows, and each engine keeps it its own way: Postgres compiles it to `CREATE POLICY`, MongoDB translates it into a filter AND-ed into every read and write. `supportsRLS` answers whether an engine *generates policies*, which is a different question from whether it honours a rule.

### Added

- **`rebase cloud deploy` needs no flag on a managed project** — a bare deploy used to be refused with "redeploy it with `rebase cloud deploy --bundle`". The refusal existed because forgetting the flag meant the command built a container image and ejected the project — a plausible mistake with an expensive outcome. Now that the backend *declares* `runtime: "managed"`, the flag is redundant and the bare command builds and ships a bundle. `--source` and `--bundle-dir` are explicit acts and still win, and the refusal stays for the case it was written for: a manifest that says `custom` deploying over a project the platform runs.

- **`rebase cloud status` says which runtime and which framework a project is running** — it reported no runtime information at all, so "what is actually serving this project" had to be assembled by hand from a Docker tag, a manifest and a pod. Three numbers are in play and two of them look interchangeable: the runtime version is the contract line a bundle's range resolves against, the framework version is the `@rebasepro` release the runtime image ships, and a project can legitimately run runtime 1.2.0 — whose image was built against framework 0.10.0 — while its own bundle installs 0.11.0 at boot.

- **The login screens can offer a newsletter opt-in** — `LoginView` takes an `onNewsletterOptIn` prop and renders a checkbox on the sign-in, register and bootstrap forms, translated in all seven locales. It fires only once the credentials are accepted: a ticked box on a *failed* attempt must not subscribe an address whose owner never proved they control it. The state lives in `LoginView` rather than the form, so switching between login and register does not drop the tick. Entirely opt-in — a panel that passes no handler renders no checkbox.

- **A drawer group can carry the icon, and its entries indent beneath it** — a long navigation rendered as one flat column: every entry had an icon of its own, and the group headers organising them sat at 11px in `surface-400`, *below* the contrast of the rows they label. The thing you scan to find anything else was the quietest element on screen, and thirty entries gave no visual sign of which belonged together.

  `NavigationGroupMapping` takes an `icon` now — a Lucide name, like every other icon in a collection. Declaring one moves the anchor from the rows to the group: the header takes the icon, and the entries below trade theirs for an indent of the same width, so labels stay on the original grid and the rail does not change size. The label steps up to 12px `surface-600` to match, since it is now what carries the hierarchy.

  Strictly opt-in, and per group. A group that names no icon renders exactly as it did — same classes, entries keep their icons — so an existing panel sees no change until it asks for one. Two cases stay flat regardless of configuration: a group with no header has nothing to indent under, and a drawer collapsed to a rail keeps its entry icons, because there they are the only thing left to click.

- **`defaultDrawerOpen` — open the navigation expanded** — the drawer started collapsed to a rail with no way to change it. `autoOpenDrawer` looks like the prop for this and is not: it expands on *hover*, and always has, though `RebaseLayout` documented it as "auto-open the drawer on load" while `Scaffold` documented the same prop as "open the drawer on hover". Both docs now say the same true thing.

  The new prop seeds the initial state and nothing more — no effect syncs it afterwards, so a user who collapses the drawer is not re-expanded underneath them on the next render. Ignored on small layouts, where an expanded drawer covers the content it exists to navigate.

- **The shell takes a `logo`** — `Scaffold` accepted one and rendered it in the drawer and top bar, but nothing passed it down, so the prop was unreachable from `RebaseShell` — the component a scaffolded app actually mounts. Threaded through `RebaseShell` → `RebaseLayout` → `Scaffold`.

- **An entity action's icon can be a Lucide name** — `EntityAction.icon` was `React.ReactElement`, alone among a collection's icons; `admin.icon` and `entityViews[].icon` were strings already. An element cannot be written in the `config` package at all: it is plain `.ts`, and a backend loads it for its schema, so importing the UI layer just to name an icon drags React into the server's module graph. Both forms are accepted now and resolved through `getIcon` at every render site.

- **A collection's `entityActions` may name an app-level action by key** — `resolveEntityAction` has always accepted `string | EntityAction`, the collection editor stores exactly these keys, and the sibling field `entityViews` is typed `(string | EntityCustomView)[]`. Only this field's type disagreed, so the documented approach — register the action on `<RebaseAdmin entityActions={…}>`, then name it from the collection — required a cast to write.

  It matters most where the action *cannot* be imported. An action carries an `onClick` and usually opens a dialog, so a collection file that imports one pulls the admin bundle into any backend that loads it; naming it costs nothing there.

- **A full-screen entity has a way back to its collection** — every other layout can be dismissed: a side panel and a dialog close, a split keeps the list beside it. Full screen replaces the collection outright, leaving browser Back as the only route out — which the page never shows as an affordance, and which is wrong anyway once the reader has moved between tabs inside the entity.

- **A project declares its storage buckets in `rebase.json`** — storage had one destination and three ways in, and which buckets a project has was declared in compiled config code, so nothing outside the running container could learn it. The console could only ever configure the default bucket, and a named source was reachable only by hand-writing `S3_BUCKET__MEDIA` — and only on the managed runtime, because the ejected template parsed `STORAGE_TYPE` itself and knew nothing about suffixes.

  Topology moves to `rebase.json`, the one artifact a host can read *before* running a build. The CLI resolves it into the bundle manifest for managed runtimes; a custom runtime reads the same file out of the image it already ships. Both end at the same list, so the console and the tenant cannot describe different topologies. A declared bucket is a topology rather than a boot requirement — declaring one does not fail the boot if its credentials are not present yet.

- **`iterate()` and `findAll()`, so nobody hand-rolls the paging loop** — `find()` with manual `limit`/`offset` was the whole pagination API, so every consumer wrote the same loop and wrote it wrong in the same two ways: terminating on `rows.length >= limit`, which mistakes an exactly-full final page for a middle one and drops everything after it, and capping `findAll`-style helpers by silently truncating.

  `iterate()` is an async generator that fetches a page at a time and yields rows as they are consumed. `findAll()` is the same walk collected under a ceiling that **throws** when hit, because a short array that reads like a complete one is the bug this exists to prevent. Termination comes from `meta.hasMore` alone. Offset paging is the default and drifts under concurrent writes — `cursor: "id"` switches to keyset seeking, built out of parameters `find()` already takes, so it needs nothing new from the server and works on every transport.

- **Filters on a relation, for every kind the driver can compile** — `isFilterableRelation` allowed only `belongsTo`, the one kind with a column on this row. The driver compiles `manyToMany`, `hasMany` and `hasOne` into a correlated `EXISTS` now, so the affordance returns for them; `via` stays out, its join path having no stated inverse. A to-many relation also answers `array-contains` and `array-contains-any` — a to-many *is* the list, so "contains X" is `==` and "contains any of" is `in`, the same `EXISTS` under a different name. Before, the admin rendered those controls and the driver returned a 400 behind them.

- **`supportsVectors` on a data source's capabilities** — `VectorProperty` carries a `dimensions` and is pgvector-shaped, and it was the one driver-specific property kind with no flag to gate it, so unlike every other field in that descriptor there was not even a runtime answer to appeal to: a Firestore collection could declare an embedding and no driver would do anything with it. Postgres claims it; the document stores do not, and `vector` is now excluded from their property maps alongside `relation`.

- **Every collection config is strict-parsed at boot** — nothing checked these files. A config written against an older version loaded clean and whichever keys had moved were ignored: no warning, no log line, no failed boot. The collection still served rows, so the only signal was the feature quietly not being there — an icon that never appeared, a `readOnly` field the panel let you edit, a relation that answered `[]`. The renames were never the problem; a rename with no runtime signal is.

  `assertCollectionConfigs` runs at the loader — the one definition of "the collections" — so the runtime, the drizzle generator, the policy generator and the doctor reach the same verdict. It is also what turns the property-block move above into an error naming the fix rather than a silently ignored key.

- **The cron scheduler warns when in-process timers cannot fire** — jobs are driven with `setTimeout`, and on a platform that freezes or evicts the instance between requests (Cloud Run at `--min-instances=0`, Lambda, Vercel) those timers never fire. The failure was completely silent: the server booted, logged the jobs as registered, and ran nothing. Detected from documented runtime env vars and warned once at scheduler start. Kubernetes pods are excluded, so a GKE Deployment never warns. Nothing here can fail a boot.

### Fixed

- **The API docs disappeared from every project the runtime boots** — `REBASE_ENABLE_SWAGGER` defaulted to a flat `"false"`, which reads as a safe default and was not one: the runtime is how every scaffolded project boots, so `/api/docs` and `/api/swagger` 404'd for projects that never asked for that. `rebase init` prints "docs are at /api/swagger" on completion, the headless README repeats it, and the console's API Explorer fetches `/api/docs` — all three were broken against a project running the runtime.

  The variable is tri-state now and resolved against `NODE_ENV`: unset means on in development and off in production, and an explicit `true` or `false` wins in both. Unset in development resolves to *undefined* rather than `true`, which hands the decision to the server's own policy — the one that already knows to serve the spec while withholding the Swagger UI. Two defaults that can disagree about the same route is the bug this replaces, so there is only one now.

- **A backend with `allowRegistration: false` was a dead end on a fresh database** — `GET /auth/config` reported `registrationEnabled` while `needsSetup`, the login UI showed the first-admin form on the strength of that, and `POST /auth/register` then refused it. `POST /admin/bootstrap` could not break the tie either, since it requires an authenticated caller and an empty database cannot produce one. Hit live on a deployed project.

  The register gate now admits the first registration when the user table is empty — a paginated count, not an unbounded list, since this path serves anonymous callers — and the existing auto-promote makes that user an admin. One user in and the flag binds again; a racer that slips past the empty check is deleted and refused, so the window can never mint a second account. `disableSelfRegistration` stays a hard kill switch above even bootstrap, and `/auth/config` stops advertising registration when it is set instead of pointing the UI at a form that can only 403.

- **`@rebasepro/server` loaded twice in one process left every custom function without a singleton** — under the managed runtime this is the normal layout, not an edge case: the image ships the framework at `/app/node_modules`, while a bundle installs its own dependencies into `/bundle/node_modules`, where `@rebasepro/server` arrives transitively. Every custom function imports `defineFunction` from `@rebasepro/server`, so functions held the bundle's copy while `initializeRebaseBackend()` initialized the image's. With the instance in a module-local variable, `rebase.data`, `rebase.dataAsAdmin` and `rebase.storage` threw "server not initialized yet" on every request to every custom function — in a process that booted cleanly, served `/api/data/*` fine and reported itself healthy. Observed in production as 100% of one tenant's document routes 500ing while the rest of the app worked.

- **The documented `where` query parameter was never read** — the OpenAPI document publishes `where` on every `GET /api/data/{slug}` and the relations docs use it to narrow a subcollection list, but `parseQueryOptions` never looked at it. It was also missing from `reservedQueryKeys`, so it fell through to the per-field `?field=op.value` loop and compiled as a filter on a column literally named "where", which no table has — meaning the documented way to filter a list returned the entire table, bounded only by whatever RLS allowed, until unresolvable fields started failing closed and it became a hard 400 instead. It is parsed as JSON and normalized through the same `deserializeFilter` the querystring dialect uses, so `{"status":["==","active"]}`, `{"status":"eq.active"}` and `{"status":"active"}` compile to one condition — and unlike the querystring, JSON carries types, so `[">=", 18]` stays a number.

- **`serveSPA` 404'd routes that merely shared a prefix** — exclusion was a `startsWith`, so `/api` excluded `/apidocs` and `/admin` excluded `/administrators`. Both are ordinary client-side routes of an app rooted at `/`, and both 404'd: the SPA fallback declined them and nothing else claimed the path. `apiBasePath` is always in the exclusion list, so this was never limited to the multi-app setups the list was added for — a single SPA with a route under `/api<something>` hit it too. Matching is by path segment now.

- **A deliberate 400 was reported as a database failure** — `sanitizeErrorForClient` only knew how to unwrap Postgres errors, so a thrown `ApiError` lost its message, its code and its status on the way to the client and took a `logger.error` line with it. That is the whole diagnosis for a realtime subscription: the admin list prefers `accessor.listen`, so an unknown filter field arrived as an opaque failure and every notify-triggered refetch logged at error as if the database had gone down. A 4xx short-circuits ahead of the Postgres extraction now and passes its message and code through untouched, logging at debug or warn per the error's `expected` flag. 5xx is unchanged: still a generic message, still logged at error, so internals stay server-side.

- **`rebase schema generate` emitted a schema that does not compile** — `rel.localKey` is a *column* name and the generated Drizzle object is keyed by *property*. They coincide until a property is camelCase — `userId` stored in `user_id` — and then the emitted relation references a key that is not there: `Property 'user_id' does not exist on type … Did you mean 'userId'?`. Three of the four relation-emission sites already normalised through `resolvePropertyKeyForColumn`; the `belongsTo` branch did not. It hid because the existing test's collection declares no property matching the FK column, so the resolver fell through and returned the column unchanged — identical output either way.

- **The runtime image did not ship the S3 and SMTP drivers it loads** — the runtime implements S3 object storage and SMTP email and pulls their drivers in with `await import(...)`, but the image never installed them, and the import resolves relative to the runtime's own location: a project declaring `@aws-sdk/client-s3` in its bundle does not satisfy it, because that copy lands off the resolution path. The failure is nasty precisely because it is so narrow — the tenant boots clean, passes every health probe, serves every other route, and fails only on storage *writes*.

- **The runtime deduped every `@rebasepro` package, not just the one that needs it** — the first cut of the singleton fix redirected every `@rebasepro` package the image ships, which took tenants down: the image installs only the narrow dependency set the runtime itself needs, while a bundle's own install resolves each package's full tree, so redirecting `@rebasepro/server-postgres` pointed the database driver at a copy with no `chokidar` and the pod crash-looped. `@rebasepro/server` is the only package that both needs the redirect and is provably safe to redirect.

- **Two published packages imported dependencies they never declared** — `@rebasepro/firebase` declares `firebase` as a peer dependency, but every source file imported the *scoped subpackages* — `@firebase/app`, `@firebase/auth`, `@firebase/firestore` and four more — which appeared only in devDependencies. Rollup externalises every bare specifier, so those imports survived into the published `dist` verbatim. They resolve by accident under npm and yarn, whose hoisting puts them at the top level, and fail under pnpm's isolated layout — so the package type-checked, built and tested green, then broke on first import for an installing user. `@rebasepro/inference` shipped the same way with two packages.

- **A scaffolded project could not run `rebase build`** — `backend/tsconfig.json` and `config/tsconfig.json` left `types` unset, so TypeScript swept every reachable `node_modules/@types` and treated each folder as an implicit type library. Under pnpm that reaches the virtual store, where packages hoisted for peer resolution live — `dompurify` among them, pulled in transitively by the admin editor — and every scaffolded project failed with `TS2688: Cannot find type definition file for 'dompurify'`.

- **A custom runtime was built a bundle it never deploys** — `rebase build` had no `runtime` check, so an ejected project — whose artifact is an image built from its own Dockerfile and entrypoint — still got a `dist-bundle/` produced for it. That is worse than doing nothing, because the bundle looks like the thing that ships. A custom backend is skipped now, naming the two commands that actually build it; static apps in the same repo still build, since an ejected entrypoint serves them itself via `serveSPA`.

- **The headless scaffold's backend had nothing to compile** — moving `storage.ts` into the config package left `backend/src/` empty in the headless flavour: it declares no collections, so there is no generated schema, and the entrypoint moved behind `rebase eject`. The tsconfig still said `include: ["src/**/*"]`, and tsc reports an include matching nothing as `TS18003` — an error, not a no-op — so the backend workspace failed to build on every headless scaffold.

- **The client SDK could not create an admin API key** — `admin: true` is what grants a key the `admin` role: the admin-gated routes, and the RLS `default_admin` policies. `@rebasepro/client` declared its own `CreateApiKeyRequest` without the field, under a comment saying these types lived in the server package rather than in `@rebasepro/types` — which had stopped being true, and the copy had drifted. Passing `admin: true` was an excess-property error, so the one privileged thing about a key was unreachable. There is one declaration now, in `@rebasepro/types`; the client and the server both re-export it.

- **A history entry's `updated_at` was a `string` from Postgres and a `Date` from MongoDB** — the same interface name in two driver packages, plus a third spelling in the admin's `useHistory` hook, so nothing could read history without first choosing a driver. `EntityHistoryEntry` in `@rebasepro/types` is the wire shape and carries a `string`. MongoDB's `Date` was never the contract, only its storage: the driver keeps that for its own document and converts on the way out.

- **The collection editor dropped fields on save** — it round-trips a collection through a hand-written serializable mirror whose whitelist had fallen behind the core types by six fields. Editing a collection in the panel silently unset whichever of them it had.

  Two mattered. `excludeFromApi` is the server-side guarantee that a column — a password hash, a verification token — never reaches an API response; opening such a collection in the editor and saving published it. And collection-level `relations` had no serializer at all, so importing an existing table detected its foreign keys and junction tables, showed them on the form, and discarded every one on save. The other four were `strictWrites`, `disableDefaultPolicies`, `filterOperators` and `urlPreview`; `url` was being dropped too, and it feeds the generated OpenAPI contract.

- **Importing a table wrote a relation shape the framework no longer accepts** — `pgColumnToProperty` existed in two copies. The one the collection editor called emitted the pre-union flat relation (`cardinality`/`direction`, replaced by the `kind` tagged union) and CRUD verbs where `SecurityOperation` takes SQL ones, typed `any[]` at both sites so neither showed up. The correct copy was the one in `@rebasepro/studio`, which had the tests and was called from nowhere. There is one now, in `@rebasepro/common`.

- **The Studio JS editor autocompleted a query shape the server rejects** — its ambient SDK declarations are hand-mirrored and had drifted: ten Firestore-era filter operators with no `like`/`ilike`/`is-null` family, `where` as `Record<string, string>` where a filter is an `[operator, value]` tuple, and `orderBy` as a bare string rather than a `[field, direction]` pair. A bare string reaches PostgREST and builds a malformed query. The operator union is now interpolated from `ALL_WHERE_FILTER_OPS`, so that part cannot fall behind again.


- **A many-to-many child listing failed on a column that does not exist** — the junction's columns were passed into the `EXISTS` subquery as bare Drizzle columns. A column object carries no table qualifier of its own; it renders against whatever table the surrounding builder believes is current. Inside `db.query.findMany`, which aliases the root table, that produced

  ```sql
  EXISTS (SELECT 1 FROM "body_area_podcast"
          WHERE "podcast"."podcast_id" = "podcast"."id" AND "podcast"."body_area_id" = $1)
  ```

  — the junction's columns wearing the *target's* alias. Postgres aborts the transaction on the unknown column, and the fallback read then fails on `25P02 current transaction is aborted`, three frames away from anything to do with the relation.

  The junction is aliased and referenced by identifier now, exactly as the `joinPath` branch beside it already did; only the correlation stays a column object, because that one has to bind to the outer row. The alias also disambiguates a self-referential many-to-many, where the junction and the target are the same table. The old form rendered *correctly* in isolation and only corrupted inside the query builder, which is why unit tests asserting on result counts never saw it — the new ones assert the emitted SQL.

- **An auth collection that named `reset_password` got two Reset Password buttons** — the injector skips its action when the collection already has one, but it read `.key` off every entry, and an entry may be the key itself. A collection that named the action rather than importing it was therefore never recognised as already having it, and the injection ran on top.

- **An empty `in` list returned every row** — `filter: { id: ["in", teamIds] }` with no teams is how a caller asks for nothing, and it answered with the whole table: an empty list built no condition, and an absent condition is not a restriction. It needs no typo to reach, because an empty array is exactly what a correct program produces when the set it derived came out empty.

  `in []` is FALSE now and `not-in []` is TRUE, which is what excluding nothing means; `array-contains-any []` overlaps nothing. A non-array operand was dropped too, and that one arrives over the wire — `?filter=id.in.5` parses to the string `"5"`, since the REST dialect only builds an array when the value is parenthesised, so an ordinary REST query ran unfiltered. A scalar is now the one-element list it means.

- **An unresolvable filter field widened the read** — a filter key matching no column was logged and dropped. Dropping a condition can only widen a result set, so a typo'd or renamed key ran the query without it and returned everything RLS happened to allow. Inside `or(...)` it was worse: the leaf vanished from the disjunction, so the surviving branches matched on their own and the widening was not bounded by the condition that went missing.

  Both sites resolve through one helper now, which throws a 400 `UNKNOWN_FILTER_FIELD` naming the field, the collection and the table's real columns. `unknownFilterFields: "warn"` on the driver config restores the old drop-and-continue behaviour verbatim.

- **An owning relation's key is its `localKey`, not `<field>_id`** — the filter resolver guessed the column name. The real one is the relation's `localKey`, whose default is snake-cased *and* singularised, so `userProfile` is `user_profile_id` and `users` is `user_id` — and an explicit `localKey` is anything at all. With unresolvable fields now failing closed rather than widening, that guess turned an ordinary `belongsTo` filter into a 400. It resolves through the collection's relations, keeping the two derivable shapes as a last resort.

- **The SDK answered in two different relation shapes** — `data.jobs.find()` and `data.jobs.find({ include: […] })` disagreed. With `include` the accessor ran the REST pipeline, which inlines a relation as the target's own columns; without it, the driver eagerly loaded every relation and put a `{ __type: "relation" }` envelope where the foreign key was. `findById` was always the second. The generated types described only the envelope, so a column the schema calls a foreign key was typed `string` and arrived as an object — twice, in production, before anyone traced it here. Every SDK read goes through the REST pipeline now, which is what the HTTP API already serves for the same query.

- **"Posts with no tags" returned no posts** — the null checkbox was hidden on a to-many relation, and asking which rows have *no* link is the question a filter on a link is most often for. Showing it was not enough: the design is that the operator carries the sense and the checkbox supplies the value, and on a to-many the multi-select can only produce `in`/`not-in`, neither of which carried a null — the relation path read `["in", null]` as membership of an empty list.

- **The filter UI asserted Postgres on every engine's behalf** — `isFilterableRelation` hardcoded the four kinds *the Postgres driver* compiles. Only Postgres declares `supportsRelations` today, so the claim happened to be true, but it was a fact about a driver stated where no driver could see it. It moves to `DataSourceCapabilities` beside `filterOperators`, where the same question is already answered for operators. The field is optional, so a third-party driver registered before it existed still compiles. Two related fixes: the operator now decides how many values a relation filter takes, and a relation with no column to filter on is no longer offered one.

- **A relation declared inline on the property rendered an error instead of a field** — `RelationFieldBinding` demanded a top-level `relations` array before it would render, and the inline form — `relation: { kind, target }` on the property, which is what the docs show — produces no such array. Every collection declaring a relation that way threw and rendered the error boundary where the field should be. The guard was redundant as well as wrong: `resolveRelationProperty` handles all three forms and reports a real error naming the property and the collection when it genuinely cannot resolve.

- **A server-side client with no credential now says so** — a `createRebaseClient` built with no token off-browser is silently anonymous, and RLS answers it with whatever is public: usually nothing, occasionally the wrong thing. Warned once per client on the first request rather than at construction, since `setToken`, `setAuthTokenGetter` and a server-side sign-in all land after the constructor. Deliberately narrow: anonymous is an ordinary state in a browser, and warning there is noise that teaches people to ignore the warning.

## [0.11.0] - 2026-07-27

### Breaking

- **`buildCollection` and `buildProperty` are removed** — not deprecated, removed. Both were FireCMS-migration shims that had been superseded by `defineCollection`, and keeping a deprecated alias around in a framework that has not shipped 1.0 only buys two ways to write the same thing.

  `buildCollection` was a plain identity function whose generic had to be supplied by hand, so it gave up the property inference that is the entire reason to wrap a collection literal at all. `defineCollection` uses a `const` type parameter to capture the literal, which is what puts your property keys into completion for `admin.titleProperty`, `admin.sort` and `admin.propertiesOrder`. `buildProperty` wrapped a single property in a conditional type that resolved to the type the property already had — a no-op once the surrounding collection is inferred.

  ```diff
  - import { buildCollection, buildProperty } from "@rebasepro/common";
  + import { defineCollection } from "@rebasepro/admin-types";

  - export default buildCollection({
  + export default defineCollection({
        name: "Posts",
        slug: "posts",
        table: "posts",
  -     properties: { title: buildProperty({ name: "Title", type: "string" }) }
  +     properties: { title: { name: "Title", type: "string" } }
    });
  ```

  A plain `const posts: CollectionConfig = { … }` annotation still works and is still typechecked — it just infers nothing, so prefer `defineCollection` in new code. The scaffold templates and every docs example now use it.

- **`where` and `orderBy` are now checked against the row type** — `FindParams` was not generic, so its `where` was `FilterValues<string>` and its `orderBy` an untyped `OrderByTuple`. Passing a generated `Database` to `createRebaseClient` typed the *rows* correctly but not the *query*: `find({ where: { nonexistent_column: ["==", 1] } })` compiled, then came back as a 400 from the API — or matched nothing at all, which is worse. `FindParams<M>` now carries the row type, and a column that does not exist is a compile error.

  A dotted path (`"meta.tag"`) still works for reaching into a `map`/jsonb column; its **root** must be a real column. `include` is unchanged — relation names come from `relations`, not from the row type, so nothing in `Database` can check them.

  `M` defaults to `Record<string, unknown>` all the way through, so an untyped `createRebaseClient()` behaves exactly as before. The chain that has to stay intact is `createRebaseClient<DB>` → `SDKCollectionClient<M>` → `FindParams<M>` → `FilterValues<FieldPath<M>>`; a non-generic alias anywhere along it silently flattens `M` back to the default, which is precisely how the re-export in `client/src/transport.ts` (`export type FindParams = TypesFindParams`) hid this. `e2e/baas-typecheck/src/sdk.ts` now pins it with `@ts-expect-error`, so `pnpm check:baas-types` fails if the check ever comes back off.

  The fluent builder is unaffected: `.where("status", "==", "draft")` was already typed on its parameters. Its internal accumulator stays keyed by `string`, because a `Partial<Record<FieldPath<M>, …>>` is read-only under a generic `M` (TS2862) and cannot be built up in place.

- **The `admin` block's key fields are now checked against the collection's properties** — `titleProperty`, `sort`, `propertiesOrder` and `listProperties` reject a name that is not one of your properties. Previously they accepted any string, so a removed or misspelled field was found by noticing a column had quietly vanished from the panel.

  The cause was one line. `augment.ts` merged the block on as `admin?: AdminCollectionOptions` with **no type arguments**, so `M` fell back to its default `Record<string, unknown>`, `Extract<keyof M, string>` widened to `string`, and every key-shaped field accepted anything. `defineCollection` computed the property-key inference correctly the whole time; it was dropped at that seam, one line short of the field that needed it. The completion those fields' docs promised had therefore never worked.

  Three non-property forms are still accepted: a dotted path into a `map` property (`"profile.displayName"` — the root is checked, the path below it is not), a child-collection column (`"subcollection:orders"`), and an `additionalFields` key. That last one needs an explicit cast, because `AdditionalFieldDelegate.key` is a plain `string` and nothing carries those keys into the type:

  ```diff
  + import type { AdditionalFieldKey } from "@rebasepro/admin-types";
  -     propertiesOrder: ["title", "score"]
  +     propertiesOrder: ["title", "score" as AdditionalFieldKey]
  ```

  Only `defineCollection` turns the check on — it is what supplies `M`. A plain `const x: PostgresCollectionConfig = { … }` annotation infers nothing, so these fields stay permissive there, exactly as before. A type-level test in `packages/admin-types/test/admin_collection.test.ts` now pins all four fields with `@ts-expect-error`, so the seam cannot reopen without a build failure.

- **`CollectionConfig` reports Postgres in its type errors** — `CollectionConfig` is a union discriminated on `engine`, and Postgres collections omit `engine` because it defaults to `"postgres"`. An incomplete Postgres literal therefore matched no member, and TypeScript elaborated the failure against the last constituent — MongoDB. Leaving out `name`, the most common mistake there is, told a Postgres user of a Postgres-first framework that they were missing `engine` on a `MongoDBCollectionConfig`. Postgres is now last in the union, so the same mistake names `PostgresCollectionConfig` and only the field actually missing. No runtime or assignability change; error text only.

- **Admin-panel presentation moved into an `admin` block** — a collection carried two unrelated concerns in one flat object: what the data *is* (table, schema, properties, relations, validation, security rules, callbacks) and how an admin panel should *draw* it (`icon`, `group`, `listProperties`, `kanban`, entity views, selection controllers, …). Ninety-five fields of the second kind sat beside the first, and twelve React view-model types were exported from `collections.ts` — so a backend that never renders anything still pulled the React layer into its type graph, and `@rebasepro/types` could not be a backend contract while it depended on React.

  `@rebasepro/types` is now the React-free BaaS contract; the presentation layer lives in a new `@rebasepro/admin-types` that depends on it, and nothing in core depends back. `pnpm check:baas-types` typechecks a full BaaS project — backend, driver, collection file, SDK reads and writes — with `react` mapped to a stub, which is the invariant that keeps it that way.

  **What to change.** Move presentation fields into `admin`:

  ```diff
   export default {
       slug: "posts",
       table: "posts",
  -    icon: "FileText",
  -    group: "Content",
  -    propertiesOrder: ["id", "title"],
  -    sort: ["updatedAt", "desc"],
       properties: { /* … */ },
  +    admin: {
  +        icon: "FileText",
  +        group: "Content",
  +        propertiesOrder: ["id", "title"],
  +        sort: ["updatedAt", "desc"]
  +    }
   };
  ```

  The backend loads the block and never reads inside it, so a project with no admin panel can drop these fields entirely. For completion and checking inside `admin`, author with `defineCollection` from `@rebasepro/admin-types` — it captures the property literals, so `admin.titleProperty`, `admin.sort` and `admin.propertiesOrder` complete over your own property keys instead of `string`.

- **A relation declares a `kind`, and carries only the fields that kind uses** — a relation was one open interface with every join field optional at once: `cardinality`, `direction`, `localKey`, `foreignKeyOnTarget`, `through`, `joinPath`, `inverseRelationName`. Nothing stopped you combining fields that cannot coexist, so the type accepted several relations that could not work — and two of them corrupted data rather than erroring. `cardinality: "many"` with a `localKey` wrote the foreign key onto the *parent* row, because a to-many has no single row to point at; a many-to-many carrying `foreignKeyOnTarget` claimed a column on the target that the junction table owns. Both compiled, and both were shipped.

  `Relation` is now a closed union discriminated on `kind`, and the link moves under a `relation` field on the property:

  ```diff
   author: {
       name: "Author",
       type: "relation",
  -    target: () => usersCollection,
  -    cardinality: "one",
  -    direction: "owning",
  -    localKey: "author_id"
  +    relation: {
  +        kind: "belongsTo",
  +        target: () => usersCollection,
  +        localKey: "author_id"
  +    }
   }
  ```

  The five kinds, and where each keeps its key: **`belongsTo`** (one row, key on this table, `localKey`), **`hasOne`** / **`hasMany`** (one or many rows, key on the target, `foreignKeyOnTarget`), **`manyToMany`** (many rows through a junction, `through`), and **`via`** (reached by joining across several tables, `joinPath`). Offering a field its kind does not own is now a compile error, so the two corrupting shapes above are unrepresentable rather than merely discouraged.

  `via` is the only kind that still states a `cardinality`, because a join chain cannot imply one, and it is read-only — Rebase will not guess which hop of a chain a write belongs to. `direction` is gone: which side holds the key is what the kind says. `inverseRelationName` is gone with it; the schema generator finds the counterpart by scanning the target's relations.

  `scripts/codemod/relations-tagged-union.mjs` migrates a codebase — it rewrote 232 declarations across 46 files here. It refuses to guess: anything it cannot decide is marked `kind: "AMBIGUOUS"` for you to resolve, rather than being given a plausible default.

  Internally this splits the authored surface from a resolved form. Every consumer now reads a `ResolvedRelation` with defaults already filled in and `writable` / `shared` decided once, instead of each site re-deriving them from optional fields — which is how the write guard and the admin had drifted into disagreeing about whether a `via` could be written through.

- **A relation whose names do not exist now fails at boot instead of returning nothing** — the union settles a relation's *shape*; it cannot know whether `posts_tags` is a table, whether `author_id` is a column, or whether a `joinPath` actually connects the tables it names. Those are facts about the database. Nothing checked them until a query ran, and the failures were the quiet kind: a missing junction table logged a warning and returned no rows, so `posts/1/tags` answered `[]` — the same answer a correct relation gives for a post with no tags. The tab rendered, the tab was empty, and nothing said why.

  The registry now validates every resolved relation against the schema it will run on and refuses to start if any of them cannot resolve, listing all of them at once with the columns actually available and the edit that fixes each. Fatal rather than a warning deliberately: a server that will not boot costs a minute, and a relation that quietly answers "nothing" costs however long it takes someone to notice their data is missing.

  It fails open wherever it cannot see enough to be sure — a collection with no registered table, a target belonging to another backend — because blocking boot on a working project is worse than missing one bad relation. The sharpest case it catches is the junction default: `through.table` is derived from the two table names sorted and joined, so renaming a table silently re-points the relation at a name that was never created.

### Added

- **`rebase-rls-check` — audit row-level security on any Postgres** — a standalone, read-only CLI that reads a database's catalog and reports what is actually exposed. It runs against any Postgres — Supabase, Neon, RDS, a self-managed server — and needs no Rebase project, which is the point: it has to be worth running for someone who will never adopt the framework.

  Fourteen checks, three of them taken straight from bugs this codebase shipped and debugged: a bare column inside an `EXISTS` subquery binding to the inner table, junction tables left open while both endpoints were locked, and RLS enabled with no policies serving an empty collection for weeks.

  Two constraints the design treats as non-negotiable. **False positives are worse than misses** — checks that cannot see intent are marked heuristic, rendered separately and phrased as questions, and severity is calibrated per platform (`policy-anonymous-tautology` is critical on Rebase and PostgREST but only low on Supabase, where `auth.uid()` genuinely returns NULL for anonymous callers, so flagging it there would fire on nearly every Supabase database alive). And **credentials never surface** — the connection string is redacted everywhere including the auth-failure path, and the redactor refuses to guess when an unencoded `@` or `/` makes the authority boundary ambiguous rather than printing part of a password as a host.

  See [RLS Check](https://rebase.pro/docs/rls-check).

- **Existing rows can be attached to a many-to-many tab** — a junction-backed relation reads as set membership on write: `PUT parent/:id/child/:childId` links a row idempotently. Previously the junction row was written only alongside an insert, so a linked tab could create new rows and never attach one that already existed. Unlike an owning foreign key this takes the row from nobody — its other parents keep it — which is why linking is safe here where reparenting would not be. The admin surfaces it as **Add existing** on a linked tab, opening the picker over the whole target collection.

- **`geopoint` and `binary` are real field types in the admin panel** — both were in the property model with nothing behind them. `geopoint` was missing from the widget lookup altogether, so it resolved to no field: the column never rendered on a form, and its property dialog opened showing a name, a description and no type-specific settings — indistinguishable from a property that has none. `binary` resolved to the plain text field, which offers multiline, markdown and email (none of which mean anything for bytes) and whose editor merges `type: "string"`, so touching a binary property's widget silently changed its type.

  Both now have a field binding, a widget config and a place in the property picker. Geopoint is two coordinate inputs rather than a map, because a map needs a tile provider, an API key and a network, none of which belong in a field that has to work offline; it holds a half-typed location rather than committing it, since sending the empty side through `Number("")` yields a perfectly finite `0` and would drop the point in the Gulf of Guinea. Binary shows a collapsed card with the decoded size and expands only when someone wants to edit the base64.

  `vector_input` joins them in the picker. It had a binding and an editor already and was simply never listed, so a vector property rendered correctly once it existed but could only be created by writing code.

- **A project is a bundle, and the runtime is the platform's** — `rebase build` now emits `dist-bundle/`: compiled collections, functions, crons and schema plus a generated `manifest.json` recording the runtime range it needs, a `schemaVersion` hash, its declared dependencies, and whether it uses native modules. `@rebasepro/server` boots it (`bootFromBundle`, bin `rebase-server`), and `docker/server.Dockerfile` publishes that as an image. The consequence is the point: **the engine can be replaced under a project without rebuilding it** — upgrading is a new image tag against the same bundle — and self-hosting becomes "run the image with your bundle" rather than "build and maintain your own container". `docker/docker-compose.selfhost.yml` is that, ready to run.

  A repo-root `rebase.json` declares topology only — the runtime compatibility range and the apps this repository contributes (`backend`, `static`, `admin`, `mobile`). Schema, rules, hooks and functions stay TypeScript in `config/`, which is the point of the product and does not move into JSON. `rebase link` accepts a self-hosted base URL wherever it accepts a cloud project, and writes an uncommitted `.rebase/cloud.json`, because a project reference is per-checkout.

- **Remote SDK generation from a running project** — `GET /api/meta/contract` (admin, service-key or admin API-key gated; fail-closed 404 when no auth is configured) serves the collection contract, and `rebase generate-sdk --from <link|url>` reads it instead of importing local `config/`. A second repository can therefore build a typed client against a backend it does not contain, which is what makes the multi-repo case work at all. The SDK records the `schemaVersion` it was generated against so drift is detectable; `GET /api/meta/schema-version` is deliberately unauthenticated and returns only that hash.

- **Collection tables are created at boot, additively** — the runtime ensured its auth tables and nothing ensured the project's, so a backend booted against a fresh database answered sign-in and then `500` on every data route. `REBASE_MIGRATE_ON_BOOT=ensure` (the default) now creates missing tables, columns and enum types before serving. **Additive only, permanently**: it never drops, narrows or rewrites, so it is safe to run unattended on every start and re-running is a no-op. A removed field leaves its column behind and a rename reads as an addition — destructive changes stay a deliberate `rebase db push`, with its dry-run and confirmation gate. `none` opts out.

- **Storage authorization can look up ownership** — `storageAuthorize` received a key, a bucket, an operation and a user, and no way to answer the only question that matters: *who owns this object?* Ownership lives in a row, so a hook limited to prefix arithmetic on the key expresses no real multi-tenant rule — and it could not fetch that row itself, because the hook is declared in the project's `config` package, which depends on `@rebasepro/types` alone and cannot resolve `@rebasepro/server` at runtime. The context now carries a trusted, read-only, RLS-bypassing reader (`ctx.data`). It bypasses RLS deliberately: the hook *is* the authorization decision, so making it decide through a reader already narrowed by the caller's permissions is circular.

- **Multiple data and storage sources** — declare `dataSources` / `storageSources` as exports of the config package and configure each by suffixing its env var with the source key: `DATABASE_URL__ANALYTICS`, `S3_BUCKET__MEDIA`. Two underscores, because one collides with real variable names (`S3_BUCKET_NAME`). A source that is declared but not configured fails boot rather than silently falling through to the default database.

- **Prometheus metrics** — `/metrics` in Prometheus text format, off unless `REBASE_METRICS=true` and gated by `REBASE_METRICS_TOKEN`: request counts and latency histograms per surface, plus process heap, RSS and uptime. Self-hosters can scrape it directly.

- **`rebase build` folds a single static app into the backend bundle** — the runtime already served a SPA from `entry.static`; nothing put the assets there. So a project whose container served its site at `/` and its API at `/api` lost the site when it moved to a platform-run runtime: the API answered and every page 404'd. The frontend now travels in the bundle and one runtime serves both, which is the shape the scaffolded template produces. `--no-static` opts out.

- **Local-first sync in the client SDK (`offline: true`)** — the data layer keeps a normalized local database of rows rather than a cache of responses, and answers queries against it. A row written offline therefore appears in *every* filtered list it belongs to (filters, sorting and pagination are evaluated locally), a row edited in one view updates in all of them, and `findById` answers for a row only ever seen inside a `find`. Server responses merge into that database instead of replacing it, so a row carrying unsynced local writes keeps them — the user's own change never flickers away underneath them.

  Writes are decided locally: once the client knows the connection is gone it stops attempting requests, so an offline write costs nothing instead of a timeout, and it applies immediately and replays in order when connectivity returns. A write the server *rejects* is rolled back, along with the queued edits that were built on it — but not a later create or delete for the same row, which stands on its own. Temporary failures (429, 503, a dropped connection) are retried on an exponential backoff instead, up to `maxRetries`.

  `observe()` / `observeById()` are the new reactive reads, on every collection client: local-first, de-duplicated, and re-emitted on any local write, replay, rollback, realtime event, or change from another tab. Each result carries `fromCache`, `hasPendingWrites` and `partial`, so an interface can say what it is showing. Tabs share the local database and the outbox over a `BroadcastChannel`, and only one replays the queue at a time. `client.offline` gained `status()` and `onStatusChange()` for a sync indicator, and `isOfflineError()` distinguishes "offline with nothing local to answer with" from a request that genuinely failed.

  A replayed write is recognised rather than repeated. The queue names each
  mutation with an idempotency key, and the server records what that key
  answered, so a create whose response was lost to a dropped connection comes
  back with the row it already made instead of inserting a second one — the case
  the client cannot detect for itself on a table with a server-assigned id,
  which is what the scaffold's collections use. Keys are scoped to the
  authenticated user and honoured for 24 hours; a backend that cannot store them
  ignores the header rather than refusing the write, and auth signups are
  excluded because their response can carry a temporary password.

  Writes made while another is in flight are safe too: an edit is no longer
  folded into a request already on the wire (where it was dropped, unsent, when
  that request was acknowledged), a delete no longer cancels out a create the
  server is in the middle of reading, and an update or delete now queues behind
  a pending write for the same row instead of racing ahead of it to a server
  that has not seen the row yet.

  **Not yet:** conflicting concurrent edits are still last-write-wins — there is
  no row version, so two clients editing the same row overwrite each other with
  no conflict reported. `createMany` is not keyed, only `create`. Where
  `navigator.locks` is unavailable two tabs may both replay the queue.

  See [Offline & Local-First Sync](https://rebase.pro/docs/sdk/offline).

### Changed

- **No bucket means no file storage, rather than a crash or a disappearing disk** — 0.10.0 made a production backend *refuse to boot* on `type: "local"`, which stopped the silent data loss but replaced it with a crash-looping rollout for anyone who simply had not configured storage — a project that never uploads a file was taken down by a feature it does not use. Storage is now opt-in instead: with no bucket configured in production, no storage backend is registered, `/api/storage/*` answers `501 STORAGE_NOT_CONFIGURED` with the fix in the message, and everything else — data, auth, realtime — keeps serving. `501` and not `503`, so the client's offline queue does not retry uploads that can never land.

  The scaffolded backend matches: it configures S3 for `STORAGE_TYPE=s3` and now GCS for `STORAGE_TYPE=gcs`, and falls back to local disk only outside production (or with `FORCE_LOCAL_STORAGE=true`, for a deployment with a real volume mounted). A named backend that is local-in-production is dropped from a multi-backend map without taking the durable ones with it.

### Fixed

- **`rebase db pull` wrote collection files that would not compile** — introspection emits collection *source code* as template strings, which put it outside every check the relations refactor relied on: the codemod rewrites real declarations and never saw these, `tsc` checks the generator rather than the code it prints, and the existing tests asserted with `toContain`, which passes happily on a field the type no longer has. So introspection went on writing `cardinality`, `direction` and a top-level `target` long after `Relation` stopped accepting any of them.

  Fixed at every emission site, and the many-to-many case got simpler rather than merely renamed: with no owning and inverse side to choose between, it no longer guesses one from table-name ordering, and no longer hands the losing side a relation with no `through` and a comment asking the reader to finish it by hand. Introspection knows both junction columns already; each side now names them from its own end.

- **The relation editor wrote kinds that do not exist** — the relation property form still carried its pre-union `Cardinality` (one/many) and `Direction` (owning/inverse) selects. Both had been pointed at `relation.kind` without the controls being rethought, so their options went on writing the old vocabulary: choosing "One (has-one)" set `kind: "one"`, choosing "Owning" set `kind: "owning"`. Both also rendered from `value={kind}` while comparing against `"one"`, so a `belongsTo` relation displayed as "Many (has-many)" *and* "Inverse" at once — the form disagreed with itself, disagreed with the stored value, and offered no way to pick a real kind.

  It is one Kind select now, driven by a table shared with the relations tab so the two surfaces cannot describe the same thing differently, and typed so a sixth kind cannot be added to the union without failing to compile there. Three more in the same dialog: saving cast the draft straight to a `Relation`, so a junction table filled in and then abandoned by switching to "Belongs to" was persisted alongside a `localKey` — exactly the shape the union exists to forbid, smuggled past it by a cast; picking "Via" offered no way to enter a join path while Save stayed enabled, producing a relation with an empty `joinPath` that joins nothing; and the relations table declared five header cells while rendering four, so `kind` appeared under a "Cardinality" heading and "Direction" had no cell at all.

  The JSON path was never affected — `validateCollectionJson` checks `kind` against the union and rejects fields a kind does not own. Only the form drifted, because nothing typechecks a select's option values against what its handler writes.

- **The collection editor could not round-trip a relation** — `target` is a `() => CollectionConfig` thunk, which cannot be written to JSON, so it travels as a collection slug. Nothing rebuilt it on the way back: the deserializer had no branch for relations, so one fell through to the pass-through default and returned with `target` still a *string*, while every consumer in the codebase calls `target()`. The cast to `Property` at the end of that function erased the difference, so it compiled and shipped. Serialization is now switched on `kind` and assigned without a cast, and `fromSerializableCollectionConfigs` rebuilds the thunks against the whole set — resolving lazily, so collections may reference each other in any order.

- **Generated OpenAPI documented none of a collection's subcollections** — the spec read `relationName` straight off the authored `relations` array. That name is optional and defaults to the property key or the target's slug, so every relation relying on the default was skipped, and relations declared inline on a property were never seen at all, since they are not in that array. A collection could show three subcollection tabs in the admin panel and document zero. The routes now come from the resolved relations — the same names the nested-path router matches — in a second pass after every component schema exists, which also fixes subcollections whose target appeared later in the array silently degrading to an untyped `object`. To-one relations are left out: `posts/1/author` resolves, but documenting it as a paginated list describes a response the client never gets.

- **A custom `Field` or `Preview` attached as a lazy import rendered nothing** — the documented way to attach one is `admin: { Preview: () => import("./MyPreview") }`. JavaScript names an anonymous function after the property key it is assigned to, so that arrow's name is `"Preview"`, and component detection treated "zero arguments, starts with a capital letter" as proof of a component — which is true of every loader written that way. The thunk went to React as a component, React called it, got a Promise, and rendered nothing: an empty cell with no console error. Detection now leads with what the function does — a dynamic module load in the body outranks the name — and matches both `import(...)` and the `require(...)` that CommonJS transforms produce.

- **`rebase dev` could print a URL served by a different process** — when the first port was busy, the port-retry helper bound the next one but reported the port it had just *failed* to bind. It passed its success handler to `server.listen(port, host, cb)`, and that form registers the handler as a one-shot `listening` listener which a failed attempt never removes; the next attempt's success then ran both, and the earliest won. So with something already on 3001, the server listened on 3002 and announced `http://localhost:3001`. Whatever was already there answered normally, out of its own database, and nothing logged a warning.

  Two consequences are fixed with it. The port file recorded the wrong number as well, and port *affinity* from that file used to outrank an explicitly requested port — so setting `PORT` in `.env` had no effect while a file from an earlier run existed. The file now records the bound port and the requested one, affinity applies only when the same port is requested again, and this matches the precedence the CLI already used (`--port`, then `PORT`, then affinity).

- **A bundle build said nothing about ignoring `backend/src/index.ts`** — `rebase dev` runs that file whenever a project has one, so throughout local development it *is* the server and every route in it works. A bundle has no entrypoint of its own: the runtime boots the bundle and mounts what the manifest points at — the config package, functions, crons and the schema. So a project with custom routes in its entrypoint built clean, deployed green, and answered 404 on every one of them, with the file still sitting in the repository looking exactly like the server. `rebase build` and `deploy --bundle` now name the file, say it is neither compiled nor shipped, and give the two ways forward: move the routes into `backend/functions/`, or declare the app as `"type": "custom"` to keep your own entrypoint (which is already what a manifest-less repo carrying one is inferred as).

- **`rebase cloud deploy` with no flags did not say what it was about to build** — the bare form uploads nothing. It asks the control plane to rebuild what it already holds: a git checkout, or the newest source archive some earlier `--source` deploy left in object storage. Both are legitimate and neither is the working directory, so a deploy shipping month-old code was indistinguishable from one shipping today's. It now prints the source first — the repository and branch, or the archive's deployment id and age, with a reminder that `--source .` is what uploads this directory — and says plainly when the control plane holds neither.

  On a managed project it was worse than stale. A successful source build sets `runtimeMode: "custom"` server-side, so the bare form silently swapped a project off the platform runtime and back onto a container image. That case is now a refusal naming `--bundle` as what was meant; `--source .` and the new `--force` both eject deliberately, and an explicit `--source` deploy of a managed project warns before it does.

- **`deploy --bundle` could not skip type checking** — `rebase build` has `--skip-type-check` and `buildBundle` already accepted the option; only the deploy argument spec lacked it, so iterating meant building by hand and then pointing `--bundle-dir` at the result. The flag is accepted on `deploy` now and threaded through.

### Testing

- **A stable release now runs the full gate before publishing anything.** Publishing was not gated on tests: the canary job ran a build and published, and `publish.yml` had no dependency on CI at all — the two workflows fired in parallel on the same push, so a release could go out while CI was still running, or after it had already failed. The stable job ran unit tests but no end-to-end suite, which meant the failures those suites exist to catch — a broken `rebase init`, RLS not isolating rows — were exactly the ones a green build could not see.

  The whole gate (type checks, headless/BaaS guards, init-template check, unit tests, and every e2e suite) now lives in a reusable `verify.yml` that CI and the stable release both call, so the release path cannot drift from the one that runs on every push. A stable release stops before any version bump, tag or publish if any of it fails. Canary is deliberately unchanged: it still publishes on a green build alone.

- **The template e2e suite could test a server it had not started.** It took the backend's address from the announced banner, which is trustworthy only if the server announces the port it bound — see the fix above. Each backend is now given a port the OS reports as free, and the run fails loudly if the banner disagrees rather than continuing against an unknown server and a database it does not control. It also talks to `127.0.0.1` rather than `localhost`, which resolves to `::1` first on macOS while the server binds `0.0.0.0`.

- **The CLI init e2e leaked its frontend.** `rebase dev` supervises a Vite that ends up outside the process group the teardown signals, so a frontend survived every run — one held port 5173 for hours with its project directory already deleted. Teardown now also reaps whatever still holds the dev server's own ports, restricted to processes that were not already listening there when the run began (a developer's `tsx watch` server gets a new pid whenever it restarts, so "any new listener" would have been a way to kill it).

- **`rebase cloud link` was broken from a fresh checkout** — three prompts still used inquirer's removed `list` type, so running it interactively died with `Prompt type "list" is not registered`. Prompts are only constructed when a command actually asks something, so every non-interactive test passed and CI stayed green while the first command anyone runs did not work.

- **`rebase build` produced bundles that could not boot** — TypeScript emits import specifiers untouched, so a project on `moduleResolution: "bundler"` compiled `from "./posts"` and Node ESM refused it. Specifiers are rewritten after compilation. Bundle tarballs no longer carry macOS extended-attribute headers, which GNU tar warned about once per file on extraction and which buried real errors.

## [0.10.0] - 2026-07-20

### Breaking

- **The authenticated principal is `uid` everywhere** — the identity had two names. `uid` was the domain model's: the `User` type, the `AuthenticatedUser` adapter contract, the driver scope, and the RLS layer, where policies read `auth.uid()`. `userId` was the JWT claim's, inherited by the Hono request context because it was populated straight from the decoded payload. A request crossed that boundary twice, so a route handler and a collection hook two frames apart saw the same person under different keys — and three unrelated places had independently grown the same defensive `a ?? b` read to cope. `uid` wins because `userId` was confined to four server-side packages while `uid` is the vocabulary of twelve, and because the two ends of the stack — Postgres policies and the client SDK — already agreed on it.

  Tokens now carry a `uid` claim and `c.get("user")` returns `{ uid, roles }`. Anything reading `payload.userId` or `user.userId` must move.

- **ESM only — the CJS/UMD output is gone** — the packages shipped both, but the output banner injects `import` / `import.meta.url`, which a UMD bundle cannot parse as CommonJS, so the CJS half was never loadable. `main`, `module` and the `import` condition all point at `index.es.js`; the `require` condition is removed. A CommonJS consumer must `import()` or move to ESM.

- **`id` is an address, not a column** — the synthesized `id` was written into rows on the way out, where it collided with the data three ways: it renamed the key (a `sku` primary key was served as `id`, with `sku` absent entirely), it changed the type (an integer key reached the SDK as `"42"`), and it destroyed real values, because `drizzleResultToRow` spread it last so it would win over a raw `id` column. Rows now carry their own columns under their own names and types. Code reading `row.id` on a table not keyed on `id` must read the real key.

- **A write naming a field the collection lacks is a 400** — unknown keys used to travel into the INSERT, so a typo came back as `column "titel" does not exist`, phrased by Postgres from a stack the caller cannot see, and only when the column really was absent. The `id` case is called out specifically: `create(data, id)` writes the id argument as an `id` column, which is meaningless for a table keyed on `sku`, so the error names the real key instead of sending someone hunting for an `id` they never wrote. Bulk writes are checked before the transaction opens and report the offending row index.

- **`policy.authenticated()` no longer matches anonymous requests** — it compiled to `auth.uid() IS NOT NULL`, a tautology on the user path: `applyAuthContext` coerces a blank user id to the `'anonymous'` sentinel precisely so it cannot read back as NULL and pass for the trusted server context. So a rule reading as "logged-in users only" granted full access to anonymous visitors, and neither the type system, the DDL generator nor — at the time — the drift checker said a word. `not(authenticated())` was separately special-cased to mean "is the server context", which the default policies leaned on — so both spellings moved together. Review any rule built on either.

  **Upgrading does not change your database.** The compiled SQL lives in `pg_policies`, so an existing app keeps the permissive `auth.uid() IS NOT NULL` until `db push` runs again — nothing re-applies policies at container boot, so redeploying and restarting change nothing. `rebase doctor --policies` reports it: alongside the name-keyed diff it scans the live `qual`/`with_check` of every policy on a managed schema and flags the bare tautology as *Insecure*, and it flags a policy an earlier push superseded but never dropped as *Orphaned* — the two ways this fix fails to land. It exits non-zero, so CI can gate on it. The scan is narrow by design: it matches that one expression shape and treats an `<> 'anonymous'` guard anywhere in the clause as the corrected form, so a hand-written fail-open policy spelled another way (`USING (true)`, `USING (1 = 1)`) is not flagged — read the qual out of `pg_policies` directly to confirm those. Then run `db push`, which re-applies the current policies and drops the superseded ones. See [Upgrading](https://rebase.pro/docs/upgrading).

- **RLS is the whole authorization model — reads are bound too** — enforcement used to split by operation: writes ran through app-layer callbacks while reads leaned on RLS `SELECT` policies. But a privileged connection — superuser, `BYPASSRLS`, or the table owner — bypasses RLS unconditionally, so on any such connection (the common case) tenant read isolation was silently dead. Authenticated, user-context requests now run as a restricted, non-owner `rebase_user` role, so Postgres RLS binds *every* statement: `SELECT`, `INSERT`, `UPDATE`, `DELETE`. A collection's `securityRules` are now the entire authorization model; callbacks (`beforeSave` and friends) are validation and side-effects, not a security boundary. The server context — auth flows, migrations, `dataAsAdmin` — stays the trusted owner plane and bypasses RLS by design. Default policies are locked-by-default for every collection (a permissive server-or-admin read/write baseline; auth collections also get a self-read and keep the restrictive admin write gate), so RLS-on does not default-deny everything; `FORCE ROW LEVEL SECURITY` is gone, since the user role is already a non-owner. The opt-out is `disableDefaultPolicies`. Isolation is provisioned at boot and on `db push` / `migrate`; a privileged connection that cannot be isolated fails boot with the exact setup SQL, and connecting as superuser or `BYPASSRLS` warns loudly — the auth-collection write gates do not bind those.

- **22 retired package names deprecated on npm** — the names the repo no longer publishes now carry a deprecation notice pointing at their replacement, so an install of an old name says so instead of silently resolving to an abandoned version.

- **Package renames** — packages are now named for their role, not their position. `core` was frontend-only React while `server-core` was the actual core of the product; they shared a word and were otherwise unrelated. `client-firebase` depended on `admin`/`core`/`ui`, so it was a UI integration wearing a client-SDK name. Import paths are the only change — no behavior moved with them.

  | Old | New |
  |----------|----------|
  | `@rebasepro/core` | `@rebasepro/app` |
  | `@rebasepro/server-core` | `@rebasepro/server` |
  | `@rebasepro/server-postgresql` | `@rebasepro/server-postgres` |
  | `@rebasepro/server-mongodb` | `@rebasepro/server-mongo` |
  | `@rebasepro/client-postgresql` | `@rebasepro/client-postgres` |
  | `@rebasepro/client-firebase` | `@rebasepro/firebase` |
  | `@rebasepro/formex` | `@rebasepro/forms` |
  | `@rebasepro/sdk-generator` | `@rebasepro/codegen` |
  | `@rebasepro/schema-inference` | `@rebasepro/inference` |
  | `@rebasepro/mcp-server` | `@rebasepro/mcp` |
  | `@rebasepro/plugin-data-enhancement` | `@rebasepro/plugin-ai` |

  Unchanged: `types`, `utils`, `common`, `client`, `ui`, `admin`, `studio`, `cli`, `plugin-insights`.

- **`@rebasepro/auth` removed** — it was one hook and an API helper whose only dependency was `@rebasepro/types`, and it always had to be installed alongside `core` anyway. `useRebaseAuthController`, `fetchAuthConfig`, `createAuthConfigCache` and `clearAuthConfigCache` now come from `@rebasepro/app`, beside the `RebaseAuth` and `LoginView` components they are used with. The auth *system* was never here — it lives in `@rebasepro/client` (`client.auth`) and `@rebasepro/server`.

- **`defaultSecurityRules` moved off the server config** — it lived on `RebaseBackendConfig`, was applied to the in-memory registry, and enforced nothing: `db push` generates the Postgres policies — the only thing that actually enforces access — from the collection *files*, and never sees the running server. Declare it in `config/collections/index.ts` instead, where the loader reads it and both the runtime and `db push` see the same thing. Its old doc also claimed collections without rules were "unrestricted"; they are locked to admin-only by the generator. In `baas` mode there are no collection files and no `db push`, so the database's own RLS is the whole model and there is nothing to default.

  ```ts
  // config/collections/index.ts
  export const defaultSecurityRules: SecurityRule[] = [
      { operation: "select", access: "public" },
      { operations: ["insert", "update", "delete"], roles: ["admin"] }
  ];
  ```

- **A collection file that fails to import is now a hard error** — the loader used to log and continue, which turns a broken file into a missing API route and a missing policy, with a successful exit code. Both read as "no data" rather than as a failure.

- **`RebaseCMS` → `RebaseAdmin`** — the component now matches the package it ships from. `mode: "cms"` on `RebaseBackendConfig` is unchanged: it describes where collections come from (config vs database), not the UI.

- **BaaS mode does not serve tables without row-level security** — see Fixes. A table with RLS disabled is skipped and named at boot; `baas: { unprotectedTables: "serve" }` restores the old behavior.

### Features & Improvements

- **Presence and broadcast channels in the SDK** — the realtime engine had supported `join_channel`, `broadcast` and the presence messages for a while, but the client could only send them fire-and-forget: no methods to call them, and no way to receive channel events, since `on()` handled only connect/disconnect/reconnect/error. Anything wanting presence opened a second socket and reimplemented the authenticate handshake, the reconnect backoff and the presence heartbeat — a couple of hundred lines per app, duplicating this package. `client.realtime.channel(name)` now provides `track` / `onPresence` / `broadcast` / `onBroadcast` / `leave`, with channels as per-name singletons so two components cannot cut each other off by leaving. It also hides two protocol details discoverable from neither the message list nor the docs: a joining client is told only about its own join, so `join()` sends an explicit `presence_state` to get the roster; and presence expires after 30s, so tracking is re-sent on a heartbeat.

- **Ordered, replayable per-channel history** — broadcast was fire-and-forget to whoever happened to be connected. Enough for presence and for "someone saved"; not enough for op-based collaborative editing, where a client that blinks out for two seconds had to resync a whole document rather than catch up on the four operations it missed. Every broadcast on a retained channel now gets a per-channel sequence number, allocated by the same statement that stores it, so a reconnecting client can say where it got to and receive only what it missed. Retention is server-side and opt-in (`realtime.channels`, matching exact names or a trailing `*` prefix) — a channel is created by whoever names it, so a client-supplied history depth would let any visitor commit the backend to unbounded storage. With no rules configured nothing is written, no table is created, and broadcast runs the same synchronous path as before.

- **Database-level realtime — change data capture** — realtime events were application-level: only writes through the Rebase API emitted them, so a change made with `psql`, another service's cron, a raw SQL statement or Studio's SQL editor committed silently and no subscriber heard it. A database-level CDC source now feeds the existing `RealtimeService`, matching Supabase Realtime's WAL-tailing model: an idempotent `AFTER INSERT/UPDATE/DELETE` trigger per managed table emits `pg_notify`, a dedicated `LISTEN` client fans the events in, and delivery is RLS-safe — a change is marked invalidated so every subscriber re-reads under its own auth context rather than trusting the publisher's row. `REALTIME_CDC` is `auto` by default: on where the connection supports it, silent fallback to app-level otherwise (`wal` degrades to `trigger` — native WAL streaming is not bundled). An 8KB-overflow guard means CDC can never abort a write.

- **Per-object authorization for storage** — storage routes authenticated but did not authorize. `requireAuth` and `publicRead` are global switches: they decide whether a caller must be signed in, not what that caller may touch, so any authenticated user could read any key they could name. For multi-tenant apps the only thing between two tenants' files was key unguessability, which is not an access-control model. `storageAuthorize({ key, bucket, operation, user })` is the storage analogue of a collection's security rules; denials are 403, and a hook that throws denies too, so a failed ownership lookup cannot fall open. The load-bearing placement is `/metadata` rather than `/file/*`, because `/metadata` mints the short-lived path-scoped download token that `/file/*` trusts — and it minted one for any authenticated caller for any path. Listing is gated on the prefix, since a listing is how you discover keys nobody told you about, and TUS is gated at create time so a denied upload leaves no temp file to resume.

- **Bulk writes and upsert** — only single-row create/update/delete existed, so a ~10k-row ETL had no way to express itself and dropped to `admin.executeSql` with hand-bound parameters, which is where injection bugs live. `createMany(rows, { upsert: true })` is available on both the HTTP and server-side clients, and as `POST /api/data/:collection/bulk`. Every row still runs the normal pipeline — callbacks, relations, RLS — because `saveMany` reuses `save()`; the win is that the batch shares one transaction and one round trip. `upsert` is `INSERT ... ON CONFLICT DO UPDATE` on the primary key, one statement, so it cannot lose the race a read-then-write can.

- **Junction tables inherit the security model instead of escaping it** — a `through` relation makes the generator create a table nobody declared, and those were the one kind of generated table with no RLS at all. Since `rebase_user` holds full DML grants, any signed-up user could read or wipe every edge between two locked-down endpoints (3,648 rows on the live demo), and there was nowhere to write rules for a junction anyway. A junction's security is now derived: the same locked server-or-admin baseline every collection gets; reads follow the endpoints via two correlated `EXISTS` subqueries that run under the caller's role, so visibility is delegated rather than copied and endpoint policy changes propagate with no junction change; and writes follow the owning side, because linking an edge is editing the owning row.

- **Account linking** — the `EMAIL_NOT_VERIFIED` rejection on OAuth sign-in told users to link the provider from their profile, but no such endpoint existed; the only link route was anonymous→password, so the error was a dead end. An authenticated `POST /auth/link/:provider` now attaches a provider identity to the current account, with a matching client `linkProvider()`. Linking deliberately does not require a verified email or matching addresses: on sign-in the provider's email is the only evidence tying an identity to an account, so an unverified address would allow takeover, but here the caller already proved ownership with a valid session. Refuses with 409 `IDENTITY_ALREADY_LINKED` when the identity belongs to another user, and is idempotent for the caller's own.

- **Cron is coordinated across instances** — every app instance ran every cron job, since the scheduler is in-process `setTimeout` and the executing flag only guards within one process, so N replicas meant N executions per tick. Handlers stay app-level closures; only the mutual exclusion moves to the database, where each instance derives the same scheduled fire time from the cron expression and atomically claims the slot.

- **First-class database backups** — `rebase db backup` / `restore` / `backups`, writing to a local path or an `s3://` / `gs://` destination. Restore is confirmation-gated into a fresh database (`--create-db` / `--target-db`) so it cannot clobber a live one. Backups can run on a schedule from a cron file (`createBackupCron`, `backupCronConfigFromEnv`) with retention pruning (`BACKUP_RETENTION_DAYS` / `BACKUP_KEEP_MINIMUM`). A `rebase.backups` client surface and server routes expose the same operations, and the scaffold's `.env.example` documents the settings.

- **`rebase cloud` reaches operational parity** — project slugs replace UUIDs across every user-facing surface (`--project` takes the subdomain the console URLs show; raw UUIDs still resolve for old scripts and link files), plus `rebase cloud debug` for diagnosing deployed projects and `rebase cloud storage create` / `attach`. `rebase init` gains real `--project` / `--setup-key` handling — the setup page advertised both flags while permissive arg parsing silently swallowed them.

- **Tail-follow logs explorer in Studio** — sticky auto-scroll with a new-entry pill.

- **Admin: the RLS editor offers the roles that actually exist** — it listed native PostgreSQL roles from `pg_roles` when picking values for `SecurityRule.roles`, which matches the strings on the users table via `auth.roles()`. Choosing `public` or `rebase_user` there compiled to a condition no user could satisfy. `fetchApplicationRoles` now sits alongside `fetchAvailableRoles` across the `SQLAdmin` surface, and the doc comments on both fields spell out which is which.

- **Admin: an unsaved-changes guard for split and entity views**, with shared view-mode routing.

- **`pnpm verify:docs`** — typechecks documentation code fences against the workspace SDK, so a doc that names an API the code does not have fails instead of aging quietly.

- **BaaS mode — a REST API over your database with no collections at all** — `mode: "baas"` derives collections from the live database at boot instead of loading config files. Every protected table becomes a REST resource, with types, primary keys and relations read from `information_schema`; the drizzle tables the query layer needs are built in memory, so no generated `schema.generated.ts` is required either. Change the schema with a migration and the API follows. Join tables are skipped, the schema editor is off (it exists to write config files), and no React enters the backend's module graph. `introspectionSchema` on the Postgres adapter selects a schema other than `public`.

- **The SDK works with no collections** — `rebase.data.collection("posts").find()` needs only a table name against a BaaS backend: no collections map, no generated types, nothing to declare. The optional `collections` option exists only to pin non-obvious slugs.

- **`rebase init --flavor baas`** — scaffolds a headless project: `backend/` alone, no `config/`, no `frontend/`, and no UI package in the install tree. Without `--flavor`, `init` asks: *BaaS + admin* (default) or *BaaS only*.

- **`rebase doctor --policies`** — diffs `pg_policies` against the policies your collections generate, reporting missing, orphaned, diverged and insecure, and exits non-zero so CI can gate it. Policies live in Postgres and the config is only their source; nothing reconciled the two, so a stale policy outlived every config fix. Reuses `generatePostgresPoliciesDdl` — the same function `db push` applies — so it compares against what would really be written. It also reports policy roles this server can never assume, without booting one. Policy *expressions* are not diffed against the generated DDL: Postgres rewrites `qual`/`with_check` on storage, and a check that cries wolf gets ignored. They are still *scanned*, for one shape — the fail-open `auth.uid() IS NOT NULL` tautology, without the `<> 'anonymous'` guard — which is the one drift no other field here can see, since a policy carrying it matches its expected counterpart on name, roles, command and clause presence alike.

- **One definition of "the collections"** — the runtime, the drizzle-schema generator, the policy generator and the doctor each scanned the collections directory themselves, four copy-pasted filters agreeing by discipline rather than construction. A drift between them would serve one set of collections while pushing policies for another. They now share one loader, exported from `@rebasepro/server`.

- **Guards for the two failure modes that ship silently** — `pnpm run check:headless` imports every collection file and server package under a loader hook that rejects React, so a UI import cannot creep back into the backend. `pnpm run check:names` fails on references to renamed packages and duplicate dependency keys. Both run in CI. A new BaaS e2e installs a scaffolded project from real tarballs and boots it against tables it was never told about — the only place `workspace:*` resolves, so the only thing that proves the templates rather than the library.

### Fixes

- **A signup with a typo'd field is now a 400, not a silent 201** — a write to an auth-enabled collection skipped unknown-field validation entirely, because a signup body carries `password` and provider fields the users table does not declare as columns. The skip was total, so `POST /api/data/users` with an undeclared `emial` returned 201 and dropped the field, while the same typo on `posts` was a 400 — directly contradicting the Breaking note above. The exemption is now scoped to exactly the fields the auth adapter consumes (the built-in one names `password`); everything else is validated as on any collection. An auth collection with a custom `onCreateUser` hook opts out, since the hook then owns the body's shape.

- **`POST /auth/refresh` with no session is a 401, not a 400** — clients refresh on page load before they know whether a session exists, so a first-time visitor with no token is the most common way the route is called. It answered `400 INVALID_INPUT` and logged a warning for every anonymous page view. Absent-token is now `401 NO_SESSION`, logged at debug; a present-but-malformed token is still a 400. `ApiError` gained an `expected` flag (and an `unauthenticated()` factory) so a routine outcome no longer looks like an incident in the logs.

- **The generated `docker-compose.yml` could not boot** — `63108aa90` made the server refuse to start with local storage under `NODE_ENV=production`, on the grounds that the container filesystem is destroyed on the next restart and uploads go with it. The scaffold's compose file sets `NODE_ENV=production` and *does* mount a durable named volume at the storage path, which is the exact case the check tells you to acknowledge with `FORCE_LOCAL_STORAGE=true` — but the template never set it. So `docker compose up`, the "recommended for production" path in every scaffolded README, crash-looped the backend with `Failed to start server`. The flag is now set in the template, next to the volume that justifies it. This was invisible for days because the e2e step that would have caught it sits behind a step that was already failing.

- **`init --database-url` shipped a compose stack with the password `changeme`** — `DATABASE_PASSWORD` was only written on the branch that generates a local database. Supply your own `--database-url` and it was omitted entirely, so `docker-compose.yml`, which interpolates `${DATABASE_PASSWORD:-changeme}` into both `POSTGRES_PASSWORD` and the backend's connection string, fell back to the literal default — on a `db` service that publishes a host port. The password is now generated in both cases; the supplied URL is untouched.

- **`rebase init` told you things that were not true** — the next steps were assembled from the flags you passed rather than from what actually happened. `--introspect` without `--install` printed "Skipping introspection because dependencies were not installed" and then, four lines later, "Database has been introspected & collections generated!" — the second line branched on the flag, never on the outcome. It now reports what really ran, and when introspection did not, it prints the `schema introspect` and `schema generate` commands that finish the job. In the same pass: the `cd` hint used the project's basename, so `init apps/my-app` said `cd my-app` — a directory that does not exist from where you are standing — and `init .` told you to `cd` into a directory you were already in; both now use the path you typed, and in-place scaffolds print no `cd` at all.

- **`rebase init --help` printed the wrong help** — `init` was missing from the dispatcher's namespaced-command list, so `--help` fell through to the global command index. `--template`, `--flavor`, `--yes`, `--database-url`, `--introspect`, `--project` and `--setup-key` were documented in exactly one place: the error you get for running init on a non-TTY. You had to trigger a failure to discover the flags. `init` now has its own help, and a test fails if a flag the parser accepts goes undocumented.

- **`--git` left the work half-done** — it ran `git init` and stopped, leaving every scaffolded file untracked on whatever `init.defaultBranch` happened to be, so the first `git diff` was noise and the first commit was the user's problem. It now lands an initial commit on `main`, authored by the user's own git identity where one is configured. `.gitignore` is in place before the commit, so `.env` and its generated secrets are never in it while `.env.example` is.

- **`--template` was accepted and discarded for the baas flavor** — baas has no collections, so a preset has nothing to swap; the flag was taken silently and the scaffold came out identical either way. It now says the preset is being ignored, and the help spells out that `--template` does not apply to baas.

- **OAuth token substitution allowed account takeover** — the Google path resolved client-supplied access tokens through the userinfo endpoint, which does not check `aud`, so any valid Google access token — including one an attacker obtained for their own OAuth client — was accepted and resolved to whatever account it belonged to. The audience is now verified against our `clientId` via tokeninfo before the identity is trusted, and ID-token paths read the real `email_verified` claim instead of hardcoding it. On Microsoft, `emailVerified` is derived from a provider-provisioned `mail` mailbox rather than asserted `true`, so a bare userPrincipalName can no longer auto-link an OAuth login onto a pre-existing password account. CORS, rate limiting and vector SQL were hardened in the same pass.

- **`/admin/bootstrap` was a land-grab** — the self-promotion endpoint only refused to run once an admin already existed. In a "users exist but no admin" state — reachable via concurrent first-registrations, or by deleting the first user — any authenticated user could seize the initial admin role. It is now gated to the earliest-registered user, deterministically tie-broken by id, with security-audit logs on both the denial and the success.

- **The API served password hashes** — `/api/data/users` returned every user their own `passwordHash` and `emailVerificationToken`. RLS scoped the row to the caller so this was not a cross-user leak, but a salted hash is offline-crackable and a verification token can be replayed. The users collection only marked them `ui.hideFromCollection`, which stops the admin panel from *rendering* a field and leaves it in the JSON.

- **The data API was rate-limited by API key only** — the limiter returned early for any request that carried no API key, so JWT and anonymous traffic — most of what a BaaS serves — was unbounded, and it was mounted only `if (apiKeyStore)`, making its presence depend on a feature it does not need. Every request now falls in exactly one bucket, resolved most-specific first: API key by id, signed-in user by uid, everyone else by IP.

- **Storage had no effective upload size cap** — the `bodyLimit` was registered *after* the routes, so Hono never ran it. A wrapper router now applies it in front. Storage also accepts API keys under a new `storage` permission namespace (read/write/delete), where `rk_` tokens previously 401'd as malformed JWTs.

- **API keys and admin surfaces** — the builtin auth adapter no longer authenticates `?token=` query params, which could leak full JWTs and the service key into access logs (the non-adapter middleware already refused them). Admin API keys now genuinely reach admin surfaces, with `rk_` pre-auth running in front of `/admin/*`, cron, backups and logs.

- **A purpose-scoped token is not an access token** — every storage token is signed with the same secret, so a signature says the server minted it, not what it is for. A download token travels in URLs and grants one file; it was rejected as a session only because it happens to carry no id, and nothing stopped a future one from carrying one. `verifyAccessToken` now refuses any token with a `purpose` claim outright. No live hole was found — this is defence in depth.

- **Superseded RLS policies survived `db push`** — a generated policy is named after a hash of its own semantics, so editing a `securityRule` writes a policy under a new name, and `policies.sql` only DROPs the names it is about to CREATE. Because Postgres ORs PERMISSIVE policies together, a superseded `USING (auth.uid() IS NOT NULL)` kept granting everything no matter how tight its replacement was — and push reported success throughout, so tightening a rule looked like it had worked and hadn't.

- **A pooled connection could leak its RLS GUCs** — when the client-side `query_timeout` fires inside a drizzle transaction, pg rejects the promise but keeps the connection and splices queued queries, so drizzle's ROLLBACK times out without ever reaching the wire and the `finally` releases the client back to the pool with no error. pg-pool then re-pooled it mid-transaction with the `app.*` GUCs still set, and the next checkout ran inside the zombie transaction under someone else's auth context.

- **Relation batching guessed on composite keys** — batching matched parents on `parentPks[0]`, so two rows of a composite-keyed collection differing only past the first column collapsed together: `tenant_id IN (1, 1)` collected every row of tenant 1 and filed them all under `"1"`, last write winning. Each booking of a tenant was handed its neighbour's relations, and nothing errored. The WHERE is now an OR over whole keys, or it refuses rather than guess.

- **Ephemeral local storage is refused in production** — `STORAGE_TYPE` defaults to `local`, which on a managed platform is the pod's ephemeral filesystem: every uploaded file destroyed on the next restart, with no error at write time, no error at read time, and a warning nobody reads until the data is gone. Boot now fails instead. `FORCE_LOCAL_STORAGE=true` remains the opt-in for a deployment with a real volume mounted. GCS env vars were added alongside, local bucket defaulting made symmetric, and list paging fixed.

- **Subscriptions could hang forever** — a collection view could sit on its loading spinner indefinitely with no error until reload. `subscribe_collection` / `subscribe_one` are in the `expectsResponse = false` set, so unlike ordinary requests they had no timeout, and a subscribe that got no reply left the subscription pending forever; a subscribe whose send rejected — a token refresh losing a cold-load race — failed the same silent way.

- **Channel messages lost their envelope** — channel payloads are now wrapped consistently, and the realtime socket connects lazily rather than in the constructor, so constructing a client no longer opens a connection.

- **Realtime told subscribers the wrong name for their rows**, and a save now names the row it saved rather than deriving an address the caller never asked for.

- **The doctor reported drift on a clean project**, and the schema tooling now says which RLS policies you did not write and how to drop them.

- **`rebase init` failed when installed from npm**, hung on a non-interactive terminal, and defaulted to the wrong package manager; `pnpm start` now filters the backend workspace by path, storage subcommands dispatch correctly, and a stale build warns instead of behaving mysteriously. macOS deploy contexts are handled — AppleDouble tar entries suppressed, dotfiles skipped in directory loaders, and the 100MB upload cap pre-checked.

- **Postgres errors surfaced as opaque 500s** — the underlying error is now reported, and a legacy auth schema is reconciled on boot.

- **Admin: a navigated entity is addressed by the path it was fetched by**, field bindings in `DEFAULT_FIELD_CONFIGS` are read lazily, and the two `WhereFilterOp` definitions now fail loudly when they drift instead of silently disagreeing.

- **Studio: the views that were lying** — an RLS editor crash, dark-mode controls, a revoke confirmation, and the policies those views disowned.

- **BaaS mode served every table to every authenticated user** — it introspects all tables, `ensureAppRole` grants `rebase_user` `SELECT/INSERT/UPDATE/DELETE` across the schema, and nothing enabled RLS, because that only happens via `db push`, which BaaS never runs. Pointing Rebase at an ordinary database therefore exposed every row of every table. A table with RLS disabled has no authorization model, so it is now excluded and logged with the `ALTER TABLE` needed to protect it. Tables with RLS enabled but no policies are served and return nothing — legal, and indistinguishable from an empty table, so that is called out at boot too.

- **Security rules targeting an unusable Postgres role now fail the boot** — `pgRoles` sets a policy's `TO` clause, so naming a role requests never run as means the policy never applies and RLS filters every row. The table reads as empty, which is indistinguishable from having no data, so the mistake shipped. Boot now throws, naming the collection and role, with a specific hint for Supabase's `authenticated`/`anon`/`service_role`.

- **The demo app's collections were empty** — every collection but `users` granted `pgRoles: ["authenticated"]`, a Supabase role name, while requests run as `rebase_user`. RLS filtered every row; `authors` and `posts` granted `TO public`, which is why they were the only two showing data. They now use the documented API (`select: public`, writes `admin`), the same shape `rebase init` scaffolds. The generated `drizzle/policies.sql` carried the same policies and is regenerated — it is what `db push` applies, so the config alone would have changed nothing.

- **The service key did not authenticate websockets** — the HTTP middleware compares it before JWT verification; the websocket path went straight to `extractUserFromToken`, and a static secret can only ever fail that. Any SDK client using a service key (scripts, cron, server-to-server) got `jwt malformed` on every connect and silently received no realtime events.

- **`collection-file → UI package` imports no longer drag React into the backend** — `users.ts` imported `resetPasswordAction` from `@rebasepro/admin`, so the Node backend loaded the entire admin bundle at boot. The action is already injected frontend-side for `auth` collections, making the import redundant. `@rebasepro/admin` is also gone from the config and backend templates, and `@rebasepro/core`/`ui` from `@rebasepro/auth` — none were imported.

### Testing

- **CI had been red for three days on a bug in the test, not the product** — every commit since 2026-07-17 failed the browser e2e with `Local API request failed with status: 401`, and Publish kept shipping canaries past it. The suite writes `REBASE_SERVICE_KEY` into the scaffolded `.env` with a regex, and the regex put `\s*` before the variable name — where `\s` matches newlines. While the CLI shipped that line commented out, the `#` anchored the match and it worked. `259ef0b7a` made the CLI write the key uncommented, so the leftmost match began at the end of the *previous* line and swallowed the newline, welding the assignment onto the comment above it. dotenv then read the whole line as a comment, the server auto-generated its own key, and every service-key request was rejected — a failure three layers away from its cause. The writer is line-based now, and asserts the variable landed on a line of its own instead of trusting the write.

- **The e2e suites refuse to run when their port is taken** — both suites pin a port (3099, 3098) and assert against it, but `rebase dev` falls back to another port when one is busy, so the browser step drove whatever else happened to be listening. A dev server left running in a git worktree held 3099 and silently served the entire local run — including a database that had already been torn down, which is a convincing way to produce failures that have nothing to do with your change. Startup now stops with the squatting pid and command named, and the port is overridable via `E2E_BACKEND_PORT` / `E2E_BAAS_BACKEND_PORT`.

- **Every `init` template is now driven to a persisted row** — the e2e suite scaffolded one project, in one shape, and checked that tables and indexes existed. A template could scaffold, typecheck and migrate cleanly while being unable to store anything, and nothing would say so. `test/e2e/templates.test.ts` takes all six preset × flavor combinations through the path a user actually walks: scaffold, install, bootstrap a real PostgreSQL database, boot the backend, register, log in, write over the HTTP data API, read back, and confirm the row in Postgres — because an API that echoes what it was sent passes every assertion short of the last one. The baas cases additionally assert the security posture the flavor is built on: a table with no row-level security must **not** be served, the boot log must name it and say how to fix it, and once a policy exists, `auth.uid()` must hide one user's rows from another.

- **`rebase init`'s output is under test** — `test/e2e/init-ux.test.ts` pins the reporting defects above so they cannot return: next steps that contradict what happened, a `cd` that points at a directory that does not exist, undocumented flags, an uncommitted `--git` tree, and a silently discarded `--template`. It drives the real binary and installs nothing, so it runs in about three seconds.

- **`test/` is typechecked** — the build config only ever included `src`, so the e2e suites could drift out of sync with the code they drive and fail only at runtime, minutes into a docker-backed run. `tsconfig.test.json` (`pnpm typecheck:test`) covers them; it caught a missing import while this was being written.

- **A stale `dist/` fails loudly** — the e2e suites link the workspace packages and load their build output, so an unbuilt tree silently tests yesterday's code. This surfaced as `Permission denied on "posts"` — a failure with no visible connection to its cause. The suite now checks that every linked package's `dist/` is newer than its sources and, if not, names the packages and the build command instead of running.

## [0.9.0] - 2026-07-13

### Breaking

- **Collection & callback API renames** — several collection-related types took role-based names, the callback parameters flattened to plain rows, and the WebSocket protocol dropped the redundant `ENTITY` from its message names. The `Entity` type itself is unchanged. This is a search-and-replace-level migration for consumers — no behavioral changes.

  **Types (`@rebasepro/types`)**

  | Old Name | New Name |
  |----------|----------|
  | `EntityCollection<M>` | `CollectionConfig<M>` |
  | `EntityCallbacks<M>` | `CollectionCallbacks<M>` |
  | `EntityView` | `EntityCustomView` |
  | `EntityCollectionView` | `DataCollectionView` |

  **Callback API (`CollectionCallbacks`)** — beyond the rename, the parameter shapes changed:

  | Old Param | New Param | Notes |
  |-----------|-----------|-------|
  | `entity` (in `afterRead`) | `row` | Now a flat `Record<string, unknown>`, not an `Entity<M>` wrapper |
  | `entityId` (in save/delete) | `id` | `string \| number` |
  | `previousEntity` | `previousValues` | `Partial<EntityValues<M>>` |
  | `afterCreate` / `afterUpdate` | `afterSave` | Use `status: "new" \| "existing"` to distinguish |

  Migration example:
  ```diff
  -import type { EntityCallbacks } from "@rebasepro/types";
  -const callbacks: EntityCallbacks = {
  -    afterRead: ({ entity }) => {
  -        return { ...entity, values: { ...entity.values, email: "***" } };
  -    },
  -    afterCreate: ({ entity }) => { /* ... */ },
  -    beforeDelete: ({ entityId }) => { /* ... */ },
  +import type { CollectionCallbacks } from "@rebasepro/types";
  +const callbacks: CollectionCallbacks = {
  +    afterRead: ({ row }) => {
  +        return { ...row, email: "***" };
  +    },
  +    afterSave: ({ id, status }) => { if (status === "new") { /* ... */ } },
  +    beforeDelete: ({ id }) => { /* ... */ },
  };
  ```

  **WebSocket wire protocol**

  | Old Message Type | New Message Type |
  |-----------------|-----------------|
  | `FETCH_ENTITY` | `FETCH_ONE` |
  | `SAVE_ENTITY` | `SAVE` |
  | `DELETE_ENTITY` | `DELETE` |
  | `COUNT_ENTITIES` | `COUNT` |
  | `subscribe_entity` | `subscribe_one` |
  | `collection_entity_patch` | `collection_patch` |

- **Unified `<Rebase>` data props** — Removed the `data` and `driver` props. There are now exactly two ways to provide data: `client` (server transport) and `dataSources` (everything else). A `dataSources` entry keyed `"(default)"` with a `driver` replaces `client.data` as the default source — this is how a fully client-side app (e.g. Firestore-only via `RebaseFirebaseApp`) is wired. Migration: `driver={x}` → `dataSources={[{ key: "(default)", engine: "firestore", driver: x }]}`; `data={x}` had no known users (custom backends implement `DataDriver`, now the documented integration SPI).
- **Deterministic default-source resolution** — The default data source resolves as: `"(default)"`-keyed entry with driver → `client.data` → the sole registered source. Several sources without an explicit default now throw instead of silently picking the first object entry (order-dependent).

- **Side-panel / Edit-view / Collection-view component rename** — Renames mechanically-generated "Entity" component names to descriptive, role-based names. Components bound to Rebase core data use the `Binding` suffix. This is a search-and-replace migration — no behavioral changes.

  **Types (`@rebasepro/types`)**

  | Old Name | New Name |
  |----------|----------|
  | `EntitySidePanelProps` | `SidePanelBindingProps` |
  | `sideEntityController` (on `RebaseContext`) | `sidePanelController` |
  | `sideEntityController` (on `EntityActionClickProps`) | `sidePanelController` |
  | `"Entity.FormActions"` (override key) | `"EditView.FormActions"` |
  | `"Entity.DetailView"` (override key) | `"DetailView"` |
  | `"Entity.Preview"` (override key) | `"RecordPreview"` |

  **Components (`@rebasepro/admin`)**

  | Old Name | New Name |
  |----------|----------|
  | `SideEntityProvider` | `SidePanelProvider` |
  | `EntitySidePanel` | `SidePanelBinding` |
  | `EntityEditView` | `EditViewBinding` |
  | `EntityEditViewFormActions` | `EditFormActions` |
  | `EntityDetailView` | `DetailViewBinding` |
  | `EntityView` | `RecordViewBinding` |
  | `EntityPreview` | `RecordPreviewBinding` |
  | `EntityJsonPreview` | `JsonPreviewBinding` |
  | `DataCollectionView` | `CollectionViewBinding` |
  | `EntityCollectionBoardView` | `CollectionBoardViewBinding` |
  | `EntityCollectionCardView` | `CollectionCardViewBinding` |
  | `EntityCollectionListView` | `CollectionListViewBinding` |
  | `DataCollectionViewActions` | `CollectionViewActions` |
  | `DataCollectionViewStartActions` | `CollectionViewStartActions` |
  | `DataCollectionTable` | `CollectionTableBinding` |
  | `EntityCollectionRowActions` | `CollectionRowActions` |
  | `EntitySelectionTable` | `SelectionTableBinding` |
  | `EntityBoardCard` | `BoardCardBinding` |
  | `EntityCard` | `RecordCardBinding` |
  | `useEntityPreviewSlots` | `usePreviewSlots` |
  | `SideEntityControllerContext` | `SidePanelControllerContext` |

  **Bridge key (`@rebasepro/core`)**

  | Old Key | New Key |
  |---------|---------|
  | `"sideEntityController"` | `"sidePanelController"` |
  | `sideEntityController` (on `StudioBridge`) | `sidePanelController` |

- **Client split into server/browser variants** — `RebaseClient` is now split so the RLS-bypassing accessor is explicit: use `rebase.dataAsAdmin` (server-only) for admin-scoped, RLS-bypassing access, and `rebase.data` for user-scoped access. The public API surface was curated to hide internal plumbing.

- **`update`/`delete` throw on not-found** — SDK `update()` and `delete()` now throw when the target row does not exist, instead of silently returning `undefined`.

- **`deleteAll` is now internal** — removed from the public data accessors.

- **Scaffold defaults to cookie auth** — new projects store the refresh token in an httpOnly cookie (`authFlowMode: "cookie"`) by default.

- **`AdminUser.provider` → `providerId`** — renamed to match the canonical `User` type.

### Features & Improvements

- **Membership / relational RLS predicate (`policy.existsIn`)** — a first-class access predicate for scoping reads/writes by membership in a related collection (e.g. "only rows whose team the caller belongs to"). Compiles to a single correlated `EXISTS` subquery — no per-row `afterRead` lookups. Adds `policy.existsIn({ collection, where })` and the `policy.outerField(name)` operand for correlating the subquery to the outer row.

- **Built-in email → user lookup for invites** — opt-in `auth.allowUserLookup` exposes an authenticated `POST /auth/find-user` and a client `rebase.auth.findUserByEmail(email)` that returns a minimal public profile (`uid`, `displayName`, `photoURL` only). Removes the hand-rolled `dataAsAdmin` server function that invite flows previously required. Off by default (enables user enumeration by signed-in users).

- **Mount the admin under a path prefix** — `RebaseCMS` accepts a `basePath` so the admin can live under a sub-path route (e.g. `/admin`) without the collection data-grid hanging on URL↔collection resolution.

- **Filter operators** — LIKE family (`like`, `ilike`, etc.) and null checks, with engine-aware, customizable filter fields.

- **Scoped storage tokens** — storage access is now governed by scoped, time-limited tokens, with a documented public-files + scoped-token URL model.

- **Uniform server error envelope** — server error responses are routed through a central handler for a consistent `{ error: { message, code, details? } }` wire shape.

- **Inferred data-source transport** — `DataSourceDefinition.transport` is now optional: entries with a client-side `driver` default to `"direct"`, entries without to `"server"`. A `"(default)"`-keyed entry without a driver can be used to declare the default source's engine/capabilities while the client keeps serving the data.

- **`installShutdownHandlers`** — New `@rebasepro/server-core` helper that encapsulates graceful shutdown: drains via `backend.shutdown()`, runs `onCleanup` (e.g. closing your database pool), guards against repeated signals, and force-exits if shutdown hangs. Replaces the hand-rolled ~40-line shutdown block in the backend templates — the CLI template previously lacked the re-entry guard and force-exit timer entirely.

- **Honest Realtime Meta** — Added `FindResponse.meta.estimated` flag on realtime first-paint updates. When `listen()` emits its immediate heuristic metadata, the emission now carries `estimated: true`. Redundant second emissions are skipped when the authoritative count matches the heuristic, and count failures no longer silently pretend to be authoritative — the `estimated` flag remains as the signal.

### Fixes

- **Concurrency-safe refresh-token rotation** — token rotation now uses an atomic `INSERT … ON CONFLICT DO UPDATE` instead of a DELETE-then-INSERT. Concurrent `/refresh` calls (which cookie-mode boot can fire at once) previously raced into a `unique_device_session` violation and returned 500, breaking the session. The client also single-flights concurrent refreshes.

- **Cookie session restore** — `/auth/refresh` now returns the user object, and the client restores the user (falling back to `/me`) instead of leaving a blank `uid`. A cold start restored from an httpOnly cookie alone no longer yields an empty user.

- **Resilient auto-refresh** — a transient refresh failure (network blip, backend restart, 5xx) now retries with exponential backoff instead of immediately signing the user out; only a genuine auth failure (401/403/invalid/expired token) or exhausted retries signs out.

- **`server-postgresql` ships `src/`** — the driver package now packs `src` alongside `dist`, fixing `✗ Could not find CLI entry point for @rebasepro/server-postgresql` for `rebase db push` / `schema generate` in published/packed installs (the CLI runs `src/cli.ts` via tsx; no `dist/cli.js` is built).

- **Malformed request bodies** — the API now rejects malformed JSON bodies with `400` and tightens the public-path check.

- **Auth collection callbacks warning** — the server warns at startup when an auth collection defines `beforeSave`/`afterSave`/`beforeDelete`/`afterDelete`, since auth-driven user creation bypasses the collection save pipeline (use the `afterUserCreate` auth hook instead).

- **CLI DX** — friendly diagnostics for "SSL is not enabled on the server" (suggests `sslmode=disable`) and for dependency-drop failures that leave a schema half-migrated; a clear warning when `--collections` resolves to a missing path; and `rebase dev` now surfaces when it overrides the project's `.env` PORT / `VITE_API_URL` with its derived per-project port.

- **Scaffold hardening** — the frontend Vite config ships `resolve.dedupe` for React / React Router so a locally `link:`ed Rebase checkout doesn't load duplicate React copies (which broke the admin's data router); `.env.example` documents `sslmode=disable`.

## [0.8.0] - 2026-07-01

### Changed

- **Strict collection accessors** — When a `collections` dictionary is passed to `createRebaseClient`, unknown property accessors on `client.data` now throw immediately with a nearest-match suggestion instead of silently producing a 404 later. Use `data.collection("slug")` for dynamic slugs.

### Cleanup

- **Removed** — Six unused FireCMS-legacy builder identity functions (`buildProperties`, `buildPropertiesOrBuilder`, `buildEnum`, `buildEnumValueConfig`, `buildEntityCallbacks`, `buildAdditionalFieldDelegate`). Migration: remove the wrapper call — they were identity functions, so the object literal is the same value.
- **Deprecated** — `buildCollection` / `buildProperty` in favor of `defineCollection`. Both are marked `@deprecated` and will be removed before 1.0.
- **Removed** — Unused `<Rebase apiKey>` prop (it was never consumed by the component).
- **Fixed** — Duplicated sentences in `propertiesOrder` JSDoc; rewrote `subcollection:` description to cover both Firestore and Postgres.

### Features & Improvements

- **Unified Policy & Filter Engine** — Replaced ad-hoc permission checks with a centralized `evaluatePolicy` system and `Policy` type. This system translates high-level security rules into both frontend conditions (for UI gating) and backend-specific filters (Postgres RLS, Firestore security rules). Includes `policyToPostgres` and `securityRuleToConditions` utilities, ensuring the admin UI matches database enforcement by construction.
- **`defineCron` authoring helper** — Typed identity wrapper for cron job files (parity with `defineFunction`). Demo app now ships a working cron job (`refresh-product-stats`).
- **Multi-Backend Storage Sources** — Introduced a first-class `StorageSource` system allowing a single project to use multiple storage backends (S3, GCS, Local, Firebase) simultaneously. Added `GCSStorageController` for native Google Cloud Storage support with TUS resumable uploads. Managed via `StorageSourcesContext` and `StorageRegistry`, enabling complex multi-cloud storage architectures.
- **Custom Backend Functions** — New `defineFunction()` API for creating type-safe, discoverable backend endpoints. Functions are automatically mounted, type-checked, and can be invoked directly from the client SDK with full type safety. Includes a new `invoke_function` MCP tool for interacting with custom endpoints from AI agents.
- **Property Schema Consolidation** — Refactored the property system to unify how database-level schemas, UI configurations, and validation rules are defined. Removed overlapping property types and introduced a more robust `PropertyConfig` system that handles complex relations and references consistently across all data drivers (Postgres, MongoDB, Firestore).
- **Editable UI Table** — Significantly enhanced `VirtualTable` with native editable cells (`VirtualTableInput`, `VirtualTableSelect`, `VirtualTableNumberInput`, `VirtualTableDateField`). Added a new `SelectionStore` and `SelectionContext` for robust multi-row selection, keyboard navigation, and batch operations within the CMS.
- **Expanded Agent Skills** — Massive overhaul of the Rebase AI coding skills. Added new specialized skills for `rebase-custom-functions`, `rebase-ui-components`, and `rebase-storage`. Expanded existing skills for auth, security, and SDK with deep architectural context, common patterns, and safety rules.
- **Public API Refinement** — Cleaned up the public API surface of `@rebasepro/client` and `@rebasepro/core`, simplifying integration into existing applications. Consolidated data controllers, improved type inference, and refined the `Rebase` component props for better developer experience.
- **NPM Publishing Safeguards** — Added `validate-no-workspace-protocol.sh` and `check-packages.sh` scripts to the release pipeline. These prevent publishing packages with `workspace:` dependencies or inconsistent versions, ensuring library consumers always get stable, resolved dependencies.

### Fixes

- **Dependency Management** — Resolved workspace-wide dependency conflicts and fixed "workspace protocol" leakage in built artifacts that caused installation failures in certain environments.
- **Lifecycle Interception** — Unified lifecycle interception systems across different data drivers. This ensures consistent execution of `beforeSave`, `afterSave`, `beforeDelete`, and `afterDelete` hooks regardless of whether the collection is backed by Postgres, MongoDB, or Firestore.
- **OAuth Configuration** — Refactored and stabilized OAuth provider configuration. Resolved inconsistencies in how environment variables were parsed for Discord, Microsoft, and LinkedIn providers.
- **MongoDB & Firestore Parity** — Improved collection support for MongoDB and Firestore, bringing their relation/reference capabilities and storage integration closer to parity with the PostgreSQL driver.
- **Any Type Audit** — Conducted a comprehensive audit of `any` types across the core packages, replacing them with strict types or narrowing guards (e.g., `isSQLAdmin`) to improve overall codebase robustness and prevent runtime errors.

### Testing

- **Security Policy Tests** — New test suites for `evaluatePolicy`, `policyToPostgres`, and `securityRuleToConditions` covering Kleene logic and complex nested expressions.
- **Storage Tests** — Added comprehensive integration tests for `GCSStorageController`, multi-storage routing, and TUS upload flows.
- **UI Tests** — New unit and integration tests for `VirtualTable` editable fields, selection logic, and keyboard accessibility.
- **Schema Gates** — Added `collection_registry_property_gates` tests to validate property resolution and permission-based visibility gating at the registry level.

---

## [0.7.0] - 2026-06-29

### Features & Improvements

- **Multi-Datasource Architecture** — Introduced a first-class `DataSourceDefinition` / `DataSourceCapabilities` system that lets a single Rebase instance route collections to different database engines (Postgres, Firestore, MongoDB, or custom drivers). Collections declare a `dataSource` key, and the frontend router, backend driver registry, and collection editor all resolve capabilities from the same definition. Includes `resolveDataSource()`, `createDataSourceRegistry()`, `registerDataSourceCapabilities()`, and a new `DataSourcesContext` React provider. The editor automatically shows/hides tabs (Relations, Subcollections, RLS) and property types based on each source's declared feature flags.
- **Headless Collection Views** — Extracted reusable, data-agnostic collection view components (`CollectionView`, `CollectionTableView`, `CollectionCardView`, `CollectionListView`, `CollectionKanbanView`) into `@rebasepro/ui`. These headless components accept a generic `CollectionDataController<T>` — no coupling to entities or the CMS data layer — making them usable in custom pages, standalone apps, and third-party integrations. Includes a `CollectionViewToolbar` with view-mode toggle, search, filters, and pagination.
- **Headless Entity Forms** — Decoupled `EntityForm`, `EntityFormActions`, and `EntityFormBinding` from the admin package internals. Forms now accept pluggable field bindings and layout props, enabling standalone entity editing outside the CMS shell. Added `PopupFormField` for inline editing and extended form layout controls.
- **Auth Hooks Expansion** — Significantly expanded the `AuthHooks` interface with new lifecycle hooks: `beforeLogin`, `afterLogout`, `onPasswordReset`, `beforeUserDelete`, `afterUserDelete`, `onAdminCreateUser`, `onAdminResetPassword`, and `transformAuthResponse`. The `transformAuthResponse` hook lets developers inject external tokens (e.g. Firebase Custom Tokens) or project-specific metadata into every auth response. Added `AuthMethod` type covering all authentication methods.
- **Custom Auth Adapter** — New `createCustomAuthAdapter()` factory for plugging existing auth systems into Rebase with minimal config. Only `verifyRequest` is required — capabilities, user lookup, and registration are all optional overrides.
- **Magic Link Authentication** — Added passwordless magic-link login flow with `mountMagicLinkRoutes()`. Generates secure tokens with 15-minute expiry, sends branded emails via the configured email provider, and integrates with the `transformAuthResponse` hook and rate limiting.
- **API Keys** — Full API key management with collection-level permission scoping (`read` / `write` / `delete`), admin keys, rate limiting, expiration, and revocation. Includes server-side middleware (`api-key-middleware.ts`), a Postgres-backed key store, a Studio management UI (`ApiKeysView`), a CLI command (`rebase api-keys list|create|revoke`), and a client SDK module (`@rebasepro/client` `api-keys.ts`). Keys are stored with hashed secrets; the full key is only returned on creation.
- **Atlas Migrations (replaces Drizzle Kit)** — Replaced `drizzle-kit` with [Atlas](https://atlasgo.io/) for schema migrations. Added `generate-postgres-ddl-logic.ts` that produces raw SQL DDL (with enums, RLS policies, and indexes) from collection definitions. Migrations are now version-controlled SQL files under `drizzle/migrations/` with an `atlas.sum` integrity file. CLI `rebase db` commands updated accordingly.
- **Improved RLS Editor** — Overhauled the Studio RLS editor with better policy visualization, shared `table-classification.ts` module (classifying tables as `rebase-internal`, `junction`, or `user`), and improved default auth policies generation.
- **Headless Collection Editor** — Made the collection schema editor headless and decoupled from the admin shell. Extracted serializable types and utilities, allowing the editor to be embedded in custom Studio views or third-party tools.
- **Security Audit Logging** — Added structured security audit logging across all OAuth providers (Apple, Google, GitHub, GitLab, Facebook, Discord, Microsoft, LinkedIn, Slack, Spotify, Twitter, Bitbucket). Improved `ECONNREFUSED` error handling with actionable diagnostics, and fixed `chalk` CJS compatibility.
- **Landing Page & Demos** — New layered architecture diagram on the developers page, improved CRM dashboard demo (`CrmDashboardDemo`), and fixed NEAT gradient mismatches across all landing pages.
- **CLI Skills Enhancements** — Extended the `rebase skills` command with updated skill definitions for auth, security, collections, realtime, and SDK documentation.

### Fixes

- **Security Hardening** — Parameterized queries in API key store and cron store to prevent SQL injection. Hardened WebSocket connection safeguards, strengthened `EntityPersistService` input validation, and added `.dockerignore` / `.gitignore` rules to prevent secrets leakage. Sanitized environment variable handling in production.
- **Repo Cleanup** — Reorganized internal documentation (`BREAKING_CHANGES_POSTGRES.md`, `PUBLISHING.md`, `REBASE_ARCHITECTURE.md`) into `.github/internal/`. Cleaned up legacy `formex` `.yarn/cache` artifacts, updated `CONTRIBUTING.md`, `README.md`, and `AGENT.md`. Deprecated export documentation moved to `docs/DEPRECATED_EXPORTS.md`.
- **UI & Ergonomics** — Multiple ergonomic fixes across the admin panel: improved Sheet/Dialog focus management, refined `DrawerNavigationGroup` and breadcrumb context, stabilized navigation resolution hooks, and cleaned up `BreadcrumbsContext` and `CollectionRegistryContext`.

### Testing

- **Multi-Datasource Tests** — New test suites for `buildRoutedRebaseData`, `resolveDataSource`, `collection_registry_datasource`, `routing_integration`, `multi-datasource-routing`, and `routed-realtime-service`.
- **Auth Tests** — Added tests for `custom-auth-adapter`, `transform-auth-response`, and extended `auth-routes` tests covering magic links and lifecycle hooks.
- **Postgres Tests** — New `auth-default-policies` tests, extended `cli-helpers-extended` tests, `connection` tests, `databasePoolManager` tests, `doctor-extended` tests, and `generate-postgres-ddl` tests.
- **UI Tests** — Added `views.test.tsx` covering the new headless `CollectionView`, `ListView`, `CardView`, and `TableView` components.
- **E2E Tests** — Updated Playwright E2E tests for collections, studio features, and the new API keys flow.

---

## [0.6.1] - 2026-06-23

### Fixes

- **CLI Init Crash** — Fixed `rebase init` crashing with `UnknownPromptTypeError: Prompt type "list" is not registered` after entering the project name. The `inquirer` v14 dependency renamed the `"list"` prompt type to `"select"`, breaking the interactive flow. The non-interactive (`--yes`) path was unaffected, which is why E2E tests did not catch it.

### Testing

- **Interactive Prompt Validation** — Extracted prompt question building into a testable `buildInitQuestions()` function and added unit tests that validate all prompt `type` values against the installed `inquirer` version's registered types. This prevents prompt-type regressions from shipping silently when `inquirer` is upgraded.

---

## [0.6.0] - 2026-06-18


### Features & Improvements

- **Schema Drift & Previews** — Added a schema drift notification banner to Starlight and Studio home page, and improved previews for collection reference/relation properties.
- **Rebase Client & Types** — Consolidated RebaseClient context hooks, aligned types in `@rebasepro/client` and reconciled data controllers for cleaner imports.
- **Observability** — Integrated structured request-logger middleware and an `X-Request-ID` correlation header to trace client requests across core backend services.
- **Code Quality & Testing** — Added robust unit/integration tests across `@rebasepro/ui` components, StudioHomePage, and data plugins. Cleaned up Vite configuration targets, and strengthened type-safety checks.
- **Multi-Factor Authentication (MFA)** — Full TOTP-based MFA implementation with enroll, verify, challenge, and unenroll flows. Includes recovery codes, `aal1`→`aal2` token upgrade on challenge verification, and an `onMfaVerified` auth hook. Auth routes extracted into dedicated `mfa-routes.ts` and `session-routes.ts` modules.
- **Component Override System** — New `ComponentOverrideContext` and `useComponentOverride` hook allow developers to replace built-in UI components at both the global (`<Rebase components={…}>`) and per-collection level, with resolution priority: collection → global → default.
- **CLI Skills Command** — `rebase skills` auto-detects and installs Rebase AI coding skills for Cursor, Claude Code, Windsurf, and Gemini/Antigravity, writing the correct file format (`.mdc`, `SKILL.md`, `.md`) to each agent's rules directory.
- **MCP Server Expansion** — Added storage tools (`storage_list_objects`, `storage_delete_object`, `storage_get_metadata`), cron tools (`cron_list_jobs`, `cron_get_job`, `cron_trigger_job`, `cron_get_job_logs`, `cron_toggle_job`), and `invoke_function` for calling custom backend functions. Automatic package-manager detection for dev server commands.
- **Server Init Refactor** — Decomposed the monolithic `init.ts` into focused modules: `init/middlewares.ts` (request ID, body limits, CSRF, CORS warnings, logging), `init/health.ts` (health-check endpoint with DB latency), `init/shutdown.ts` (graceful teardown ordering), `init/storage.ts` (multi-backend storage bootstrap), and `init/docs.ts` (OpenAPI serving).
- **Entity Form Improvements** — Enhanced `EntityDetailView` and `EntityEditView` with better field-binding support, added `PopupFormField` inline editing, extended `EntityForm` with additional layout controls, and added `replace` option to `navigateToEntity`.
- **Drizzle Schema Generation** — Improved generated schema logic with richer column-type support and cleaned up `EntityPersistService` by extracting reusable persist utilities.
- **Documentation & Website** — Added `llms.txt`, updated `sitemap.md`, expanded backend auth, realtime, collections, SDK, and component-overrides documentation. Agent skills updated for auth, collections, realtime, SDK, and Studio.


### Fixes

- **Auth Refactoring** — Resolved auth issues and cleaned up redundant user management hooks, admin routes, and legacy decorators.
- **Studio & UI Components** — Corrected icon sizing bugs in navigation cards, restored and stabilized SQLEditor panel logic, improved tab scroll styles, and updated third-party dependencies across all packages.
- **Relation Preview Rendering** — Fixed broken relation previews in list views by correcting `useEntityPreviewSlots` resolution and adding proper hydration logic in `RelationPreview` and `PropertyPreview` components.
- **Security Hardening** — Hardened WebSocket client with connection-level safeguards, added input validation to GraphQL and REST generators, tightened API key store and cron store queries, improved image-transform and SPA-serve path handling, and added branch-service authorization checks.
- **PostgreSQL Error Handling** — New `pg-error-utils.ts` module extracts native PG errors from Drizzle's cause chain, translates 5-character SQLSTATE codes into user-friendly messages, and surfaces constraint, column, and table metadata.
- **Roles Query** — Fixed roles query resolution in user management flows.
- **Package Cleanup** — Cleaned up `package.json` files across the monorepo, fixed dependency declarations, and corrected `plugin-insights` version reference.
- **VirtualTable & UI** — Refactored `VirtualTable` and `VirtualTableHeader` for better resize handling and simplified render logic. Improved `Dialog` focus management and `LoginView`/`ErrorView` layout.

### Testing

- **Admin Package Tests** — Added component-level tests, data export tests, data import tests (including `get_import_inference_type` and transforms), and extended navigation utils test coverage.
- **PostgreSQL Tests** — New `relations.test.ts` for relation service, `pg-error-utils.test.ts` for error extraction, and expanded `drizzle-conditions.test.ts` and `generate-drizzle-schema.test.ts`.
- **MCP Server Tests** — Extended test suite covering new storage, cron, and function tool handlers.


---

## [0.5.0] - 2026-06-15

### Features & Improvements

- **Aesthetic Landing Page** — Added high-performance custom NEAT canvas background gradients, revamped hero illustrations, and introduced localized documentation and responsive demo page structures.
- **Developer Workspaces** — Added curated development skills rules (covering cron jobs, design-language, email, history, and SDK specs) directly into the agent workspace configs.
- **Data Insights & Migrations** — Integrated database migration `0002` schema changes and a seed script, and introduced an automated insights calculator service.
- **CLI Improvements** — Hardened CLI initialization options for PostgreSQL 18.

### Fixes

- **RLS & Security** — Resolved critical security gaps in Postgres Row-Level Security (RLS) policies.
- **Multi-DB Drivers** — Cleaned up type-safety and package path dependencies for `server-mongodb` and `server-postgresql`.

---

## [0.4.0] - 2026-06-11

### Features & Improvements

- **Unified Authentication** — Redesigned default auth routing, eliminated the `defaultUsersCollection` construct, and streamlined default view redirects.
- **Email Config** — Added custom `SMTP_NAME` parameter configuration in SMTP email delivery properties.

### Fixes

- **Layout & Sizing** — Resolved side navigation alignment glitches, added scroll-overflow fixes in entity data grids, and corrected `ReadOnlyFieldBinding` form fields.
- **Missing Build Configurations** — Added missing `tsconfig.prod.json` compiler files and stabilized workspace-level packaging dependencies.

---

## [0.2.5] - 2026-06-09

### Features & Improvements

- **Role Model Simplification** — Removed roles as an independent table/collection, simplifying permissions into a standard DB enum column directly in the `users` table.
- **SDK & Client Methods** — Extended Rebase client drivers with new data persistence methods.

### Fixes

- **Types & Layouts** — Extended schema types to support native UUID format in string fields, adjusted scroll behaviors in tab grids, and solved pnpm lockfile conflicts.

---

## [0.2.4] - 2026-06-08

### Features & Improvements

- **PostgreSQL 18** — Upgraded core infrastructure and Docker configurations to support PostgreSQL v18.
- **Scaffold Configurations** — Added VPC and S3-compatible cloud storage setup inputs directly into the CLI project-creation prompts.
- **Auth Hooks & Orgs** — Added basic multi-tenant organization support and renamed `AuthOverrides` to `AuthHooks`.
- **Advanced Query Operators** — Introduced `array-contains-any` and `not-in` filter clauses for postgres client drivers.
- **Error Boundaries** — Wrapped main application routes in a robust `ErrorBoundary` with specific full-page and authorization error layouts, and attached global listeners for unhandled promise rejections.

### Fixes

- **Stricter Typing & Logging** — Replaced broad `any` usages with type-safe `unknown` keywords, and migrated core controllers from `console.log` to the structured monorepo logger.

---

## [0.2.3] - 2026-05-31

### Features & Improvements

- **OIDC Publish Workflows** — Migrated package publishing workflows to use GitHub Actions OIDC federation with NPM, removing hardcoded auth tokens and adding secure ID-token scopes.
- **Dynamic Versions** — Dynamically resolved workspace versions from `lerna.json` during canary package releases.

### Fixes

- **CLI Scaffold** — Fixed CLI template installation bugs, repaired Docker database image configs, and restored correct properties inside template collection schemas.

---

## [0.2.1] - 2026-05-30

### Fixes

- **Lockfile & Build Issues** — Fixed a missing integrity hash for the `xlsx` dependency in the lockfile, and resolved frontend build failures by adding `@types/node` and `vite/client` type definitions.
- **SQL Editor Component** — Updated the `SQLEditor` component for improved stability and rendering.

### CI & E2E Testing

- **E2E Test Runner Improvements** — Replaced the `execa` dependency with a custom spawn helper in E2E tests, resolved package packing/resolution issues, and fixed split chunk E2E test failures by accumulating logs for dev server URL detection.
- **Vite Template Config** — Tracked `virtual.d.ts` in git and fixed glob inclusions in `tsconfig` files to prevent template compilation errors.

---

## [0.2.0] - 2026-05-29

### Features & Improvements

- **Postgres Vector (pgvector) Support** — Added a `vector` property type for embeddings, including admin UI field bindings, validation, Postgres schema generation, API generators, and data transformations.
- **Pluggable AuthAdapter Architecture** — Replaced direct Firebase Auth logic in key controllers with a pluggable adapter system to support dynamic/external authentication providers (e.g., dynamic Postgres auth schemas).
- **Users & Roles Collections** — Migrated the user/role system to be treated as standard, customizable data collections, with built-in overrides and migration of auth UI components to the core package.
- **A/B Testing & Landing Page Revamp** — Added A/B testing infrastructure, hero CTAs, testimonials, landing page Bento Grid layouts (`ProductContent`), and demo view modes.
- **SDK Drift Detection** — Added SDK drift detection to the CLI doctor command to check for drift between collection definitions and generated SDKs.
- **EntityDetailView & UI Enhancements** — Created `EntityDetailView` for read-only displays, new `FilterChip` components, and support for collection filter presets.
- **CLI and Test Improvements** — Upgraded pnpm to v11, added CLI init E2E tests, localhost validation tests, and AI coding assistant rules to CLI templates.
- **Database Role Switching Config** — Introduced `DISABLE_DB_ROLE_SWITCHING` and `ADMIN_CONNECTION_STRING` options with troubleshooting documentation.
- **License Update** — Relicensed the project under the MIT License.

### Fixes & Refactoring

- **Realtime Service Shutdown Deadlock** — Fixed potential deadlocks during shutdown by cleaning up websocket realtime services before closing the database pool.
- **Environment Validation** — Centralized environment variable validation in `server-core`.
- **UI Styling & Translations** — Refactored UI components to use consistent Typography/Alert variants, and updated i18n translation strings.

---

## [0.1.2] - 2026-05-15

### Improvements

- **Removed `lodash` dependency** — Replaced `lodash/cloneDeep` with a custom `deepClone` utility in `@rebasepro/utils`. This eliminates the external dependency and fixes `npx create-rebase-app` failing due to missing `lodash` at runtime.
- **New `deepClone` utility** — A lightweight deep-clone function that preserves function references and class instances (Date, GeoPoint, etc.), designed specifically for Rebase collection objects.

### CI & Tooling

- **Automated release pipeline** — New GitHub Actions workflow (`Publish Stable Release`) that handles version bumping, npm publishing, and GitHub Release creation in a single click from the Actions tab.
- **Local release script** — `pnpm release:patch`, `pnpm release:minor`, `pnpm release:major` for releasing from the command line with the same pipeline.
- **Canary releases** — Every push to `main` publishes a canary version to npm (`@canary` dist-tag).

### Fixes

- Fixed navigation utility tests to assert the correct call signature with `undefined` options parameter.
- Updated package descriptions to reflect the Postgres-based architecture.

---

## [0.1.0] - 2025-05-14

🎉 **First public release of Rebase** — an open-source headless CMS and admin panel for Postgres.

### Highlights

- **Full Admin Panel** — Spreadsheet, card, list, and table views for managing your data with inline editing, filtering, sorting, and search.
- **PostgreSQL Backend** — First-class Postgres support with Drizzle ORM, schema introspection, and automatic migrations.
- **Authentication** — Built-in auth with email/password, Google OAuth, and anonymous sign-in. Role-based access control with customizable permissions.
- **Storage** — S3-compatible file storage with image resizing, drag-and-drop uploads, and metadata management.
- **Studio** — SQL editor, RLS policy editor, schema visualizer, JS/TS editor, cron jobs, and API explorer.
- **CLI** — `npx create-rebase-app` to scaffold a new project in seconds. Supports both npm and pnpm.
- **SDK Generator** — Auto-generate fully typed TypeScript SDKs from your collection definitions.
- **MCP Server** — Model Context Protocol server for AI-assisted database management.
- **Plugins** — Data enhancement and insights plugins for extending the admin experience.
- **UI Component Library** — A comprehensive set of accessible, themeable React components built on Radix primitives.
- **Firebase Support** — Optional Firebase/Firestore data source and authentication adapters.
- **MongoDB Support** — Optional MongoDB data source adapter.

### Packages

| Package | Description |
|---|---|
| `@rebasepro/types` | Core TypeScript type definitions |
| `@rebasepro/utils` | Shared utility functions |
| `@rebasepro/common` | Common modules shared across packages |
| `@rebasepro/formex` | Lightweight form management library |
| `@rebasepro/ui` | React component library |
| `@rebasepro/core` | Core CMS logic and controllers |
| `@rebasepro/client` | Client-side data access layer |
| `@rebasepro/client-postgresql` | PostgreSQL client adapter |
| `@rebasepro/client-firebase` | Firebase/Firestore client adapter |
| `@rebasepro/server-core` | Server framework and middleware |
| `@rebasepro/server-postgresql` | PostgreSQL server adapter with Drizzle |
| `@rebasepro/server-mongodb` | MongoDB server adapter |
| `@rebasepro/auth` | Authentication controllers and views |
| `@rebasepro/admin` | Full admin panel interface |
| `@rebasepro/studio` | SQL editor, schema tools, and developer utilities |
| `@rebasepro/cli` | CLI for project scaffolding and management |
| `@rebasepro/sdk-generator` | TypeScript SDK code generation |
| `@rebasepro/mcp-server` | MCP server for AI integrations |
| `@rebasepro/schema-inference` | Database schema introspection and inference |
| `@rebasepro/plugin-data-enhancement` | AI-powered data enhancement plugin |
| `@rebasepro/plugin-insights` | Analytics and insights plugin |
