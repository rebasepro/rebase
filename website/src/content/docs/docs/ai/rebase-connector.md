---
title: Connect Claude to Rebase
sidebar_label: Rebase connector
description: One MCP connector for all your Rebase projects, on Rebase Cloud or self-hosted — add it once in Claude, sign in with your Rebase account, and read, deploy and change your projects with the access you have in the console, every change confirmed first.
---

The Rebase connector is one MCP server for every Rebase project you run: on
Rebase Cloud, and on your own servers. You add it once in Claude, sign in with
your Rebase account, and Claude can see your projects, read their logs, deploy
and roll them back, set their environment variables, and read and change their
data. It works in Claude on the web, the desktop app and mobile.

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

Your Rebase Cloud projects are there already. That is the whole setup for them.

## Add your self-hosted instances

Run this once for each server you host yourself:

```bash
rebase cloud connect https://admin.example.com
```

It adds the instance to your Rebase account and prints two variables. Set them
on that server and restart it; the command waits until the server answers, then
says it is connected. Inside the project's folder it offers to write them to
`.env` for you.

```bash
REBASE_PLATFORM_TOKEN_KEY=…
REBASE_PLATFORM_TOKEN_AUDIENCE=linked:…
```

From then on Claude lists the instance beside your Cloud projects, and you name
it the same way: "show me the orders on admin.example.com". On a self-hosted
instance the connector reads and changes data, reads its schema and runs its
cron jobs. Deploys, environment variables and logs stay on your own server.

- **The server needs Rebase 0.28.1 or later**, reachable over https at a public
  address. Rebase Cloud calls it, so a server only on a private network cannot
  be connected.
- **The variables hold no secret.** The key is Rebase Cloud's public key; the
  audience names this instance. With them the server accepts short-lived
  tokens Rebase Cloud signs for this instance only, and grants them at most
  what Studio would: data, under its row-level security, and cron.
- **Calls go through Rebase Cloud.** Claude talks to the connector, and the
  connector to your server. A server you never connect keeps its own
  [remote MCP endpoint](/docs/ai/remote-mcp/), with nothing in between.
- **To disconnect one**, run `rebase cloud connect --remove https://admin.example.com`,
  or remove the two variables from the server.

Adding an instance needs the organization's owner or admin role, like reaching
a project's data does. `rebase cloud connect --list` shows the ones you added.

## What Claude can do with it

Thirteen tools. The first nine only read:

| Tool | What it does |
|---|---|
| `projects` | Lists your projects, their status and your role in each |
| `project_status` | One project's status and latest deployment; optionally its recent deployments, its environment variable **names**, its cron jobs |
| `logs` | The running app's output, a deployment's build log, or a cron job's runs |
| `schema` | A project's tables, or one table's columns, relations and security rules |
| `query` | Reads rows: one by id, a filtered page, or a count |
| `show_table` | Opens a table in your admin panel's own view, in the conversation: a table, list, cards or kanban board you can search, filter and page, where a row opens its form |
| `show_record` | Opens one row's form, or a form for a new row Claude filled in, for you to check and save |
| `show_app` | Builds a small app for the task at hand, such as a triage queue or a dashboard, and runs it on your data in the conversation. It can use your admin panel's views and forms, and asks you before it changes anything |
| `show_app_guide` | How to write `show_app`'s code: the hooks, components and props an app may use, with an example. Claude reads it before building an app |

The other four change production, and each one asks first:

| Tool | What it does |
|---|---|
| `write` | Creates, updates or deletes one row (users included: they are rows of your users table) |
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
because they are marked as destructive. In the views, saving a form shows
the plan and waits for you to press **Save**.

Environment variable values are never shown back: a plan shows their length,
and `project_status` lists names only. A value you set does pass through the
conversation.

## What it can reach

- **Projects and cloud operations**: what the console allows you. A member of an
  organization can read status and logs and, as in the console, deploy and set
  variables.
- **Data, schemas and cron jobs**: what Studio in the console allows you. That
  is an owner or admin of the organization, on a project whose Studio access is
  switched on, or on a self-hosted instance the organization connected. Calls run inside the project, under its row-level security, with
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

The connector is for the people who build on Rebase. To let the people
who **use** your app connect Claude to it as themselves, serve the
[remote MCP endpoint](/docs/ai/remote-mcp/) from your own backend.
