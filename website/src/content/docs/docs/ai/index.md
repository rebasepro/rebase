---
title: AI & Agents
sidebar_label: Overview
description: What Rebase ships for AI coding assistants and autonomous agents — an MCP server, project-local agent skills, scaffolded instruction files, and the credential model that decides what an agent can actually reach.
---

Rebase ships four separate things for AI assistants, and they solve different
problems. It is worth knowing which one you are reaching for:

| | What it is | Who consumes it |
|---|---|---|
| [**MCP server**](/docs/ai/mcp) | A stdio Model Context Protocol server with 41 tools over your schema, data, users, storage, cron and dev server | An assistant, at runtime |
| [**Agent skills**](/docs/ai/skills) | 21 Markdown skill files written into your repo by `rebase skills install` | An assistant, as reference material |
| [**Instruction files**](/docs/ai/instruction-files) | `ai-instructions.md` plus per-assistant pointer files, written by `rebase init` | An assistant, as always-on rules |
| [**API keys**](/docs/backend/api#api-keys) | Scoped machine credentials, per collection and per operation | Anything calling the HTTP API |

The first three are about giving an assistant *knowledge* and *tools*. The
fourth is the only one that decides what it may actually do.

## The part that matters: what an agent may touch

An agent with tools over your database is an ordinary API caller that happens to
decide its own next request. Rebase does not try to constrain it with
instructions — a prompt is not an access-control mechanism, and an agent that
reads your rows is reading text that somebody else may have written. The
constraint has to live below the agent, in the credential it carries.

Rebase gives that credential two independent gates:

1. **The API-key permission list.** Declared per collection *and* per operation,
   where `delete` is separable from `write` — which is usually the one you want
   to withhold from an agent that is otherwise allowed to edit.
2. **Row-Level Security.** API keys do not bypass RLS. A key connects as the
   `rebase_user` Postgres role like any other caller, so your policies still
   decide which rows come back.

Both must allow a request. Neither is a substitute for the other, and the second
one is the reason a key with `"*"` permissions can still return an empty result
set.

A point that catches people: a collection's `access: "public"` widens **which
rows a caller may see**, not **who may call**. It is a statement about row
visibility, not about authentication. Granting it does not add a caller to the
permission list, and withholding it does not stop one.

The mechanics — creating keys, the permission JSON, rotation, expiry, rate
limits — are covered in [REST API → API Keys](/docs/backend/api#api-keys).
Do not skip [Security Rules (RLS)](/docs/collections/security-rules) on the way
past; the second gate is only as good as the policies you wrote.

:::caution[The MCP server does not default to a scoped key]
The two-gate model above describes what an API key does. It is **not** what
`@rebasepro/mcp` uses unless you configure it to. Left alone, the MCP server
authenticates with your dev server's **service key** — an unscoped admin
credential that satisfies the default admin policies on every collection. See
[What the MCP server can reach](/docs/ai/mcp#what-the-server-can-reach)
before you point an assistant at anything you care about.
:::

## Vector search

Rebase has a first-class `vector` property type on Postgres and a
`.vectorSearch()` query method with `cosine`, `l2` and `inner_product` distance.
It is already documented, in two places rather than one:

- [Querying Data → Vector Search](/docs/sdk/querying#vector-search) — the SDK
  method, the `_distance` field it adds to each row, and the caveats
- [REST API → Vector Search](/docs/backend/api#vector-search) — the
  `vector_search`, `vector`, `vector_distance` and `vector_threshold` query
  parameters

Three things to know before designing around it. **Rebase stores and searches
embeddings; it does not compute them** — there is no embedding provider, model
setting or API key anywhere in Rebase, so producing the vectors is your job.
**pgvector is a prerequisite, and installing it is opt-in.**
`database({ extensions: ["vector"] })` in `config/resources.ts` lets `rebase db
push` and the boot schema-ensure run `CREATE EXTENSION IF NOT EXISTS vector` for
you; without it they create the column and leave the extension to you. Either
way the server needs an image carrying the library and a role allowed to install
it. And **every vector column gets an HNSW index for
cosine distance**, because cosine is what `vectorSearch` measures with unless
you pass `distance` — an index serves exactly one operator. Tune it, or turn it
off, on the property: see [The index](/docs/sdk/querying#the-index).

Vector queries also cannot be subscribed to; `.vectorSearch(...).listen()` is
refused with `VECTOR_SEARCH_NOT_LIVE`.

For lexical search — ranked full-text over the fields you name, including JSONB
and array content — see [Search](/docs/backend/search). It is a different
mechanism and the two do not interact.

## Where to go next

- [MCP Server](/docs/ai/mcp) — connect Claude Code, Cursor or any MCP client
- [Agent Skills](/docs/ai/skills) — `rebase skills install` and the 21 skills
- [AI Instruction Files](/docs/ai/instruction-files) — the scaffolded rules pattern
