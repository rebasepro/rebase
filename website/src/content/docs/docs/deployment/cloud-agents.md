---
title: CI, Agents and Claimable Backends
sidebar_label: CI and Agents
description: Deploy to Rebase Cloud from CI or an agent with a scoped token instead of a password, and let an agent provision a live backend with no account that a person claims later.
---

A [Rebase Cloud](/docs/deployment/cloud/) project does not need a person at a
terminal to deploy. A CI job or an agent acts with a token narrowed to a few
actions on one project, and an agent can create a project before anyone has an
account, then hand over a link to claim it.


## CI and agents

A CI job or an agent should not carry your password. Give it a token
instead: a key that acts as your account, narrowed to a few actions on one
project. Create it from a signed-in terminal:

```bash
rebase cloud tokens create --project shop --can deploy,logs --expires-in 90
```

The token is printed once, as an `export REBASE_TOKEN=rk_live_…` line. With
`REBASE_TOKEN` set, every `rebase cloud` command authenticates with it instead of
your login, and never reads or writes the stored session. In GitHub Actions,
store it as a repository secret and expose it under that name:

```yaml title=".github/workflows/deploy.yml"
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11
      - uses: actions/setup-node@v4
        with:
          node-version: 22.x
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec rebase cloud deploy --project shop
        env:
          REBASE_TOKEN: ${{ secrets.REBASE_TOKEN }}
```

`--can` takes one or more capabilities, comma-separated or repeated:

| Capability | What the token may do |
|---|---|
| `deploy` | Deploy the project and follow its builds: `deploy` (`--preview` included), `deployments`, `previews` |
| `logs` | Read build and runtime logs, cron history, live metrics and usage: `logs`, `cron`, `metrics`, `usage` |
| `env` | Read and change environment variables, secrets included, and previews' own (`--preview`) |
| `database` | `db list`, `db info` and `db connect`, which includes the database password |
| `backups` | List, create, inspect and download backups, and read the point-in-time window |

Three more capabilities act on an organization rather than a project. A token
holds one only when `--can` names it, on the organization `--org` names (or,
without `--org`, the project's organization, then the one selected with
`rebase cloud use`). A token may hold them and no project capability:

```bash
rebase cloud tokens create --can billing --org <organization-id> --name invoices
```

| Capability | What the token may do |
|---|---|
| `billing` | Read the card on file, the invoices and the next invoice, and change the billing email: `billing`, `billing invoices`, `billing upcoming`. Owners and admins only |
| `audit` | Read the organization's activity log: `activity`. Owners and admins only |
| `notifications` | Change its owner's own email choices, and the organization's projects' notification webhooks: `notifications`. Adding, changing and removing a webhook still takes the owner or admin role |

A token made before
`billing` existed still reads billing for one release. Each of those answers
carries a `Deprecation: true` header and a sentence naming the scope the token
lacks, and the CLI prints it once, on stderr, as a warning. Replace such a token
with one made with `--can billing` before the next release, when billing starts
refusing it.

Under the hood a token is a [personal API key](/docs/backend/api-keys/#personal-keys)
on the control plane. Each capability becomes a few
[scopes](/docs/backend/roles-and-scopes/): `deploy` on `shop` holds
`project:deploy:<id>`, with the project's id, plus the data and function scopes
the deploy commands call. An organization capability holds `org:billing:<id>`,
`org:audit:<id>` or `org:notifications:<id>`, with the organization's id. The token never holds more than your account does at the moment
it is used, so it loses whatever your account loses.

Two things stay with a signed-in person:

- **Managing tokens.** `rebase cloud tokens list`, `create` and `revoke <id>` take
  your `rebase cloud login` session. A token cannot list, create or revoke
  tokens, because a token that could mint tokens could mint its own successor.
- **Restoring.** No capability grants a backup restore or a point-in-time
  `restore` and `cutover`. Putting old data over a live database stays with a
  signed-in owner or admin.

`rebase cloud whoami` with a token set shows what it may do, and on which
project or organization. The console's **Access tokens** screen offers the same
capabilities, the organization ones under **Organization access**. `rebase cloud tokens revoke <id> --yes` stops it at once.

## A backend with no account

An agent that has built an app can give it a live backend before anyone has
signed up, and hand the person it works for a link to keep it:

```bash
rebase cloud init --claim
```

That provisions a project on Rebase Cloud, sets `REBASE_BASE_URL` in `.env` to
its live address, links the directory, and deploys the local collections with
`rebase cloud deploy --bundle`. It prints the live URL, the admin panel URL and a
**claim URL**. Whoever opens the claim URL and signs in can move the project into
one of their organizations. The link works once. A project nobody claims within
72 hours is deleted, database included. `rebase cloud claim` prints the claim
URL again with the time left, and `--open` opens it. The MCP server's
`rebase_cloud_provision` tool runs the same command and returns the same URLs;
its other cloud tools then check, deploy, read logs, set variables and roll back
the project without a login (see [MCP server](/docs/ai/mcp#rebase-cloud)).

`REBASE_BASE_URL` in `.env` is also where `rebase api-keys`, `rebase storage`
and `rebase auth reset-password` send the local service key, so after `init
--claim` they go to the cloud project, which does not take that key. They say so
when they do; set `REBASE_BASE_URL` in the shell to reach a local backend
instead.

Until the project is claimed it belongs to no account. Its token is narrowed to
that one project: it deploys, reads logs and metrics, sets environment variables
and runs `db info`. It reads nothing secret back: not a variable's value (the
service key included), not the database password, and it cannot open
`db connect` or a preview. It is kept in
`~/.rebase/credentials.json`, never in the repository, and `rebase cloud`
commands in the linked directory use it on their own. `REBASE_TOKEN`, when set,
still wins if it holds a scope on that project, and those commands warn that it
did; when it holds none (a CI token made for other projects), the project's own
token is used and the first command says so. A command given `--project` for
another project keeps `REBASE_TOKEN`, and the deploy `init --claim` runs always
uses the project's own token. It expires with the project. `rebase cloud whoami` in that directory shows the project, what the
token may do, the claim URL and when the project expires. A command that needs a
person's session refuses with `session_required` and keeps the token; it is
forgotten only once the control plane refuses it everywhere, after a claim or at
expiry, and the claim URL is printed as it goes. `rebase cloud status` shows the
claim URL and the expiry too (`unclaimed` in `--json`). `rebase cloud unlink`
does not delete an unclaimed project: it warns that the project keeps running
until it expires and prints the claim URL, and `init --claim` in a directory
that is already linked to one points at its claim URL instead of provisioning a
second. Until the claim, the app reaches the internet on ports 80 and 443 only;
the mail ports every other project has (465, 587 and 993) open when the project
is claimed.

Once the deploy has built the app, the command also sets `REBASE_API_TOKEN` in
`.env`: a key minted on the app itself, which is what the MCP server and the SDK
send to it. A `REBASE_API_TOKEN` already in `.env` is kept and none is minted,
and a `.env` the command creates is readable by you alone. It reads and writes data (`data:read`, `data:write`) through the
app's row-level security, as a caller who is neither a person nor an admin. It
holds nothing of the admin plane, and it expires with the claim window unless the
project is claimed first. With `--no-deploy`, or when that first deploy fails,
there is no key yet: the next `rebase cloud deploy` that succeeds in the
directory asks for one, as long as the project is unclaimed and `.env` sets no
`REBASE_API_TOKEN` already. `init`, `deploy`, `status` and `whoami` print the
date it expires.

Claiming hands the key over: the claim removes its expiry, so the app's `.env`
keeps working. The agent still holds a copy, so the person who claimed the
project can replace it. `rebase cloud app-key rotate`, or **Rotate app key** in
the project's Settings, mints a new key and revokes every earlier agent key at
once. It writes the new key into a `.env` that already sets `REBASE_API_TOKEN`,
or shows it once. Owners and admins rotate it, signed in. A key that could not
be handed over keeps its expiry, which happens when the app was not deployed or
not answering at the claim. Rotating replaces it with one that does not expire.

Claiming also replaces the project's `REBASE_SERVICE_KEY`, which is admin on
the app's own API and which the agent's deployed code could read. The app
restarts once onto a new key, and whatever the agent kept stops working when
that restart has finished. If a deploy is running at the moment of the claim,
the next deploy carries the new key.

Claiming takes a signed-in browser session, not a token, and a payment method on
the organization the project moves into. From the claim onwards the project is
billed like any other. Claiming also revokes the agent's token: sign in with
`rebase cloud login`, or mint a new token with `rebase cloud tokens create`.

Provisioning without an account is bounded per address, per network (an IPv4
/24) and in total, and a control plane that has not switched it on refuses with
a message saying so. Usage from before the claim is not billed to whoever
claims the project.
