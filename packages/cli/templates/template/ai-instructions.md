# Rebase AI Coding Rules

Rebase provides agent skills for AI coding assistants (Cursor, Claude Code, Windsurf, Gemini CLI, Antigravity, and more) with detailed guidelines, architecture, SDK APIs, and troubleshooting guides.

To install skills for your environment, run:

```
rebase skills install
```

## Core Tenets (Quick Reference)

1. **Schema-as-Code**: Always define or edit collections in `config/collections/` (e.g., `config/collections/posts.ts`). Never modify generated Drizzle schemas or PostgreSQL tables manually.
2. **Two-Step Migrations**:
   - Step 1: Run `rebase schema generate` to compile collections to the Drizzle schema.
   - Step 2: Run `rebase db push` (development) or `rebase db generate && rebase db migrate` (production) to apply schema changes to the database.
3. **Use the SDK**: Always go through the Rebase SDK to fetch or modify data. Server-side that is `rebase.dataAsAdmin.<slug>` for work done as the service identity, or `getDriver(c)` inside a function when the read should run as the caller. The server client has no plain `data` accessor — it is omitted precisely so that the choice of identity is written down. Bypassing the SDK with raw SQL or direct Drizzle/PG queries circumvents model validations, lifecycle hooks, and Row-Level Security (RLS).
4. **Guard every custom route**: routes in `backend/functions/` are mounted **without** an auth requirement — webhook receivers need that — so each one is public until you guard it. Import `requireAuth` / `requireAdmin` from `@rebasepro/server/functions` and pass them in the route's own middleware slot (`app.post("/", requireAuth, handler)`), not via `app.use()`, which only covers routes declared below it. Reading `getUser(c)` is not a guard: an anonymous caller gets `undefined` and the handler still runs. See `backend/functions/hello.ts` for all three tiers.
5. **In `backend/functions/`, always import from `@rebasepro/server/functions`** — never from `@rebasepro/server`. Both work today; the subpath is the portable one, and it also gives you the typed context accessors (`getUser`, `getDriver`, `requireDriver`) instead of casting `c.get("user")`. The package root is for a server entrypoint, not for route handlers.
6. **Never read `process.env` at the top of a function file.** A module-scope read that comes back undefined throws at import time, and the loader reports that as a *skipped function* — the route simply 404s with no error attached to it. Read configuration inside the handler with `requireEnv(c, "NAME")`, or build a client once with `lazyResource(env => new Client(env.KEY))`.
7. **Work that outlives the response goes in `waitUntil(c, promise)`**, not a floating promise. A floating promise is dropped when the process shuts down mid-deploy; `waitUntil` is what a graceful shutdown waits for.
8. **Build UI from the kit, never from scratch**: any custom view, home page, dashboard or entity tab must be composed from `@rebasepro/ui` components (`Card`, `Typography`, `Button`, `Chip`, `Alert`, …) and the theme's colour tokens (`text-surface-*`, `bg-surface-accent-*`, `text-primary`), with a `dark:` value beside every light one. Do **not** invent a palette, a type scale, or hand-written CSS: a hardcoded colour like `#111` is invisible in one of the two themes and nothing will catch it. The live reference ships in your `node_modules` — read `@rebasepro/app/src/components/Debug/UIReferenceView.tsx` before building a view, and see [Styling Custom UI](https://rebase.pro/docs/frontend/styling). The `rebase-design-language` and `rebase-ui-components` skills cover this in full; install them with `rebase skills install`.
