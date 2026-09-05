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
git clone https://github.com/<your-username>/rebase.git
cd rebase
```

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
