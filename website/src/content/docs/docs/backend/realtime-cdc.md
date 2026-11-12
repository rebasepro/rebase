---
title: Database change capture
sidebar_label: Database change capture
description: "Realtime events for every committed write, however it was made: the capture triggers, the REALTIME_CDC setting, and what they need."
---

**Change Data Capture is on by default.** Rebase captures changes at the database and emits realtime events for **every committed write, regardless of how it was made** — REST, SDK, Studio, `psql`, a cron job in another service, raw Drizzle/SQL, or Studio's **SQL editor**. This is the same model as Supabase Realtime tailing the write-ahead log.

No configuration is required. On a database connection that supports it, CDC self-provisions at startup; on one that doesn't (e.g. a restricted role that can't create triggers), Rebase quietly uses application-level realtime instead — nothing to turn on, nothing that breaks.

## Configuration

CDC is controlled by the `REALTIME_CDC` environment variable:

| Value | Behavior |
| --- | --- |
| `auto` *(default)* | Enable database-level capture where the connection supports it; **silently fall back** to application-level realtime otherwise. Zero-config. |
| `trigger` | Force trigger-based capture. Works on any PostgreSQL, including managed instances without logical replication. Warns (rather than silently falling back) if it can't provision. |
| `wal` | Read changes from the write-ahead log through logical replication instead of triggers, so a write runs no trigger and sends no `NOTIFY`. Needs `wal_level=logical` and a role that may replicate; falls back to `trigger`, with a warning, when either is missing. See [Capture from the WAL](#capture-from-the-wal). |
| `off` | Application-level realtime only. Use this to avoid the per-write trigger overhead on write-heavy workloads. A boot with `off` that owns the schema also **removes** the capture triggers and functions an earlier boot installed, and logs how many it took off; unset it and the next boot installs them again. |

The same setting is
the Postgres adapter's `realtime.cdc` option, for a server that configures it in
code. `REALTIME_CDC`, when set, wins.

On boot you'll see a log line stating the active mode, e.g.:

```
📡 [CDC] Realtime source = database-level change capture (mode: trigger).
   All writes now emit realtime events regardless of origin.
```

If the connection can't support it, `auto` logs an informational line instead and continues with application-level realtime:

```
ℹ️ [CDC] Database-level change capture unavailable (likely insufficient
   privileges to create triggers…) — using app-level realtime.
```

## How It Works

1. **Self-provisioning** — At startup (server/owner context), Rebase installs idempotent `AFTER INSERT/UPDATE/DELETE/TRUNCATE` triggers on each managed table. They fire once per statement and emit change notifications on the `rebase_cdc` channel that name the changed rows by their key — the primary key, plus the two id columns for a many-to-many junction table — and carry **no other column**. A statement that changed many rows names them in batches of about a thousand keys, so a 1M-row `UPDATE` sends about 1,000 notifications rather than a million; a statement that changed one row sends one notification, and one that changed none sends nothing. A `TRUNCATE` is announced as a change to every row of the table. A partitioned table keeps one trigger per row, because PostgreSQL copies a row trigger onto every partition and a write made straight to a partition is still seen. PostgreSQL puts no privilege on `LISTEN`, so any role that can connect to the database can read this channel; it learns which keys changed, never what they hold. A key too large for PostgreSQL's 8&nbsp;KB `NOTIFY` limit is sent as no key (a change to the whole table, which every list and single-row subscription on it refetches), so CDC can never abort the triggering write. The functions are replaced on every boot that provisions, so a database instrumented by an older version — whose trigger sent whole rows — is brought up to date by the next boot; a boot with `REALTIME_CDC=off` removes them instead.

   **Upgrading.** A database instrumented by a version before batching has one trigger per row; the first boot of a newer version replaces it with the per-statement triggers. For 24 hours after that, the new triggers still send one notification per row, as the old ones did, so instances of the older version still running during a rolling deploy (or after a rollback) hear every row. After the window they batch. Every version that batches reads both shapes.
2. **Capture** — A dedicated, unpooled `LISTEN` client per instance consumes `rebase_cdc`, maps the changed table back to the table it serves, and feeds the change into the same `RealtimeService` pipeline used by API mutations. Like the cross-instance listener, it prefers `DATABASE_DIRECT_URL` and auto-reconnects.
3. **RLS-safe delivery** — The raw row from the change stream is **never** forwarded to subscribers. The change is marked invalidated, and each subscription re-reads the row under its **own** auth context. Filtering is therefore per subscriber, never per publisher: a client only ever receives rows its RLS policies permit.
4. **Cross-instance** — Because every instance observes every commit through the change stream, CDC also *is* the cross-instance channel; the legacy per-mutation `rebase_entity_changes` broadcast is not used while CDC is active.
5. **De-duplication** — A mutation made through the Rebase API schedules a refetch for the local subscribers the instant it commits and is also echoed back through the change stream. The originating instance suppresses an echo that arrives within the refetch debounce window (a short-lived record of its own emits), so an API write normally produces one frame. An echo that arrives later than that triggers one more refetch, which delivers the same rows again: harmless, but a subscriber can see an identical frame twice.

## Capture from the WAL

`REALTIME_CDC=wal` reads changes from PostgreSQL's write-ahead log through logical replication (the built-in `pgoutput` plugin) instead of triggers. A write then runs no trigger and sends no `NOTIFY`, which matters once writes are concurrent: a transaction that called `NOTIFY` takes one lock for the whole server at commit and holds it through the disk flush, so under trigger capture those commits happen one at a time. Measured on PostgreSQL 18 with 32 concurrent writers and a 1&nbsp;ms disk flush, trigger capture held inserts to about a tenth of the rate WAL capture reached.

It needs:

- `wal_level = logical` on the server, which takes a restart. On Amazon RDS set `rds.logical_replication = 1`; on Cloud SQL, `cloudsql.logical_decoding = on`.
- A role that may replicate: `ALTER ROLE <role> REPLICATION`, or the host's equivalent (on RDS, membership of `rds_replication`).
- One free replication slot and WAL sender per server instance (`max_replication_slots` and `max_wal_senders`, both 10 by default).
- A direct connection (`DATABASE_DIRECT_URL`): a pooler does not carry the replication protocol.

When any of these is missing, the boot logs why and uses trigger capture instead.

What a boot does:

- It creates a publication named `rebase_cdc` and adds every served table and every many-to-many junction table to it. Tables are only ever added, so an older version still running during a rolling deploy cannot take a newer table's table back out.
- A table with no primary key, or with `REPLICA IDENTITY NOTHING`, is left out with a warning: PostgreSQL refuses `UPDATE` and `DELETE` on a published table that cannot say which row changed. Writes to it made outside Rebase are not captured.
- Each instance streams the publication through its own **temporary** replication slot, which PostgreSQL drops when the connection closes, so an instance that crashes cannot leave a slot behind holding WAL until the disk fills. A reconnect starts a new slot, and every subscription refetches, because what committed in the gap is not replayed.
- Once its stream is open, a boot that both provisions and consumes removes the capture triggers, as `off` does. During a rolling deploy away from trigger capture, instances still running it stop hearing writes made elsewhere until they are replaced; their own writes still reach their subscribers. A process that only provisions, such as the migration job of a [split deployment](/docs/deployment/split-processes/), keeps the triggers for consumers that cannot stream and fall back to them.

Writers keep their full speed under a burst, but one WAL sender decodes each slot, so past several thousand writes per second sustained, events can arrive late. A role with `REPLICATION` can read every row of a published table through a slot of its own; the stream stays inside the server, and subscribers still re-read each row under their own RLS.

## Requirements & Notes

- CDC requires a direct connection string (`DATABASE_DIRECT_URL`, the adapter's `directConnectionString`, or the primary connection) for the `LISTEN` client — connection poolers in transaction mode do not support long-lived `LISTEN` sessions.
- Triggers are installed only on the tables the backend serves, and on the junction tables of their many-to-many relations. Writes to unmapped tables are ignored.
- A served table that has not been created yet is skipped with a warning rather than blocking CDC for the rest.

## Next Steps

- [Realtime & WebSocket](/docs/backend/realtime) — subscriptions, channels and presence, which these events feed.
- [Realtime across instances](/docs/backend/realtime-transports) — the bus that carries changes between server processes.
