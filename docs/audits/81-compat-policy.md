# Unit 81 — the compatibility contract for a 1.0 (policy half)

Read-only audit, 2026-08-08. Companion to
[`api-surface-audit-2026-08-05.md`](api-surface-audit-2026-08-05.md), which
covered *what is exported*. This covers *what is allowed to change, and what
enforces that*.

---

## Verdict

`docs/compatibility.md` is a genuinely good document about **five of the six
things a release can break**, and the two gates it centres on —
`check:derived-names` and the bundle/runtime contract constants — are among the
strongest compatibility gates I have read in any repository this size: both
classify their diff by severity, both fail on additions so a baseline cannot
drift silently, both have non-vacuity floors, and `derived-names.mts` even
refuses to run against stale `dist` because its first draft passed against a
checkout where the contract was broken. That is a real engineering standard.

The problem is what the document is *about*. It is a policy for the **artifact**
contracts — the bundle, the image, the database — and it is explicit that the
**authored TypeScript API is not covered**: "Breaking changes to the authored
TypeScript API are still allowed in a minor." That is a coherent 0.x position.
It is also the entire content of a 1.0 promise, and the document contains no
plan for it: the strings `1.0`, `deprecat`, and `support` do not appear in
`docs/compatibility.md` at all. There is no statement of what is public versus
internal (beyond "not re-exported from the barrel"), no deprecation window, no
support window, no definition of what a Rebase major would mean for a user's
`package.json`. The one gate that *does* guard a JS surface —
`scripts/check-api-surface.mjs`, which exists and runs on every PR — is not
mentioned anywhere in the policy document, and its coverage has a hole at
exactly the export every user touches.

Per axis:

| # | Axis | Gate | Verdict |
|---|---|---|---|
| 1 | JS/TS API surface | `check:api-surface` (`verify.yml:209`) | **partial** — one package of 22, names only, and the singleton is uncovered (H2) |
| 2 | HTTP wire format | — | **none** (M1) |
| 3 | DB schema + derived names | `check:derived-names`, `upgrade-e2e`, `project-upgrade-e2e` | **strong**, with a prunable fixture (M3) |
| 4 | Config file format | `manifest-consistency.test.ts`, `AssertNever` in `validate-config.ts` | **good** |
| 5 | CLI flags | — | **none** (M2) |
| 6 | Runtime/driver contract | `bundle-compat.test.ts`, `verify:corpus`, boot refusal | **strong**, with a hand-copied constant in the control plane (M4) |

Every gate that exists **is** wired into PR CI: `ci.yml:4` runs `verify.yml` on
`pull_request: [main]` and on push, and `publish.yml` calls the same reusable
workflow for both canary and stable. The gates are real. The gaps are the axes
nobody built a gate for, and the release step that decides what number goes on
the box.

**Counts: 3 High, 7 Medium, 5 Low.**

---

## High

### H1. The policy has no 1.0 half: no public/internal boundary, no deprecation window, no support window

`docs/compatibility.md` (whole file), `docs/compatibility.md:11`,
`docs/compatibility.md:168-181`.

The document opens with "Rebase is `0.x`. **Breaking changes to the authored
TypeScript API are still allowed in a minor**", and the "What is *not* frozen"
section (`:168`) lists the authored TypeScript API, four packages by name, and
"anything under a package's `src/` that is not re-exported from its barrel".
That is the complete statement of public-versus-internal, and it is a negative
list.

What is absent, verified by grep over the file:

- `1.0` — no occurrence. The document never says what changes at 1.0.
- `deprecat` — no occurrence. There is no deprecation window: nothing says a
  removed export must first ship deprecated for N minors, or that
  `admin.titleProperty` (deprecated in the current `[Unreleased]`, CHANGELOG.md
  line ~24) has any guaranteed lifetime.
- `support` — no occurrence. No support window: nothing says how long 0.13
  receives fixes once 0.14 ships, or whether it receives any.
- No statement of what a *major* means for a consumer. Contract 3
  (`RUNTIME_CONTRACT_VERSION`) has a major and `docs/compatibility.md:65-80`
  explains it beautifully; the *package* major is never discussed.

The barrel rule is also weaker than it reads. `packages/client/src/index.ts` is
described as curated, and it is — but the same sentence covers 22 published
packages, and the only one with a machine-checked barrel is
`@rebasepro/server`. For `@rebasepro/types`, `@rebasepro/admin-types`,
`@rebasepro/client`, `@rebasepro/ui`, `@rebasepro/utils` and the rest, "public"
is defined by whatever the barrel happens to re-export on the day you look.

**Failure scenario.** A user asks the only question that matters — "if I build
on this, what breaks under me later, and how much warning do I get?" — and the
answer available to them is a per-release migration guide
(`website/src/content/docs/docs/upgrading.mdx`, 574 lines, entirely
retrospective). There is no forward promise to evaluate. For an evaluation
against Supabase or Firebase, that is the deciding document and it does not
exist.

**Fix direction.** Add a "The 1.0 promise" section to `docs/compatibility.md`
stating, per package: which barrel is the public API; that a public export is
removed only in a major and only after one minor shipped it deprecated; the
support window for the previous major; and what a Rebase major does and does not
touch (in particular that contract 6 stays frozen *across* majors, which is
already the rule at `:117` and is the most surprising and most valuable clause
in the file). Then publish it — see L1.

### H2. The API-surface gate gives zero member coverage to `rebase`, the export every hook and function imports

`scripts/api-surface.mjs:56-67`, `contracts/server.api.txt:34`,
`packages/server/dist/singleton.d.ts:53`.

`memberNames(decl)` reads `decl.members ?? decl.type?.members`. For
`export declare const rebase: RebaseServerClient` the declaration's `.type` is a
`TypeReferenceNode`, which has no `.members` — so the function returns `null`
and the baseline records the bare line:

```
const rebase
```

`contracts/server.api.txt:34`. That is the whole entry. The gate's own diff
logic (`scripts/check-api-surface.mjs:79`) then computes `goneMembers` against
an empty member list, which is empty by construction, so this entry can never
report `CHANGED`.

`rebase` is the singleton: `rebase.dataAsAdmin`, `rebase.auth`, `rebase.admin`,
`rebase.storage`, `rebase.email` — the documented surface at
`packages/server/dist/singleton.d.ts:22-50`, and the API every tenant hook,
function and cron is written against.

**Failure scenario.** A refactor drops `email` from the object the singleton
proxies, or renames `dataAsAdmin`. `pnpm check:api-surface` prints
"✓ API surface unchanged." The change ships in an image. The managed tier rolls
the fleet onto it. Every tenant whose hook calls `rebase.email.send(...)` throws
`TypeError: Cannot read properties of undefined` — at runtime, in a wave, in
exactly the scenario the file's own docblock (`scripts/api-surface.mjs:8-16`)
describes as the reason it exists. The gate is aimed precisely at this and looks
straight past it.

The same shape applies to `const logger`, `const requireAuth`,
`const errorHandler` and the other 13 `const` exports
(`contracts/server.api.txt:21-36`) — all recorded as bare names.

**Fix direction.** For a `VariableDeclaration`, resolve the declared type
through the checker (`checker.getTypeAtLocation(decl)` →
`getApparentProperties()`) rather than reading syntax. That also fixes L4 for
free, since the resolved type carries inherited members.

### H3. The release bump level is an unvalidated human input; a contract break can ship as a patch

`.github/workflows/publish.yml:20-26`, `:297-322`,
`scripts/prepare-changelog.mjs` (whole file).

Stable releases run from `workflow_dispatch` with a free-text `version` input
defaulting to `"patch"` (`publish.yml:26`). The "Determine version" step
(`:307-316`) reads that input, cases on `patch`/`minor`/`major`, and computes
the number. Nothing in that step, or anywhere in the workflow, examines the
diff: not the API-surface baseline, not `contracts/derived-names.txt`, not the
CHANGELOG's sections, not the two contract constants.

`scripts/prepare-changelog.mjs` does not classify either. It promotes
`## [Unreleased]` to `## [<version>] - <date>`, opens a fresh `[Unreleased]`,
and mirrors the file into the docs site. It never inspects the section headings.
`### Breaking` appears 4 times across 1,503 lines of `CHANGELOG.md`
(lines 245, 467, 654, 876, 1056) and is a hand-written convention with no
producer and no reader.

**Failure scenario.** A PR removes an export from `@rebasepro/server`,
regenerates the baseline with `node scripts/api-surface.mjs --write` (the gate
then passes green, since it only detects *forgetting* to regenerate — see M-note
below), and lands. The release is cut with the default `patch`, giving 0.13.1.
Every consumer with `"@rebasepro/server": "^0.13.0"` — the range `rebase init`
scaffolds — resolves 0.13.1 on their next `pnpm install`, because `^0.13.0`
means `>=0.13.0 <0.14.0`. A breaking change auto-installs. Under 0.x the *minor*
is the breaking position, and nothing enforces that a breaking change reaches
it.

**Fix direction.** Make the bump a *consequence*, not an input: fail the release
when `git diff` against the previous tag touches
`contracts/server.api.txt` in the removal direction, or
`contracts/derived-names.txt` at all, or either version constant, unless the bump
is at least `minor` **and** the promoted CHANGELOG section carries a
`### Breaking` heading. `prepare-changelog.mjs` already parses the section
structure and is the natural place.

---

## Medium

### M1. No gate on the HTTP wire format

No baseline file exists: the only two under version control are
`contracts/derived-names.txt` and `contracts/server.api.txt` (verified by
enumerating `*.txt` outside `node_modules`).

The OpenAPI document is generated at runtime by
`packages/server/src/api/openapi-generator.ts` and is never snapshotted. The
three tests that touch it assert hand-picked facts about individual operations —
`spec.paths["/data/users/{id}"]`
(`packages/server/test/openapi-update-contract.test.ts:28`),
`spec.paths["/data/posts"].get.parameters`
(`openapi-parameter-fidelity.test.ts:42`),
`spec.paths["/data/posts/{parentId}/comments"]`
(`openapi-relations.test.ts:92`). No test enumerates the route set, the response
envelope, the error-code vocabulary, or the header contract.

**Failure scenario.** `POST /<collection>/bulk/delete` is renamed, or the
`ApiResponse` envelope (`{ data, error, meta }`,
`contracts/server.api.txt:134`) gains a level, or an error `code` string
changes. Every generated SDK, every `curl` in a customer's CI, and every
non-JS client breaks. Nothing in the repository notices, because the wire format
is the one surface with no artifact to diff. Note that this axis is *worse* than
the JS one: a JS break is at least a compile error for someone, whereas a wire
break is a 404 in production.

**Fix direction.** Snapshot the generated OpenAPI document for the reference
app's collections into `contracts/openapi.json` and diff it with the same
three-way classification the other two gates use (REMOVED path/operation/field =
break; ADDED = regenerate). The generator already runs headlessly in
`openapi-*.test.ts`, so the renderer is a few lines.

### M2. No gate on CLI flags

`packages/cli/src/*.test.ts` is five files — `bundle`, `fold-static`,
`manifest-consistency`, `manifest`, `storage-sources`. None concerns flags. No
flag inventory, no `--help` snapshot, no baseline.

`docs/api-surface-audit-2026-08-05.md` §7 already documented that `-p` means
`--port`, `--password` and `--project` on different commands, and §5 that
`rebase doctor --help` fails outside a project. Both are consequences of nobody
holding the flag surface as a single artifact.

**Failure scenario.** A flag is renamed (`--out` → `--output`, which that audit
recommends) or a short form is reassigned. Every CI pipeline, Dockerfile and
Makefile calling the old spelling fails — and unlike a JS rename, there is no
compiler anywhere in the path to catch it. The CLI is the surface most likely to
appear in *someone else's* automation, and it is the least guarded.

**Fix direction.** Render the command tree and every flag (long form, short
form, whether it takes a value) into `contracts/cli-flags.txt` and diff it. The
commander/yargs definition is already data.

### M3. The derived-names fixture can be pruned, and only a `> 0` floor stands in the way

`scripts/derived-names.mts:59-63`, `:244-247`;
`scripts/check-derived-names.mts:80-86`.

The fixture's own comment states the rule:

> Append-only, in the same sense the baseline is: removing a collection from
> here removes whatever it was the only thing exercising, and the baseline
> shrinks by exactly as much without anything failing. Add cases; do not prune.

That is a convention. The gate's only structural defence is
`if (current.size === 0)` (`check-derived-names.mts:80`), which fires on a
totally broken renderer and on nothing else. The baseline is currently 136
identifiers from 11 collections.

**Failure scenario.** Someone deletes the `longName` fixture
(`derived-names.mts:211`) — the one collection exercising Postgres's silent
63-byte truncation, and the case `docs/compatibility.md:137-144` names as the
*only legitimate override* of the freeze rule. The gate reports REMOVED once;
the fix that looks obvious is `pnpm write:derived-names`; from then on the
truncation rule is unguarded and the gate reports "✓ 120 derived identifier(s)
unchanged." forever. The identical trap was already recognised for `rls:check`,
which is why `verify.yml:496` passes `--min-tables 8 --min-policies 40` — with a
comment explaining that floors are what stop a vacuous gate. `derived-names` did
not get the same treatment.

**Fix direction.** Add `MINIMUM_IDENTIFIERS` and `MINIMUM_FIXTURE_COLLECTIONS`
floors set below the current values, the way `upgrade-e2e.test.ts:65,73` and
`project-upgrade-e2e.test.ts:65,110` already do for their corpora.

### M4. The control plane keeps a hand-written copy of both contract constants, with no gate tying them together

`saas/backend/src/managed/bundle-manifest.ts:42,45` versus
`packages/types/src/types/project_manifest.ts:273,283`.

```
export const SUPPORTED_BUNDLE_FORMAT = 2;      // saas
export const SUPPORTED_RUNTIME_CONTRACT = 1;   // saas
export const BUNDLE_FORMAT_VERSION = 2;        // @rebasepro/types
export const RUNTIME_CONTRACT_VERSION = 1;     // @rebasepro/types
```

Grepping `saas/` for `BUNDLE_FORMAT_VERSION` or `RUNTIME_CONTRACT_VERSION`
returns nothing: the control plane never imports the source of truth. This is
acknowledged — `bundle-compat.test.ts:246-249` says "one of them — the control
plane — keeps a hand-written copy of this shape because it cannot depend on this
package. Nothing can make that copy update itself" — and the mitigation is a
tripwire test (`bundle-compat.test.ts:272-275`,
`expect(BUNDLE_FORMAT_VERSION).toBe(2)`) whose failure message is a four-step
ordered checklist. That is a good mitigation and it is the reason this is Medium
and not High.

What it does not do is check the other side. The checklist's step 2 ("Raise
`SUPPORTED_BUNDLE_FORMAT` in the control plane") is enforced only by whoever
reads the failure.

**Failure scenario.** A developer bumps `BUNDLE_FORMAT_VERSION` to 3, hits the
tripwire, updates it to `toBe(3)` because that is what the assertion asks for,
teaches `upgradeLegacyManifest` both shapes, and ships the CLI. The control
plane still holds `SUPPORTED_BUNDLE_FORMAT = 2`. Every managed deploy from that
point answers `BUNDLE_FORMAT_TOO_NEW` and the message blames the user's
manifest — the precise outcome step 3 of the checklist exists to prevent. Note
that `saas` CI builds against this repo's `main` (per `docs/compatibility.md:196`),
so it is positioned to catch this and does not.

**Fix direction.** In `saas` CI, assert
`SUPPORTED_BUNDLE_FORMAT >= BUNDLE_FORMAT_VERSION` and
`SUPPORTED_RUNTIME_CONTRACT === RUNTIME_CONTRACT_VERSION` against the
workspace's `@rebasepro/types`. The direction matters: the control plane must be
allowed to be *ahead*, which is exactly what step 3 mandates.

### M5. Nothing produces or checks the breaking-change classification in the changelog

`scripts/prepare-changelog.mjs` (whole file), `CHANGELOG.md`.

Covered in H3 as a release-gating problem; called out separately because it is
also a *documentation* problem. The current `[Unreleased]` section deprecates
`admin.titleProperty` in favour of `admin.display` (CHANGELOG.md, Added, first
entry) and states the deprecation inline in prose. There is no `### Deprecated`
heading in the file's vocabulary, no machine-readable record of what is
deprecated, and no way to answer "what is deprecated right now and when does it
go" other than reading 1,503 lines.

**Fix direction.** Adopt the Keep-a-Changelog `Deprecated` and `Removed`
headings the file is already shaped for, and have `prepare-changelog.mjs` refuse
to promote a section that has neither when the bump is a minor and a tracked
baseline moved.

### M6. `docs/compatibility.md` does not mention the API-surface gate at all

`docs/compatibility.md:35-43` (the six contracts), `:183-196` (the gate table).

`check:api-surface` exists, runs on every PR (`verify.yml:208-209`), guards a
real fleet-wide boot failure, and carries the best explanatory docblock in
`scripts/`. It appears nowhere in `docs/compatibility.md`: not as a seventh
contract, not as a row in "The gates that hold these", not in prose. Grepping
the file for `api-surface`, `api surface` or `API surface` returns nothing.

The gate table lists eight gates and omits this one; every other file it names
was verified to exist (`fixtures/bundles/`, `e2e/tests/cli-init-e2e.ts`,
`e2e/tests/client-sdk-e2e.ts`, `upgrade-e2e.test.ts`,
`schema-snapshots/`, `verify:selfhost`, `verify:corpus`, `rls:check` — all
present).

**Failure scenario.** Someone follows "Changing a contract"
(`docs/compatibility.md:202-213`) — "Decide which of the six it is. Most changes
are none of them." — while removing an export from `@rebasepro/server`. They
correctly conclude it is none of the six, and the document has told them the
change is therefore uncontroversial. It is the single most dangerous change in
the repository.

**Fix direction.** Add contract 7 — "the public API surface of the
runtime-provided packages", declared in `contracts/server.api.txt`, checked by
`pnpm check:api-surface`, direction "additive only within a contract major" —
and a matching gate-table row.

### M7. The two frozen corpora are not being recorded per release, and nothing in the release records them

`docs/compatibility.md:198-200` says, in bold: "**Record a bundle fixture and a
schema snapshot once per release.** The value of both corpora is entirely in how
far back the oldest one goes, and neither can be backfilled after the fact."

Observed:

- 10 release tags (`v0.6.0` … `v0.13.0`).
- `fixtures/bundles/` — 3 fixtures (`format1-cms`, `format2-backend`,
  `format2-static`). These are per *format*, not per release, which is arguably
  the right axis for a bundle-shape corpus, but it is not what the instruction
  says.
- `packages/server-postgres/test/e2e/schema-snapshots/` — 2 files
  (`era-1a-user-id-legacy-roles.sql`, `era-1b-uid-device-session.sql`), named
  per *era*, not per release.
- `packages/server-postgres/test/e2e/project-snapshots/` — 1 directory,
  `v0.13.0`.

`grep -rn record-schema-snapshot` and `record-project-snapshot` over
`.github/` returns nothing: neither recorder is invoked by `publish.yml` or by
any workflow. Both are manual (`packages/server-postgres/package.json:41`
defines `record:project-snapshot`; the schema recorder has no script at all).

**Failure scenario.** 0.14 through 0.18 ship. Nobody remembers. In a year the
oldest database the upgrade suite can start from is still the 0.13 era, so the
migration path from 0.15 — the one an actual customer is sitting on — has never
been executed by anything. The instruction's own second sentence says this
cannot be repaired later.

**Fix direction.** Make it a release step, not an instruction. `publish.yml`
already runs a Postgres-capable job pattern in `verify.yml`; add a stable-only
step that runs `record:project-snapshot --out v<version>` and commits the result
alongside the version bump (which the workflow already commits and pushes at
`:421-430`).

---

## Low / DX

### L1. The compatibility policy is not published to users

`docs/compatibility.md` lives in `docs/`, which is the internal tree. The
published docs are `website/src/content/docs/**`, and grepping it for
"compatib" returns per-page mentions only — the nearest published thing is
`website/src/content/docs/docs/upgrading.mdx`, a 574-line retrospective
migration guide for the current release. A user evaluating Rebase cannot read
the promise; they can only read what broke last time.

Given `docs/compatibility.md` is the document that would most reassure an
evaluator, and given the docs site is already 6-locale for `docs/**`
(per the i18n structure), publishing it is a high-value, low-effort move.

### L2. `verify.yml`'s `checks` job has no `if: always()`, so a single early failure hides every contract verdict

`verify.yml:31-239`. The `checks` job is ~22 sequential steps with no
`if: always()` on any of them. `Derived database identifiers` is step ~20 and
`Runtime API surface` step ~22 — after typecheck, four headless guards,
templates, image refs, names, deps, lint, two ratchets, test-scripts, control
chars, untranslated, docs-drift, and the build.

The `e2e` job deliberately does the opposite: five steps carry `if: always()`
with a comment explaining that "a failure in the first said nothing about this
one". The same reasoning applies to the contract gates and was not applied.

**Effect.** A PR with a lint warning-turned-error *and* a derived-name break
reports only the lint error. The author fixes it, pushes, and discovers the
contract break on the next run. Not silent — the job is red either way — but it
serialises discovery of the most consequential findings behind the least
consequential ones.

**Fix direction.** `if: always()` on `Derived database identifiers`,
`Runtime API surface`, `Docs API drift` and the three ratchets. (`Runtime API
surface` needs the build, so it wants `if: always()` guarded on the build step's
outcome rather than unconditionally.)

### L3. Both baselines are regenerable in one command, and nothing marks a regeneration as a decision

`scripts/check-api-surface.mjs:114-115`, `scripts/check-derived-names.mts:164-165`.

Both gates are **drift detectors, not approval gates**. They catch *forgetting*
to regenerate; they do not catch *choosing* to. `node scripts/api-surface.mjs
--write` or `pnpm write:derived-names` turns any break into a green build, and
the resulting PR shows a diff in a file whose header says "GENERATED … do not
hand-edit" — which reads to a reviewer as noise.

Both scripts do everything a script can about this: the derived-names gate's
docblock (`check-derived-names.mts:24-29`) says outright "The answer is almost
never 'regenerate the baseline'", and the API gate prints a five-line
explanation before exiting. What is missing is anything outside the script.
There is **no `CODEOWNERS` file in the repository** (verified), so
`contracts/derived-names.txt` and `contracts/server.api.txt` carry no review
requirement distinct from any other file.

**Fix direction.** Add `CODEOWNERS` covering `contracts/`, `contracts/`,
`fixtures/bundles/` and the two version constants. Cheap, and it converts a
regeneration from an invisible line in a diff into a named approval.

Minor asymmetry in the same area: `write:derived-names` is a `package.json`
script (`:67`) but there is no `write:api-surface` — the API gate's own error
message tells you to type `node scripts/api-surface.mjs --write`. Two gates,
two idioms.

### L4. Members inherited through `extends` are invisible to the surface renderer

`scripts/api-surface.mjs:57` reads `decl.members`, which is the *declared body*
only. `interface AuthRepository extends UserRepository, RoleRepository,
TokenRepository, MfaRepository {}`
(`packages/server/dist/auth/interfaces.d.ts:493`) has an empty body, so the
baseline records it as a bare `interface AuthRepository`
(`contracts/server.api.txt:137`) — the only member-less interface or class in
the file, which is the tell.

Impact here is small: all four supertypes are themselves exported and tracked
(`server.api.txt:184, 203, 215, 219`), so their members are covered. The
mechanism is what matters — an interface or class extending an *unexported* base
would lose its whole surface silently. Fixed by the same checker-based rewrite
as H2.

### L5. Two stale doc pointers

- `scripts/derived-names.mts:238` — "Exported because
  `scripts/record-project-snapshot.mts` provisions a database from it". The file
  is at `packages/server-postgres/scripts/record-project-snapshot.mts`; there is
  no `scripts/record-project-snapshot.mts` (the sibling in `scripts/` is
  `record-schema-snapshot.mts`, a different tool). The consumer is real —
  `record-project-snapshot.mts:98` does `await import(.../scripts/derived-names.mts)`
  and destructures `FIXTURE` — only the path in the comment is wrong. Worth
  fixing because that comment is the *only* thing telling a reader the fixture
  has a second consumer, i.e. the only thing standing between someone and
  pruning it (M3).
- `CHANGELOG.md:1268` — "Deprecated export documentation moved to
  `docs/DEPRECATED_EXPORTS.md`". No such file exists anywhere in the
  repository. Historical changelog entries naturally rot, but this one names the
  deprecation register, which is precisely the artifact H1 says is missing.

---

## Checked and clean

- **CI wiring.** `ci.yml:4-7` triggers `verify.yml` on `pull_request: [main]`
  and `push: [main]`; `publish.yml:53` and its stable counterpart call the same
  reusable workflow. `check:derived-names` (`verify.yml:195`) and
  `check:api-surface` (`:209`) genuinely run on every PR. The canary path was
  fixed to gate too (`verify.yml:11-15`), with the incident recorded.
- **`check:derived-names` cannot pass against stale build output.**
  `derived-names.mts:403-426` compares `@rebasepro/utils`'s
  `generateForeignKeyName` against `packages/utils/src/names.ts` and throws if
  they disagree, with the reason recorded: the first draft reported "136
  identifiers unchanged" against a checkout where the contract was broken.
  `package.json:66` sets `TSX_TSCONFIG_PATH`, and `verify.yml:191-193` places
  the step *before* the build on purpose.
- **Exit-code discipline.** `check-derived-names.mts` exits 2 for "the check did
  not run" and 1 for "the check ran and found something" (`:73-78`, `:80-86`) —
  the distinction most gates in this class get wrong.
- **Rename detection.** `check-derived-names.mts:94-111` pairs a removal with an
  addition only when kind *and* table match, so it does not invent renames from
  coincidence, and `identifierOf` (`:57`) separates a producer-tag change from
  an identifier change so `push`/`boot` divergence is reported as its own defect.
- **Additions fail too.** Both gates fail on an additive-only diff with
  "regenerate", not "you broke the contract" (`check-api-surface.mjs:117-122`,
  `check-derived-names.mts:157-166`), so a baseline cannot silently fall behind.
- **`rebase.json` schema ↔ type parity is gated.**
  `packages/cli/src/manifest-consistency.test.ts:199-210` asserts top-level key
  equality between `website/public/schemas/rebase.json` and
  `RebaseProjectManifest`, *and* asserts `additionalProperties === false` so the
  parity check cannot be neutered by relaxing the schema. Finding §6 of the
  2026-08-05 audit (the missing `telemetry` key) is fixed —
  `website/public/schemas/rebase.json:43` declares it.
- **Collection-config key drift is gated at compile time.**
  `packages/server/src/collections/validate-config.ts:82-125` is a
  hand-maintained `as const` list, but `MissingCollectionKeys` /`AssertNever`
  (`:128-131`) make a `CollectionConfig` key absent from it a type error. The
  `search`-key incident that motivated it is recorded in the docblock.
- **The runtime contract constants have a tripwire with a checklist.**
  `packages/server/src/boot/bundle-compat.test.ts:244-275` pins both values and
  fails with the four-step coordinated-release procedure as the message,
  including "SHIP THE CONTROL PLANE FIRST".
- **Contract line ≠ package version is real and deliberate.**
  `saas/backend/src/managed/intake.ts:19-30` and
  `saas/config/collections/runtime-releases.ts:27-46` both document that
  `version` is the contract line (`1.4.2`) and `imageTag` is the package version
  (`0.13.0`), with the incident that forced the split ("Matching a `^1` range
  against a `0.10.0` string rejects every bundle") recorded in both places.
  `contract` is `columnType: "integer"` with a comment explaining that
  node-postgres returns `numeric` as a string and would break the `!==`
  comparison.
- **`RUNTIME_PROVIDED` is genuinely one package.** `infra/docker/entrypoint.mjs:110`
  is `["@rebasepro/server"]`, matching `TRACKED` in `api-surface.mjs:41-43` and
  the scoping argument in its docblock. (Nothing *ties* the two lists together —
  a second entry in `entrypoint.mjs` would not reach `TRACKED` — but at one
  entry each the risk is theoretical.)
- **Corpus vacuity floors exist where they matter.**
  `upgrade-e2e.test.ts:65,73` and `project-upgrade-e2e.test.ts:65,110-117`
  both assert a minimum snapshot count *and* that the snapshot is non-empty,
  with the `describe.each([])` failure mode named in the comment.
  `verify.yml:496` passes `--min-tables 8 --min-policies 40` to `rls:check` for
  the same reason.
- **`verify:corpus` pins `manifest.schemaVersion` identity**
  (`scripts/verify-bundle-corpus.mts:468-482`), which is contract 5's only
  meaningful guarantee.
- **The changelog mirror cannot drift.** `check:generated` (`verify.yml:228`,
  `package.json`) runs `website generate-all` — which includes
  `copy_changelog.js` — and `git diff --exit-code`s
  `website/src/content/docs/docs/CHANGELOG.md`.
- **Every file `docs/compatibility.md` names exists** and every value it quotes
  is current: `BUNDLE_FORMAT_VERSION = 2`
  (`packages/types/src/types/project_manifest.ts:273`),
  `RUNTIME_CONTRACT_VERSION = 1` (`:283`), `AUTH_SCHEMA_VERSION = 2`
  (`packages/server-postgres/src/auth/schema-version.ts:37`).
- **All 22 published packages are at `0.13.0`**, versioned in lockstep, matching
  what the policy describes.

---

## Open questions

1. **Is lockstep versioning the intended 1.0 shape?** All 22 packages move
   together today. At 1.0 that means a breaking change in `@rebasepro/studio`
   (explicitly listed at `docs/compatibility.md:175` as fastest-moving and least
   guaranteed) forces a major on `@rebasepro/types`. Either the fast-moving
   packages leave the 1.0 promise by staying `0.x`, or the promise is diluted to
   the weakest package. The document does not say which.

2. **What is `@rebasepro/types`' status?** It is imported by every published
   package and by every user's collection files, but has no barrel gate, no
   surface baseline, and no mention in the compatibility document beyond the
   generic "authored TypeScript API". Under a 1.0 it is arguably the most
   load-bearing public surface in the product.

3. **Does the derived-names freeze survive a major?**
   `docs/compatibility.md:117` says "Not 'frozen until the next major' —
   frozen", which is the correct and unusual answer. Confirm this is intended to
   hold across a 1.0→2.0 boundary and state it in the 1.0 section, because it is
   the clause a reader will most expect to find an exception to.

4. **Is `saas` CI positioned to run a cross-repo constant check?** M4's fix
   assumes `saas` CI has the public monorepo's `@rebasepro/types` resolvable at
   check time. It builds against this repo's `main`, so it probably does, but I
   did not verify the `saas` workflow files (they are in the nested repo and out
   of this unit's scope).

5. **Should the wire-format baseline be the OpenAPI document or something
   narrower?** The generated spec includes descriptions and examples that churn,
   which would make the gate noisy and therefore ignored — the failure mode
   `api-surface.mjs:52-54` explicitly designs against. A projection (paths ×
   methods × parameter names × response field names, no prose) is probably the
   right artifact, but that is a design call.
