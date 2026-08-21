# Live schema editing — commit, then apply

Design for issue #5: creating and altering collections against a **running**
backend, from the panel, without giving up the thing that makes a Rebase
collection more than a table.

Status: design only. Nothing here is built. Written 2026-08-22 against
`9dfe8cc79`.

---

## The problem, stated precisely

`packages/server/src/api/ast-schema-editor.ts` already edits collections — it
rewrites TypeScript with ts-morph and supports `saveProperty`,
`deleteProperty`, `saveCollection` and `deleteCollection`. The routes in
`schema-editor-routes.ts` expose it.

It is disabled under `NODE_ENV=production`, for an honest reason stated at
[`init.ts:1495`](../packages/server/src/init.ts):

> The schema editor is off under `NODE_ENV=production`: it edits collection
> source files, and a deployed server's files are rebuilt from your repository
> on every deploy, so an edit here would be discarded.

So the editor works on a laptop and nowhere else. "Click a table into existence"
— the thing the whole few-clicks story rests on — dead-ends at a file in a
developer's working tree.

## Why the obvious fix is the wrong one

The obvious fix is to make the database the source of truth: store collections
in a metadata table, let the panel write to it, done.

That loses the product. `serializeCollections` in
`packages/types/src/types/collection_contract.ts` already defines the
serializable subset of a collection, and it deliberately drops:

- the entire `admin` block, via `withoutAdminBlock` — views, previews, custom
  components and their file paths;
- every function encountered during the walk — so `callbacks`, `dynamicProps`
  and `conditions` go too.

What survives is slug, table, properties, relations and `securityRules`. That is
the schema layer, and a product whose panel can only edit the schema layer is a
SQL tool with row-level security. BaaS mode already demonstrates what that feels
like: it builds collections from introspection, they work, and they are visibly
thinner.

The behaviour-and-presentation layer is the differentiator. A design that puts
it permanently out of the panel's reach is a design that decides Rebase is
Supabase.

## The design

**When the panel persists a change: commit to the linked repository first, then
apply the DDL to the live database.**

The repository stays the single source of truth. The database is brought forward
immediately so the user sees the result, and the commit is what makes that
durable across the next deploy instead of being overwritten by it.

This is strictly better than either alternative on the axis that matters: the
panel is editing *source*, so there is no ceiling on what it can eventually
edit. Adding a column today; editing an `admin` block or scaffolding a callback
later is the same mechanism with a richer editor in front of it.

It also produces something neither competitor has. A schema change in Supabase
is invisible to your repository. Here it is a commit, with an author and a diff,
in the history of the project it changed.

---

## Why that order, and not the other one

The two failure directions are not symmetric, so the ordering is load-bearing
rather than a matter of taste.

**Apply first, commit fails.** The database has a column the repository does not
describe. The boot-time ensure is strictly additive — the only `DROP COLUMN`
strings in `ensure-collection-tables.ts` are inside advice text, never in a
planned action — so the next deploy will not remove it and will not mention it.
The result is a column that exists in the database, is absent from the
collections, and is invisible to the API, sitting there until somebody goes
looking. Nothing in the system detects or reports this state.

**Commit first, apply fails.** The repository describes a column the database
does not have. This is the ordinary state of every project between an edit and a
deploy, and boot's ensure reconciles it on the next start. Nothing is orphaned
and nothing is silent.

So: commit, then apply. The bad half of the dual write lands in the direction the
system already handles.

Report both halves distinctly in the UI. "Committed, applying…" and "Committed;
the change will apply on next boot" are different states and the second is not an
error.

---

## What goes in the commit

This is where the work actually is. The commit is not "the collection file".

A deploy against a **fresh** database has to produce the schema that was just
clicked, or the feature is worse than not having it. That means the commit must
carry everything a developer doing this by hand would have produced:

| Artifact | Why it must be in the commit |
|---|---|
| `config/collections/<name>.ts` | The declaration itself. What `AstSchemaEditor` already writes. |
| `backend/src/schema.generated.ts` | A committed artifact. A stale one has broken every deploy at least once — see the FK key snake-vs-camel incident. |
| `drizzle/migrations/*` | Reproducibility. Without a migration a fresh database gets a different schema. Note that Drizzle **skips out-of-order migrations**: a lower `when` than one already applied never runs, so the timestamp has to be minted correctly. |
| `drizzle/policies.sql` | Row-level security is migration-applied. `securityRules` in the collection file alone is cosmetic. |
| `drizzle/schema.sql`, `drizzle/search.sql` | Same class of committed artifact; regenerate whatever the change touches. |

Two existing traps apply directly:

- **`partial: true`.** `POST /api/schema-editor/collection/save` treats a payload
  without it as a whole-collection save and deletes every key it does not
  mention, `securityRules` included. Adding one column posts one key. This has
  already bitten once and is documented in the route.
- **Derived names are frozen.** Anything the commit generates flows into
  `contracts/derived-names.txt`, and `check:derived-names` fails if a name moves.
  The generated migration must produce the same identifiers the boot path would.

The honest read: generating a *correct* commit is the bulk of this project. The
live DDL is the easy half.

---

## The credential gap

Today a cloud project carries a `gitRepoUrl` — `packages/cli/src/commands/cloud/projects.ts`
sets it from `--repo` and it is shown by `project show`. But it is **metadata
only**. Deploys work by the CLI packaging a source tarball and uploading it
(`deploy.ts`, `createSourceTarball`); nothing in the pipeline ever pulls from, or
pushes to, that URL.

So "commit to the linked repository" needs a write path that does not exist yet.
That is a real, separable piece of work and it should be planned as one:

- a GitHub App (or per-project token) with contents-write on one repository;
- storage for that credential — `SecretStore` from phase 5 of the roadmap is the
  right home, not a column;
- scope, rotation, and revocation;
- the equivalent for GitLab and plain git, or an explicit decision not to.

Until it exists, the editor cannot be enabled in production for any project. This
is the dependency that decides when #5 can ship, more than the DDL work does.

---

## When no repository is linked

A self-hoster running a bundle from `docker run` has no repository. Make this
explicit rather than clever:

- **repository linked** → commit, then apply;
- **no repository** → the editor stays off, exactly as it is today, and the error
  says how to link one.

One model, one code path. The tempting alternative — "apply to the database only
when there is no repo" — quietly reintroduces a second source of truth and needs
its own ownership and drift rules for a case that is not the main one. Not worth
two models.

This keeps the binding rule intact: the capability ships in OSS, its interface is
the same everywhere, and Cloud's contribution is making the linking easy rather
than being the only place it works.

---

## Things that will bite, designed for rather than discovered

**Rollback is asymmetric.** `git revert` on one of these commits does not drop
the column, because the ensure path never drops. Schema changes are forward-only
unless somebody writes the down migration. The UI should say so at the moment of
the change, not in a docs page.

**Branch protection.** Many repositories refuse direct pushes to the default
branch. Then the change is a pull request, and the repository does not match the
database until a human merges it. That is a legitimate state and needs its own
UI: "applied; PR #123 opened". It also means "commit succeeded" and "the
repository now describes this" are two different facts.

**Which branch.** The deployed bundle came from some commit. The write has to go
to whatever branch that deployment tracks, which the project model does not
currently record — only the repository URL.

**Concurrency.** Two panels, or a panel and a `git push`, produce a stale base.
The write needs to be against current `HEAD` with a retry-on-rebase, and two
concurrent column additions to the same file must not silently drop one.

**The apply is not always safe.** Adding a nullable column is; adding `NOT NULL`
to a populated table, narrowing a type, or changing a primary key are not. The
editor should classify the change and refuse the ones that need a data migration,
rather than discovering it at `ALTER TABLE` time.

---

## Suggested staging

Each stage is useful on its own, which matters for a project this size.

1. **Classify changes.** Given a collection diff, decide safe / unsafe / needs
   data migration. Pure logic, fully unit-testable, no infrastructure. Also
   immediately useful in dev mode, where the editor already runs.
2. **Generate the full commit.** Collection file plus every regenerated artifact
   plus the migration, as a set of file contents — no git, no network. Testable
   by asserting a fresh database built from the result matches the one the change
   describes. This is the bulk of the work and it can be finished before any
   credential exists.
3. **The git write path.** App/token, storage, branch selection, rebase retry,
   PR fallback.
4. **Live apply.** Reuse the existing ensure/migration machinery rather than a
   new DDL path, so there is exactly one thing that changes a schema.
5. **Panel UX.** The two-phase status, the refusal messages from stage 1, the
   forward-only warning.

Stages 1 and 2 have no dependency on the credential work and carry most of the
risk. They are where to start.

---

## Open questions

- Which branch does a deployment track, and where is that recorded?
- Does a change made against a production project also need to land in whatever
  branch `staging` tracks, or do environments diverge deliberately?
- GitHub App or per-project token — the App is better hygiene and more setup.
- Is a PR-only mode (never commit directly, always open a PR) the safer default
  for every project rather than a fallback for protected branches?
