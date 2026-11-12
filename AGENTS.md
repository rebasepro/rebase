# Working in this repository

Rules for coding agents working on the Rebase monorepo. They apply to humans too.
The detailed guides live in `.agent/workflows/`. Read the one that matches the
task before you start:

- [`coding-standards.md`](.agent/workflows/coding-standards.md) covers the TypeScript
  rules (no `any`, no structural casts, `isSQLAdmin`), i18n, and the auth helpers.
- [`rebase-architecture.md`](.agent/workflows/rebase-architecture.md) covers package
  entry points, CMS vs. Studio mode, and where code belongs.
- [`schema-migration.md`](.agent/workflows/schema-migration.md) covers changing a
  table and applying the migration, including every relation kind.
- [`ui-components.md`](.agent/workflows/ui-components.md) covers the `@rebasepro/ui`
  kit and the design reference. Read it before building any UI.
- [`deployment.md`](.agent/workflows/deployment.md) covers deploys and releases:
  never do either without an explicit request.

## Always

- **Use pnpm only.** Never npm or yarn.
- **The UI must stay coherent.** Build from the `@rebasepro/ui` kit, not raw HTML
  or ad-hoc classes. `UIReferenceView` (`packages/app/src/debug/UIReferenceView.tsx`,
  at `/debug/ui` in the example app) is the design source of truth. Read it,
  or `ContentHomePage` / `StudioHomePage`, before creating a view.
- **Author tables with `defineTable` from `@rebasepro/server/schema`**, one file
  per table in `backend/schema/`, exported from `backend/schema/index.ts`
  (`defineAuthTable` for the users table, `defineView` for a SQL view). Columns
  are `col.*`, JSON shapes `json.*`, relations `rel.belongsTo` / `hasOne` /
  `hasMany` / `manyToMany` / `via`, and `rls` is required on every table.
  Server hooks are `hooks: { … }` on the table and `.transform()` on a column.
  How a table looks in the CMS is a separate file, `frontend/src/cms/<table>.tsx`,
  written with `customizeTable<typeof table>("slug", { … })` from
  `@rebasepro/cms`, which imports the table as a type only. Read
  `packages/types/src/schema/` (`columns.ts`, `relations.ts`, `table.ts`) before
  writing anything unusual; `app/backend/schema/` and `app/frontend/src/cms/`
  are the worked examples.
- **Never convert to `any`**, and never cast structurally around a type (for
  example `driver as { executeSql?: … }`). To run raw SQL, narrow `driver.admin`
  with `isSQLAdmin` from `@rebasepro/types`.
- **Put scripts in `tooling/scripts/`.** Never put one-off scripts, codemods,
  logs or diffs in the repo root or inside a package. For truly throwaway files,
  use your own scratch directory outside the repository.
- **Ask before touching the local environment.** Present a plan and get approval
  before changing database settings, `.env` files, or creating or dropping
  databases and roles.
- **Never release without consent.** Never publish, tag or release a package
  unless the user asked for that exact release, in the moment. Deploys are gated
  the same way. See `deployment.md` for what counts and what to do instead.
- **Verify before you say it is done.** `./tooling/scripts/verify-quality.sh`
  runs what CI runs: the static gates, the build gates, the unit tests and every
  end-to-end suite (`pnpm ci:e2e` — the RLS and integration suites, the CLI and
  SDK scaffolds, self-host, the admin panel; it needs Docker).
  `pnpm check:gates-doc` fails when the workflow runs something it does not.
  One lane is `pnpm ci:e2e --lane <vitest|cli|selfhost|admin>`. For a docs-only
  change, `pnpm verify:docs:strict` is the gate that reads it.
  A push to `main` first runs the fast subset, about three minutes
  (`tooling/git-hooks/pre-push`, installed by `pnpm install`), and lists the
  commits going out; it refuses when HEAD is not what you push or a tracked
  file is modified. Emergency only: `REBASE_SKIP_PREPUSH=1 git push …`.

## Measuring agent changes

`pnpm harness:eval -- --list` shows benchmark tasks derived from real fix commits
in this repo. Use them to check whether a change to agent instructions or
tooling helps or regresses. See `tooling/scripts/harness/README.md`.
