# Gates

Every automated check this repository runs, what it protects, where it runs, and
how to bank its baseline when it has one.

The list is not documentation in the usual sense: `pnpm check:gates-doc` reads
`package.json` and this file together and fails when they disagree, so a gate
added without a row here fails CI, and a row naming a script that no longer
exists fails too. A table nobody checks eventually tells a contributor that a
gate does not exist.

## Naming

Three prefixes, and the prefix says what kind of thing it is:

| Prefix | Means |
|---|---|
| `check:` | Reads the repository and refuses. Fast, hermetic, no network. |
| `verify:` | Exercises something end to end — a build, a self-host, a doc corpus. Slow. |
| `test:` | Runs a test suite. |

`write:` and `fix:` are the other half of a ratchet: they re-record a baseline
rather than checking it, and they are named in the table's last column rather
than being gates of their own.

**One script breaks the rule: `rls:check`.** It is not renamed to `check:rls`
because that name is printed in the docs site in six locales, in
`docs/compatibility.md` and in the audit notes, and the right fix for those
readers is not a different script name — it is to stop pointing them at a
monorepo script at all and give them `npx @rebasepro/rls-check`, which is the
published binary. Renaming first would leave twelve translated pages naming a
command that no longer exists. `check:gates-doc` carries this as its one exact
exception, so a *second* offender fails.

## Running them

```bash
pnpm ci:static      # every gate in the `static` job, in the same order
pnpm check:<name>   # one of them
```

`ci:static` skips the two gates needing a tool the repository cannot install
(Docker, Helm) and says so. Under CI it refuses to skip.

## The static job

Source-only. No build, no database, no browser. `pnpm ci:static` runs exactly
this list, in this order.

| Script | What it protects | Bank / fix |
|---|---|---|
| `typecheck` | The authoritative type gate: the monorepo and `tsconfig.tests.json`, resolving `@rebasepro/*` to source, so a stale `dist` cannot make it pass. | — |
| `check:core-types` | The core packages with `@rebasepro/cms-types` absent, which the gate above structurally cannot check. | — |
| `check:headless` | The backend never *executes* React or a UI package: every collection file imported under a rejecting loader hook. | — |
| `check:types-headless` | The type-level counterpart — sources, built `.d.ts` and manifests, where thirteen files once imported React types a BaaS install could not resolve. | — |
| `check:browser-deps` | A published package declaring a browser-only dependency without naming React, which neither guard above sees. | — |
| `check:baas-types` | A real BaaS project typechecked with `react` mapped to a stub: a React type reached through an alias. | — |
| `check:runtime-image` | Every container image the shipped files name has a workflow that publishes it. | — |
| `check:runtime-deps` | The packages the runtime image promises to supply are installed there, at a compatible version, with their own dependencies and peers. | — |
| `check:chart` | The Helm chart lints, renders its three documented topologies, and every refusal in `_validate.tpl` is still reachable. Needs Helm. | — |
| `check:runtime-image:boots` | The image actually starts, both ways a bundle can arrive, and still refuses when given neither. Needs Docker. | — |
| `check:names` | A package rename leaking into a bare string, a `.astro` file, an `.env.example` or a Tailwind `@source` path. | — |
| `check:deps` | Every published package declares what it imports, so it resolves under pnpm's isolated layout and not only under hoisting. | — |
| `check:publishable-set` | The release derives its own package set from the workspace instead of enumerating it. | — |
| `check:package-contents` | What each published tarball actually contains — tests shipped by accident, sources shipped on purpose. | — |
| `check:lint` | ESLint errors (`--quiet`), which no pipeline ran at all until one sat on main. | — |
| `check:hooks` | A ratchet over `exhaustive-deps` warnings: 183 candidate stale closures, and the 184th would have hidden among them. | `pnpm check:hooks --update` |
| `check:unused` | A ratchet over values computed and discarded — where the bugs are, not the tidiness. | `pnpm check:unused --update` |
| `check:test-scripts` | Every package declares `test` and `test:watch`. A package without one is not reported as skipped; it is not reported at all. | `KNOWN_WITHOUT_TESTS` in the script |
| `check:control-chars` | A literal NUL in a source file, which makes grep classify it as binary and skip it in silence. | — |
| `check:untranslated` | A ratchet over admin strings written as English literals beside a translation key that already exists. | `pnpm check:untranslated --update` |
| `check:glued-code` | Prose glued to an inline tag — "or runrebase dev" — which Astro and JSX produce from a newline and no diff shows. | — |
| `check:contributor-setup` | CONTRIBUTING, `app/.env.example` and the compose file agreeing about the local database. | — |
| `check:gates-doc` | This file against `package.json`, and the naming rule above. | Add the row |
| `verify:docs:strict` | Every documented snippet compiles against workspace source, in every locale. | — |
| `check:derived-names` | The identifiers this framework writes into a customer's database — columns, constraints, policies, junction tables — which outlive every release after them. | `pnpm write:derived-names` |
| `check:portable-core` | A ratchet on what the request path needs Node for. May shrink, may never grow. | `pnpm check:portable-core --write` |
| `check:schema-fresh` | The checked-in `schema.generated.ts` still describes the schema this release derives. | `rebase db generate`, or `rebase dev` |

## After the build

`build-gates` builds first, then runs only the gates that read what it emitted.

| Script | What it protects | Bank / fix |
|---|---|---|
| `check:api-surface` | The public export surface of every package, as a committed contract. | `pnpm write:api-surface` |
| `check:dts` | Published `.d.ts` resolve under `nodenext`, where they were silently `any`. | — |
| `check:templates` | The scaffolded collection files compile, once per preset, laid out as `rebase init` lays them out. | — |
| `check:eject` | An ejected project typechecks against built output. | — |
| `check:examples` | `examples/*` compile against built output, like a real user. | — |
| `check:resource-graphs` | The resource graph a project declares matches what the runtime reads. | — |
| `check:bundle` | The eager-JS budget of the admin bundle, both directions: growth, and a shrink that means the baseline is stale. | `pnpm check:bundle --update` |
| `check:docs-imports` | Every identifier the docs import exists in the API-surface baseline. | `pnpm write:api-surface` |
| `check:legacy-rls` | Whether the legacy RLS path is finally removable, so it does not outlive its reason. | — |
| `check:generated` | `llms.txt`, `llms-full.txt`, `sitemap.md` and the per-locale changelog mirrors are current. | `pnpm -C website generate-all` |
| `test:gates` | The gate scripts' own unit tests. | — |

## Tests and end to end

| Script | What it protects | Bank / fix |
|---|---|---|
| `test` | Every package's unit suite, serialized (`--workspace-concurrency=1`). | — |
| `test:harness` | The agent harness's own tests. | — |
| `verify:selfhost` | A self-hosted deploy, built and booted from the repository. | — |
| `verify:selfhost:docker` | The same, through the shipped compose file and image. | — |
| `verify:corpus` | A corpus of bundles still loads under the current runtime contract. | — |
| `rls:check` | A live database against the fifteen RLS checks, with table and policy floors so an empty database cannot pass. | `tooling/scripts/rls-baseline.json` |

## Release only

Run by `publish.yml` and `release.sh`, not on a pull request.

| Script | What it protects | Bank / fix |
|---|---|---|
| `check:release-bump` | The bump you asked for matches what `## [Unreleased]` says changed. | Edit the changelog |
| `check:version-pins` | Version numbers written into the docs match the release. Also runs inside `verify:docs`. | `pnpm fix:version-pins` |
| `check:runtime-image:live` | The published image tag actually answers, which the hermetic check deliberately does not ask. | — |
| `verify:docs` | The non-strict form, for working locally before `verify:docs:strict` gates the PR. | — |
