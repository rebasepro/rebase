---
title: Live schema editing
description: Create and alter tables against a running backend — the edit is written to backend/schema, committed to your repository first, then applied.
---

<span class="since-badge" data-since="0.31">Since 0.31</span>

The schema editor in the admin panel rewrites the table files in
`backend/schema`. That works on your machine and nowhere else: a deployed
server's files are rebuilt from your repository on every deploy, so an edit made
there would be discarded on the next one.

Live schema editing is the answer to that. It **commits the change to your
repository, then applies the DDL** — so the edit survives the next deploy,
because the deploy is built from it.

```
GET  /api/admin/schema/status   whether this backend can do it, and whether you may
POST /api/admin/schema/plan     what would happen, without doing it
POST /api/admin/schema/apply    commit, then apply
```

Status and plan need the `schema:read` scope, and apply needs `schema:write`, like
every other `/api/admin` surface that names a scope. An admin holds both.
Applying also needs one thing more than the scope — see [Who may apply](#who-may-apply).

## The edits: `TablePatch`

<span class="since-badge" data-since="0.31">Since 0.31</span>

Every route that changes the schema takes the same body, `{ patches }`: a list
of edits, each naming its table by slug. The type is `TablePatch`, from
`@rebasepro/types`.

| `op` | What it writes in `backend/schema` |
|---|---|
| `createTable` | a new `backend/schema/<name>.ts` holding the table, exported from `index.ts` |
| `deleteTable` | removes the file and its export |
| `addColumn` `{ key, column, before? }` | a column, before the one named by `before`, or last |
| `changeColumn` `{ key, column }` | rewrites one column's builder chain; a `.transform()` written on it is kept |
| `renameColumn` `{ key, to, column }` | renames the key, keeping the SQL column |
| `removeColumn` `{ key }`, `moveColumn` `{ key, before? }` | removes or reorders a column |
| `addRelation`, `changeRelation` `{ name, relation }`, `removeRelation` `{ name }` | a `rel.*` entry; the relation's `target` is a slug |
| `setRls` `{ rls }` | the posture: `"admin-only"`, `"inherit"` or a list of rules |
| `addRule` `{ rule, index? }`, `replaceRule` `{ index, rule }`, `removeRule` `{ index }` | one rule of the list |
| `setOption` `{ option, value }` | `description`, `tenant`, `softDelete`, `history`, `search`, `indexes`, `strictWrites`, `defaultPolicies` or `metadata`; `null` removes it |

A column travels as its definition — the Postgres type as `{ kind: … }`, and the
modifiers as flags — without its `.transform()` hooks, which are code and stay
where they are written:

```json
{ "patches": [
    { "op": "addColumn", "table": "posts", "key": "subtitle",
      "column": { "type": { "kind": "text" } } }
] }
```

Only the code an edit names is rewritten. Everything else stays as it is —
imports, comments, formatting, a column shared from another module. The editor
refuses, naming the expression, an edit that reaches *into* something defined
in code: a table built with a spread, a column built by a helper, rules held in
a variable, a computed key, a column whose JSON shape carries transforms. It
also never renames a slug, a table, a schema or a definition's name (that moves
data: write a migration), never removes the last rule (say `setRls` with
`"admin-only"`), refuses `rls` on a view, and refuses deleting a table other
relations target. An edit whose result does not compile is refused with
`SCHEMA_EDIT_DOES_NOT_COMPILE` and the compiler's problems. Nothing is written
on any refusal.

How a table looks in the admin panel — labels, icons, groups, view modes, enum
colours — is not a schema edit: it lives in `frontend/src/cms` and the panel's
saved preferences, and none of it travels in a `TablePatch`.

`$ADMIN_TOKEN` is an access token — the `accessToken` a sign-in returns — for an
account holding `schema:read`: an admin, or a role that declares it. Nothing on
the machine sets it for you.

## Plan before you apply

<span class="since-badge" data-since="0.31">Since 0.31</span>

`/plan` has no side effects. Post the edits, and it tells you what they mean:

```bash
curl -X POST https://your-app/api/admin/schema/plan \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"patches":[{"op":"addColumn","table":"posts","key":"subtitle","column":{"type":{"kind":"text"}}}]}'
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
  "files": ["backend/schema/posts.ts", "backend/src/schema.generated.ts"],
  "message": "…the commit message the apply would use…",
  "withheldConstraints": [],
  "followUp": []
}
```

`files` is every file the apply commits: the table's source, when the backend
can write it, then the generated schema. The planner's change records keep
their wire names (`add-property`, `collection`, `property`).

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

- **A `.notNull()` column added to a table that already holds rows** arrives
  **nullable**. `NOT NULL` is checked against every row already there, and rows
  written before the column existed have no value for it. On an **empty**
  table there is nothing to check, so the constraint is applied and this is
  `safe`.
- **Making an existing column `.notNull()`** has the same shape: `SET NOT NULL`
  scans the table, so it is `safe` on an empty one and `diverges` on a populated
  one until you backfill.

Two changes that used to be `diverges` are now `safe`, because the ensure path
carries them out:

- **A value added to an existing enum** lands, via
  `ALTER TYPE … ADD VALUE IF NOT EXISTS`. It used to be skipped along with the
  whole type, and the first row using the new value was rejected by a type that
  had never heard of it.
- **Relaxing a `.notNull()` column** drops the `NOT NULL`. It used to be left in
  place, so writes omitting the column still failed.

### Constraints that are asked for and not applied

A change can be applicable and still leave something your configuration asks for
unenforced — a `.notNull()` column over a populated table is the case. That is not
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
table or a column, changing a column's type (an integer toggle, a string
becoming an enum, an array's element type, a varchar's width), renaming a
column, changing a primary key, removing an enum value, making an existing
column unique, and changing a relation — its kind, its target, its `localKey`,
its `onDelete`. A `hasMany` or `hasOne` whose link column nothing creates is
refused too. Each refusal names the change and what to do instead.

The verdict is read from the schema each side produces — the same plan
`schema.generated.ts` and `db push` are rendered from — so an edit that changes
the database cannot be reported as no change. Two edits that look like changes
and are not refused:

- **Renaming a column's key while keeping its SQL column** (`renameColumn`,
  which writes the old name as the builder's first argument, `col.text("old_name")`) moves no data. It is `safe`; API clients read the new name.
- **Setting, changing or dropping a default** binds future writes only. It is
  `safe`, and applied with `ALTER COLUMN … SET DEFAULT` / `DROP DEFAULT`.

### Edit source only

<span class="since-badge" data-since="0.31">Since 0.31</span>

A refused change can still be written to `backend/schema` and committed,
leaving the database as it is — removing a column you no longer serve is the
usual case. Post `/apply` with `"sourceOnly": true`. Nothing runs; the commit
message names what the database keeps, for example
`chore(schema): remove sku from products (source only — column products.sku kept)`,
and each change in the plan carries a `sourceOnly` sentence saying what it
leaves behind — including when a column left behind is `NOT NULL` with no
default, which makes every later insert fail until it is dropped or made
nullable. A change without one (moving a primary key, a relation whose link
column nothing creates) cannot be written to the source alone.

On a deployment that changes nothing in its database (`REBASE_PROVISION=false`)
no change is applied from the panel, so every change goes this way: the
dialog's main button reads **Commit** and sends `"sourceOnly": true`, and the
process that changes that database applies the schema.

Deleting a table from the admin panel takes the same path: `/apply` with a
`deleteTable` edit and `"sourceOnly": true` deletes the table's file and its
export in `index.ts` and commits both; the table and its rows stay in the
database. It is refused while a relation of another table targets it, naming
that table — deleting it would stop the schema from compiling.

## What gets committed

Not just the table file. The Drizzle schema is generated from it, and a
stale one breaks the next deploy, so both go in the same commit:

- `backend/schema/<name>.ts` — the table itself, and `backend/schema/index.ts` when a table is created or deleted
- `backend/src/schema.generated.ts` — the Drizzle schema

Those paths are relative to your **project**, not to your repository. When the
two are the same — a `rebase init` project, which is the usual case — there is
nothing to think about. When your project sits in a subdirectory of a larger
repository, the paths are prefixed with it, found by walking up from your
schema directory to the nearest `rebase.json`. A project with no
`rebase.json` keeps the plain paths.

No SQL goes in the commit. `rebase db push` and `rebase db generate` write theirs
from the tables on every run, into `.rebase/sql/`, which is gitignored.

The commit message describes the change rather than announcing one, and is
attributed to the person who made it, by the account's display name and email
(a user with neither is committed as `<uid>@users.noreply.rebase.pro`).

A schema change with an author and a diff in your project's history is something
neither Firebase nor Supabase gives you — their table edits are invisible to
your repository.

## Who may apply

Holding `schema:read` is enough to **plan**. Planning has no side effects, and a
CI job asking whether a proposed schema change is applicable is a good use of
it.

Applying is a second privilege, because applying writes a commit and a commit
carries an author:

| Caller | Plan | Apply |
|---|---|---|
| A signed-in person holding `schema:write` | yes | yes |
| An API key holding `schema:read` / `schema:write` | yes | no |
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

What it does commit is the table file, and that is what `rebase db generate`
writes the migration from. So the migration is one command away:

```bash
rebase db generate
```

The plan and the result both say so when your project has migrations, because
the failure otherwise is quiet: your database has the change and your repository
describes it, but the next environment built by replaying migrations does not,
and nothing said anything.

A project provisioned by boot-ensure — the managed runtime, and any self-host
leaving `REBASE_MIGRATE_ON_BOOT` at its default — needs no migration at all. Its
tables are the schema, and the next boot reconciles.

## Commit first, then apply

The order matters and it is not arbitrary.

If the DDL ran first and the commit failed, your database would have a column
your repository does not describe. The ensure path never drops anything, so the
next deploy would neither remove it nor mention it — an invisible column, absent
from your tables, until somebody went looking.

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

<span class="since-badge" data-since="0.31">Since 0.31</span>

Live schema editing rewrites `backend/schema` with the same editor the panel's
source-only saves use (it needs `ts-morph` installed). Where that source
comes from decides where it runs:

- **On disk** (`schemaDir`, the default): it runs where the source-only
  editor runs. That editor is off under `NODE_ENV=production` unless the server
  sets `schemaEditor: true`.
- **In a repository you name** (`liveSchema.repository`, or
  `REBASE_LIVE_SCHEMA_REPOSITORY` for a bundle): the source is read from
  GitHub and the change is committed back there, so it runs anywhere,
  production included. This is the opt-in for a built bundle.

| Deployment | Works |
|---|---|
| `rebase dev` on your machine | yes |
| Self-host with the project and its git working tree mounted | yes, when `NODE_ENV` is not `production`, or with `schemaEditor: true` |
| A built bundle: a self-host serving a build, or the published image | only when it opts in with `REBASE_LIVE_SCHEMA_REPOSITORY` — see [From a built bundle](#from-a-built-bundle) |
| Any server with `liveSchema.repository` configured | yes, `NODE_ENV=production` included |

A bundle is compiled output, so there is no `backend/schema` source in it, and
the runtime that serves it turns the source-only editor off. Unless it names a
repository, `/api/admin/schema/status` answers `enabled: false` with the code
`SCHEMA_EDITOR_DISABLED`: edit `backend/schema` in development, commit, and
deploy.

### From a built bundle

<span class="since-badge" data-since="0.31">Since 0.31</span>

A bundle has no code of its own to configure, so it opts in with environment
variables. Nothing changes for a bundle that does not set them.

```bash
REBASE_LIVE_SCHEMA_REPOSITORY=acme/storefront     # turns it on
REBASE_LIVE_SCHEMA_GITHUB_TOKEN=github_pat_…       # or the three _GITHUB_APP_* variables
# REBASE_LIVE_SCHEMA_BRANCH=main                   # default
# REBASE_LIVE_SCHEMA_PATH=backend/schema           # default
```

The full list is in [Configuration](/docs/getting-started/configuration#live-schema-editing-from-a-bundle).
A repository named without a usable credential (none, both kinds, half a GitHub
App), or a value that is not `owner/name`, refuses to boot, rather than serving
an editor that fails when somebody presses Apply. So does the removed
`REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`, with a message naming
`REBASE_LIVE_SCHEMA_PATH`, and a path that leaves the repository.

What stays the same when it is on:

- It is an `/api/admin` surface: no answer at all without `schema:read`, and
  `/apply` needs `schema:write` and a person (see [Who may apply](#who-may-apply)).
- The write target is only the repository you named. The source-only editor,
  which writes files beside the process, stays off.
- Each change is planned, shown, committed, then applied, exactly as on your
  machine.

The process that applied the change serves it at once: its REST routes, the
`GET /api/schema/tables` descriptors and the admin panel follow the edit
without a restart. Other replicas, and this process after a restart, serve the
tables the bundle was built with until your pipeline builds and deploys the
commit.

So a change waits for the one before it to be served. A change planned against
tables the repository is already ahead of would commit generated schema files
that leave the earlier change out. Each apply therefore renders
`schema.generated.ts` from the tables this process serves and compares it with
the repository's copy. When they differ, the apply is refused with
`SCHEMA_CHANGE_FAILED`, naming the file, until a process running that commit
replaces this one. The check reads the repository, not this process's memory,
so it holds across a restart, across replicas, and for a change a developer
pushed that is not deployed yet. Planning stays available meanwhile.

The copies also differ when the file was generated by another Rebase version,
reformatted, or edited by hand. If nothing is waiting to deploy, run
`rebase schema generate` with the version the deployment runs, commit the
result, and deploy it. Line endings and trailing whitespace do not count as a
difference.

### Committing to a remote repository

<span class="since-badge" data-since="0.31">Since 0.31</span>

`liveSchema.repository` makes the server commit each change to a GitHub
repository through the Git Data API instead of running `git commit` in a
working tree. It does not depend on the source-only editor being on: with a
repository configured, live editing works under `NODE_ENV=production` and with
`schemaEditor: false`, because nothing on this machine is written. A bundle
sets it through the variables above.

```typescript no-verify
initializeRebaseBackend({
    // …the rest of your config
    liveSchema: {
        repository: {
            kind: "github",
            owner: "acme",
            repo: "storefront",
            branch: "main",
            // Where backend/schema lives in that repository.
            // Defaults to "backend/schema".
            schemaPath: "backend/schema",
            auth: { kind: "token", token: process.env.GITHUB_TOKEN! }
        }
    }
})
```

The schema directory is then read from the repository, rewritten with the
same editor that runs locally, and what changed is committed back through the
Git Data API: a blob per file, a tree, a commit and a ref update. Nothing is
cloned and nothing is left on disk. The whole directory is read, not only the
edited file, so a relation can target another table and deleting a table works
as it does locally: refused while another table's relation targets it, and
removed from `index.ts` in the same commit. Only `backend/schema` is fetched,
so a table file that imports something outside it cannot be edited this way.

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

Without `liveSchema.repository`, the commit is a plain `git commit` in the
working tree that holds `schemaDir`: nothing to authenticate, no token, no
network.

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
- Postgres only. The capability is detected on the driver, and a driver
  without it answers `SCHEMA_EDITING_UNSUPPORTED`.
- After an apply that adds a column, the Postgres driver keeps the column
  catalogue it opened with until the process restarts, so a REST write to the
  new column can fail until then. Reads, and the descriptors the panel renders
  from, already have it.

## Related

- [Schema Generation](/docs/cli/schema/) — the same edits from the command line
- [Tables](/docs/schema/) — what the editor is rewriting
- [Studio](/docs/studio/) — the panel these routes are behind
