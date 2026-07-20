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

## Why the snippet stage needs accommodations

Docs snippets are fragments, not programs. Three of them, each chosen to keep
the check meaningful rather than to silence it:

1. **Unresolvable imports are stubbed.** Relative paths, `virtual:` ids, and
   deps the monorepo does not carry become ambient `any` modules.
   `@rebasepro/*` is *never* stubbed — that is the surface under test.
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

## Making it blocking

The stage is warn-first because the baseline is not clean. To enforce: add
`--strict` to the `verify-docs.mjs` call in `scripts/verify-quality.sh` and move
it from `warn` to `err`.
