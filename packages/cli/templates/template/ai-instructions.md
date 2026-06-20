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
