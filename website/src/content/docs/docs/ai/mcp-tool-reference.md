---
title: MCP tool reference
sidebar_label: MCP tool reference
description: Every tool the Rebase MCP server registers, by group — what each one needs and does, and which ones the loopback gate refuses against a non-local project.
---

The tools [`@rebasepro/mcp`](/docs/ai/mcp) offers an assistant. How it connects,
which credential it holds and how the [loopback gate](/docs/ai/mcp#the-loopback-gate)
decides what ⚠ means are on the [MCP server](/docs/ai/mcp) page.

42 tools, in nine groups. Tools marked ⚠ are refused against non-local targets
unless you opt out.

## Schema & database (12)

Spawn the Rebase CLI in the active project directory.

| Tool | Required | Description |
|---|---|---|
| `rebase_schema_generate` | — | Generate Drizzle schema from collection definitions |
| `rebase_db_push` ⚠ | — | Apply the schema directly to the database (dev shortcut) |
| `rebase_schema_introspect` | — | Introspect the live database into collection definitions |
| `rebase_db_generate` | — | Generate SQL migration files from schema changes |
| `rebase_db_migrate` ⚠ | — | Run all pending SQL migrations |
| `rebase_generate_sdk` | — | Generate the fully-typed TypeScript SDK |
| `rebase_doctor` | — | Detect drift between definitions, generated schema and the live database |
| `rebase_db_branch_create` ⚠ | `name` | Create a database branch (admins only) |
| `rebase_db_branch_list` | — | List database branches (admins only) |
| `rebase_db_branch_delete` ⚠ | `name` | Delete a database branch (admins only) |
| `rebase_db_branch_info` | `name` | Branch information and status (admins only) |
| `rebase_db_branch_switch` | — | Point this checkout at a branch, or back at the main database (admins only) |

## Schema planning (1)

Asks the backend what a change would do, over `POST /api/admin/schema/plan`. No
CLI, and nothing written to disk — it works on the managed development database,
which the Atlas-backed commands cannot.

| Tool | Required | Description |
|---|---|---|
| `rebase_schema_plan` | `collectionId`, `collection` | The SQL one collection's change would run, and which statements destroy data |

## Documents (5)

| Tool | Required | Description |
|---|---|---|
| `list_documents` | `collection` | List rows, with optional `limit`, `offset`, `orderBy`, `where` |
| `get_document` | `collection`, `id` | Fetch a single row by ID |
| `create_document` ⚠ | `collection`, `data` | Create a row |
| `update_document` ⚠ | `collection`, `id`, `data` | Update a row |
| `delete_document` ⚠ | `collection`, `id` | Delete a row |

## Users & roles (6)

| Tool | Required | Description |
|---|---|---|
| `list_users` | — | List all users, including roles |
| `create_user` ⚠ | `email` | Create a user (optional `displayName`, `password`, `roles`) |
| `update_user` ⚠ | `uid` | Update email, display name or roles |
| `delete_user` ⚠ | `uid` | Delete a user |
| `list_roles` | — | List defined roles |
| `rebase_auth_reset_password` ⚠ | `email` | Reset a password via the admin API |

`create_user` and `update_user` both accept `roles`, so either can mint an
admin. That is why they are gated rather than treated as merely "additive".

## Storage (3)

| Tool | Required | Description |
|---|---|---|
| `storage_list_objects` | — | List stored objects |
| `storage_get_download_url` | `key` | A temporary signed download URL and its expiry — not object metadata |
| `storage_delete_object` ⚠ | `key` | Delete an object |

`storage_get_download_url` is classified as a read because it does not change the
environment — but the signed URL it mints is a bearer capability that outlives
the tool call.

## Cron (5)

| Tool | Required | Description |
|---|---|---|
| `cron_list_jobs` | — | List scheduled jobs and their status |
| `cron_get_job` | `jobId` | Job details |
| `cron_get_job_logs` | `jobId` | Execution logs |
| `cron_trigger_job` ⚠ | `jobId` | Run a job immediately |
| `cron_toggle_job` ⚠ | `jobId`, `enabled` | Enable or disable a job |

`cron_toggle_job` can silently disable a backup or a billing job — a change with
no error and no output until something is missing later.

## Functions (1)

| Tool | Required | Description |
|---|---|---|
| `invoke_function` ⚠ | `name` | Invoke a [custom function](/docs/backend/custom-functions) with any method and payload |

This calls code the MCP server has never seen, with a method and body the model
chose. Its blast radius is whatever your functions do.

## Dev server (3)

| Tool | Required | Description |
|---|---|---|
| `rebase_dev_start` | — | Start the dev server; returns immediately |
| `rebase_dev_logs` | — | Read recent output (default 50 lines, 500-line buffer) |
| `rebase_dev_stop` | — | Stop the dev server |

## Project registry (6)

| Tool | Required | Description |
|---|---|---|
| `rebase_project_list` | — | List registered projects and show the active one |
| `rebase_project_switch` | `name` | Change the active project |
| `rebase_project_add` | `name` | Register a project (`baseUrl`, optional `projectDir`, `token`) |
| `rebase_project_remove` | `name` | Remove a project (the default project cannot be removed) |
| `rebase_project_current` | — | Show the active project and its auth status |
| `rebase_project_status` | — | Health-check the active backend |

`rebase_project_switch` is not gated, because it retargets everything else
rather than acting on a target itself. An assistant can therefore switch to a
remote project without tripping the gate — it just cannot then run a destructive
tool there.
