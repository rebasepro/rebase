# Unit 44 — `packages/firebase`

Read-only audit, 2026-08-08. Scope: `packages/firebase`, plus every place the
monorepo references it. No source was modified.

## Verdict

**Alive and shipping, but only structurally — functionally it is legacy, and two
of its three "product" layers are wired to nothing.**

The evidence for alive is unambiguous. `@rebasepro/firebase` is published to npm
(`latest` = 0.13.0, with canaries as recent as today — `dist-tags` shows
`canary: 0.13.1-canary.g501e3cb`, matching HEAD), and it is published on *every*
release because `tooling/scripts/release.sh:214,279` bump and publish `./packages/*`
wholesale with no per-package opt-out. It is a member of the authoritative
typecheck program (`tsconfig.typecheck.json:62-67,` include list) and
`tsc --noEmit -p tsconfig.typecheck.json` is **clean** — I ran it. It builds
(`dist/` regenerated today, `pnpm build` covers `./packages/*`). Its example
`examples/firebase` is type-checked in CI (`.github/workflows/verify.yml:217`),
and `firestore` is a first-class engine in the core types, not an afterthought:
`FirebaseCollectionConfig` with `engine: "firestore"`
(`packages/types/src/types/collections.ts:334-336`), `isFirebaseCollection`
(`:498`), and a declared capability record `FIREBASE_CAPABILITIES`
(`packages/types/src/types/data_source.ts:222-241`) whose comment even cites this
driver's LIKE-family throw. So: **not dead, not excluded from any gate, not
drifting unchecked.**

The evidence for legacy is equally clear. There is **no documentation page for
it anywhere** — `website/src/content/docs/**` mentions `@rebasepro/firebase` only
in the CHANGELOG and in the v0.12→0.13 package-rename table in `upgrading.mdx`.
The only places that promise it are `README.md:258` and
`tooling/rebase-agent-skills/skills/rebase-basics/SKILL.md:135` ("When connecting to a
Firebase backend"), which is a promise an agent will act on and then find no
guidance behind. The marketing site does not overpromise: `/rebase-vs-firebase`
positions Rebase as the thing you migrate *away from* Firebase to. Meanwhile the
package's own README documents five exports that do not exist, its five tests
have never executed in any pipeline (a recorded, allow-listed gap), the
user-management and App Check layers are computed and thrown away inside
`RebaseFirebaseApp`, and the entire ~600-line text-search stack hangs off a
`DataDriver` extension point that nothing in the monorepo calls.

Recommendation at the end. Short version: **keep and mark deprecated**, after
fixing the two fail-open/fail-loose defects below, because leaving a
security-relevant access gate published while advertising it in the agent skill
is the worst of the three options.

---

## Findings by severity

### HIGH

**H1 — `useBuildUserManagement`'s access gate fails OPEN when the users
collection cannot be read.**
`packages/firebase/src/hooks/useBuildUserManagement.tsx:163-168` — the Firestore
`onError` handler sets `setUsersWithRoleIds([])` and `setUsersLoading(false)`.
`:276-279` — the gate then reads:

```ts
if (users.length === 0) {
    console.warn("No users created yet");
    return true; // If there are no users created yet, we allow access to every user
}
```

The bootstrap intent ("first admin gets in") is legitimate and matches the
server-side pattern elsewhere in the repo. The defect is that the gate cannot
tell *empty* from *unreadable*. A `permission-denied` on
`__FIRECMS/config/users` — a rules misconfiguration, a rules deploy that hasn't
landed, a renamed path — produces exactly the same `users.length === 0` and
admits **every authenticated user**. `usersError` is set at `:166` and then
never consulted by the gate. The fix is a state distinction, not a rewrite:
`usersError` must deny.

**H2 — the Realtime Database driver silently discards `filter`, `orderBy`,
`order` and `searchString`.**
`packages/firebase/src/hooks/useFirebaseRealTimeDBDelegate.ts:22-53`
destructures all four out of `FetchCollectionProps` and never references them;
only `startAfter` and `limit` reach the query. `listenCollection` (`:56-80`) is
worse — it destructures only `path` and `onUpdate` and reads the whole node.
A caller asking for "rows where `status == 'draft'`" gets the entire collection
back, presented as the answer. This is the same class the `logical` field's own
doc comment records as a past REST bug
(`packages/types/src/controllers/data_driver.ts:107-114`): *"the group was
dropped and the read ran unfiltered — returning every row the caller's policies
allowed rather than the ones they asked for."* Mitigating factor: nothing in the
repo instantiates `useFirebaseRTDBDelegate`, and it is undocumented. It is
nonetheless exported from the package barrel and reachable by any consumer.

**H3 — `findAll()` / `iterate()` over a Firestore collection duplicates rows and
then throws.**
`buildRebaseData` pages by offset — `packages/common/src/data/buildRebaseData.ts:165`
computes `driverOffset` and `:203` passes `offset: driverOffset` to
`driver.fetchCollection`. The Firestore driver's `fetchCollection`
(`packages/firebase/src/hooks/useFirestoreDriver.ts:309-337`) does not
destructure `offset` at all — `buildQuery` (`:105-161`) only knows `startAfter`,
which nothing supplies. So every page is page one. `total` comes from a real
`getCountFromServer` (`:551-564`), so `hasMore = offset + rows.length < total`
(`buildRebaseData.ts:225`) stays true, `paginateFind` never terminates, and
`collectAllPages` accumulates duplicates until it trips `maxRows` and throws
`RebasePaginationError` (`packages/common/src/data/paginate.ts:291-298`) — an
error whose message ("matched more than N rows") describes a condition that did
not occur. Not admin-visible: `useDataTableController` pages by growing `limit`
with no offset (`packages/app/src/components/common/useDataTableController.tsx:268`).
Fully SDK-visible.

**H4 — a self-comparison makes the role-refresh path dead.**
`packages/firebase/src/hooks/useFirebaseAuthController.ts:79-86`:

```ts
const updateRoles = useCallback(async (user: User | null) => {
    if (defineRolesFor && user) {
        const userRoles = await defineRolesFor(user);
        if (!equal(userRoles, userRoles)) {   // ← always false
            setUserRoles(userRoles);
        }
    }
}, [defineRolesFor, userRoles]);
```

The local `const userRoles` at `:81` shadows the state `userRoles` from `:56`,
so the guard compares the fresh value to itself and can never be true.
`setUserRoles` is unreachable from here, which makes the effect at `:88-92`
(`updateRoles(loggedUser)`) a no-op. Roles are only ever applied through
`updateUser` (`:69-71`), i.e. on an auth-state change — a later `defineRolesFor`
result never lands.

### MEDIUM

**M1 — class 21, systemic: six `DataDriver` extension points that nothing
reads.** `isFilterCombinationValid`, `initTextSearch`, `needsInitTextSearch`,
`currentTime`, `delegateToCMSModel` and `cmsToDelegateModel` are declared on the
SPI (`packages/types/src/controllers/data_driver.ts:341-372`). A repo-wide grep
over `packages/*/src`, `app`, `saas`, `website`, `examples` and `e2e` finds
**zero call sites** for any of them. `buildRebaseData` — the only consumer of a
driver — touches `fetchCollection`, `count`, `fetchOne`, `save`, `saveMany`,
`delete`, `updateMany`, `deleteMany`, `listenCollection`, `listenOne` and
`restFetchService`, and nothing else. Consequences specific to this package:

- `isFilterCombinationValid` is implemented three times (this package twice,
  `client-postgres` once) and called never. Its signature has also drifted:
  `DataDriver` declares it as `Omit<FilterCombinationValidProps, "collection">`
  (`data_driver.ts:347`) while `useFirestoreDriver.ts:566-576` requires
  `collection`. Method-shorthand bivariance lets that pass tsc; at runtime a
  caller obeying the interface would hand `firestoreIndexesBuilder` an
  `undefined` collection.
- `initTextSearch` (`useFirestoreDriver.ts:277-293`) is the entry point for the
  whole search subsystem: `algolia.ts`, `pinecone.ts`,
  `rebase_search_controller.ts` (357 lines of Typesense), and
  `local_text_search_controller.ts`. Roughly 600 lines whose `init` probe never
  runs. Search partly still works — the `useEffect` at `:93-103` builds the
  controller regardless — but the "does this controller support this path"
  negotiation is dead, so an Algolia controller is asked to search paths it does
  not index. `website/src/content/docs/docs/backend/search.md:238` describes this
  machinery as live.
- `delegateToCMSModel`/`cmsToDelegateModel` still carry the pre-rename FireCMS
  name on a shipped public type.

**M2 — `RebaseFirebaseApp` builds the user-management layer and throws it away.**
`packages/firebase/src/components/RebaseFirebaseApp.tsx:184-187` assigns
`const defaultUserManagement = useBuildUserManagement({...})` and never
references it again. Every product surface that hook produces — `accessGate`,
`defineRolesFor`, `users`, `roles`, `saveUser`, `deleteUser`, `isAdmin` — is
unreachable. But the hook is not inert: it opens two Firestore listeners on
`__FIRECMS/config/users` and `__FIRECMS/config/roles` on every mount
(`useBuildUserManagement.tsx:110,147`) and calls `authController.setUserRoles`
(`:316`). So every `RebaseFirebaseApp` install pays for two subscriptions to
paths it probably has no rules for, produces console errors, and gets no feature.
Recorded in `tooling/scripts/unused-locals-baseline.json` as
`RebaseFirebaseApp.tsx::defaultUserManagement`.

**M3 — App Check is initialised but never enforced.** Same file, `:124-131`
destructures `{ loading, appCheckVerified, error }` from `useAppCheck`; `:202`
uses only `loading`. A failed attestation (`appCheckVerified === false`) renders
the app normally, and `error` is never surfaced. Firebase still enforces App
Check server-side, so this is not an authorization hole — but a `appCheckOptions`
prop that visibly does nothing is a false affordance. Both locals are banked in
`unused-locals-baseline.json`.

**M4 — user records are written by email and compared by uid, so every access
check fires a write that can never satisfy its own condition.**
`useBuildUserManagement.tsx:206-211` saves with `id: email`. `rowsToUsers`
(`:350-361`) reconstructs `uid` from the document id — so for any user this hook
wrote, `mgmtUser.uid` *is* the email. `:284` then tests
`mgmtUser.uid !== user.uid` against the real Firebase uid, which is permanently
true, so `:290` calls `saveUser` on every gate evaluation, writing `uid: user.uid`
into a field `rowsToUsers` discards on the next read. A self-perpetuating write
loop against Firestore.

**M5 — `logical` filter groups are dropped by the Firestore driver.**
`buildRebaseData.ts:205,222` passes `params.logical` to `fetchCollection` and
`count`; `useFirestoreDriver.ts:309-318` and `:551-557` do not destructure it.
An `or(...)` group therefore widens rather than narrows the result set. The
capability record does not exempt it — `FIREBASE_CAPABILITIES` restricts only the
LIKE family (`data_source.ts:234-235`).

**M6 — the signed-URL cache never caches, and the storage source has a new
identity every render.** `useFirebaseStorageSource.ts:30` declares
`const urlsCache: Record<string, DownloadConfig> = {}` in the hook body, not a
ref, and `:31` returns a fresh object literal. Every render discards the cache,
so `getSignedUrl` issues `getDownloadURL` + `getMetadata` for every image on
every render, and the unstable identity propagates into
`useFirebaseAccessGate`'s dependency array.

**M7 — the access gate can be invoked many times concurrently for one login.**
`useFirebaseAccessGate.tsx:106-125` guards on `checkedUserRef`, but assigns it at
`:125`, *after* the `await`. Its `checkAccess` callback depends on `data`
(`:134`), and `RebaseFirebaseApp` passes a freshly-built
`buildRebaseData(firestoreDelegate)` on every render (`:170` — and again at
`:195`, two independent instances). The effect at `:136-138` therefore re-fires
on each render while the first `accessGate` promise is still pending, running the
user's gate callback — which typically hits Firestore or a token endpoint — N
times per login.

**M8 — `localSearchControllerBuilder.init` returns a promise that never
settles.** `local_text_search_controller.ts:45-73`: the `new Promise` executor
does all its work inside `if (collectionProp)`, with no `else`. Called without a
collection, neither `resolve` nor `reject` ever runs, and the `await` at
`useFirestoreDriver.ts:288` hangs forever. Latent today only because nothing
calls `initTextSearch` (see M1).

**M9 — RTDB `checkUniqueField` reports false collisions.**
`useFirebaseRealTimeDBDelegate.ts:165-186` queries with `startAt(value)`, which
is `>=`, not equality, then requires the matched key to equal `id`. Any new value
that sorts at or below an existing row is reported as non-unique. The code
comments itself as a "Simplified example" — it is shipped as a driver method.

**M10 — RTDB reference conversion reads a field that does not exist.**
`useFirebaseRealTimeDBDelegate.ts:250-252` narrows on `isEntityReference()` and
then reads `entityRef.slug`. `EntityReference`
(`packages/types/src/types/entities.ts:88-127`) has `id`, `path`, `driver`,
`databaseId` — no `slug`. The path built is `undefined/<id>`, and the value
handed to `set()` is a `DatabaseReference` object, which RTDB cannot store.

**M11 — the package README documents five exports that do not exist.**
`packages/firebase/README.md` "Key Exports" lists
`buildAlgoliaSearchController` (real name: `performAlgoliaTextSearch`),
`buildTextSearchController` (real: `buildExternalSearchController`),
`buildLocalTextSearchController` (real: `localSearchControllerBuilder`),
`useFirebaseRealTimeDBDelegate` (real: `useFirebaseRTDBDelegate` — the *file* has
that name, the function does not), and `buildCollectionsFromFirestore`, which has
no counterpart at all. `tooling/scripts/docs-verify/sdk-exports.mjs` builds the real
export set for this package (`:35`) but is used to police website docs, not
package READMEs — so this drifted unchecked.

**M12 — the `typesense` peer range excludes the version the code targets.**
`package.json` declares `"typesense": "^1.8.0"` as an optional peer while the
devDependency is `^3.0.6`, and `rebase_search_controller.ts:149-163` is written
and type-checked against the 3.x client shape. A consumer who satisfies the
declared peer installs an API this code does not target.

### LOW

- **L1 — a FireCMS-era dead host survives a sweep that fixed its sibling.**
  `packages/firebase/src/utils/pinecone.ts:5` still defaults to
  `https://api.rebase.pro`. `packages/plugin-ai/src/api.ts:11-17` documents that
  exact host as *"a FireCMS-era host that resolves but serves nothing — every
  path 404s"* and moved off it. `packages/cms/src/collection_editor/api/generateCollectionApi.ts:51`
  is a third occurrence. Additionally `pinecone.ts:35` sends a Firebase ID token
  as `Authorization: Basic ${firebaseToken}` — the wrong scheme, and the same
  "hand a live credential to a third party that cannot verify it" shape
  `plugin-ai/src/api.ts:20-32` was rewritten to eliminate.
- **L2 — FireCMS branding in shipped defaults and errors.**
  `useBuildUserManagement.tsx:76-77` defaults to `__FIRECMS/config/users` and
  `__FIRECMS/config/roles`; `:36` says "the FireCMS users"; `:82` throws an error
  containing `https://firecms.co/docs/pro/migrating_from_v3_beta` and a version
  reference (`3.0.0-beta.11`) from a different product's numbering.
- **L3 — placeholder debug logging in the published bundle.**
  `useFirestoreDriver.ts:453,461` — `console.debug("1", {...})` and
  `console.debug("2", {...})` around the save path. Present verbatim in
  `dist/index.es.js:1165,1172`.
- **L4 — `getFirestoreDataInPath` ignores its own `limit` and mutates its
  argument.** `utils/database.ts:11` takes `limit`, honours it only on the
  no-parent branch (`:14`), and hardcodes `limitClause(5)` on the recursive
  branch (`:27,:31`). `:22` does `allPaths.push(path)` where `allPaths` is the
  caller's `parentPaths` array, not a copy.
- **L5 — capability record contradicts the driver on vectors.**
  `FIREBASE_CAPABILITIES.supportsVectors: false`
  (`packages/types/src/types/data_source.ts:231`) while the driver round-trips
  Firestore `VectorValue` in both directions (`useFirestoreDriver.ts:686-689`,
  `:744-745`) and has two passing-if-they-ran tests for it
  (`test/firestore.test.ts:40-73`).
- **L6 — `RebaseSearchControllerOptions` docs contradict the code.**
  `rebase_search_controller.ts:27-28` says `extensionInstanceId` "Defaults to
  `rebase-search`"; `:96` defaults it to `"typesense-search"`. `region` is typed
  required (`:24`) but `:95` supplies a `"us-central1"` fallback.
- **L7 — storage upload edge cases.** `useFirebaseStorageSource.ts:114` returns
  `storageUrl: s3://<bucket>/<path>` for a Firebase/GCS object (`gs://` is the
  correct scheme; `getSignedUrl` at `:147` parses both, so it round-trips
  internally but misleads any other reader). `:59-67` cancels an upload after 5s
  without a progress event and reports it as "likely a CORS configuration issue",
  which will misdiagnose a slow connection.
- **L8 — dead build/tsconfig configuration.** `vite.config.ts:50-52` aliases
  `@rebasepro/plugin-ai`, `@rebasepro/inference` and `@rebasepro/studio`;
  `tsconfig.json` maps `@rebasepro/forms`, `plugin-ai` and `inference`. None of
  the six is imported anywhere in `src/`, and none is a declared dependency.
- **L9 — unused import.** `utils/collections_firestore.ts:1` imports
  `deleteField` and never uses it.
- **L10 — `website` declares a dependency it does not use.**
  `website/package.json:29` has `"@rebasepro/firebase": "workspace:^"`; no file
  under `website/` imports it (`website/src/utils/firebase.ts` uses the raw
  `firebase/app` + `firebase/firestore` SDK).
- **L11 — the example ships a third party's live project.**
  `examples/firebase/src/App.tsx:13-22` and
  `examples/firebase/src/firebase_config.ts:10-19` both hardcode the FireCMS demo
  project (`firecms-demo-27150`, `demo.firecms.co`) — two copies of the same
  config, only one of which is used. `examples/firebase/package.json` deploy
  script targets `hosting:rebase-demo-27150`, a site alias that does not match
  that project id. Firebase web API keys are not secrets, so this is a lineage
  and correctness issue rather than a leak. `App.tsx:37` also computes
  `userIsAdmin` and discards it.
- **L12 — `Role.isAdmin` is declared and never read.**
  `useBuildUserManagement.tsx:18` declares it; `:308` derives admin status from
  the string id instead (`userRoles.some(r => r === "admin")`).

---

## Checked and clean

- **Typecheck.** `pnpm typecheck`'s first program includes
  `packages/firebase/src` and passes with zero errors. The package is *not*
  excluded from any type gate.
- **Undeclared runtime dependencies — fixed and staying fixed.** The
  CHANGELOG-recorded defect (seven `@firebase/*` subpackage imports resolvable
  only under hoisting) is gone: every runtime import in `src/` now uses the
  `firebase/*` umbrella entry points covered by the peer dependency. Verified by
  enumerating all bare specifiers in `src/` and by grepping the built
  `dist/index.es.js` externals — the full external set is `@rebasepro/{admin,
  app, common, types, ui, utils}`, `fast-equals`, `firebase/{app,app-check,auth,
  database,firestore,functions,storage}`, `fuse.js`, `react`, `react-router`, and
  every one of those is declared. `pnpm check:deps` gates this
  (`verify.yml:125`). The one remaining `@firebase/firestore` import is in
  `test/firestore.test.ts:2-3`, which the guard deliberately skips and which
  never ships.
- **The `firebase` SDK is not forced into consumers' installs.** It is a
  `peerDependency`, not a dependency, and appears in `dependencies` only in
  `examples/firebase` and `website` (the latter for its own analytics use, not
  via this package).
- **Bundling.** Despite `vite.config.ts` aliasing several `@rebasepro/*`
  packages to source, Rollup's `external` predicate is evaluated on the
  unresolved specifier, so nothing is inlined — confirmed against the built
  bundle. No dual-module-instance hazard from this package.
- **`RebaseFirebaseAppProps` has no dead props.** All 23 declared props plus
  both `ComponentsRegistry` members are destructured and threaded by
  `RebaseFirebaseApp`. (The two *results* thrown away are M2/M3, not props.)
- **CI coverage.** `verify.yml` gates typecheck (`:58`), `check:deps` (`:125`),
  `check:hooks` (`:147`), `check:test-scripts` (`:163`), the build (`:198`),
  `check:api-surface` (`:209`) and `check:examples` (`:218`). The package is in
  all of them.
- **Known gaps are already recorded rather than invisible.** The 17
  `exhaustive-deps` findings in this package are banked in
  `tooling/scripts/hooks-baseline.json`; `defaultUserManagement`, `appCheckVerified` and
  `error` are banked in `tooling/scripts/unused-locals-baseline.json`; and the missing
  test runner is an explicit, justified allow-list entry in
  `tooling/scripts/check-test-scripts.mjs:39-43`, whose header documents the exact
  consequence ("28 source files shipped to npm at 0.13.0 with a test directory
  that looks like coverage and is not"). I found nothing in those three
  categories that was not already banked.
- **`firestoreToRebaseModel` / `rebaseToFirestoreModel`.** The rename away from
  the `CMSModel` names landed cleanly here, and the conversion pair is the one
  genuinely well-tested part of the package — timestamps, arrays, GeoPoints,
  `EntityReference`↔`DocumentReference`, vectors and `deleteField` sentinels all
  round-trip, and the vector test carries a comment explaining the false-pass it
  was written to close. (The tests just never run — see above.)
- **The marketing site does not overpromise Firebase support.** It sells Rebase
  as the migration *target*, not a Firebase-compatible backend.

---

## Open questions

1. **Is `useFirebaseRTDBDelegate` intended to exist at all?** It is exported from
   the barrel, used by nothing, documented nowhere except under a name it does
   not have, declares `key: "firebase_rtdb"` which no capability record matches
   (so `getDataSourceCapabilities` silently returns `DEFAULT_CAPABILITIES`,
   `data_source.ts:299-302`), and carries H2, M9 and M10. If it is not a
   supported surface, deleting the file removes three findings at once.
2. **Should `initTextSearch` and `isFilterCombinationValid` be wired or
   removed?** They are the last two Firestore-shaped hooks in a `DataDriver` SPI
   that has otherwise gone engine-agnostic. Either `buildRebaseData` should call
   them (which would also make M8's dangling promise reachable) or they should
   leave `DataDriver` and become Firestore-internal. Leaving them declared-and-
   uncalled is what makes the search stack look supported.
3. **Was `defaultUserManagement` meant to be passed to `useFirebaseAccessGate`
   and `useFirebaseAuthController`?** The pieces fit exactly — `accessGate` and
   `defineRolesFor` are the two props those hooks want and neither receives. If
   the wiring was dropped in the FireCMS→Rebase port, H1 becomes live rather than
   latent, which changes its priority.
4. **Does anyone actually consume this package?** npm download counts would
   settle whether the deprecation path needs a migration note or can be a
   one-line notice. I did not fetch them.
5. **Should `examples/firebase` keep pointing at `firecms-demo-27150`?** It is
   another project's Firebase instance; if it ever goes away, a CI-gated example
   starts failing for reasons unrelated to this repo.

---

## Recommendation

**Keep and mark deprecated.** Not "keep and fix", and not "remove".

*Why not remove.* Three blockers, none insurmountable but all real: it is
published with a stable `latest` at 0.13.0 and has real download surface;
`firestore` is a declared engine in `@rebasepro/types` with a capability record
and a `FirebaseCollectionConfig` type that other code branches on, so removing
the package leaves a documented engine with no driver; and `examples/firebase`
plus the CI gates that cover it would have to go with it. Removal is a coherent
1.0 decision, but it is a coordinated change across `types`, `examples`, the
README, the agent skill and the release script — not a delete.

*Why not "keep and fix".* Fixing it properly means wiring `initTextSearch` and
`isFilterCombinationValid` into `buildRebaseData`, threading `collection` (and
therefore `databaseId`) through every driver call, implementing `offset` and
`logical` in the Firestore driver, and standing up a test runner. That is a
Postgres-shaped investment in a Firestore adapter for a product that markets
itself as the alternative to Firestore.

*What deprecation requires, concretely, before the notice goes out:*

1. **H1 must be fixed regardless of deprecation.** A published, advertised access
   gate that admits everyone when the users collection errors is not something to
   leave behind a deprecation notice. One condition: `usersError` denies.
2. **H4 is a one-character-class fix** (`equal(userRoles, newRoles)` with the
   shadow renamed) and removes a silently dead code path.
3. **Decide on the RTDB delegate (open question 1).** Deleting it is the cheapest
   resolution of H2/M9/M10.
4. **Correct the README's five phantom exports (M11)** — a deprecated package
   whose docs name functions that do not exist wastes the time of exactly the
   people trying to migrate off it.
5. **Add the deprecation to the places that currently promise support:**
   `README.md:258`, `tooling/rebase-agent-skills/skills/rebase-basics/SKILL.md:135`, and
   `packages/firebase/README.md`. The agent skill matters most — it is the one
   that will actively route work here.
6. **Drop the unused `@rebasepro/firebase` dependency from `website`** (L10) and
   the dead aliases from `vite.config.ts`/`tsconfig.json` (L8), so the package's
   remaining reverse dependencies are an honest list.

The cheap wins that need no decision: L1 (the `api.rebase.pro` sweep miss —
`pinecone.ts` and `generateCollectionApi.ts` are siblings of a fix already
landed in `plugin-ai`), L3 (the `"1"`/`"2"` debug logs in the published bundle),
and L9.
