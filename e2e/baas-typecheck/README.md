# BaaS typecheck fixture

Proves that a **BaaS-only** Rebase project typechecks with React absent.

This is the test whose absence let the type surface rot. The runtime guard
(`pnpm check:headless`) proved the backend never *executes* React, and it passed
the whole time — every React import in `@rebasepro/types` is erased at build. But
13 shipped `.d.ts` files began with `import React from "react"` while
`@types/react` was declared only as a devDependency, so a real BaaS install had
nothing to resolve them against.

## How react's absence is simulated

`stubs/react-absent.d.ts` is a module whose default export has exactly one
member, `__rebase_react_is_not_installed__`. `tsconfig.json` maps `react`,
`react-dom` and `react/jsx-runtime` onto it.

Any core type that *uses* a React type — `React.ReactNode`,
`React.ComponentType`, `import { ReactNode } from "react"` — becomes a type
error, naming the offending file. Because the program resolves `@rebasepro/*` to
**source**, the check needs no prior build and cannot be fooled by stale `dist`.

`jsx` is deliberately left unset: a `.tsx` file containing real JSX anywhere in
the BaaS graph fails too.

This pairs with `pnpm check:types-headless`, which scans for the *presence* of a
`react` specifier in core sources and in built `.d.ts`. Two different questions:
the guard asks "does any core file name React?", this fixture asks "does the BaaS
type surface still work when React does not exist?". Both are needed — the guard
cannot see through a type alias, and the fixture cannot see an unused import.

## What it covers

- `src/server.ts` — a BaaS backend: `initializeRebaseBackend` + Postgres adapter.
- `src/collection.ts` — a collection file with properties, validation, relations,
  security rules and callbacks, typed against core `CollectionConfig`. This is
  the proof that the *schema* half of a collection is fully typed with no React.
- `src/sdk.ts` — `@rebasepro/client` usage, including typed accessors.

## Run

```bash
pnpm check:baas-types
```
