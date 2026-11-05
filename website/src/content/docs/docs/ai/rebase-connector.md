---
title: Connect Claude to Rebase Cloud
sidebar_label: Rebase Cloud connector
description: One MCP connector for all your Rebase Cloud projects — add it once in Claude, sign in with your Rebase account, and read, deploy and change your projects with the access you have in the console, every change confirmed first.
---

The Rebase connector is one MCP server for everything you run on Rebase Cloud.
You add it once in Claude, sign in with your Rebase account, and Claude can see
your projects, read their logs, deploy and roll them back, set their
environment variables, and read and change their data. It works in Claude on
the web, the desktop app and mobile.

It acts as **you**, with the access your account has in the console: the
projects of the organizations you belong to, the role you hold in each, and the
data access the console's Studio gives you. It holds no key of its own.

## Add it

In Claude, open **Settings → Connectors → Add custom connector** and enter:

```text
https://app.rebase.pro/mcp
```

Claude opens the Rebase consent screen. If you are signed in to the console in
the same browser, it offers that account: press **Allow**. Otherwise sign in
there. The screen lists what you are granting; you can connect again later to
grant less.

## What Claude can do with it

Ten tools. The first six only read:

| Tool | What it does |
|---|---|
| `projects` | Lists your projects, their status and your role in each |
| `project_status` | One project's status and latest deployment; optionally its recent deployments, its environment variable **names**, its cron jobs |
| `logs` | The running app's output, a deployment's build log, or a cron job's runs |
| `schema` | A project's collections, or one collection's fields |
| `query` | Reads rows: one by id, a filtered page, or a count |
| `show_collection` | Shows rows as a table in the conversation, where you can page and edit cells |

The other four change production, and each one asks first:

| Tool | What it does |
|---|---|
| `write` | Creates, updates or deletes one row (users included: they are rows of your users collection) |
| `deploy` | Deploys a git branch, rolls back to an earlier deployment, or cancels one in progress |
| `env` | Sets or removes environment variables; a change applies at the next deploy |
| `cron` | Runs a cron job now, or switches one on or off |

Deploying code from your machine stays with the CLI (`rebase cloud deploy`) and
the [local MCP server](/docs/ai/mcp/), which also covers local development,
schema generation and database branches.

## Every change is confirmed

A tool that changes something takes two calls. The first changes nothing: it
answers a plan, such as "Roll shop back to deployment d_81f2", and a
confirmation token. Claude shows you the plan, and calls again with the token
only if you agree. The token works for five minutes, once, for exactly the
arguments it was made for: if anything differs, nothing runs.

Claude also asks your permission before it calls any of these four tools,
because they are marked as destructive. In the table view, an edited cell
shows the plan and waits for you to press **Save**.

Environment variable values are never shown back: a plan shows their length,
and `project_status` lists names only. A value you set does pass through the
conversation.

## What it can reach

- **Projects and cloud operations**: what the console allows you. A member of an
  organization can read status and logs and, as in the console, deploy and set
  variables.
- **Data, schemas and cron jobs**: what Studio in the console allows you. That
  is an owner or admin of the organization, on a project whose Studio access is
  switched on. Calls run inside the project, under its row-level security, with
  the admin role Studio has. Turning Studio access off for a project turns this
  off too.
- **What you granted.** You can grant the connector less than your account
  holds: only reading, or only one project. It never asks for backups,
  restores, database credentials or project settings.

A project reaches its data through the connector once it runs a runtime that
takes the connector's calls. Until its next deploy or platform rollout, those
tools say so.

## Disconnecting

Remove the connector in Claude's settings. Its access token stops working
within the hour. Deleting your Rebase account, or signing out everywhere, stops
it at the next call.

The connector is for the people who build on Rebase Cloud. To let the people
who **use** your app connect Claude to it as themselves, serve the
[remote MCP endpoint](/docs/ai/remote-mcp/) from your own backend.
