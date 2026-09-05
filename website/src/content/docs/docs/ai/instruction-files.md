---
title: AI Instruction Files
sidebar_label: AI Instruction Files
description: Every scaffolded Rebase project ships ai-instructions.md plus one-line pointer files for Claude, Cursor, Windsurf, Copilot and AGENTS.md — one source of truth, many filenames.
---

Every assistant wants its rules in a different file. Claude Code reads
`CLAUDE.md`, Cursor reads `.cursorrules`, Windsurf reads `.windsurfrules`,
Copilot reads `.github/copilot-instructions.md`, and the cross-vendor convention
is `AGENTS.md`. Maintaining the same guidance in five files is how four of them
end up stale.

`rebase init` writes all five — as **pointers to a single file you actually
edit**:

```text
your-project/
├── ai-instructions.md            ← the real content
├── CLAUDE.md                     ← pointer
├── AGENTS.md                     ← pointer
├── .cursorrules                  ← pointer
├── .windsurfrules                ← pointer
└── .github/
    └── copilot-instructions.md   ← pointer
```

Each pointer file is two lines:

```markdown title="CLAUDE.md"
# Rebase AI Rules
Please refer to and follow the instructions defined in [ai-instructions.md](./ai-instructions.md).
```

`.github/copilot-instructions.md` is identical but for the relative path
(`../ai-instructions.md`).

This happens on every `rebase init`, for every preset including `--headless`.
There is no flag and no prompt.

`rebase init` also writes `.mcp.json`, which points Claude Code, Cursor and
any other MCP client at the [Rebase MCP server](/docs/ai/mcp):

```json title=".mcp.json"
{
  "mcpServers": {
    "rebase": { "command": "npx", "args": ["-y", "@rebasepro/mcp"] }
  }
}
```

There is no `REBASE_PROJECT_DIR` in it on purpose: the client spawns the server
at the project root, and an absolute path is the one line of that file that
cannot be committed.

## Why a pointer rather than a copy

The pointer files are deliberately content-free. Assistants follow relative
Markdown links, so a two-line file that names the real one gets the same result
as a copy — and it has properties a copy does not:

- **One file to edit.** Rules cannot drift between assistants, because there is
  only one set of rules.
- **One diff to review.** A change to project conventions is a change to one
  file, not five identical ones a reviewer must compare.
- **Adding an assistant is two lines.** A new tool with a new filename gets a
  pointer, not a sixth copy of your conventions.

The pattern is worth keeping if you fork the scaffold, and worth adopting in
repos that are not Rebase projects at all.

## What `ai-instructions.md` starts with

The scaffolded file is deliberately short — it points at
[`rebase skills install`](/docs/ai/skills) for depth, then states the rules that
assistants get wrong often enough to be worth repeating at the top of every
session:

1. **Schema as code.** Collections are defined in `config/collections/`. Never
   hand-edit the generated Drizzle schema or the Postgres tables — see
   [Schema as Code](/docs/architecture/schema-as-code).
2. **Migrations are two steps.** `rebase schema generate`, then `rebase db push`
   in development, or `rebase db generate && rebase db migrate` for production.
3. **Use the SDK.** Go through `rebase.dataAsAdmin.<slug>` for work done as the
   service identity, or `getDriver(c)` inside a function when the read should run
   as the caller. The server client has no plain `data` accessor. Raw SQL and direct
   Drizzle calls bypass validation, callbacks and RLS.
4. **Guard every custom route.** Routes in `backend/functions/` are mounted
   *without* authentication. Use `requireAuth` / `requireAdmin` from
   `@rebasepro/server/functions` in the route's own middleware slot — reading
   `c.get("user")` is not a guard, and neither is `app.use()` after the route.

That last one is the one to keep. It is the difference between a middleware that
runs and one that does not, and an assistant that has not been told will
reliably write the version that does not — see
[Custom Functions](/docs/backend/custom-functions).

## Making it yours

`ai-instructions.md` is your file. Nothing regenerates or overwrites it — unlike
[installed skills](/docs/ai/skills), which are replaced on every
`rebase skills install`. Project-specific conventions belong here.

What earns its place is what an assistant cannot infer from the code: which
collections are legacy, which service owns which table, the naming convention
that is not enforced anywhere, the migration that must not be re-run. Keep it
short — instructions loaded into every request compete with the actual task for
attention, and a long file is one an assistant skims.

And keep the boundary in mind: this file shapes what an assistant *writes*. It
has no bearing on what an agent connected to your database may *do* — that is
decided by the credential it carries, and nothing in Markdown changes it. See
[the MCP server's credential model](/docs/ai/mcp#what-the-server-can-reach).
