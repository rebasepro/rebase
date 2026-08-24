# Project snapshots — the aged-*project* axis

A sibling to `../schema-snapshots/`, and the distinction between them is the whole
reason this directory exists.

| corpus | records | catches |
|---|---|---|
| `schema-snapshots/` | a database, auth schema only | a migration that mangles an aged **database** |
| `project-snapshots/` | a database **and the artifacts a project keeps beside it** | the two disagreeing after only one was migrated |
| `fixtures/bundles/` (repo root) | built bundles | a runtime that cannot boot an old **bundle** |

## Why a database-only corpus was not enough

0.13 changed a derived foreign-key column name. Boot-ensure renamed the column —
correctly, and the rows came with it. Then `assertRelationsResolve` read the
project's checked-in `backend/src/schema.generated.ts`, which the *previous*
release generated and which still declared the old name, and killed the boot.
Permanently: the rename was already applied, so every restart failed identically,
and the error advised setting the relation to a column that by then existed
nowhere.

Both halves came from the same release. Only one of them was migrated. No
database-only snapshot can express that state, and no hand-written fixture
produces it either — a fixture author writes both sides, and writes them agreeing.
That is precisely why the unit tests on either side of this bug both passed.

## What a snapshot contains

```
v0.13.0/
  schema.sql             the database as that release provisioned it, with rows
  generated-schema.json  table → columns, as that release's codegen declared
  collections.json       the collections that produced both
  manifest.json          the release, its auth schema version, what it seeded
```

`generated-schema.json` is read back from the catalogue rather than by running
codegen: the generated schema *describes* the database a release provisions, so
the catalogue is the answer codegen is trying to produce — and reading it there
means a snapshot cannot inherit a codegen bug that would make the replay agree
with itself for the wrong reason.

`collections.json` is declarative. A relation's `target` is a thunk, which JSON
cannot carry, so the target's **slug** is recorded and the replay rebuilds the
thunk. Recording executable code instead would age into an artifact a later
release cannot load at all — and a snapshot that cannot be loaded is an upgrade
path that stops being tested exactly when it gets interesting.

## Adding one

Once per release, from the repo root:

```bash
pnpm record:project-snapshot
```

It starts its own Postgres, provisions it from the reference project in
`tooling/scripts/derived-names.mts` — the same naming-stress fixture the frozen-names gate
uses — seeds rows, points every foreign key at a real row, and writes the four
files above. No live database of the right vintage required, which is the point:
"record one per release" is a discipline that had already been skipped three
releases running, so the only version worth building is the one nobody has to
remember. `tooling/scripts/release.sh` runs it.

It refuses to overwrite an existing snapshot. A snapshot is a record of what a
release shipped; rewriting it un-tests every upgrade path that ran through it.

**Seed rows are not optional.** A snapshot with empty tables exercises the DDL
half of an upgrade and none of the data half — and the data half is where a rename
that silently became an `ADD COLUMN` shows up, as a column the current code reads
and finds empty while the values sit in the old one. The recorder populates every
relation column for the same reason: a column that was already empty proves
nothing about whether an upgrade preserved it.

## What the replay asserts

`../project-upgrade-e2e.test.ts`, in the order the failures matter:

1. **the upgrade converges** — boot-ensure runs to the end, and a second run has
   nothing left to do. Not a tautology about idempotence: the ensure paths are
   guarded by probes rather than by a ledger, so a guard comparing against a name
   the catalogue stores differently re-issues its statement on every boot forever.
   This caught exactly that — a constraint name past Postgres's 63-byte limit,
   stored truncated, never matching the untruncated name it was compared against;
2. **the rows survive**, per table;
3. **any renamed relation column brought its data**, compared across the rename
   rather than by column name — a renamed column is *supposed* to have a different
   name afterwards, and comparing by name could not express the case;
4. **the tables are still locked** — RLS on, policies present. An upgrade that
   leaves a table readable by every signed-in user is the fail-open case;
5. **a stale generated schema is diagnosed** — the boot either resolves or fails
   naming the generated file and `rebase schema generate`, and never advises
   pinning a column the migration has just moved away from. Following that advice
   is what turned a recoverable state into a broken config.

Requires Docker. Run it with:

```bash
pnpm --filter @rebasepro/server-postgres test:e2e project-upgrade
```
