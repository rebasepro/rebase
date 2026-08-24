# Schema snapshots — the aged-database axis

Every other suite in this repo starts from a database this code just created. That
is one of the three states a real deployment is in:

| state      | who created the schema         | covered by                        |
|------------|--------------------------------|-----------------------------------|
| **empty**  | this code, zero rows           | `cli-init-e2e` `--empty` axis      |
| **fresh**  | this code, seeded              | every other suite                  |
| **aged**   | an *older release*, then upgraded | **only this directory**         |

The aged state is where the expensive bugs have actually lived: the
`unique_device_session` drop that 500'd every login behind a green `/health`, the
`user_id` → `uid` rename that had to become an expand/contract, the out-of-order
migration that a high-water mark skipped forever. None of them are reachable from
a schema the current code just wrote, because the current code writes the *new*
shape by definition.

Each `.sql` file here is one such starting point: an auth schema exactly as some
earlier era of the framework left it. `upgrade-e2e.test.ts` restores each one into
a throwaway Postgres, runs the *current* `ensureAuthTablesExist` over it, and then
asserts the resulting schema and the auth write path — never merely that the boot
survived.

That last distinction is the whole point. The migration block in
`ensure-tables.ts` is deliberately wrapped in `try { … } catch { logger.warn() }`
and continues, because on balance a limping boot beats a crash loop. The cost is
that a migration which throws is *invisible* to any test that checks only for an
exception. Assert the catalogue, or assert nothing.

## Adding a snapshot

Two kinds, both belong here.

**Recorded** — the normal case, one per release. Run:

```bash
node --import tsx tooling/scripts/record-schema-snapshot.mts
```

It provisions an empty database with the code at your current checkout, stamps
the file with the auth schema version and package version it came from, and
writes `packages/server-postgres/test/e2e/schema-snapshots/recorded-<version>.sql`.
Do this on the release commit, *before* you start the next migration — a snapshot
recorded after the migration records the shape you were trying to test against.

**Hand-written** — for an era that predates snapshotting, reconstructed from the
migration that retired it. The two files starting `era-` are these. Reconstruct
from the `ALTER`/`DROP` statements in `ensure-tables.ts` plus the history comment
in `auth/schema-version.ts`, and seed rows: an empty legacy table exercises the
DDL but not the back-fill, and the back-fill is the half that silently signs
everyone out.

## Rules

- **Seed rows.** A snapshot with no data cannot catch a back-fill that drops it.
  Every file here inserts at least one user and one live refresh token.
- **Never edit a snapshot to make a test pass.** It is a record of what a real
  database looks like; if the migration cannot handle it, the migration is wrong.
  Editing it here re-writes history and un-tests the upgrade.
- **Never delete one** because "nobody runs that version any more". Deployments in
  the wild upgrade from further back than you think, and the file costs a few
  seconds of CI.
- Snapshots are restored into a schema-only database. No `CREATE DATABASE`, no
  `\connect`, no ownership or `GRANT` lines that assume roles this container has.
