---
title: Live schema editing
description: Create and alter collections against a running backend — committed to your repository first, then applied.
---

The schema editor in the admin panel rewrites your collection source. That works
on your machine and nowhere else: a deployed server's files are rebuilt from
your repository on every deploy, so an edit made there would be discarded on the
next one.

Live schema editing is the answer to that. It **commits the change to your
repository, then applies the DDL** — so the edit survives the next deploy,
because the deploy is built from it.

```
POST /api/schema/plan     what would happen, without doing it
POST /api/schema/apply    commit, then apply
```

Both are admin-gated, like every other admin surface.

## Plan before you apply

`/plan` has no side effects. Post the collection as it should end up, and it
tells you what the change means:

```bash
curl -X POST https://your-app/api/schema/plan \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"collectionId":"posts","collection":{}}'
```

```json
{
  "applicable": true,
  "verdict": "safe",
  "changes": [
    { "kind": "add-property", "verdict": "safe", "collection": "posts",
      "property": "subtitle", "detail": "New optional property subtitle …" }
  ],
  "statements": ["ALTER TABLE \"public\".\"posts\" ADD COLUMN IF NOT EXISTS \"subtitle\" TEXT;"],
  "files": ["backend/src/schema.generated.ts", "drizzle/schema.sql"]
}
```

This is not a convenience. Two of the three verdicts are refusals, and one of
them is a refusal you would otherwise only discover by pressing the button on a
live database.

## The three verdicts

| Verdict | Meaning |
|---|---|
| `safe` | The boot-time ensure path expresses it and the result matches your configuration. Applied. |
| `diverges` | It applies *in part*, leaving a database that does not match your configuration — and nothing reports it. Refused. |
| `needs-migration` | The ensure path cannot express it at all. Refused. |

`diverges` is the one worth understanding, because these changes look like they
worked:

- **A required property added to an existing collection** arrives **nullable**.
  `NOT NULL` is checked against rows that are already there, so it is withheld on
  a table that already exists. Your config says required; the database does not
  enforce it.
- **A value added to an existing enum** never lands. An enum type that already
  exists is skipped entirely, and the first row using the new value is rejected.
- **Relaxing a required property** leaves the old `NOT NULL` in place. Writes
  omitting it still fail.

`needs-migration` covers everything the ensure path cannot do: dropping a
collection or a property, changing a type, renaming a column, changing a primary
key, removing an enum value. Each refusal names the change and what to do
instead.

## What gets committed

Not just the collection file. A schema change touches several generated
artifacts, and a stale one breaks the next deploy:

- `config/collections/<name>.ts` — the collection itself
- `backend/src/schema.generated.ts` — the Drizzle schema
- `drizzle/schema.sql`, `drizzle/policies.sql`, `drizzle/search.sql`

The commit message describes the change rather than announcing one, and is
attributed to the admin who made it. A schema change with an author and a diff
in your project's history is something neither Firebase nor Supabase gives you —
their table edits are invisible to your repository.

## Commit first, then apply

The order matters and it is not arbitrary.

If the DDL ran first and the commit failed, your database would have a column
your repository does not describe. The ensure path never drops anything, so the
next deploy would neither remove it nor mention it — an invisible column, absent
from your collections, until somebody went looking.

Committing first fails the other way: the repository describes something the
database does not have yet. That is the ordinary state of every project between
an edit and a deploy, and boot reconciles it on the next start.

So a failed apply is **not an error**. The response says so:

```json
{
  "applied": false,
  "applyError": "connection refused",
  "committed": { "sha": "1a2b3c4de", "branch": "main" },
  "summary": "Committed 1a2b3c4de on main, but the database was not changed. The change will be applied on the next boot."
}
```

## Where this works

The dividing line is whether the running server has your **source on disk** —
not whether it is production.

| Deployment | Works |
|---|---|
| `rebase dev` on your machine | yes |
| Self-host with the project mounted | yes |
| Self-host from a built bundle | no — nothing to edit |
| Rebase Cloud | with a connected repository |

A bundle is compiled output. There is no collection source in it, so the routes
answer `SCHEMA_EDITING_NO_REPOSITORY` and say why. **Running from source is how
a self-hosted deployment gets the schema editor.**

On a machine that has the repository, the commit is a plain `git commit` —
nothing to authenticate, no token, no network. Cloud is the harder case, because
the repository is elsewhere; there it commits through a GitHub App using the Git
Data API, with no clone.

Two things that make it safe to run against a repository somebody else is
working in:

- It stages **only** the files it generated. A schema commit that swept up
  half-finished work would be a commit nobody could review, and it refuses
  outright if the tree already has one of its own files modified.
- The remote path never force-updates a ref. If something landed while the
  commit was being built, the update is rejected — losing somebody's commit
  silently is worse than failing.

## Limits

- Only additive changes. Everything else is refused with a reason, because the
  ensure path is the only thing that changes a schema and it can only add.
- No migration file is written. A project provisioned by boot-ensure needs none;
  a project provisioned by migrations should run `rebase db generate`, which
  mints one through Atlas with the integrity hash Atlas requires.
- Postgres only. The capability is detected on the driver, and other engines
  answer `SCHEMA_EDITING_UNSUPPORTED`.
