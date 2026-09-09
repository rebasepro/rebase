# Tasks a cheap model can run

Written 2026-09-09 against `main@ef769df5a`. Every count below was measured, not
estimated — the command that produced it is in the task.

The premise: this repo has **67 gates**. That is what makes a weak model usable
here. A task is safe to hand to Gemini Flash when a command can tell it that it
failed. A task is not safe when the only thing that could catch a bad answer is
someone reading the diff carefully. Sort by that, not by how hard the task
sounds.

## How to dispatch one

`gemini` is on PATH. One task per session, fresh context, from the repo root:

```bash
gemini --approval-mode auto_edit -m gemini-2.5-flash "$(cat /tmp/task.md)"
```

Every task file handed over must end with its `Check:` line, and the agent must
be told: **run the check, and if it does not pass, revert and report — do not
try a second approach.** A weak model's second approach is where the damage is.

Before trusting a batch, measure the model on this repo's own benchmark, which
is built from real fix commits:

```bash
pnpm harness eval --list
```

```bash
pnpm harness eval --agent "gemini --approval-mode yolo -m gemini-2.5-flash"
```

Caveat: the suite holds **two** tasks today (`dev-port-retry`,
`template-image-import`). It will tell you the model can drive the repo at all;
it will not tell you it is good. The gates are the real contract. Growing the
suite from recent fix commits is itself a task on this list.

## Rules for every task

- One branch per batch, never per task. You read the diff before merge.
- `git -c core.fsmonitor=false` for anything git; never `git add -A`.
- No back-compat shims — delete the old name.
- Never let a cheap model touch: releases and version bumps, migrations, RLS
  policy generation, the schema pipeline, the saas control plane, anything
  under `.github/workflows`, or any file whose name contains `baseline` unless
  the task is explicitly to re-bank it.
- Read-only tasks (family C) carry no risk at all. Start there.

---

## A. Translation — the best fit, and the largest pile

Flash is genuinely good at this, and the failure mode (a clumsy sentence) is
cheap. `pnpm check:locale-parity` is currently green at 978 keys × 7 locales,
so the gate proves nothing is *missing*; a human spot-check proves quality.

### A1 · 16 documentation pages exist only in English · **80 jobs**

`website/src/content/docs/docs` holds 202 pages; each of `de`, `es`, `fr`, `it`,
`pt` holds 84. Excluding `ui/components/*` (AST-generated, not hand-translated),
34 pages are missing per locale, of which these 17 are hand-written prose:

```
backend/api-keys.md            backend/auth-adapters.md
backend/auth-endpoints.md      backend/branching.md
backend/endpoints.md           backend/realtime-transports.md
backend/writes.md              collections/arrays-and-maps.mdx
collections/field-access.md    collections/file-uploads.mdx
collections/soft-delete.md     collections/validation-and-conditions.mdx
getting-started/headless.md    sdk/aggregates-and-search.md
sdk/relations.md               sdk/writing.md
```

One job = one page × one locale. 16 × 5 = 80.

`troubleshooting.md` is the seventeenth and is **not** one of these: it is
generated into the English docs from `docs/troubleshooting.md` by
`website/scripts/copy_repo_docs.js`, which gives it no locale copy at all —
unlike `CHANGELOG.md`, which that same script mirrors into all five behind a
"translation pending" banner, and unlike `compatibility.md`, which has hand
translations. Translating it by hand would be overwritten. See C7.

- **Do:** translate `website/src/content/docs/docs/<page>` into `<locale>`, at
  `website/src/content/docs/<locale>/docs/<page>`. Translate prose and
  frontmatter `title`/`description` only. Do **not** translate: code blocks,
  identifiers, CLI flags, file paths, env var names, or anything inside
  backticks. Keep the heading structure identical. Match the register of a
  sibling page already translated in that locale — read one first.
- **Check:** `pnpm -C website run build` succeeds, and
  `pnpm -C website generate-all && git -c core.fsmonitor=false diff --exit-code -- website/public/llms.txt`
  is clean after regenerating.
- **Stop rule:** if the English page contains a `<Steps>`/`<Tabs>` component you
  do not recognise, copy the component markup verbatim and translate only its
  text children.

### A2 · 207 English strings hardcoded where a translation already exists · **~67 jobs**

`pnpm check:untranslated` reports 207 findings across 67 files, each one a
literal that duplicates a key already declared in `packages/app/src/locales/en.ts`
and already translated seven ways. A German panel renders them in English today.

Heaviest files:

```
17  packages/cms/src/editor/components/SlashCommandMenu.tsx
15  packages/cms/src/collection_editor/ui/collection_editor/PropertyEditView.tsx
13  .../collection_editor/GeneralSettingsForm.tsx
12  packages/cms/src/form/validation.ts          ← skip, see stop rule
11  .../collection_editor/CollectionDetailsForm.tsx
 8  .../collection_editor/DisplaySettingsForm.tsx
 8  packages/cms/src/data_import/components/DataNewPropertiesMapping.tsx
```

One job = one file.

- **Do:** in `<file>`, replace each hardcoded English literal that matches a
  declared key with `t("<key>")`. **Only if `t` is already in scope in that
  file.** If it is not, stop — bringing `t` into scope is a design decision.
  Then `pnpm check:untranslated --update` to re-bank the count.
- **Check:** `pnpm check:untranslated` green, `pnpm typecheck` green, and the
  baseline diff shows only removals for this file.
- **Stop rule:** skip `packages/cms/src/form/validation.ts` and any non-component
  module — where a validation message should live is a design call, not a
  substitution.

### A3 · Marketing copy drift across `de`/`es`/`fr`

`website/src/i18n/en.ts` is 2072 lines; `de` 1975, `es` 1977, `fr` 1976. Marketing
runs 4 locales (docs run 6) — the ~96-line gap is the backlog.

- **Do:** report every key present in `en.ts` and absent (or still English) in
  each of the other three. Then translate them in batches of 20 keys.
- **Check:** `pnpm -C website check:site`, `pnpm -C website run build`.

### A4 · The recurring one

Every English sentence changed in `docs/` or `website/` has to be replayed into
the other locales. This is the standing job — hand Flash the diff, not the file.

- **Do:** given `git -c core.fsmonitor=false diff <range> -- website/src/content/docs/docs`,
  apply the equivalent edit to each of the five locale mirrors.
- **Check:** `pnpm verify:docs` and `pnpm check:generated`.

---

## B. Tests for code that has none

Seven packages ship with zero test files. These are the pure ones — the contract
is readable in the signature, which is exactly the case where a weak model can
write a real test rather than a tautology.

| Package | src files | tests |
| --- | --- | --- |
| `packages/utils` | 26 | 0 |
| `packages/types` | 49 | 0 |
| `packages/cms-types` | 38 | 0 |
| `packages/common` | 45 | 4 |
| `packages/forms` | 12 | 0 |
| `packages/inference` | 8 | 0 |
| `packages/codegen` | 3 | 0 |
| `packages/ui` | 118 | 1 |

Start with `packages/utils`: `arrays.ts`, `dates.ts`, `strings.ts`,
`flatten_object.ts`, `plurals.ts`, `names.ts`, `objects.ts`, `regexp.ts`,
`hash.ts`, `sha1.ts`, `policy-names.ts`. One job = one module.

- **Do:** write `<module>.test.ts` next to `<module>.ts`. Cover every exported
  function: the documented behaviour, the empty input, and one boundary. No
  mocks — these are pure.
- **Check:** the test passes; **and** the agent must prove the test bites, by
  deliberately breaking one line of the source, re-running to see it fail, then
  reverting the break. A test that passes against broken code is worse than no
  test — that is bug class 3 in `docs/bug-classes.md`.
- **Stop rule:** if a function needs a database, a network call, or a React
  render, skip it and say so.

### B2 · Mutation survivors

Where a package already has tests, mutation survivors name the assertions worth
adding — see the mutation-testing recipe. Flash writes the killing test; the
survivor list is the spec, so no judgment is required.

### B3 · The test-type debt · **6 jobs**

`tsconfig.tests.json` documents 1617 type errors in test files that nothing
checks, split across six packages: `server-postgres` (1037), `client` (265),
`server` (165), admin's remaining tests (87), the rest of `app/test` (52), and
**`cli` (11)**.

Start with `cli` — 11 errors is one afternoon.

- **Do:** add `"packages/cli/test"` to the `include` array of
  `tsconfig.tests.json`, run `pnpm typecheck`, and fix each error **in the test
  file**, never by loosening a type in `src`. Add a comment on the new include
  line naming the drift it exposed, matching the style of the lines above it.
- **Check:** `pnpm typecheck` green with the line added.
- **Stop rule:** if fixing an error requires changing a type under `src`, stop —
  that means the test found a real bug and a human should see it.

---

## C. Read-only sweeps — zero risk, high yield

No file is edited. The output is a report. This is where a cheap model earns its
keep, because the work is volume, not judgment, and a wrong answer costs a
minute of reading.

### C1 · Sweep for siblings of each known bug class · **61 jobs**

`docs/bug-classes.md` names 61 classes, each with a description and a real
example. The repo rule is: name the class, sweep for siblings.

- **Do:** read class *N* in `docs/bug-classes.md`. Search the whole repo for
  other instances of the same shape. Report `file:line` plus one sentence per
  candidate. Do not fix anything. Do not report the example already in the doc.
- **Check:** none — it is a report. Value it by hit rate; drop classes that
  return nothing twice.

High-yield classes to run first: 3 (tests that bypass the wiring), 4 (safety
nets that swallow their own failures), 9 (`toBeDefined()` on an API that returns
`null`), 12 (a prop the component does not have), 13 (generated code checked by
substring), 18 (a predicate that discriminates nothing), 20 (a value computed and
then discarded).

### C2 · Triage the 125 discarded values · **12 batches of ~10**

`pnpm check:unused` reports 125 "assigned a value but never used" findings across
82 files. Two real bugs already came out of this list. They cannot be fixed
mechanically — but they can be *sorted*, and sorting is the expensive part.

- **Do:** for each of these 10 entries, read the surrounding function and
  classify: **(a) dead** — the computation has no purpose, delete it;
  **(b) bug** — the value was clearly meant to be used and is not, name where it
  should go; **(c) intentional** — a destructure-to-discard or a deliberate
  side-effect call. Quote the 3–5 lines that justify the call. Do not edit.
- **Check:** none. A human acts on the (b) list only.

### C3 · Triage the 178 exhaustive-deps findings · **18 batches**

Same shape, `pnpm check:hooks`. **Do not let Flash fix these** — the gate's own
docblock is explicit that adding the missing dependency is as likely to be the
bug as the fix. Triage only: which of these effects read a value they were not
keyed on *and* that value can change independently?

### C4 · `@ts-expect-error` in tests that assert nothing

A `@ts-expect-error` over a line that would compile fine is a silent pass.
`pnpm check:ts-expect-error-coverage` proves the 77 directives are inside a tsc
program; it does not prove each one is load-bearing.

- **Do:** for each `@ts-expect-error` in a test, delete it, run tsc, and report
  whether tsc then errored. Restore the file either way. Report the ones where
  tsc stayed silent.

### C5 · External link check

- **Do:** extract every external URL from `website/src/content` and `docs/`,
  fetch each, report non-2xx and redirects.
- **Check:** `pnpm check:doc-links` covers relative links (135, all resolving);
  external ones are unchecked today.

### C7 · Does a German reader 404 on Troubleshooting?

`website/scripts/copy_repo_docs.js` mirrors `CHANGELOG.md` into all five
non-English locales specifically because "without the file, five of six readers
follow a link to a 404". `troubleshooting.md` goes through the same script and
gets **no** locale copy; `compatibility.md` has hand translations. The sidebar
declares the entry once, in `website/astro.config.mjs:99`.

- **Do:** build the site and open `/de/docs/troubleshooting`. Report whether it
  404s or falls back to English. Same for the other 33 untranslated pages.
- **Check:** a report. If it 404s, the fix is one line in `copy_repo_docs.js`
  (`englishOnlyLocales`) plus its destinations in root `check:generated` — a
  small, gated job a cheap model can do from the CHANGELOG entry as a model.

### C6 · Error-string → troubleshooting coverage

- **Do:** list every user-facing error string thrown in `packages/cli/src` and
  `packages/server/src`, and report which have no entry in
  `docs/troubleshooting.md`. Remediation text nobody tested is bug class 5.

---

## D. Documentation chores

### D1 · Version pins

`pnpm fix:version-pins` writes them. A model is not even needed — but a model
should run the check after any docs batch.

### D2 · JSDoc on authoring fields

`pnpm check:jsdoc-coverage` is at 0 of 239 bare, under a 5% ceiling. This is a
maintenance job: after any batch that adds authoring fields, Flash writes the
missing doc comments from the surrounding code.

### D3 · Gate rows

Every new gate needs a row in `docs/gates.md` under the right job heading —
`pnpm check:gates-doc` enforces the shape (67 gates today, all rowed). When a
gate is added, filling in its row is mechanical.

### D4 · Doc examples that do not typecheck

`pnpm check:doc-examples` typechecks snippets. When it fails, the fix is usually
a renamed export — mechanical, and the gate is exact.

---

## E. What to keep away from a cheap model

Not because the task is long, but because nothing would catch a wrong answer:

- Anything in the schema pipeline. Three `Property → SQL` emitters disagree in
  12 documented ways and there is no IR; a plausible-looking edit there is
  boot-fatal.
- RLS policy generation and `rls-baseline.json`.
- The saas control plane, and anything that has to reason across both repos.
- Release plumbing, version bumps, `check:release-bump`, image promotion. A wire
  removal breaks the field.
- Migrations and `db push`.
- `react-hooks/exhaustive-deps` fixes (triage is fine — see C3).
- Anything where the acceptance test is "it looks right" — the surface system,
  the film, marketing composition.

---

## Rough totals

| Family | Discrete jobs |
| --- | --- |
| A1 docs translation | 80 |
| A2 hardcoded strings | ~67 |
| A3 marketing drift | ~5 batches |
| B1 tests for pure modules | ~40 |
| B3 test-type debt | 6 |
| C1 bug-class sweeps | 61 |
| C2 discarded-value triage | 12 |
| C3 hooks triage | 18 |
| C4–C7 sweeps | ~6 |
| **Total** | **~300** |
