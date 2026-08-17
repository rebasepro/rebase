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
3. **Use the SDK**: Always use the Rebase SDK (`rebase.data.<slug>`) to fetch or modify data. Bypassing it with raw SQL or direct Drizzle/PG queries circumvents model validations, lifecycle hooks, and Row-Level Security (RLS).
4. **Guard every custom route**: routes in `backend/functions/` are mounted **without** an auth requirement — webhook receivers need that — so each one is public until you guard it. Import `requireAuth` / `requireAdmin` from `@rebasepro/server` and pass them in the route's own middleware slot (`app.post("/", requireAuth, handler)`), not via `app.use()`, which only covers routes declared below it. Reading `c.get("user")` is not a guard: an anonymous caller gets `undefined` and the handler still runs. See `backend/functions/hello.ts` for all three tiers.
5. **Build UI from the kit, never from scratch**: any custom view, home page, dashboard or entity tab must be composed from `@rebasepro/ui` components (`Card`, `Typography`, `Button`, `Chip`, `Alert`, …) and the theme's colour tokens (`text-surface-*`, `bg-surface-accent-*`, `text-primary`), with a `dark:` value beside every light one. Do **not** invent a palette, a type scale, or hand-written CSS: a hardcoded colour like `#111` is invisible in one of the two themes and nothing will catch it. The live reference ships in your `node_modules` — read `@rebasepro/app/src/components/Debug/UIReferenceView.tsx` before building a view, and see [Styling Custom UI](https://rebase.pro/docs/frontend/styling). The `rebase-design-language` and `rebase-ui-components` skills cover this in full; install them with `rebase skills install`.
