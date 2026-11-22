---
title: Connection pooling
sidebar_label: Connection pooling
description: The pgbouncer service the self-hosted compose file ships for callers that cannot hold a connection, and what transaction pooling stops working through its port.
---

The runtime holds a small, long-lived pool and does not need a pooler. What does
is everything else that talks to the same database and cannot hold a connection:
a serverless function, a scheduled script, a BI tool, a queue worker that scales
to fifty. Postgres' `max_connections` is a hard limit in the low hundreds and
each connection is a *process*, so a lambda fan-out exhausts it long before the
database is busy.

The compose file ships a `pgbouncer` service for that traffic, behind a profile
so a deployment with no such callers does not run a process it has no use for:

```bash
docker compose --profile pooler up -d
```

```
postgres://rebase:$POSTGRES_PASSWORD@your-host:6432/rebase
```

```bash
PGBOUNCER_PORT=6432           # host port
PGBOUNCER_MAX_CLIENT_CONN=500 # client connections accepted
PGBOUNCER_POOL_SIZE=20        # server connections used to serve them
```

Client authentication is generated from `DATABASE_URL` on startup, so the
password is not written twice. The pooler authenticates to Postgres with
`scram-sha-256`, which Postgres 18 stores — the image's `md5` default fails the
*server* login with `FATAL: server login failed: wrong password type`, which
reads like a wrong password and is not one.

Keep the sum of `PGBOUNCER_POOL_SIZE` across every pooler comfortably under the
database's `max_connections` — the runtime is drawing from the same budget.

## What transaction pooling changes

A pooled client holds a server connection for the length of a transaction and
then gives it back, which is what lets 500 clients share 20 connections. Three
things stop working through that port, and each is something Rebase itself uses
— which is exactly why the runtime connects directly and this port is for other
callers:

- **`LISTEN`/`NOTIFY`.** [Realtime](/docs/backend/realtime/) is built on it, and a listener needs a
  connection that outlives a transaction. `LISTEN` is *accepted* through the
  pooler — it answers `LISTEN`, and then no notification ever arrives.
- **Session state**: `SET` (as opposed to `SET LOCAL`), advisory locks held
  across statements, `WITH HOLD` cursors, temporary tables. The next transaction
  may land on a different server connection, which will not see any of it. Both
  of these fail the same unhelpful way: with one idle client the state is
  usually still there, so it works while you are testing and stops working under
  the concurrency you introduced the pooler for.
- **Protocol-level prepared statements.** Most drivers can be told not to use
  them — node-postgres does not by default; asyncpg needs
  `statement_cache_size=0`.

`SET LOCAL` is transaction-scoped and works, which is what row-level security is
set with — so RLS behaves identically through the pooled port.

Leave the profile off if nothing outside the runtime connects to your database.
An unused port is surface.

## Next

- [Self-hosting](/docs/deployment/self-hosting/): the compose file this service is part of.
- [More than one instance](/docs/deployment/multiple-instances/): the state each runtime process keeps, before you add a replica.
