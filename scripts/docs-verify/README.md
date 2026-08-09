# Docs API-drift verification

Catches documentation that describes an API the code does not have — the class
of bug where a confidently-written realtime surface (`channel.on("message")`,
`channel.send`, `channel.presence.track`) shipped, was machine-translated into
all six locales, and left readers with a `TypeError` and the impression that the
feature was broken.

Run it:

```bash
pnpm verify:docs                     # both stages, warn-only
node scripts/verify-docs.mjs --names # fast stage only (~20s, no snippet compile)
node scripts/verify-docs.mjs --strict # exit 1 on findings
node scripts/verify-docs.mjs --json  # machine-readable findings
```

It also runs as stage 7 of `scripts/verify-quality.sh`.

## The two stages

**1. `api-names` — every locale, cheap.** Extracts code fences from all six
locales plus `rebase-agent-skills/`, then checks three things textually against
the real export surface (resolved with the TypeScript API, so re-exports across
barrels are handled):

- named imports from `@rebasepro/*` are actually exported by that package —
  and if another workspace package exports the name, the report says which;
- subpath imports (`@rebasepro/server/services/webhook-service`) appear in the
  package's `exports` map. These resolve in-repo because
  `tsconfig.typecheck.json` maps `@rebasepro/x/*` to source, but throw
  `ERR_PACKAGE_PATH_NOT_EXPORTED` for anyone who installed from npm — so the
  snippet typechecker cannot see this class at all;
- member access on a receiver with a known SDK type (`channel.x`) exists on
  that type, counting **public** members only.

**2. `snippets` — English + skills, deep.** Compiles each fenced ts/js block
against workspace *source*. English only, because the other five locales are
generated from it by `website/scripts/translate_docs.mjs`; stage 1 is the net
for locale-only drift.

## What is globbed

`website/`, `rebase-agent-skills/`, `examples/*/`, the marketing components, the
MCP manifests — and the repository's own agent instructions: `AGENT.md`,
`.agents/*.md` and `.agent/workflows/*.md` (`AGENT_INSTRUCTION_GLOBS` in
`extract.mjs`).

That last group was added because the gap was load-bearing. While every checked
surface reported zero findings, `AGENT.md` and
`.agent/workflows/schema-migration.md` went on teaching relations as `target` +
`cardinality` + `direction` on the property — a shape the authored relation type
had replaced with a closed `kind` union, and `direction` had stopped existing
anywhere in `packages/types`. An agent that read them wrote code that did not
compile. A documentation surface nothing globs is a documentation surface that
drifts.

`AGENT.md` is `.gitignore`d, so CI never sees it and it contributes nothing
there; it is globbed for the local run, where it is edited. The blocking gate
rests on the two tracked surfaces.

One wrinkle worth knowing if you extend this: `checkRunScripts` derives a fence's
working directory from the doc's own path, which is right for an example README
and wrong for `.agent/workflows/deployment.md` — its `pnpm run build` means the
monorepo root, not a `package.json` beside the file. `ROOT_CWD_GLOBS` in
`check-doc-commands.mjs` is that exception.

## Why the snippet stage needs accommodations

Docs snippets are fragments, not programs. Three of them, each chosen to keep
the check meaningful rather than to silence it:

1. **Unresolvable imports are stubbed.** Relative paths, `virtual:` ids, and
   deps the monorepo does not carry become ambient `any` modules.
   `@rebasepro/*` is *never* stubbed — that is the surface under test.
   Third-party packages have to be named in `EXTERNAL_PACKAGES`; an
   unresolvable specifier that is not on that list is reported. See
   "Degradation is reported, not absorbed" below.
2. **Free identifiers are discovered by compiling twice.** Pass 1 collects the
   compiler's own "Cannot find name" diagnostics; pass 2 re-runs with a
   synthesized prelude. Using real scope resolution beats reimplementing it. A
   name the SDK exports is auto-imported so it keeps its real type; anything
   else becomes `any`.
3. **The prelude is exactly one line**, so mapping a diagnostic back to
   `doc.md:line` is arithmetic rather than a source map.

`noImplicitAny` and `strictNullChecks` are off: docs elide parameter types and
null guards for readability, neither can express API drift, and leaving them on
buried the diagnostics that can under several hundred that could not.

What survives is the part worth checking — member access and call signatures on
real SDK types.

## Degradation is reported, not absorbed

Every accommodation above trades coverage for the ability to check fragments at
all, and each one fails *quietly*: a stubbed module is `any`, and `any` accepts
everything. So a module that silently drops out of the program does not produce
errors — it produces a clean run over unchecked code.

That is not hypothetical. `react` left the program twice. The second time it
took fifteen generated `@rebasepro/ui` pages with it: their examples called
`React.useState` with no import, which is a `ReferenceError` for anyone who
copies them, and the verifier passed them because `React` was merely an
undeclared name it helpfully stubbed. Three guards now make that loud:

- **Unresolvable bare specifiers** are findings unless listed in
  `EXTERNAL_PACKAGES` (`typecheck-snippets.mjs`). Add a package there when the
  monorepo genuinely should not carry it; the list is the record of what is
  knowingly unchecked. Relative and `virtual:` specifiers stay exempt — they
  are unresolvable by design.
- **Hand-written `paths` targets are checked for existence.** They are absolute
  directories pointing into `node_modules`, and tsc does not complain about a
  mapping that resolves to nothing — it just types the import `any`. A store
  layout change would otherwise silently un-check every snippet using that
  module.
- **A snippet the program never compiled is a finding**, not a skip.

The summary line reports how many third-party modules were stubbed, so the
allowlist's cost stays visible.

## Opting out

For blocks that are deliberately pseudocode (bare type signatures, truncated
JSX, object-literal excerpts), either:

````
```ts no-verify
```
````

or an HTML comment on the line immediately above the fence:

```
<!-- docs-verify: ignore -->
```

Use it when the block is *not meant to compile*. Do not use it to silence a
block that is wrong — that is the bug this exists to find.

## Where it blocks

CI runs `pnpm run verify:docs:strict` (`.github/workflows/verify.yml`), so a
finding fails the build. The baseline is clean — keep it there.

`scripts/verify-quality.sh` still calls it without `--strict`, deliberately: it
is the local sweep, and a warning there is a nudge rather than a stop. To make
the local run blocking too, add `--strict` to that call and move it from `warn`
to `err`.
