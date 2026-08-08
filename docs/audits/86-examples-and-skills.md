# Unit 86 — `examples/**` and `rebase-agent-skills/**`

*Read-only audit, 2026-08-08. Lens: bug-classes.md class 34 — "documentation the
verifier cannot see, because it is not documentation."*

---

## Verdict

Both directories are inside a CI net, and both nets are narrower than their own
comments claim. `rebase-agent-skills/**/*.md` is genuinely covered — it is in
`DEFAULT_GLOBS` (`scripts/docs-verify/extract.mjs:73`) and in `ALL_DOC_GLOBS`
(`scripts/docs-verify/check-api-names.mjs:27`), and `verify.yml:185` runs
`verify:docs:strict`. I re-ran the cheap stage: clean, zero findings. But that
coverage is **fenced TypeScript only**. Of 1,076 fences in the 20 SKILL.md files,
273 `typescript` + 116 `tsx` are compiled; 51 `bash`, 35 `json`, 4 `env`, 2
`yaml` and 1 `dockerfile` are not, and 39 ts/tsx fences opt out with `no-verify`.
The CLI-command check that class 34 was written to add — deriving `rebase <cmd>
<sub>` from `cli.ts` and the driver — exists, but its glob is
`website/src/{components,pages}` only (`check-marketing-snippets.mjs:33`). It has
never been pointed at the skills. Same for the deploy build-context lint
(`check-deploy-build-context.mjs:24-27`), which covers six locales of
`website/**/deployment/*.md` and not
`rebase-agent-skills/skills/rebase-deployment/SKILL.md`, a file that is 900 lines
of Dockerfiles and compose manifests. Everything I found in the skills lives in
exactly those gaps: a dead `db` subcommand in two tables, two commands documented
as "No options" that grew seven and two, an `npm install -g rebase` that installs
a stranger's package, and three MCP server manifests that name a file
(`dist/cli.js`) which has never existed in `@rebasepro/mcp`.

`examples/**` is worse off, in a quieter way. `check:examples`
(`verify.yml:218`) runs each example's `typecheck` script and both pass clean
today — so the *code* is not drifting. But `**/examples/**` is in the root ESLint
ignore list (`eslint.config.mjs:41`), so the lint, the hooks ratchet and the
discarded-value ratchet never look at them; and no glob in the repo covers
`examples/**/*.md`, so both READMEs — the front door of each example — have been
unverified since they were written. Both are wrong. `examples/sdk-demo/README.md`
opens with `pnpm run dev:backend`, a script that does not exist in `app/`, and
then tells the reader to `npm install` a package whose dependencies are
`workspace:*`. `examples/firebase/README.md` is a FireCMS-era document: it says
`yarn`, discusses `react-scripts` (absent from `package.json` since before the
rename), and points at a `firebase_config.ts.template` that is not in the tree.
The gate comment at `verify.yml:213-216` claims the examples "resolve
`@rebasepro/*` to built output like a real user does, not to source like `pnpm
typecheck`" — that is true of `sdk-demo` and false of `firebase`, whose
`tsconfig.json:24-42` maps six `@rebasepro/*` specifiers straight at
`../../packages/*/src`. The one example placed after the build specifically to
catch dist drift mostly cannot.

The single most important finding is the MCP manifest: every agent that adopts
this bundle through Claude, Cursor, Gemini or Kiro gets a server config pointing
at a nonexistent entrypoint, while five skills instruct the agent to prefer MCP
tools over the SDK.

---

## Inventory

### Examples

| Example | Demonstrates | Version pinning | API drift found | Verdict |
|---|---|---|---|---|
| `examples/sdk-demo` | `@rebasepro/client` end to end: `createRebaseClient`, `client.auth.*`, `client.data.collection().observe()/find()`, `offline: true` + `client.offline.sync()`, a simulated-network switch. React 19 + Vite 8. | `@rebasepro/client: workspace:*` | **None in code** — `tsc -b --force` exits 0 against built dist. All drift is in the README. | **Code green, README broken.** Two of the four commands in "Prerequisites"/"Running" cannot succeed. |
| `examples/firebase` | The Firebase adapter: `RebaseFirebaseApp`, `FirebaseAccessGate`, `FirebaseUserWrapper`, four collection files (`blog`, `demo`, `products`, `users`). | Six `@rebasepro/*` at `workspace:*` | **None in code** — `tsc --noEmit` exits 0. Four of the six declared `@rebasepro/*` deps (`admin`, `app`, `types`, `ui`) are never imported from `src/`; `vite-plugin-svgr` is declared and unused. | **Stale on every axis except types.** README describes a project that no longer exists; a real Firebase config is committed; typechecks against source, not dist. |

### Skills

All 20 have well-formed frontmatter with a `name` and a trigger-shaped
`description`; none is dead weight on the frontmatter axis. Drift below is only
what the existing verifier structurally cannot see.

| Skill | Demonstrates | Drift found | Verdict |
|---|---|---|---|
| `rebase-basics` | Prereqs, scaffold layout, the whole CLI surface, MCP tools, troubleshooting | **`rebase db studio` (:280) does not dispatch**; `rebase build` "No options" (:235) — 7 exist and the command now builds bundles; `rebase start` "No options" (:243) — 2 exist and it now runs a bundle; scaffold tree lists `drizzle.config.ts` (:67) which is nowhere in the template, and omits `rebase.json` which is; `db` table omits `backup`/`restore`/`backups`; `generate-sdk` table omits `--from`/`--token`; package tree omits `admin-types` and `rls-check` | **Drifted** — the CLI reference is the most-read section and it is behind |
| `rebase-local-env-setup` | First-time env setup | Documents the **framework monorepo**, not a user project: `cp app/.env.example app/.env` (:114), "Run CLI commands from the `app/` directory" (:154), "installs all workspace packages (`packages/*`, `app/frontend`, `app/backend`)" (:148). A scaffolded project has `backend/`, `frontend/`, `config/`, `rebase.json` at the root and no `app/` or `packages/` at all. Also asserts the backend "defaults to port `3001`", contradicting `rebase-basics`' correct per-project hash | **Wrong audience** — every path in §4, §5, §6 is absent from the project it is installed into |
| `rebase-backend-postgres` | Postgres driver, Drizzle, pooling, replicas | **`rebase db studio` (:64)**; command table omits `backup`/`restore`/`backups`; no mention of `db push --allow-destructive`/`--yes`, which is the flag a non-TTY agent needs when the destructive gate refuses (`server-postgres/src/cli.ts:252-256`) | Drifted |
| `rebase-deployment` | Cloud, Docker, AWS/GCP/Azure/Scaleway/Hetzner/PaaS | Cloud section correct (`login`/`link`/`deploy`/`--message` all dispatch) and explicitly warns that bare `rebase deploy`/`rebase login` do not exist (:45). Documents 4 of 38 `cloud` subcommands. Build contexts are all correct — but by authorship, not by gate | Clean-but-ungated |
| `rebase-realtime` | WS engine, channels, presence, history | Accurate, including `realtime.bus` opt-in and the memory-fallback trap | Clean |
| `rebase-storage` | Local/S3/GCS, TUS, transforms, sources | Accurate, including the `authorize` requirement | Clean |
| `rebase-auth` | Auth, roles, RLS, MFA, API keys, adapters | Clean on the identifier axis (the `rebase.*` RLS-helper fix from the last sweep held) | Clean |
| `rebase-security` | Layered security, RLS as the real model | `rebase doctor --policies` verified to dispatch (`server-postgres/src/cli.ts:1157`) | Clean |
| `rebase-collections` | Property types, validation, search | Clean | Clean |
| `rebase-sdk` | Generated SDK + client | References `examples/sdk-demo/` (:813) — which is real, but whose README does not run | Clean |
| `rebase-api` | REST + GraphQL surface | Clean | Clean |
| `rebase-admin` | Admin navigation, drawers, URLs, custom Field/Preview | Clean | Clean |
| `rebase-ui-components` | `@rebasepro/ui` | Clean | Clean |
| `rebase-design-language` | Design tokens, layout, view skeletons | **Points 3× at `references/view-patterns.md` (:43, :52, :737) — a 379-line file that `rebase skills install` never copies** (`packages/cli/src/commands/skills.ts:82`) | Broken on install |
| `rebase-cron-jobs` | Built-in scheduler, `ctx.client` | Clean | Clean |
| `rebase-custom-functions` | `functionsDir` auto-discovery | Clean | Clean |
| `rebase-webhooks` | `WebhookDispatcher` | Clean | Clean |
| `rebase-email` | SMTP, templates, providers | Clean | Clean |
| `rebase-entity-history` | Audit log, revert | Clean | Clean |
| `rebase-studio` | 9 dev tools, admin modes | Clean | Clean |

### Non-skill files in the bundle

| File | Purpose | Drift found | Verdict |
|---|---|---|---|
| `.mcp.json`, `kiro/mcp.json`, `gemini-extension.json` | MCP server launch config for Cursor / Kiro / Gemini | **All three run `node node_modules/@rebasepro/mcp/dist/cli.js`. That file does not exist** — `packages/mcp/src/` holds only `index.ts`, `main` is `dist/index.js`, `bin` is `bin/rebase-mcp.js`. Node exits `ERR_MODULE_NOT_FOUND` | **Broken** |
| `README.md` | Install instructions | Six references to `github.com/rebaseco/agent-skills` (:16, :24, :32, :38, :52) against `package.json`'s `github.com/rebasepro/rebase`; Windsurf target given as `.windsurfrules/` where the CLI writes `.windsurf/rules`; **`rebase skills install` — the first-party install path — is never mentioned** | Drifted |
| `REBASE.md` | Gemini context file / master skill | Accurate | Clean |
| `kiro/POWER.md` | Kiro onboarding | **`npm install -g rebase` (:25) and `npx rebase --version` (:24)** — `rebase` on npm is an unrelated package; the CLI is `@rebasepro/cli` | **Broken** |
| `.claude-plugin/plugin.json`, `.cursor-plugin/plugin.json` | Plugin manifests | `homepage`/`repository` at `rebaseco/agent-skills`; pinned at `version: 1.0.0` while the npm package is `0.13.0` | Cosmetic |

---

## Findings by severity

### HIGH

**H1. Every MCP server manifest in the bundle names a file that has never
existed.**
`rebase-agent-skills/.mcp.json:6`, `rebase-agent-skills/kiro/mcp.json:6` and
`rebase-agent-skills/gemini-extension.json:9` all launch:

```
node node_modules/@rebasepro/mcp/dist/cli.js
```

`packages/mcp/src/` contains a single file, `index.ts`; `packages/mcp/dist/`
contains `index.js` and its map. `packages/mcp/package.json` declares
`"main": "dist/index.js"` and `"bin": {"rebase-mcp": "bin/rebase-mcp.js"}`. There
is no `cli.ts` to build a `cli.js` from. The correct invocation is what the
website already uses (`website/src/components/pages/AiContent.astro:17`):
`npx @rebasepro/mcp`.

This is load-bearing. `rebase-basics/SKILL.md:40` instructs agents to *"prefer
the MCP tools (`list_documents`, `get_document`, `create_document`, etc.) over
writing manual API calls"*, and `kiro/POWER.md` frames the whole onboarding
around the MCP server. Every one of those agents gets a server that fails to
start. Compounding it, `@rebasepro/agent-skills` declares no dependency on
`@rebasepro/mcp`, so `node_modules/@rebasepro/mcp` is usually absent anyway.

**H2. `rebase skills install` silently drops every `references/` file.**
`packages/cli/src/commands/skills.ts:80-86` reads exactly
`<skill>/SKILL.md` per directory and nothing else. `rebase-design-language`
instructs the agent three separate times (`SKILL.md:43`, `:52`, `:737`) to *"read
`references/view-patterns.md` and copy the closest skeleton"* — 379 lines of
whole-view skeletons that never reach the target project. The instruction is not
soft: *"Extend an existing pattern; do not invent a layout."* An agent that
cannot find the file does the one thing the skill forbids.

Nineteen other skills carry an empty `references/.gitkeep`, so the loss is
currently one file — but the format the bundle advertises (Agent Skills,
`README.md:7`) is progressive-disclosure with a `references/` tree, and the
installer cannot carry it.

**H3. `kiro/POWER.md:25` installs the wrong package.**
`npm install -g rebase` — `rebase` on the public registry is not this project.
The canonical form is `pnpm dlx @rebasepro/cli init` (`README.md:73`) or a global
install of `@rebasepro/cli`. `POWER.md:24`'s `npx rebase --version` has the same
defect: it downloads and executes a stranger's package to check this one's
version.

### MEDIUM

**M1. `rebase db studio` is documented as a working command in two skills and
exits 1.**
`rebase-basics/SKILL.md:280` (*"Open Drizzle Studio (visual database browser)"*)
and `rebase-backend-postgres/SKILL.md:64`. The driver's allowlist is
`packages/server-postgres/src/cli.ts:85`:

```ts
const VALID_ACTIONS = ["push", "generate", "migrate", "branch", "backup", "restore", "backups"];
```

Anything else prints `Unknown db command. Valid: …` and `process.exit(1)`. The
same two tables omit `backup`, `restore` and `backups`, which do exist — so the
one CLI reference an agent has is wrong in both directions.

**M2. `rebase build` and `rebase start` are documented with their pre-bundle
behaviour and "No options".**
`rebase-basics/SKILL.md:235`: *"Runs the build script across all workspace
packages using the detected package manager (pnpm or npm). No options."* That is
now the `--legacy` path (`packages/cli/src/commands/build.ts:86-89`). The default
reads `rebase.json` and produces a **bundle** — the artifact the runtime loads
(`build.ts:1-13`) — and accepts `--output`/`--out`, `--skip-type-check`,
`--skip-schema`, `--no-static`, `--skip-static-build`, `--legacy`, `--help`
(`build.ts:56-76`). `SKILL.md:243` says the same of `rebase start`, which takes
`--bundle` and `--legacy` and runs a built bundle (`start.ts:37-41`). An agent
told to "build for production" from this skill produces workspace output and
never a bundle.

**M3. `rebase.json` is documented in zero skills.**
Grep across all 20 SKILL.md files plus `README.md`, `REBASE.md` and `POWER.md`
returns nothing for `rebase.json`, `project manifest`, or the `apps` block. It is
scaffolded by `rebase init` (confirmed at the root of both e2e scaffolds), it is
what `rebase build` loads to decide what to build (`build.ts:92`), and
`RebaseProjectManifest` (`packages/types/src/types/project_manifest.ts:173-217`)
carries `apps`, `storage`, `telemetry`, per-app `runtime: "managed" | "custom"`,
`dockerfile`, `port`, static `root`/`build`/`output`/`path`/`spa`. The scaffold
tree in `rebase-basics/SKILL.md:57-70` omits it and instead lists
`drizzle.config.ts`, which does not exist anywhere in `packages/cli/templates/`
or in either scaffolded e2e project.

**M4. `rebase-local-env-setup` documents the framework monorepo as if it were the
user's project.**
`SKILL.md:111-117` says to `cp app/.env.example app/.env`; `:148` says
`pnpm install` *"installs all workspace packages (`packages/*`, `app/frontend`,
`app/backend`)"*; `:154` says *"Run CLI commands from the **`app/`**
directory"*; `:187` cites `app/.env.example` as the env reference. A project
scaffolded by `rebase init` has `backend/`, `config/`, `frontend/`,
`rebase.json`, `.env`, `.env.example` at the **root** and no `app/` or
`packages/` directory. `rebase-basics` gets this right — it labels its monorepo
tree *"For development of the Rebase framework itself"* (`:85`) and shows the
scaffold separately — but `rebase-local-env-setup` makes no such distinction, and
its own description tells agents to use it for all first-time setup. §4, §5 and
§6 are unrunnable in the project the skill ships into. It also states the backend
*"defaults to port `3001`"*, contradicting `rebase-basics:212`'s correct
description of the per-project deterministic hash (3001–3999).

**M5. `examples/sdk-demo/README.md` cannot be followed.**
Line 32: `pnpm run dev:backend` — `app/package.json` has no such script (its
scripts are `dev`, `build`, `start`, `db:*`, `schema:*`, `generate:sdk`,
`deploy`). Lines 41-42: `npm install && npm run dev` inside `examples/sdk-demo`,
whose only runtime dependency is `"@rebasepro/client": "workspace:*"`. The repo
root declares no npm `workspaces` field — pnpm workspaces are declared in
`pnpm-workspace.yaml` — so npm resolves that specifier standalone and fails with
`EUNSUPPORTEDPROTOCOL`. Both commands are in the two sections a first-time reader
runs first. (`app/README.md:57` carries the same phantom `pnpm dev:backend`,
outside this unit's scope but the same root cause.)

**M6. `examples/firebase/README.md` describes a project that no longer exists.**
Line 12 points at *"a template `firebase_config.ts.template`"* — the tree
contains `src/appcheck_config.ts.template` and no `firebase_config.ts.template`.
Lines 17 and 23 instruct `yarn` / `yarn dev` in a pnpm-only monorepo. Lines 27-30
say *"This project implements both vite, and react-scripts… Users of the library
will only need one of them, most likely `react-scripts`"* — `react-scripts` is
not in `package.json` and the recommendation inverts the actual toolchain.
`.env.template` likewise documents `REACT_APP_ALGOLIA_*` variables for a
dependency the example does not have.

**M7. The example the gate placed after the build typechecks against source.**
`verify.yml:213-216` justifies running `check:examples` after `pnpm build`:
*"They resolve `@rebasepro/*` to built output like a real user does, not to
source like `pnpm typecheck`, which is exactly why they catch a different class
of drift."* True for `sdk-demo` (no `paths`; resolves through the workspace link
to each package's `exports` → `dist`). False for `examples/firebase`:
`tsconfig.json:24-42` maps `@rebasepro/app`, `/firebase`, `/types`, `/common`,
`/ui`, `/admin` at `../../packages/*/src`, and neither it nor its parent
`packages/app/tsconfig.json` sets `baseUrl`, so those paths resolve relative to
the example's own config — straight at source. Note the program is *mixed*:
`@rebasepro/firebase` is in the `paths` map so it resolves to source, but a
specifier not listed there would resolve to dist. The example cannot catch a
missing or stale dist export, which is the class it was positioned to catch.

### LOW

**L1. `examples/firebase/.gitignore` uses `./`-prefixed patterns, which never
match, so a real Firebase config is committed.**
`.gitignore:2-4` lists `./src/firebase_config.ts`, `./src/appcheck_config.ts`,
`./src/SampleApp/SampleApp.tsx`. Git ignores patterns beginning with `./`;
`git check-ignore -v examples/firebase/src/firebase_config.ts` exits 1 (not
ignored) and `git ls-files` shows the file tracked — directly contradicting
`README.md:11` (*"which is not in VCS"*). The tracked file holds a live FireCMS
demo project's web config (`firecms-demo-27150`, `demo.firecms.co`). Firebase web
API keys are not secrets, so this is not a credential leak; it is stale
third-party branding shipped in a Rebase example, and the ignore rule that was
supposed to prevent it has never worked.

**L2. The same Firebase config is duplicated inside `App.tsx`, and the tracked
one is dead.**
`examples/firebase/src/App.tsx:13-22` declares and exports its own
`firebaseConfig`; `src/firebase_config.ts:10-19` holds an identical copy that
nothing imports. `package.json`'s `deploy` script targets site
`rebase-demo-27150` while every config value inside points at
`firecms-demo-27150`. `App.tsx:38` computes `userIsAdmin` and discards it — a
finding `check:unused` would report if examples were not ESLint-ignored.

**L3. `rebase-agent-skills/README.md` documents an install path the repo does not
provide, and omits the one it does.**
Five of its six options route through `github.com/rebaseco/agent-skills`
(`:16`, `:24`, `:32`, `:38`, `:52`) — a different org from `package.json`'s
`github.com/rebasepro/rebase`. Whether that mirror repo exists is UNCONFIRMED (no
network check made), but the two spellings cannot both be right, and `rebase
skills install`, the CLI's own installer with support for four agents, is not
mentioned once. `:57` also gives the Windsurf target as `.windsurfrules/` where
`packages/cli/src/commands/skills.ts:35-36` writes `.windsurf/rules`, and lists
GitHub Copilot, which the installer does not support.

**L4. `db push`'s destructive gate is undocumented.**
`packages/server-postgres/src/cli.ts:235-256` refuses a destructive push in a
non-TTY unless `--allow-destructive` or `--yes` is passed. No skill mentions
either flag, and `rebase-backend-postgres`'s command table lists no options at
all. An agent running `rebase db push` in CI after removing a field gets exit 1.
The error message does name the flag, so this is recoverable — hence LOW, not
MEDIUM.

**L5. `**/examples/**` is ESLint-ignored, so three ratchets skip them.**
`eslint.config.mjs:41`. `npx eslint . --quiet` (`verify.yml:133`), the hooks
ratchet (`:147`) and the discarded-value ratchet (`:156`) all pass over both
examples. `examples/sdk-demo` ships its own `eslint.config.js` and a `lint`
script that nothing invokes — `check:examples` runs only `typecheck`.
`examples/firebase` declares six ESLint plugins and has no config file at all.

**L6. `check:examples` is silently skippable.**
`pnpm --filter "./examples/*" -r run typecheck` skips a package with no
`typecheck` script without reporting it — the exact shape `check:test-scripts`
exists to prevent for tests (`verify.yml:159-163`). A third example added without
that script joins the pipeline as a no-op.

**L7. Cosmetic manifest drift.** `.claude-plugin/plugin.json` and
`.cursor-plugin/plugin.json` are pinned at `version: "1.0.0"` while the npm
package is `0.13.0`. `gemini-extension.json:29-52` defines a theme built on
`#FF6B35` orange; the Rebase design language is blue `#0070F4`
(`rebase-design-language/SKILL.md`). `package.json`'s `files: ["skills/"]` means
an npm consumer receives no plugin manifests, no `.mcp.json`, no `REBASE.md` and
no `kiro/` — fine if distribution is git-only, worth stating if it is not.

---

## Checked and clean

- **`pnpm verify:docs --names` baseline.** Ran stage 1+3 in JSON mode: `names: []`,
  `deployBuildContext: []`, `marketing: []`. Every `@rebasepro/*` named import in
  every skill is genuinely exported. (Stage 2, the snippet compile, was not run —
  CI runs it `--strict` and main is green.)
- **The class-34 denylist, re-applied to the skills by hand.** Zero hits for
  `createClient(`, `rebase.init(`, `client.<x>.retrieve/list(`, `.where("f",
  "eq", …)`, `channel.on(`, `@rebasepro/sdk_generator`. The RLS-helper fix
  (`auth.uid()` → `rebase.*`) from the last sweep has held in `rebase-auth`,
  `rebase-security` and `rebase-collections`.
- **`rebase login` / `rebase deploy`.** The four skill files the last sweep fixed
  are still fixed; `rebase-deployment/SKILL.md:45` now carries an explicit warning
  that neither exists. The only remaining occurrences of those strings *are* that
  warning.
- **Deploy build contexts in `rebase-deployment/SKILL.md`.** All four
  `check-deploy-build-context.mjs` rules applied manually: zero hits. Every
  `docker build` uses `-f app/backend/Dockerfile .`; every compose `context:` is
  `.` or `../..`. Correct — but by authorship, since the check's glob excludes
  this file.
- **Both examples typecheck.** `examples/sdk-demo`: `tsc -b --force` → exit 0.
  `examples/firebase`: `tsc --noEmit` → exit 0. No removed or renamed API is
  imported by either.
- **Skill frontmatter.** All 20 parse, all carry `name` + `description`, and every
  description contains an explicit "Use this skill when…" trigger clause. No dead
  skill on this axis.
- **`rebase doctor --policies`.** Dispatches — `doctor` forwards `rawArgs.slice(2)`
  to the driver (`packages/cli/src/commands/doctor.ts:79`), which declares
  `"--policies": Boolean` (`server-postgres/src/cli.ts:1157`) and honours it
  (`schema/doctor-cli.ts:72`).
- **`rebase-realtime` on the channel bus** and **`rebase-storage` on `authorize`**
  both match current behaviour, including the two failure modes that bite in
  production (memory-bus fallback behind a load balancer; key-unguessability as a
  non-model).
- **Committed build output.** `examples/firebase/build/` and
  `examples/sdk-demo/dist/` are local artifacts — `git ls-files` returns zero
  tracked files under either.
- **`@rebasepro/agent-skills` version** is `0.13.0`, in lockstep with all 22
  workspace packages.

---

## Recommendation — bringing both directories under an automated check

Four changes, cheapest first. The first two are the ones that would have caught
everything HIGH and MEDIUM above.

1. **Extend the CLI-command check to the skills (and the examples' READMEs).**
   `check-marketing-snippets.mjs` already derives the command tree from
   `cli.ts` + `server-postgres/src/cli.ts` — the hard part is done. Split
   `loadCliCommands` + the `CLI_INVOCATIONS` scan into a shared module and run it
   over `rebase-agent-skills/**/*.md` and `examples/**/*.md`, with a shell-prompt
   pattern (` ```bash ` fences and `$`-prefixed lines) instead of the
   markup-oriented one. That alone flags `rebase db studio` ×2. Then add a **flag**
   axis: `arg({...})` specs are greppable per command module, and a
   `rebase <cmd> --unknown-flag` in a doc is as broken as an unknown subcommand —
   that catches the "No options" claims from the other side.

2. **Validate the bundle's own manifests against the packages they name.** A
   twenty-line script: for each of `.mcp.json`, `kiro/mcp.json`,
   `gemini-extension.json`, resolve `args[0]` against the workspace and assert the
   file exists; assert every `command`/package named in a skill's install
   instructions resolves to a real `@rebasepro/*` package. This is the check that
   catches H1 and H3, and neither is findable by any glob over markdown.

3. **Make the skills installer copy `references/`, and gate on it.** Change
   `loadSkills` to walk the whole skill directory rather than just `SKILL.md`,
   then add a link check: every `` `references/…` `` mentioned in a SKILL.md must
   exist on disk *and* survive `rebase skills install` into a temp dir. This is a
   two-part fix — the installer bug (H2) and the guard that stops it recurring.

4. **Cover `examples/**/*.md`, and stop the examples being silently skippable.**
   Add `examples/**/*.md` to `check-api-names.mjs`'s `ALL_DOC_GLOBS` and to
   `extract.mjs`'s `DEFAULT_GLOBS` — they are documentation by every definition in
   class 34. Separately, extend `scripts/check-test-scripts.mjs`'s pattern to
   assert every directory under `examples/` declares a `typecheck` script, and
   drop `**/examples/**` from `eslint.config.mjs:41` (both examples lint clean
   enough to bank a baseline; `sdk-demo` already ships a config).

   The stronger version, if the appetite exists: a `check:example-readmes` that
   extracts every ` ```bash ` fence from an example README and asserts each
   `pnpm run <script>` / `npm run <script>` names a script that exists in the
   package.json the fence's `cd` lands in. That is what M5 needs, and it
   generalises to `app/README.md`, which has the same defect.

Finally, **correct the comment at `verify.yml:213-216`**, or correct
`examples/firebase/tsconfig.json` to match it. A gate whose stated rationale is
false is worse than no gate: it is the reason nobody re-examines the blind spot.

---

## Open questions

1. **Does `github.com/rebaseco/agent-skills` exist?** Five install paths in
   `rebase-agent-skills/README.md` depend on it, and `package.json` names a
   different org. If it is a real mirror, what syncs it — and does the mirror
   carry the `references/` files this repo has? If it is not, the entire
   Installation section is dead. UNCONFIRMED — no network check was made.
2. **Is `examples/firebase` still wanted?** It typechecks, so it holds
   `@rebasepro/firebase` honest — but nothing else about it is current, and it
   ships a third-party product's demo project config into a repo positioned
   backend-first. Retire, or re-point at a Rebase-owned Firebase project and
   rewrite the README?
3. **Should `rebase-local-env-setup` exist at all?** Its content is
   contributor-onboarding for this monorepo, its distribution is user projects.
   Either re-scope it to the scaffold (and merge the monorepo half into
   `CONTRIBUTING.md`), or exclude it from `rebase skills install`.
4. **Should the skills bundle ship an MCP config at all**, given
   `@rebasepro/mcp` is not among its dependencies? Fixing the path to
   `dist/index.js` still leaves a config that only works if the user installed the
   package separately. `npx @rebasepro/mcp`, as the website uses, has no such
   precondition.
5. **Which side is authoritative on `examples/firebase`'s module resolution** —
   the tsconfig `paths` (source) or the CI comment (dist)? Removing the `paths`
   block would make the example do what the gate claims, at the cost of requiring
   a build before a local typecheck.
