# Publishing & Releases

This monorepo has a unified release system that handles **npm publishing**, **CHANGELOG generation**, and **GitHub Releases** in one step.

## Quick Start

```bash
# Patch release: 0.1.1 → 0.1.2
pnpm release:patch

# Minor release: 0.1.1 → 0.2.0
pnpm release:minor

# Major release: 0.1.1 → 1.0.0
pnpm release:major

# Explicit version
pnpm release 0.3.0

# Preview what would happen (no changes)
pnpm release:dry
```

## What the Release Script Does

When you run `pnpm release:patch` (or any variant), it:

1. **Validates** — ensures you're on `main`, working tree is clean, tools are installed
2. **Calculates** the new version from the bump type
3. **Generates a changelog** from conventional commits since the last tag
4. **Bumps versions** in every publishable package, through `tooling/scripts/publishable-packages.mjs --set-version` (the set is derived from the workspace; there is no `lerna.json`)
5. **Updates `CHANGELOG.md`** with the new entry
6. **Builds & tests** — runs `pnpm build` and `pnpm test`
7. **Commits & tags** — `chore: release vX.Y.Z` + annotated tag
8. **Pushes** to `origin main` with tags
9. **Publishes** all packages to npm
10. **Creates a GitHub Release** with the changelog as the body

## Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/) for automatic changelog categorization:

| Prefix | Category | Example |
|---|---|---|
| `feat:` | ✨ Features | `feat: add search filtering` |
| `fix:` | 🐛 Bug Fixes | `fix: resolve date picker crash` |
| `refactor:` | ♻️ Refactors | `refactor: simplify auth flow` |
| `docs:` | 📚 Documentation | `docs: update API reference` |
| `chore:` | 🔧 Maintenance | `chore: update dependencies` |
| `feat!:` | ⚠️ Breaking | `feat!: remove legacy API` |

Commits that don't match a prefix go under "Other".

## CI: GitHub Actions

Both releases live in one workflow, `.github/workflows/publish.yml`, as two jobs
selected by the **channel** input. They are not split into two files because npm
allows only one trusted publisher per package, naming a single workflow file —
two files could never both be trusted.

### Stable Release (manual trigger)

1. Go to **Actions** → **Publish** → **Run workflow**
2. Leave **channel** on `stable`
3. Enter the version bump type (`patch`, `minor`, `major`, or explicit version)
4. Optionally enable **dry run** to preview

This does everything the local script does, but in CI.

### Canary Release (manual trigger)

1. Go to **Actions** → **Publish** → **Run workflow**
2. Set **channel** to `canary`
3. Pick the branch to publish from — the version is derived from the last release
   tag plus that commit's short sha

**version** and **dry run** are stable-only and ignored here.

```
0.0.1-canary.<short-sha>
```

Canary is not automatic. It used to publish on every push to `main`; a canary is
a release you decide to cut, so it is now triggered the same way stable is. Merges
to `main` still run the full gate — that is `ci.yml`, which calls the same
`verify.yml` this job does.

Install the latest canary:
```bash
pnpm add @rebasepro/app@canary
```

## Pre-releases

For pre-release channels, use the script with explicit versions:

```bash
# Beta
pnpm release 0.2.0-beta.0

# RC
pnpm release 0.2.0-rc.1
```

## Requirements

- Must be on the `main` branch
- Working tree must be clean
- [`gh` CLI](https://cli.github.com/) must be installed and authenticated
- `npm` must be authenticated (`npm login`)

## Dry Run

Preview what a release would do without making any changes:

```bash
pnpm release:dry
# or
./tooling/scripts/release.sh minor --dry-run
```

This shows:
- The calculated version
- The generated changelog
- What steps would be performed
