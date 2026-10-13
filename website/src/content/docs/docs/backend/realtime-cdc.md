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
| `wal` | Prefer WAL logical replication. Not yet bundled — degrades to `trigger` and logs the active mode. |
| `off` | Application-level realtime only. Use this to avoid the per-write trigger overhead on write-heavy workloads. A boot with `off` that owns the schema also **removes** the capture triggers and functions an earlier boot installed, and logs how many it took off; unset it and the next boot installs them again. |

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

1. **Self-provisioning** — At startup (server/owner context), Rebase installs idempotent `AFTER INSERT/UPDATE/DELETE/TRUNCATE` triggers on each managed table. They fire once per statement and emit change notifications on the `rebase_cdc` channel that name the changed rows by their key — the primary key, plus the two id columns for a many-to-many junction table — and carry **no other column**. A statement that changed many rows names them in batches of about a thousand keys, so a 1M-row `UPDATE` sends about 1,000 notifications rather than a million; a statement that changed one row sends one notification, and one that changed none sends nothing. A `TRUNCATE` is announced as a change to every row of the collection. A partitioned table keeps one trigger per row, because PostgreSQL copies a row trigger onto every partition and a write made straight to a partition is still seen. PostgreSQL puts no privilege on `LISTEN`, so any role that can connect to the database can read this channel; it learns which keys changed, never what they hold. A key too large for PostgreSQL's 8&nbsp;KB `NOTIFY` limit is sent as no key (a change to the whole collection, which every list and single-row subscription on it refetches), so CDC can never abort the triggering write. The functions are replaced on every boot that provisions, so a database instrumented by an older version — whose trigger sent whole rows — is brought up to date by the next boot; a boot with `REALTIME_CDC=off` removes them instead.

   <span class="since-badge" data-since="0.25">Since 0.25</span> **Upgrading.** A database instrumented by a version before batching has one trigger per row; the first boot of a newer version replaces it with the per-statement triggers. For 24 hours after that, the new triggers still send one notification per row, as the old ones did, so instances of the older version still running during a rolling deploy (or after a rollback) hear every row. After the window they batch. Every version that batches reads both shapes.
2. **Capture** — A dedicated, unpooled `LISTEN` client per instance consumes `rebase_cdc`, maps the changed table back to its collection, and feeds the change into the same `RealtimeService` pipeline used by API mutations. Like the cross-instance listener, it prefers `DATABASE_DIRECT_URL` and auto-reconnects.
3. **RLS-safe delivery** — The raw row from the change stream is **never** forwarded to subscribers. The change is marked invalidated, and each subscription re-reads the row under its **own** auth context. Filtering is therefore per subscriber, never per publisher: a client only ever receives rows its RLS policies permit.
4. **Cross-instance** — Because every instance observes every commit through the change stream, CDC also *is* the cross-instance channel; the legacy per-mutation `rebase_entity_changes` broadcast is not used while CDC is active.
5. **De-duplication** — A mutation made through the Rebase API is delivered locally the instant it commits and is also echoed back through the change stream. The originating instance suppresses an echo that arrives within the refetch debounce window (a short-lived record of its own emits), so an API write normally produces one frame. An echo that arrives later than that triggers one more refetch, which delivers the same rows again: harmless, but a subscriber can see an identical frame twice.

## Requirements & Notes

- CDC requires a direct connection string (`DATABASE_DIRECT_URL` or the primary connection) for the `LISTEN` client — connection poolers in transaction mode do not support long-lived `LISTEN` sessions.
- Triggers are installed only on tables backed by a registered collection. Writes to unmapped tables are ignored.
- A collection whose table has not yet been migrated is skipped with a warning rather than blocking CDC for the rest.
- Native WAL logical-replication streaming (`wal2json`/`pgoutput`) is planned; today `REALTIME_CDC=wal` degrades to the trigger-based path, which provides equivalent database-level coverage.

## Next Steps

- [Realtime & WebSocket](/docs/backend/realtime) — subscriptions, channels and presence, which these events feed.
- [Realtime across instances](/docs/backend/realtime-transports) — the bus that carries changes between server processes.
