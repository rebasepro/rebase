# Firebase example

A React app exercising the `@rebasepro/firebase` adapter — `RebaseFirebaseApp`,
a `FirebaseAccessGate`, and four collections (`blog`, `demo`, `products`,
`users`).

## Testing the example

This example is used for development purposes.

IMPORTANT: If you want to get started using Rebase it is advisable to check the
[docs](https://rebase.pro/docs)

The Firebase project it points at comes from the environment. Copy
`.env.example` to `.env` and fill in your own project's web config — Project
settings → Your apps in the Firebase console.

None of those values are secrets: a Firebase web config identifies a project,
and its security rules are what protect the data. They are not committed
because a live project's config inside a public example is an invitation to
spend its quota and probe its rules, which is exactly what this file used to
do — it carried a working config for an unrelated product.

If you enable App Check, copy `src/appcheck_config.ts.template` to
`src/appcheck_config.ts` and fill in your reCAPTCHA site key.

## Running

This is a pnpm workspace package. Install once from the repo root, then run the
example through the workspace filter:

```bash
# From the repo root
pnpm install
pnpm --filter rebase-firebase-example dev
```

Or from this folder, after the root install:

```bash
pnpm dev
```

### Toolchain

Vite only — `pnpm dev` for the dev server, `pnpm build` for a production build,
`pnpm typecheck` for types. There is no `react-scripts` here, and the monorepo is
pnpm-only: `yarn` and `npm install` cannot resolve the `workspace:*`
dependencies this example declares.
