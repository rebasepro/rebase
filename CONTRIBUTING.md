# Contributing to Rebase

Thank you for your interest in contributing! Whether it's a bug fix, new feature, or documentation improvement, we appreciate your help.

If you're new to open source, check out [How to Contribute to Open Source](https://opensource.guide/how-to-contribute/).

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

2. **Install dependencies**:

```bash
pnpm install
```

3. **Start the database** and push the schema:

```bash
docker compose up -d db
pnpm run db:push
```

4. **Launch the dev server**:

```bash
pnpm run dev
```

The admin panel runs at `http://localhost:5173` and the API at `http://localhost:3001`.

## Project Structure

| Path | Description |
|---|---|
| `packages/` | All library packages (published to npm) |
| `app/` | Example application that consumes the packages |
| `website/` | Documentation site |
| `e2e/` | End-to-end tests (Playwright) |
| `scripts/` | Build, release, and utility scripts |

## Code Quality

Before submitting a PR, make sure all checks pass:

```bash
./scripts/verify-quality.sh
```

This runs TypeScript compilation, ESLint, unit tests, and Playwright E2E tests.

## Submitting a Pull Request

1. Create a feature branch from `main`.
2. Make your changes — keep commits focused and well-described.
3. Run `./scripts/verify-quality.sh` and ensure everything passes.
4. Open a PR with a clear description of what changed and why.
5. Link any related issues.

> **Tip:** For major changes, please open an issue or reach out on Discord first so we can align on the approach.

## Support & Discussion

Join our [Discord community](https://discord.gg/fxy7xsQm3m) — we're happy to help with questions, ideas, or contribution guidance.
