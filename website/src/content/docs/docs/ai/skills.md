---
title: Agent Skills
sidebar_label: Agent Skills
description: rebase skills install writes 20 Rebase reference skills into your repo, in the layout your AI assistant expects — Cursor, Claude Code, Windsurf, Gemini CLI and Antigravity.
---

An AI assistant that has read Rebase's documentation writes better Rebase code
than one guessing from the shape of the API. `rebase skills install` copies 20
Markdown skill files into your repository, in whatever layout your assistant
expects:

```bash
rebase skills install
```

The skills are **reference material, not tools**. They tell an assistant how
collections are defined, why migrations are two steps, and which mistakes the
framework will not catch for it. For tools that act on your data, see the
[MCP server](/docs/ai/mcp).

## Which assistant

The command takes `--agent` (or `-a`), repeatable and comma-separated:

```bash
rebase skills install --agent claude
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Four targets are supported:

| `--agent` | Assistant | Written to |
|---|---|---|
| `cursor` | Cursor | `.cursor/rules/<skill>.mdc` |
| `claude` | Claude Code | `.claude/skills/<skill>/SKILL.md` |
| `windsurf` | Windsurf | `.windsurf/rules/<skill>.md` |
| `gemini` | Gemini CLI / Antigravity | `.agents/skills/<skill>/SKILL.md` |

`gemini` covers **both** Gemini CLI and Antigravity — they read the same
`.agents/` directory, so there is no separate `antigravity` value.

With no `--agent`, the command detects which assistants a project already uses by
looking for `.cursor/`, `.claude/`, `.windsurf/` and `.agents/`. If it finds
none it prompts you to choose.

:::note[A freshly scaffolded project always prompts]
`rebase init` writes `CLAUDE.md`, `.cursorrules` and friends, but none of the
*directories* detection looks for. So the first run in a new project falls
through to the prompt — and in CI, where there is no TTY, it exits with an error
instead. Pass `--agent` explicitly in any non-interactive context.
:::

## Project-local, and meant to be committed

Skills are written **relative to your project root** — the nearest ancestor
containing `rebase.json` — not to your home directory and not to the current
working directory. Nothing is installed globally.

Commit them. They are part of the repo the same way a lint config is: every
contributor's assistant then works from the same understanding of the codebase,
including contributors who never ran the command.

**Re-run the command to update.** Files are overwritten unconditionally, so
after a Rebase upgrade:

```bash
rebase skills install --agent all
```

Two consequences of "unconditionally": local edits to an installed skill are
lost on the next run — keep project-specific guidance in
[`ai-instructions.md`](/docs/ai/instruction-files) instead, which is yours and is
never overwritten. And skills removed in a newer release are not deleted from
your repo; only files that still exist get rewritten.

The command also works outside a Rebase project, falling back to the working
directory — useful for a separate frontend repo that talks to a Rebase backend.

## The 20 skills

| Skill | Covers |
|---|---|
| `rebase-basics` | Core principles, workflow and maintenance — the entry point the others assume |
| `rebase-collections` | Defining collections, property types, validation, searchability |
| `rebase-backend-postgres` | The Postgres backend: setup, schema generation, migrations, pooling, read replicas |
| `rebase-api` | The generated REST API — endpoints, filtering, sorting, pagination |
| `rebase-sdk` | The generated TypeScript SDK: CRUD, filtering, search, auth, realtime, offline, storage |
| `rebase-auth` | Authentication, roles, RLS policies, MFA, API keys, OAuth, custom adapters |
| `rebase-security` | Access control, interception, fail-closed design, PII masking, tenant isolation |
| `rebase-realtime` | The WebSocket engine: sync, broadcast channels, presence, table change broadcasts |
| `rebase-storage` | S3/GCS/local storage, uploads, TUS resumable uploads, image transformations |
| `rebase-custom-functions` | Custom API endpoints via file-based function discovery |
| `rebase-cron-jobs` | Scheduling recurring background tasks |
| `rebase-webhooks` | Outbound HTTP webhooks, HMAC signatures, retry and backoff |
| `rebase-email` | SMTP, templates, custom providers, the `rebase.email` singleton |
| `rebase-entity-history` | Entity versioning, change tracking, audit logs, reverting |
| `rebase-admin` | Navigating the admin panel, side drawers, URLs, embedding collection panels |
| `rebase-ui-components` | The `@rebasepro/ui` component library |
| `rebase-design-language` | The UI design language: tokens, color, typography, spacing, anti-patterns |
| `rebase-studio` | The Studio developer tools layer — SQL, RLS, storage, cron, schema visualizer, logs |
| `rebase-deployment` | Rebase Cloud, Docker, and self-hosting on AWS, GCP, Hetzner, Railway and Render |
| `rebase-local-env-setup` | First-time setup: Node.js, pnpm, PostgreSQL, Docker |

Two of these ask to be read unprompted. `rebase-basics` says it should be used
whenever an assistant touches Rebase at all, and `rebase-design-language` says an
agent must read it before creating or modifying any visual UI — that one exists
because generated UI drifts from a design system faster than anything else in a
codebase.

## What a run looks like

```text
  Found 20 Rebase skills

  ✓ Claude Code — 20 skills installed (+ 1 reference file) to .claude/skills
```

Skills ship from the `@rebasepro/agent-skills` package, which the CLI depends on,
so the set you get matches your installed CLI version.
