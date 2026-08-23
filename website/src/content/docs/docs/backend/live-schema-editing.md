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
GET  /api/admin/schema/status   whether this backend can do it, and whether you may
POST /api/admin/schema/plan     what would happen, without doing it
POST /api/admin/schema/apply    commit, then apply
```

All three are admin-gated, like every other `/api/admin` surface. Applying needs
one thing more than being an admin — see [Who may apply](#who-may-apply).

## Plan before you apply

`/plan` has no side effects. Post the collection as it should end up, and it
tells you what the change means:

```bash
curl -X POST https://your-app/api/admin/schema/plan \
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

- **A required property added to a table that already holds rows** arrives
  **nullable**. `NOT NULL` is checked against every row already there, and rows
  written before the property existed have no value for it. On an **empty**
  table there is nothing to check, so the constraint is applied and this is
  `safe`.
- **Making an existing property required** has the same shape: `SET NOT NULL`
  scans the table, so it is `safe` on an empty one and `diverges` on a populated
  one until you backfill.

Two changes that used to be `diverges` are now `safe`, because the ensure path
carries them out:

- **A value added to an existing enum** lands, via
  `ALTER TYPE … ADD VALUE IF NOT EXISTS`. It used to be skipped along with the
  whole type, and the first row using the new value was rejected by a type that
  had never heard of it.
- **Relaxing a required property** drops the `NOT NULL`. It used to be left in
  place, so writes omitting the property still failed.

### Constraints that are asked for and not applied

A change can be applicable and still leave something your configuration asks for
unenforced — a required property over a populated table is the case. That is not
a refusal, so it does not appear in `changes`; it appears in
`withheldConstraints`, with the obstacle and what would clear it:

```json
{
  "withheldConstraints": [
    {
      "target": "public.posts.author",
      "kind": "not-null",
      "reason": "\"author\" is required, but \"public.posts\" already holds rows …",
      "remedy": "Backfill the column, then apply this again."
    }
  ]
}
```

The boot-time ensure path reports the same thing as a warning. Until this
existed, a withheld constraint was withheld in silence.

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

Those paths are relative to your **project**, not to your repository. When the
two are the same — a `rebase init` project, which is the usual case — there is
nothing to think about. When your project sits in a subdirectory of a larger
repository, the paths are prefixed with it, found by walking up from your
collections directory to the nearest `rebase.json`. A project with no
`rebase.json` keeps the plain paths.

The commit message describes the change rather than announcing one, and is
attributed to the admin who made it. A schema change with an author and a diff
in your project's history is something neither Firebase nor Supabase gives you —
their table edits are invisible to your repository.

## Who may apply

Being an admin is enough to **plan**. Planning has no side effects, and a CI job
asking whether a proposed collection change is applicable is a good use of it.

Applying is a second privilege, because applying writes a commit and a commit
carries an author:

| Caller | Plan | Apply |
|---|---|---|
| A signed-in admin | yes | yes |
| An API key | yes | no |
| The server's service key | yes | no |

A credential is not an author. `api-key:7c3f…` in your CI environment is not
somebody, and letting it write to your repository produces exactly the
unattributable history this feature exists to replace.

If an automated schema change is what you want — a migration pipeline, say —
turn it on deliberately:

```typescript no-verify
initializeRebaseBackend({
    // …the rest of your config
    liveSchema: { allowMachineApply: true }
})
```

or `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY=true`. The commit is then attributed
to the credential by name — `Rebase API key (7c3f)` — so reading `git log` a
month later still tells you which changes a person made.

`GET /api/admin/schema/status` reports what *you* may do, not only what the
server supports, so a panel can disable the control and say why rather than
refusing you after you have decided:

```json
{
  "enabled": true,
  "canPlan": true,
  "canApply": false,
  "applyRefusedCode": "SCHEMA_EDIT_REQUIRES_A_PERSON",
  "applyRefusedBecause": "This request is authenticated with an API key …"
}
```

## If your project keeps versioned migrations

Applying here does **not** write a migration, and cannot: a migration is Atlas's
format with an integrity file, minted by an external binary against a throwaway
database, and a running server has neither.

What it does write is `drizzle/schema.sql` — which is exactly what
`rebase db generate` diffs against. So the migration is one command away:

```bash
rebase db generate
```

The plan and the result both say so when your project has migrations, because
the failure otherwise is quiet: your database has the change and your repository
describes it, but the next environment built by replaying migrations does not,
and nothing said anything.

A project provisioned by boot-ensure — the managed runtime, and any self-host
leaving `REBASE_MIGRATE_ON_BOOT` at its default — needs no migration at all. Its
collections are the schema, and the next boot reconciles.

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
| Self-host from a built bundle | yes, with `liveSchema.repository` |
| Rebase Cloud, or any bundle | yes, with `liveSchema.repository` |

A bundle is compiled output, so there is no collection source in it. Configure
`liveSchema.repository` and the source is fetched from your repository instead;
without it the routes answer `SCHEMA_EDITING_NO_REPOSITORY` and say why.

### A deployment with no source on disk

A bundle is compiled output — every Cloud tenant, and any self-host serving a
build. There is no collection source for the editor to rewrite, so point it at
the repository the source actually lives in:

```typescript no-verify
initializeRebaseBackend({
    // …the rest of your config
    liveSchema: {
        repository: {
            kind: "github",
            owner: "acme",
            repo: "storefront",
            branch: "main",
            // Where the collection source lives in that repository.
            // Defaults to "config/collections".
            collectionsPath: "config/collections",
            auth: { kind: "token", token: process.env.GITHUB_TOKEN! }
        }
    }
})
```

The change is then read from the repository, rewritten with the same editor that
runs locally, and committed back through the Git Data API — a blob, a tree, a
commit and a ref update. Nothing is cloned and nothing is left on disk.

`auth` takes a token or a GitHub App installation:

```typescript no-verify
auth: {
    kind: "app",
    appId: "123456",
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
    installationId: "987654"
}
```

Use the token for a single project committing to a repository you already own —
standing up an App so your own server can commit to it is a lot of ceremony for
a one-line credential. Use the App for a control plane holding one key across
many projects, which is what Rebase Cloud does: one App, an installation per
project, and no per-customer secret to rotate.

The token needs `contents: read and write` on that repository, and nothing else.

On a machine that has the repository, the commit is a plain `git commit` —
nothing to authenticate, no token, no network. A deployment without one commits
through the Git Data API instead, with no clone — see
[A deployment with no source on disk](#a-deployment-with-no-source-on-disk).

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
