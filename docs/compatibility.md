# Compatibility

What Rebase promises across versions, and what it does not.

This is the document to read before changing anything a deployed project or a
running Rebase Cloud tenant already depends on. It is also the honest answer to
"if I build on Rebase today, what breaks under me later?"

## What "beta" means here

Rebase is in public beta. Most projects use that word to mean "anything may
break", which tells a reader nothing they can plan around, so here is the line
this project actually draws:

> **The API you write against can change in a minor, with a changelog entry.
> Your data cannot break quietly.**

The first half is ordinary `0.x` behaviour and is described below. The second
half is the part worth checking, because it is a claim about mechanisms rather
than intentions: the versioned contracts in the next section are each stamped
into an artifact or a database, each is checked at boot or at intake, and each
**fails loudly and specifically** rather than degrading. A schema push that
would drop a column is refused by a destructive gate
(`packages/server-postgres/test/e2e/db-push-safety.test.ts`), and the upgrade
path itself is a test: `upgrade-e2e.test.ts` restores databases as older
releases left them, runs the current migration path over each one, and asserts
the rows survive — not merely that the boot did.

What beta does mean: features are still missing, some subsystems are newer than
others, and the shape of a rough edge is that something is absent or awkward,
not that it silently corrupts something. Which subsystems are which is published
and dated rather than left to be discovered — the table below is that
publication.

## Readiness by subsystem

**Dated 2 September 2026, against 0.17.3.** Re-read it at each minor; a rating
that has not moved in three releases is either settled or forgotten, and this
note is here so the difference gets checked.

The three ratings mean:

- **Stable** — the shape is settled and covered by a gate in CI. It can still
  gain features; it will not be redesigned under you inside 0.x, and a change to
  it that would break you is announced in the changelog.
- **Beta** — it works and is used in production, and something about it is known
  to be rough: a limit you can reach, an edge that is awkward, a design decision
  not yet made. The rough part is named in the notes, because "beta" on its own
  tells you nothing you can plan around.
- **Experimental** — shipped so it can be used and reported on. Expect to hit
  the parts nobody has.

| Subsystem | Rating | What the rating rests on |
|---|---|---|
| REST API + generated SDK | Stable | The wire contract is versioned and gated; `client-sdk-e2e` drives register → sign-in → RLS-scoped reads → refresh → storage → realtime end to end |
| Auth — email/password, OAuth, OIDC, magic link, one-time code | Stable | Twelve OAuth providers ship. The auth schema is a versioned contract, stamped and checked at boot |
| Auth — MFA (TOTP) | Beta | Enrolment, verification and recovery work and are tested. Key rotation is implemented for the encryption key; there is no admin surface for resetting a locked-out user's factor |
| Row-level security | Stable | The wedge of the product. `pnpm rls:check` audits a live database against fourteen checks, and the RLS e2e suite runs on every push |
| Storage | Stable | Local, S3 and GCS. Default-deny in production since 0.17.0, and the scaffold ships an authorize hook |
| Realtime | **Beta** | Subscriptions are matched by collection path only, so N subscribers on one collection cost N RLS-scoped refetches per write. That caps a deployment at low hundreds of concurrent subscribers. Correct at any scale; expensive past that one |
| Vector search (pgvector) | Beta | Exact search is stable. ANN indexes are not yet declarable, so large collections scan |
| Offline sync | Beta | Mutations carry idempotency keys the server honours, and the data-loss defects found in the July audit are fixed. The conflict model is last-write-wins with no per-field merge |
| Entity history | Stable | Snapshot-based, gated by its own suite |
| Functions and crons | Stable | The portable entry point (`@rebasepro/server/functions`) is a versioned contract with its own API-surface section |
| MCP server + agent skills | Beta | Thirty-odd tools, bearer auth per project, destructive tools refuse non-local targets unless opted in. stdio transport only — there is no remote/HTTP transport yet |
| Studio (SQL, schema, RLS, API explorer) | Beta | Used daily against real projects. Branching is present in the OSS package and deliberately not exposed in Rebase Cloud, because moving a running deployment onto a branch has no story yet |
| CMS + admin panel | Beta | Complete for CRUD, relations, storage fields and roles. **The data table has no grid semantics** — no `role`, no `aria-rowindex`, `tabIndex` stripped — so keyboard and screen-reader users cannot operate the main view. No drafts, no per-locale content, no block rich-text |
| PGlite managed dev database | Beta | Zero-setup `rebase dev` with no Docker. One session at a time, so requests serialize and concurrency cannot be reproduced against it; Atlas-backed commands (`db push`, `generate`, `migrate`) do not work there and say so |
| Helm chart | Beta | Renders the split-process topology and is published to the OCI registry at each release. The default remains a single container |
| `@rebasepro/server-mongo` | **Experimental** | A working driver with change-stream realtime and snapshot history. **No row-level security** — the whole isolation model above does not apply to it — and no relations |
| `@rebasepro/firebase` | Experimental | Runs the admin panel and SDK against Firestore. No RLS, no SQL surface; the Postgres feature set does not carry over |
| Rebase Cloud | **Private beta** | Live, running real tenants, opened in batches. Not self-serve |

Two entries above are the honest cost of publishing this table at all: the
realtime refetch and the data table's accessibility are open defects, not
roadmap items, and both are listed rather than left for a reader to discover.

This table is what exists. What does not yet is on the
[roadmap](https://rebase.pro/roadmap), one entry per GitHub issue, with the
subset required for 1.0 marked.

## The 0.x promise

Rebase is `0.x` — 0.17 at the time of writing. This section is written to hold
for every 0.x release rather than for one of them, so it does not go stale on
each cut. **Breaking changes to the authored TypeScript API are still allowed in
a minor**, and the changelog is where they are announced. What is
*not* allowed to break silently is the set of versioned contracts below: each
one is stamped into an artifact or a database, each is checked at boot or at
intake, and each fails **loudly and specifically** rather than degrading.

That distinction is the whole promise. A renamed export costs you a compile
error and five minutes. A bundle that boots against the wrong runtime and serves
subtly wrong data costs you an incident, and the contracts exist so that the
second category cannot happen quietly.

Rebase Cloud consumes exactly these contracts and nothing else. Anything not
listed here is an implementation detail the platform does not depend on.

## The versioned contracts

The values below are read from source; treat the file references as the truth
and this table as the map.

```bash
grep -rn "BUNDLE_FORMAT_VERSION =\|RUNTIME_CONTRACT_VERSION =" packages/types/src/types/project_manifest.ts
grep -n "AUTH_SCHEMA_VERSION =" packages/server-postgres/src/auth/schema-version.ts
```

| # | Contract | Declared in | Checked in | Compatibility direction |
|---|---|---|---|---|
| 1 | `rebase` range in `rebase.json` | the user's project | CLI at build | project states which runtimes it accepts |
| 2 | `BUNDLE_FORMAT_VERSION` | `packages/types/src/types/project_manifest.ts` | `packages/server/src/boot/bundle.ts` | **backward compatible** — new runtime reads old bundles |
| 3 | `RUNTIME_CONTRACT_VERSION` | same file | same file | **exact match, both directions** |
| 4 | `AUTH_SCHEMA_VERSION` | `packages/server-postgres/src/auth/schema-version.ts` | at boot, against `rebase.schema_meta` | **forward only** — new runtime migrates old databases |
| 5 | `manifest.schemaVersion` | emitted by `rebase build` | sent by the SDK as `x-rebase-schema` | advisory — identifies which schema a client was built against |
| 6 | Derived database identifiers | `contracts/derived-names.txt` | `pnpm check:derived-names` | **frozen** — a name a release emitted is never re-derived |

### 1 — `rebase` in `rebase.json`

A semver range, read like `engines` in a `package.json`: which runtime versions
this project accepts. Named `rebase` rather than `runtime` deliberately, because
`runtime` already means *who owns the process* (`managed` | `custom`) on an app.

### 2 — `BUNDLE_FORMAT_VERSION` (currently 2)

The on-disk layout of a built bundle. A runtime accepts any bundle whose format
is **less than or equal to** its own, which is what lets the managed tier move a
tenant onto a new image without anyone rebuilding their project.

- **1** — `mode: "cms" | "baas" | "static"`, `entry.static` a single directory,
  `entry.admin` for a bundled admin.
- **2** — `kind: "backend" | "static"`, `entry.static` a list, `entry.admin`
  removed. Format 1 is still read, via `upgradeLegacyManifest`.

**Bump it when** the layout changes such that an older runtime would misread a
newer bundle. The bump is what converts "boots and serves nothing" into a
refusal to start.

### 3 — `RUNTIME_CONTRACT_VERSION` (currently 1)

The bundle↔runtime contract major. Distinct from the `@rebasepro/server` package
version, which may release any number of minors and patches while this stays put.

**Read this before touching it.** The check is `!==`, not `>`:

> a bundle targeting contract *N* runs **only** on a runtime implementing *N*

so bumping it invalidates **every bundle ever built**, all at once, until each
is rebuilt. That is the intended severity — it is the "nothing old can run here"
lever — but it means a bump is a fleet-wide migration, not a release note. For
the managed tier it must be sequenced with a rebuild of every tenant's bundle.

If a change is *additive* and old bundles would still be correct, it wants
`BUNDLE_FORMAT_VERSION` (or nothing at all), not this.

### 4 — `AUTH_SCHEMA_VERSION` (currently 2)

Stamped into `rebase.schema_meta` and compared at boot. A runtime **refuses to
start** against a database migrated by a newer framework version, rather than
operating on a shape it does not understand — during a rolling deploy that is
the difference between half the fleet erroring and half the fleet corrupting.

Forward migration is automatic: `ensureAuthTablesExist` brings an older database
up. Note that this migration block is deliberately wrapped in `try/catch` and
logs rather than throwing — a limping boot beats a crash loop — so **"it
booted" proves nothing**. Every assertion in the upgrade suite reads the
catalogue or the data instead.

**Bump it when** a migration must not be skipped by an older runtime. Do not
bump for an additive, back-compatible column; there is a worked example of that
judgement in `packages/server-postgres/src/auth/ensure-tables.ts`.

### 5 — `manifest.schemaVersion`

A hash of the compiled collection definitions, emitted into the bundle manifest
and echoed by a generated SDK in the `x-rebase-schema` header
(`SCHEMA_VERSION_HEADER`). It exists so the platform can say "this app was built
against an older schema" instead of failing mysteriously at the first request.

It covers **collections only**. A hook or function edit does not change a
client's contract and must not invalidate every generated SDK.

### 6 — Derived database identifiers

Every name this framework works out for itself rather than being told: a foreign
key column, a foreign key constraint, a junction table and its two key columns, an
enum type, a policy name, a `camelCase` property's `snake_case` column.

> **A derived identifier is frozen the moment a release emits it.**

Not "frozen until the next major" — frozen. The reasoning is different from the
other five contracts, and stronger. Those are versioned, so a mismatch can be
*detected* and refused. This one cannot: the name is written into a customer's
database on the day they deploy, and there is no version stamp on a column. Every
database provisioned by every release that ever shipped carries whatever it
derived, and no code in this repository can reach in and rename them all.

0.13 is the worked example. `generateForeignKeyName` learned to singularize
properly — `categorie_id` → `category_id`, `addres_id` → `address_id` — which is
unambiguously the better derivation, and it broke every aged database that had an
irregular plural. Boot-ensure migrated the column, so the data survived; the
project's checked-in `schema.generated.ts` did not, and the boot died on a column
that existed. Three commits, a new seam test, and a permanent entry in the upgrade
notes, in exchange for a nicer-looking column name nobody had asked about.

**If a derivation is genuinely wrong**, it changes for collections created
*afterwards*, behind a naming strategy recorded in the project — never
retroactively, and never as a side effect of improving the function underneath.

**The one legitimate override** is a change that makes the code agree with a name
the database *already has*. The worked example is identifier truncation: Postgres
silently cuts an identifier to 63 bytes, so a longer derived constraint name was
never the name in the catalogue — the derivation was describing an object that
did not exist under that spelling, and boot-ensure re-issued `ADD CONSTRAINT` on
every single boot because its comparison could never match. Truncating at
construction changes what this repo *derives* and changes nothing about what any
deployed database *contains*. That is the test to apply: not "is the new name
better", but "does any existing database have to change".
The one thing that is always safe is to *recognise* an old name in order to
migrate it: `legacyForeignKeyName` exists to be detected, never to be generated,
and the baseline pins those detections too. Dropping one silently un-migrates
every database still carrying that spelling.

**The gate.** `tooling/scripts/derived-names.mts` runs a naming-stress fixture — irregular
plurals, an `ss` ending, an acronym, a junction off a plural slug, explicit
overrides, a slug long enough to truncate — through both producers of schema DDL,
and renders every identifier either one names:

```bash
pnpm check:derived-names
```

A changed or removed line fails as a contract break, with the old and new spelling
side by side. A purely additive change also fails, but with "regenerate" — so the
baseline cannot drift underneath anyone.

It also pins that `rebase db push` and the managed runtime's boot-ensure derive
the *same* names, which is a second contract hiding inside the first: they compile
the same collections through different code, and a project pushed once and booted
later must not end up with two schemas.

## What is *not* frozen

Said plainly, so nobody infers a promise that was never made:

- The authored TypeScript API — collection config, `initializeRebaseBackend`
  options, admin props, SDK method names. Breaking changes land in minors and
  are announced in the changelog.
- `@rebasepro/studio`, `@rebasepro/mcp`, `@rebasepro/inference`,
  `@rebasepro/plugin-*` — these move fastest and have the fewest consumers.
- Anything under a package's `src/` that is not re-exported from its barrel.
  `packages/client/src/index.ts` carries a note explaining that its export list
  is curated precisely so an internal export cannot become public by accident.
- The database schema of *your* collections. That is yours; Rebase only owns the
  `rebase` and `auth` schemas.

## The gates that hold these

None of the above is a convention — each has a test that fails when it breaks:

| Gate | What it pins |
|---|---|
| `pnpm verify:corpus` | every bundle shape ever shipped, booted on today's runtime. Fixtures in `fixtures/bundles/` are **hand-authored and frozen** — a fixture the builder regenerates moves whenever the builder moves |
| `pnpm verify:selfhost` | a real bundle built, folded, booted and fetched as a browser would |
| `upgrade-e2e.test.ts` | old database schemas (`schema-snapshots/`) met by the current runtime |
| `e2e/tests/cli-init-e2e.ts` | a scaffolded project installed from **real tarballs**, not workspace links |
| `e2e/tests/client-sdk-e2e.ts` | the end-user path: register → sign in → RLS-scoped reads → refresh → storage → realtime |
| `pnpm check:derived-names` | every column, constraint, junction, enum and policy name the framework derives — and that boot and `db push` derive them identically |
| `pnpm rls:check` | the generated schema's policies |
| `pnpm check:api-surface` | every export, and its members, of the five packages the image supplies — `@rebasepro/server`, `types`, `client`, `common`, `utils` — plus the `@rebasepro/server/functions` entry point, against the six sections of `contracts/server.api.txt`. These are the packages `infra/docker/entrypoint.mjs` symlinks over a deployed bundle's own copies, so removing an export from one is not a compile error for anyone — it is a boot failure across the fleet, during a rollout nobody asked for |
| `pnpm test:gates` | the two gates above, over fixtures. `check:api-surface` spent its whole life unable to see a member disappear from `const rebase` |
| `node tooling/scripts/check-release-bump.mjs` | that the bump level a release ships under matches what the release did to the baselines above — run by `publish.yml` before the changelog is stamped |
| saas CI | the control plane built against this repo's `main`, on its own pushes and nightly |

**Record a bundle fixture and a schema snapshot once per release.** The value of
both corpora is entirely in how far back the oldest one goes, and neither can be
backfilled after the fact.

## Changing a contract

1. Decide which of the six it is. Most changes are none of them — but "none of
   the six" does not mean "uncontroversial". Removing or renaming an export of
   `@rebasepro/server`, or a member of one, is none of the six and is the single
   most dangerous change in the repository, because the code it breaks is already
   built and will not be recompiled. `pnpm check:api-surface` is what holds that
   line; whether it becomes a seventh numbered contract is an open decision
   (`docs/audits/81-compat-policy.md`).
2. Add a fixture or snapshot for the **old** shape first, and watch it pass.
3. Make the change and bump the constant.
4. Confirm the old fixture still passes, or that it now fails *with the message
   a user would need*. Both are valid outcomes; silence is not.
5. For contract 3, plan the rebuild of every deployed bundle before merging.
6. Contract 6 is the exception to steps 3 and 4: there is no constant to bump and
   no version to refuse on, because a column carries no version stamp. The step
   that replaces them is deciding not to make the change — see the section above
   for what the alternative looks like.
