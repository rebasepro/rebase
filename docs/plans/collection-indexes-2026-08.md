# Declarable indexes

Status: **phase 1 landed** on `feat/collection-indexes`. Phases 2–4 specified
below, not built. The naming scheme is **frozen** into
`contracts/derived-names.txt` as of 2026-08-26 — nine index names, all
`[boot,push]`. It cannot be changed without renaming live objects.

## The problem, stated precisely

The collection model had no `indexes` key. The DDL generator emitted index
statements for exactly two things, both of which are structures a *feature*
owns rather than queries a developer wrote: the GIN index behind a `search`
block, and the ANN index behind a `vector` property.

So the only way to have an ordinary index was to write it by hand. And:

> `rebase db push` is declarative. An index on a managed table that is absent
> from `schema.sql` is drift, and Atlas plans `DROP INDEX` for it.

`DROP INDEX` is not in `DESTRUCTIVE_PATTERNS` (`destructive-sql.ts`), so the
auto-approved apply took it silently. Not a hypothetical — measured below.

## What was measured, not assumed

atlas v1.2.3, Postgres 18, scratch databases, real `schema apply` and
`migrate diff`. Databases dropped afterwards.

**Atlas manages every index form natively.** Parsed, planned and applied
straight from `schema.sql`: plain btree; composite with `DESC NULLS LAST`;
partial (`WHERE`); unique; covering (`INCLUDE`); `USING gin`; and an
**expression index** on `lower(email)`.

This corrects the assumption the work started from. Atlas's refusal is about a
function **definition** in the desired-state file — which is why `search`, which
ships helper functions, needed its carve-out. A function **call** inside an
index expression is fine. Indexes therefore need no carve-out, no
`drizzle/indexes.sql`, and no separate apply step, and they inherit migrations,
drift detection and rollback for free.

**The round trip is clean.** Apply the generated DDL, re-plan:
`Schema is synced, no changes to be made`. This is the assertion that catches
drift loops, and it holds for all six forms the phase-1 model emits.

**A definition change is DROP + CREATE**, emitted bare — no `CONCURRENTLY`, and
a window with no index in between. This is what phase 2 exists for.

**A hand-written index is planned for DROP.** Created `handwritten_stock_idx`
directly, re-ran an unchanged push: `-> DROP INDEX "public"."handwritten_stock_idx"`.

**The ownership fix works.** With a deleted declaration *and* a hand-written
index present at once — without the exclude, both are dropped; with the
three-part exclude, only the deleted declaration is.

## The model

Collection-level, because an index over two columns has no single property to
hang on and a partial index has none at all:

```ts
indexes: [
    { on: ["status", { prop: "createdAt", direction: "desc" }],
      reason: "admin list: filter by status, newest first" },
    { on: ["createdAt"], where: { prop: "status", op: "=", value: "published" },
      reason: "public feed is published-only" },
    { on: ["tags"], using: "gin", reason: "tag containment search" }
]
```

Three decisions carry the design:

**`prop` takes a property key, never a column name.** They differ in exactly
the case people index most: a `belongsTo` resolves to its `localKey`, so
`author` becomes `author_id`. A column name would work for most properties and
quietly index nothing for a foreign key.

**`where` is structured, not a SQL string.** A string would be replayed
verbatim by Atlas in a bare scratch database, would be the one place someone
reaches for an extension operator class, could not be checked against the
collection's properties, and could not be fingerprinted without putting its own
text in the index name — so reformatting it would rename a live index.

**`reason` is required, and deliberately not hashed.** An index is the only
thing a config can declare that costs money forever and whose benefit is
invisible from the config. Rewording the justification must not rebuild it.

### The name is a hash of the index's semantics

`<table>_<columns>_ix_<7 hex>`, or `_ux_` when unique.

`CREATE INDEX IF NOT EXISTS` matches on the **name**, not the definition. A
readable name means a changed declaration keeps the old index and reports
success, forever. That bug is already shipped here: `vector-index.ts` leaves
`WITH (m, ef_construction, lists)` out of its name, so retuning an HNSW index
today is a permanent, silent no-op.

Hashing *semantics* rather than rendered SQL means reformatting the generator
never renames anything in the field. `v: 1` in the payload is the only escape
hatch, and it is expensive on purpose: bumping it renames every index in the
field.

### Ownership replaces a scary prompt

`_ix_`/`_ux_` plus seven hex is unreachable by every other namer here —
`_fkey`, `_gin`, `_trgm`, `_pkey`, `_key`, the vector distances, auth's `idx_`
prefix. (`_idx` was rejected as a tail: `users_email_verification_token_idx` is
byte-for-byte what a naive `<table>_<column>_idx` derives on an auth-enabled
`users` collection.)

So `isRebaseIndexName` decides who owns an index, the same arrangement
`isGeneratedPolicyName` uses for policies:

| index | in the plan? | matches the pattern? | outcome |
|---|---|---|---|
| declared | yes | yes | created / kept |
| declaration deleted | no | yes | **dropped**, as intended |
| hand-written, or from introspection | no | no | **excluded — never touched** |

Adding `DROP INDEX` to the destructive list would have been the wrong fix:
once indexes are declarable, removing one from your config *should* remove it
without a scare. What must never be dropped is one Rebase never created.

This also answers the introspection round trip for free: an introspected
database's existing indexes are foreign until someone declares them.

## What phase 1 does not do

Each is its own subsystem, and none is required for the above to be correct:

- **`CONCURRENTLY` and a deferred builder.** A definition change is DROP +
  CREATE holding a lock. Fine on a dev database, not on a large table. Needs a
  builder behind the HTTP listener, on a direct connection with the client
  timer off, aware of `indisvalid` and `pg_stat_progress_create_index`.
- **A size-based push gate.** Prompt above some table size.
- **`doctor` categories** — `missing_index`, `invalid_index`, `unused_index`
  (`idx_scan = 0` + the declared `reason`, which is the one moment anyone can
  decide to delete it).
- **Introspection adoption** — `rebase db index adopt --print`.
- **The drizzle-schema side**, the live schema editor, and the rls-check
  finding for an index whose leading column is not the policy column.

## Freezing it caught a defect

The contract file states the rule: *"The [push,boot] tag is which producer
emits it. Both, or it is a bug… Any OTHER push-only or boot-only line is a
defect."*

The first run rendered all nine index lines as `[push]` only. Boot did not
create declared indexes — so a managed-runtime tenant, which provisions at boot
and never runs `db push`, would have started with none of them and nothing
would have said so. That is precisely the silent absence this feature exists to
remove, reintroduced one layer down.

`planCollectionSchemaEnsure` now emits them, `CONCURRENTLY IF NOT EXISTS`, on
the same terms as the ANN indexes beside it. All nine lines are `[boot,push]`.

Worth stating plainly: nothing about the feature looked wrong, the whole suite
was green, and the round trip through real Atlas was clean. The contract gate
is the only thing that caught it.

## Smaller calls still open, in descending order of how much they matter:

1. **Is `reason` really required?** It is the only field with no SQL behind it,
   and it is the thing that makes `unused_index` actionable later. It also
   makes every declaration three lines instead of two.
2. **Five-key cap on `on`.** Postgres allows 32.
3. **Refusing `gist`/`hash`.** Every interesting gist operator class ships in
   an extension; hash indexes cannot be unique, composite, or ordered.
