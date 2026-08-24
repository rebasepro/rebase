# The bundle corpus

Every shape of bundle Rebase has shipped, frozen, and booted against the current
runtime by `tooling/scripts/verify-bundle-corpus.mts`.

```bash
createdb rebase_corpus
pnpm run verify:corpus
```

## Why this exists

The managed tier moves projects onto new runtime images automatically, in waves,
without anyone rebuilding the project. The thing standing behind that promise was
a health gate watching request rates and error rates — which can see a crash loop
and cannot see:

- a bundle that quietly stopped loading its collections,
- a schema version that changed identity under an already-deployed project,
- an old manifest shape that now parses to something subtly different,
- RLS that stopped being applied at boot.

Those are precisely the regressions a fleet-wide auto-upgrade turns into an
outage for everyone at once. `PLATFORM-PLAN-2026-07.md` called this corpus "the
license to auto-roll fleet patches", and until now it did not exist.

## The rules

**Fixtures are frozen. Do not regenerate them.** They are hand-authored rather
than produced by `rebase build`, and that is the whole point: a fixture the
builder regenerates moves whenever the builder moves, which is the one thing a
regression corpus must not do. A bundle here is a historical artifact.

**When a fixture stops working, that is the finding.** It means a bundle already
deployed in that era would stop working too. The fix belongs in the runtime, or
in a deliberate, documented compatibility break — not in the fixture.

**Each fixture owns its own tables.** They share one database, because that is
closer to the truth than a pristine database per bundle: a runtime upgrade always
lands on a database some earlier runtime already wrote to.

## What is in here

| Fixture | Specimen of |
| --- | --- |
| `format1-cms` | bundle format 1 — `mode: "cms"`, a bundled admin at `entry.admin`, `entry.static` absent |
| `format2-backend` | bundle format 2 — `kind: "backend"`, `entry.static` as a list |
| `format2-static` | bundle format 2 — `kind: "static"`, no database at all |

`format1-cms` is the one carrying the most weight. New-bundle-on-old-runtime
is caught for free by the `bundleFormat` gate; **old-bundle-on-new-runtime is
caught by nothing** — a renamed field simply reads as absent and every gate keyed
on it skips in silence. `upgradeLegacyManifest` is what normalises it, and this
fixture is what proves the normalisation still runs.

## Adding one

Record one per release; the value is entirely in how far back the oldest one
goes.

1. Copy the closest existing directory.
2. Change `table` in its collections and in `backend/src/schema.generated.js` so
   the new fixture owns its own tables.
3. Set `schemaVersion` in the manifest to what the CLI computed at build time.
4. Add an entry to `CORPUS` in `tooling/scripts/verify-bundle-corpus.mts`.

A bundle needs both halves of its schema story to work, and the failure modes are
easy to miss:

- `config/collections/*.js` — what the runtime serves. Without these it boots and
  serves nothing.
- `backend/src/schema.generated.js` — what the query layer resolves a collection
  to. It must export `tables`, `enums` and `relations`; the individual `pgTable`
  exports are for drizzle-kit and for humans. **A bundle missing the `tables`
  export boots, answers `/health`, and 500s on the first read.**

## A note on the schema-version check

It recomputes the hash from the bundle's collections rather than trusting
`GET /api/meta/schema-version`. The endpoint returns the manifest's declared
value verbatim whenever a bundle declares one, so comparing the two compares the
manifest to itself — it passed a fixture whose declared version had been
deliberately corrupted to `v1:deadbeef…`. The manifest's value is the CLI's
answer frozen at build time; the recomputation is the runtime's answer now. Those
parting company means every deployed bundle's declared version is wrong and SDK
drift detection has silently stopped meaning anything.
