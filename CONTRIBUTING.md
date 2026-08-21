# Contributing to Rebase

Thank you for your interest in contributing! Whether it's a bug fix, new feature, or documentation improvement, we appreciate your help.

If you're new to open source, check out [How to Contribute to Open Source](https://opensource.guide/how-to-contribute/).

Taking part in this project — issues, pull requests, code review, or the Discord —
means agreeing to our [Code of Conduct](CODE_OF_CONDUCT.md).

## Prerequisites

- **Node.js** ≥ 20
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

4. **Push the schema**. `db:push` reads `app/config/collections`, so it runs from
   `app/`:

```bash
cd app && pnpm run db:push && cd ..
```

5. **Launch the dev server**:

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
| `e2e/` | End-to-end tests (Playwright) |
| `scripts/` | Build, release, and utility scripts |
| `examples/` | Standalone example apps |
| `rebase-agent-skills/` | Agent skills installed by `rebase skills install` |
| `videos/` | Remotion project for the product videos on the website (a workspace package, not part of the library) |

One-off scripts, codemods and utilities go in `scripts/`, never at the repo root
or inside a package directory.

## Code Quality

Before submitting a PR, make sure all checks pass:

```bash
./scripts/verify-quality.sh
```

This runs TypeScript compilation, ESLint, unit tests, and Playwright E2E tests.

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
3. Run `./scripts/verify-quality.sh` and ensure everything passes.
4. Open a PR with a clear description of what changed and why.
5. Link any related issues.

> **Tip:** For major changes, please open an issue or reach out on Discord first so we can align on the approach.

## Support & Discussion

Join our [Discord community](https://discord.gg/fxy7xsQm3m) — we're happy to help with questions, ideas, or contribution guidance.
