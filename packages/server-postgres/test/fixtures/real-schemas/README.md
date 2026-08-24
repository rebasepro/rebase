# Real-schema fixtures

Catalog metadata captured from real PostgreSQL databases, used by the
introspection tests. Nothing in here is hand-written: every file is the output of
`readSchemaMetadata` — the same function the `rebase schema introspect` CLI calls
— run against a live server.

That is the point. A hand-built fixture only ever proves the code agrees with its
author's idea of what Postgres returns, which is how a generator ends up
confident about column shapes and constraint renderings no server produces. Two
of the bugs this fixture set caught were exactly that: `information_schema`
reporting every partition as a base table, and `array_agg(attname)` arriving as
the string `{a,b}` because node-pg has no parser for an array of `name`.

| fixture | source | what it exercises |
|---|---|---|
| `pagila.json` | [pagila](https://github.com/devrimgunduz/pagila) (schema + data) | partitions, a generated column, a `tsvector`, a Postgres enum type, a `text[]`, two keys to the same table, pure join tables, small code lists |
| `chinook.json` | [chinook-database](https://github.com/lerocha/chinook-database) | a self-referencing key, an association with its own columns and no declared owner, `varchar` bounds |
| `northwind.json` | [northwind_psql](https://github.com/pthom/northwind_psql) | a composite-keyed association carrying price and quantity, two junctions, code lists |
| `openstreetmap.json` | [openstreetmap-website](https://github.com/openstreetmap/openstreetmap-website) `db/structure.sql` | eight enum types — the only schema here that earns a board — 15 owned children, self-referencing keys, `body` columns |
| `musicbrainz.json` | [musicbrainz-server](https://github.com/metabrainz/musicbrainz-server) `admin/sql/`, restricted to 9 tables | foreign key columns named after their target with no `_id` suffix, and primary keys made entirely of them — the shape that produced duplicate property keys |
| `constraint-shapes.json` | `constraint-shapes.sql`, in this directory | every CHECK shape the parser reads, five it must refuse, comments, a unique index, a generated column, an `ON DELETE CASCADE` child |

`constraint-shapes.sql` is the one schema written for the tests rather than found
in the wild — no sample database declares CHECK constraints. It is still captured
from a real server, which is what matters for a parser that reads
`pg_get_constraintdef` output: the server rewrites `CHECK (price > 0)` into
`CHECK ((price > (0)::numeric))`, and `> -50` into `> '-50'::integer`.

## Refreshing

```bash
pnpm tsx tooling/scripts/capture-introspection-fixture.ts <database-url> test/fixtures/real-schemas/<name>.json
```

`musicbrainz.json` is a subset — the full schema is 374 tables and does not
belong in this repository — captured with:

```bash
pnpm tsx tooling/scripts/capture-introspection-fixture.ts <url> test/fixtures/real-schemas/musicbrainz.json public --tables=area,tag,area_tag,area_tag_raw,editor,artist,artist_credit,artist_credit_name,area_type
```

Loading it needs a collation the dump assumes exists:
`CREATE COLLATION musicbrainz (provider = icu, locale = 'und-u-ks-level2', deterministic = false)`,
then `CreateTypes.sql`, `CreateTables.sql`, `CreatePrimaryKeys.sql`,
`CreateFKConstraints.sql` in that order. Foreign keys leaving the subset are
dropped, exactly as keys leaving the schema already are.

The three upstream schemas with an unconditional load are re-captured
automatically by
`test/e2e/introspect-live.test.ts`, which fails if a committed fixture no longer
matches the database it describes. Run it with Docker up, or point it at any
reachable server:

```bash
INTROSPECT_TEST_DATABASE_URL=postgres://user@localhost/postgres pnpm test:e2e
```

Only schema is captured — table, column and constraint names. The one
data-dependent value is the row count used to tell a small code list from an
entity, and it is capped.
