# Compatibility

What Rebase promises across versions, and what it does not.

This is the document to read before changing anything a deployed project or a
running Rebase Cloud tenant already depends on. It is also the honest answer to
"if I build on 0.13, what breaks under me later?"

## The 0.13 promise

Rebase is `0.x`. **Breaking changes to the authored TypeScript API are still
allowed in a minor**, and the changelog is where they are announced. What is
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

**The gate.** `scripts/derived-names.mts` runs a naming-stress fixture — irregular
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
| saas CI | the control plane built against this repo's `main`, on its own pushes and nightly |

**Record a bundle fixture and a schema snapshot once per release.** The value of
both corpora is entirely in how far back the oldest one goes, and neither can be
backfilled after the fact.

## Changing a contract

1. Decide which of the six it is. Most changes are none of them.
2. Add a fixture or snapshot for the **old** shape first, and watch it pass.
3. Make the change and bump the constant.
4. Confirm the old fixture still passes, or that it now fails *with the message
   a user would need*. Both are valid outcomes; silence is not.
5. For contract 3, plan the rebuild of every deployed bundle before merging.
6. Contract 6 is the exception to steps 3 and 4: there is no constant to bump and
   no version to refuse on, because a column carries no version stamp. The step
   that replaces them is deciding not to make the change — see the section above
   for what the alternative looks like.
