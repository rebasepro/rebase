# Publishing & Releases

A release goes out one of two ways: the **Publish** workflow in CI, which is the
normal path, or `tooling/scripts/release.sh` run from a laptop. Both publish to
npm, stamp the changelog and create the GitHub Release.

The changelog is **not generated**. The release notes are the hand-written
`## [Unreleased]` section of `CHANGELOG.md`, and both paths hand it to
`tooling/scripts/prepare-changelog.mjs`, which promotes it to
`## [X.Y.Z] - <date>` and opens a fresh `[Unreleased]`. Both refuse to release
when that section is empty.

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

When you run `pnpm release:patch` (or any variant), `tooling/scripts/release.sh`:

1. **Preflight** — you are on `main`, the working tree is clean, `main` is level
   with `origin/main`, and `gh`, `node` and `pnpm` are installed
2. **Calculates** the new version from the last release tag on this history
   (`git describe`), and stops if that tag disagrees with `packages/server`'s
   version
3. **Finds the release notes** under `## [Unreleased]` (or a pre-written
   `## [X.Y.Z]`) and stops if there are none. `--dry-run` prints them and exits
   here
4. **Asks for confirmation**
5. **Stamps the changelog** — `prepare-changelog.mjs` promotes `[Unreleased]` to
   `[X.Y.Z] - <date>`, opens a fresh `[Unreleased]`, and syncs the docs-site
   mirror
6. **Bumps versions** in every publishable package, through
   `tooling/scripts/publishable-packages.mjs --set-version` (the set is derived
   from the workspace; there is no `lerna.json`), checks the set with
   `check-publishable-set.mjs`, stamps the Helm chart, rewrites the documented
   version pins, and regenerates the website mirrors
7. **Builds and tests** — `pnpm run build`, then `pnpm test`. A failing test
   warns and the release **continues**; the workflow is the path that gates on
   the full suite
8. **Records snapshots** — the project upgrade snapshot (needs Docker) and the
   auth schema snapshot (needs a `DATABASE_URL` this release booted against).
   Either one missing warns rather than stops
9. **Commits and tags** — `chore: release vX.Y.Z` and an annotated `vX.Y.Z`
10. **Pushes** `main` with its tags
11. **Publishes** — checks that no `workspace:` reference survives packing, then
    `pnpm -r publish`
12. **Creates the GitHub Release** with the stamped notes as its body

What it does not do: run `check-release-bump.mjs`, push the runtime image or the
Helm chart, or publish the MCP Registry entry (it prints the `mcp-publisher`
command to finish that by hand). Those happen only in the workflow, which is why
the workflow is the path to use.

## Release Notes

Nothing reads commit messages. What a release says is what is under
`## [Unreleased]` in `CHANGELOG.md`, written by hand as changes land (see
`CONTRIBUTING.md`). The version heading and date are stamped by the release,
never by hand.

A release whose contract baselines show a break — a removed export, a changed
derived name, a moved bundle or runtime contract version, a raised Node floor —
needs a `### Breaking` heading in that section and at least a minor bump.
`check-release-bump.mjs` refuses it otherwise; the workflow runs it before
stamping the changelog.

## CI: GitHub Actions

Both releases live in one workflow, `.github/workflows/publish.yml`, as two jobs
selected by the **channel** input. They are not split into two files because npm
allows only one trusted publisher per package, naming a single workflow file —
two files could never both be trusted.

Either channel runs only from `main`: a `guard-ref` job refuses any other ref
before anything else starts.

### Stable Release (manual trigger)

1. Go to **Actions** → **Publish** → **Run workflow**, on `main`
2. Leave **channel** on `stable`
3. Enter the version bump (`patch`, `minor`, `major`, or an explicit `X.Y.Z`)
4. Optionally enable **dry run** to preview

`verify-stable` runs the whole `verify.yml` gate on the commit first. Then
`publish-stable` waits for approval on the **`npm-stable`** GitHub environment,
and in order:

1. checks the Docker Hub and Artifact Registry credentials are set
2. installs and builds
3. determines the version, by the same derivation as the script
4. runs `check-release-bump.mjs` against the previous tag
5. stamps the changelog with `prepare-changelog.mjs` and extracts the notes,
   failing if there are none
6. bumps the versions, the Helm chart, the documented version pins and the
   website mirrors, then checks the publishable set and that no `workspace:`
   reference survives packing
7. publishes to npm over **OIDC** — there is no `NODE_AUTH_TOKEN`; pnpm exchanges
   the job's id-token for a short-lived token against each package's trusted
   publisher
8. commits `chore: bump version to X.Y.Z [skip ci]`, tags `vX.Y.Z`, and pushes
9. builds the runtime image once, for amd64 and arm64, and pushes it as
   `rebasepro/server:X.Y.Z` and `:latest` on Docker Hub and as the **fleet
   image** `X.Y.Z-<sha>` in Artifact Registry, then verifies both are pullable
10. asks the control plane to register the fleet image (its cron would within
    15 minutes anyway). Registering is not rolling out: the run summary prints
    the `pnpm release:runtime` command that does that
11. packages the Helm chart, pushes it to `oci://registry-1.docker.io/rebasepro`,
    and verifies it can be pulled
12. smoke-tests what it published: installs the CLI from npm, runs `init` and
    `dev`, registers a user and reads a collection
13. creates the GitHub Release from the notes, then publishes the MCP Registry
    entry

A dry run skips every step with a side effect: the npm publish, the commit and
tag, the images, the chart, the smoke test, the GitHub Release and the MCP
Registry.

### Canary Release (manual trigger)

1. Go to **Actions** → **Publish** → **Run workflow**, on `main`
2. Set **channel** to `canary`

**version** and **dry run** are stable-only and ignored here. The canary runs
the same `verify.yml` gate, then publishes from the `npm-canary` environment,
over OIDC, under the `canary` dist-tag. Its version is the next patch after the
last release tag, plus the commit:

```
<next patch>-canary.g<short sha>        e.g. 0.21.1-canary.g5b17f58
```

The `g` keeps the identifier alphanumeric: a short sha of digits alone with a
leading zero is not valid semver. Nothing is tagged, and the version bump is
never pushed.

Canary is not automatic. It used to publish on every push to `main`; a canary is
a release you decide to cut, so it is now triggered the same way stable is. Merges
to `main` still run the full gate — that is `ci.yml`, which calls the same
`verify.yml` this job does.

Install the latest canary:
```bash
pnpm add @rebasepro/app@canary
```

## Pre-releases

The workflow's version input takes only `patch`, `minor`, `major` or a plain
`X.Y.Z`, so a pre-release goes through the script, with an explicit version:

```bash
# Beta
pnpm release 0.2.0-beta.0

# RC
pnpm release 0.2.0-rc.1
```

The script publishes without a `--tag`.

## Requirements

For the script:

- On the `main` branch, level with `origin/main`
- Working tree clean
- [`gh` CLI](https://cli.github.com/) installed and authenticated
- `npm` authenticated (`npm login`) — this path publishes with your own
  credentials, not OIDC
- Docker, and a `DATABASE_URL`, for the two snapshots (each warns if missing)

For the workflow:

- No npm token. Publishing is OIDC against the trusted publisher each package
  has for `publish.yml`
- Approval on the `npm-stable` (or `npm-canary`) environment, per its protection
  rules
- `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`, and the Artifact Registry
  federation (`GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_RELEASE_SERVICE_ACCOUNT`;
  `./tooling/scripts/setup-release-wif.sh` creates it). The stable job checks
  for them before it publishes anything
- Optionally `REBASE_CONTROL_PLANE_ADMIN_KEY`, to register the fleet image
  immediately rather than within 15 minutes

## Dry Run

Preview what a release would do without making any changes:

```bash
pnpm release:dry
# or
./tooling/scripts/release.sh minor --dry-run
```

This shows:
- The calculated version
- The release notes it found under `[Unreleased]`
- What steps would be performed
