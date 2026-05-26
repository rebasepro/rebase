# Rebase AI Coding Rules

For the most up-to-date, comprehensive guidelines, architecture details, SDK APIs, and troubleshooting guides, please refer to the official Rebase LLM documentation:
👉 https://rebase.pro/llms.txt

If you are running in an agentic environment (like Antigravity or a Gemini CLI extension), the assistant will automatically load the active Rebase agent skills.

## Core Tenets (Quick Reference)

1. **Schema-as-Code**: Always define or edit collections in `config/collections/` (e.g., `config/collections/posts.ts`). Never modify generated Drizzle schemas or PostgreSQL tables manually.
2. **Two-Step Migrations**:
   - Step 1: Run `rebase schema generate` to compile collections to the Drizzle schema.
   - Step 2: Run `rebase db push` (development) or `rebase db generate && rebase db migrate` (production) to apply schema changes to the database.
3. **Use the SDK**: Always use the Rebase SDK (`rebase.data.<slug>`) to fetch or modify data. Bypassing it with raw SQL or direct Drizzle/PG queries circumvents model validations, lifecycle hooks, and Row-Level Security (RLS).
