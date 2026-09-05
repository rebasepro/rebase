# Contributing to Rebase

Thank you for your interest in contributing! Whether it's a bug fix, new feature, or documentation improvement, we appreciate your help.

If you're new to open source, check out [How to Contribute to Open Source](https://opensource.guide/how-to-contribute/).

Taking part in this project — issues, pull requests, code review, or the Discord —
means agreeing to our [Code of Conduct](CODE_OF_CONDUCT.md).

## Prerequisites

- **Node.js** ≥ 22.22 (CI runs 22.x; `packages/app` and `packages/cms` declare this floor)
- **pnpm** ≥ 11 (`corepack enable` to activate)
- **Docker** (for the local PostgreSQL database)

## Getting Started

1. **Fork & clone** the repository:

```bash
git clone --filter=blob:none https://github.com/<your-username>/rebase.git
cd rebase
```

   `--filter=blob:none` is worth typing. The repository is about 890 MB on the
   server and 195 MB checked out: the difference is historical revisions of the
   marketing videos and screenshots under `website/public/` and
   `tooling/videos/`. A blobless clone fetches file contents on demand, so you
   get the same working tree and the same full history without the old copies of
   a 3 MB `.webm`. Everything works normally; `git log -p` over an old binary
   file is the only thing that has to go to the network.

2. **Install dependencies and build the packages**. The build is not optional:
   the `rebase` CLI used by the next steps runs from `packages/cli/dist`, which
   is not checked in.

```bash
pnpm install
pnpm run build
```

3. **Start the database**. The compose file belongs to the example app, so run it
   from there:

```bash
cd app/backend && docker compose up -d db && cd ../..
```

4. **Point the app at it**. Nothing creates `app/.env` for you, and without it
   `db:push` has no `DATABASE_URL` to push to. The example file already carries
   the compose credentials:

```bash
cp app/.env.example app/.env
```

5. **Push the schema**. `db:push` reads `app/config/collections`, so it runs from
   `app/`:

```bash
cd app && pnpm run db:push && cd ..
```

6. **Launch the dev server**:

```bash
pnpm run dev
```

`rebase dev` picks a free port per project rather than fixed ones, and prints the
admin panel and API URLs it settled on. Read them from its output — they differ
between checkouts, and `PORT` / `VITE_API_URL` apply to `rebase start`, not here.

## Project Structure

| Path | Description |
|---|---|
| `packages/` | All library packages (published to npm) |
| `app/` | Example application that consumes the packages |
| `website/` | Documentation site |
| `tests/e2e/` | End-to-end tests (Playwright) |
| `tooling/scripts/` | Build, release, and utility scripts |
| `examples/` | Standalone example apps |
| `tooling/rebase-agent-skills/` | Agent skills installed by `rebase skills install` |
| `tooling/videos/` | Remotion project for the product videos on the website (a workspace package, not part of the library) |

One-off scripts, codemods and utilities go in `tooling/scripts/`, never at the repo root
or inside a package directory.

`pnpm-workspace.yaml` also lists `saas/*`, and the root `saas` and `saas:prod`
scripts point there. That is Rebase Cloud's control plane, a private repository
checked out at `saas/`. It is absent from a public clone; pnpm ignores a pattern
that matches nothing, so the install is unaffected and those two scripts are the
only things that will not run.

## Coding Standards

**[.agent/workflows/coding-standards.md](.agent/workflows/coding-standards.md)**
is the rule set this codebase is held to: no `as any` and no structural cast
standing in for one, no dynamic `require`, no REST polling on a realtime
framework, no hidden `__dunder` metadata on data objects, foreign keys that stay
scalars beside their hydrated relation, and comments that describe what the code
is rather than what it used to be. It lives under `.agent/` because agents read
it too; it is not a document written *for* agents and optional for people.

`.agent/workflows/` has four more: `rebase-architecture.md`,
`schema-migration.md`, `ui-components.md` and `deployment.md`.

## Commits and the Changelog

Commit messages are [Conventional Commits](https://www.conventionalcommits.org/),
because the release script reads them: `tooling/scripts/release.sh` groups the
commits since the last tag by prefix to build the release notes. A message that
matches no prefix lands under "Other".

```
feat(scope): lowercase sentence describing the change
```

- One of `feat` / `fix` / `refactor` / `docs` / `chore`, plus `feat!` for a
  breaking change. `.github/internal/PUBLISHING.md` has the full table.
- The scope is the package or area (`cli`, `server`, `website`, `gates`).
- The subject is a lowercase sentence, no trailing period. It is read as a
  changelog line, so write what changed, not what you did.

**Only ever edit `## [Unreleased]` in `CHANGELOG.md`.** The version headings
below it are history. `release.sh` promotes `[Unreleased]` to the new version,
dates it, and opens a fresh empty one — so a note written under a version
heading is either overwritten or silently left out of the release it belonged
to. `pnpm check:release-bump` reads that section to decide whether the bump you
asked for matches what the notes say changed.

After editing `CHANGELOG.md` or anything under `docs/`, regenerate the website's
mirrors and commit them with the change:

```bash
pnpm -C website generate-all
```

The docs site keeps a copy of the changelog per locale, and `llms.txt`,
`llms-full.txt` and `sitemap.md` are generated from the docs and committed. They
used to refresh only when somebody happened to build the site, so `llms.txt` sat
a commit behind the docs it summarises. `pnpm check:generated` runs the same
command in CI and fails on a diff — if it changes a tracked file, the commit that
changed the docs forgot to.

## Code Quality

Before submitting a PR, make sure all checks pass:

```bash
./tooling/scripts/verify-quality.sh
```

It runs the build, `pnpm ci:static` — the same gate list CI's `static` job runs,
type check and ESLint included — the unit suites, and the Playwright end-to-end
tests. The browser suite needs a browser, which the npm package does not ship;
the script installs it for you, or do it once yourself:

```bash
pnpm exec playwright install chromium
```

Two gates need a tool the repository cannot install for you — Docker (it boots
the runtime image) and Helm (it renders the chart). Without them `ci:static`
says so and skips them; CI has both and refuses to skip.

If you only want the fast half, `pnpm ci:static` on its own reads source and
needs no build, no database and no browser. Every gate it runs is listed with
what it protects in **[docs/gates.md](docs/gates.md)**.

## Testing

The root `pnpm test` runs every package's suite with `--workspace-concurrency=1`
— serial on purpose, because several suites bind ports and open databases. It is
about three and a half minutes.

While working on one package, run that package:

```bash
pnpm --filter @rebasepro/server-postgres test
pnpm --filter @rebasepro/server-postgres test:watch     # re-runs on save
```

Which runner you get depends on the package, and it changes how you name a
single file:

| Runner | Packages | One file |
|---|---|---|
| Vitest | `cli`, `mcp`, `rls-check` | `pnpm --filter @rebasepro/cli test src/utils/args` |
| Jest | everything else | `pnpm --filter @rebasepro/ui test -- chip-contrast` |

`packages/server-postgres` has both: `test` is Jest over `test/*`, and
`test:e2e` is Vitest against the **built** `dist`, so build the package before
running it.

`@rebasepro/server` runs Jest under `NODE_OPTIONS="--experimental-vm-modules"`.
Its `test` script sets that for you; a bare `pnpm exec jest` in that package fails on
the first ESM import with `Cannot use import statement outside a module`.

`packages/firebase` has tests and no runner — five of them, never executed. That
is a recorded gap, not an oversight: `pnpm check:test-scripts` names it, and
fixing it means adding a devDependency and a lockfile entry.

### End-to-end

The e2e suites are not part of `pnpm test`. They need three things first:

```bash
pnpm --filter './packages/*' -r run build   # they drive dist, not src
pnpm exec playwright install chromium       # the npm package ships no browser
docker compose -f app/backend/docker-compose.yml up -d db
```

The build is not optional for any of them: the CLI suite scaffolds a project
that consumes every package as built output and refuses to start otherwise, and
the Vitest suites import `dist` directly. Then:

```bash
pnpm e2e                                    # the Playwright admin-panel suite
pnpm exec tsx tests/e2e/tests/cli-init-e2e.ts
pnpm --filter @rebasepro/server-postgres test:e2e
```

## Compatibility

Rebase is `0.x`, so breaking changes to the authored TypeScript API are allowed
in a minor and belong in the changelog. A small number of contracts are *not*
in that category: they are stamped into built bundles and into live databases,
and Rebase Cloud reads them to decide what may run where.

If your change touches the bundle format, the bundle↔runtime contract, the auth
schema version, or the collection schema hash, read
**[docs/compatibility.md](docs/compatibility.md)** first. It says what each one
promises, which direction it is compatible in, what a bump costs, and which gate
will catch you. One of them invalidates every bundle ever built, so it is worth
the five minutes.

## Submitting a Pull Request

1. Create a feature branch from `main`.
2. Make your changes — keep commits focused and well-described.
3. Run `./tooling/scripts/verify-quality.sh` and ensure everything passes.
4. Open a PR with a clear description of what changed and why.
5. Link any related issues.

> **Tip:** For major changes, please open an issue or reach out on Discord first so we can align on the approach.

## Support & Discussion

Join our [Discord community](https://discord.gg/fxy7xsQm3m) — we're happy to help with questions, ideas, or contribution guidance.
