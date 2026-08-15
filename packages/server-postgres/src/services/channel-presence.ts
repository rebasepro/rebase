/**
 * The shared presence roster.
 *
 * Broadcast only ever needed *fan-out* to work across instances — a frame goes
 * out, whoever is connected receives it. Presence needs more than that, because
 * `presence_state` is a question ("who is in this document?") and a per-process
 * `Map` can only answer for the clients that happen to share a replica with the
 * asker. Two people editing the same scene through different pods would each
 * see an empty room while broadcasting cursors at each other perfectly.
 *
 * So presence gets one row per tracked client, in Postgres, readable by every
 * instance. Three consequences worth stating:
 *
 *  - **The table is the roster; the in-process map is a cache of our own
 *    clients.** Reads answer from the table when this store is active, so the
 *    answer is the same whichever instance is asked.
 *
 *  - **`last_seen` is the liveness signal, and it is already there.** The client
 *    heartbeats presence every ~20 s against a 30 s window; the sweep that has
 *    always reaped local stale entries now also reaps rows belonging to
 *    instances that stopped writing — which is exactly what a crashed pod looks
 *    like. Crash recovery is a property of the TTL, not a separate mechanism.
 *
 *  - **The sweep deletes with `RETURNING`.** Whichever instance wins the delete
 *    is the one that announces the departures, so a stale client produces one
 *    `presence_diff` for the cluster rather than one per replica.
 */

import { sql } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { revokeInternalTableSql } from "@rebasepro/common";
import { drizzleDdlBootstrapper } from "../schema/drizzle-ddl";

/** A tracked client, as any instance sees it. */
export interface PresenceRow {
    channel: string;
    clientId: string;
    state: Record<string, unknown>;
}

export class ChannelPresenceStore {
    private tablesReady = false;

    constructor(
        private readonly db: NodePgDatabase<Record<string, unknown>>,
        private readonly instanceId: string
    ) {}

    /**
     * Create the roster table. Idempotent, and safe to run on every instance at
     * once.
     *
     * Written as separate contained steps rather than one straight sequence for
     * a reason that only bites with more than one replica, which is exactly the
     * deployment shape this table exists to serve: `CREATE … IF NOT EXISTS`
     * reads the catalog and then writes to it non-atomically, so peers booting
     * together collide, and the loser used to abandon everything after it —
     * including the trailing `REVOKE`. That revoke is the only thing keeping the
     * roster off the end-user role, so losing a boot race silently left the
     * whole channel roster readable by every signed-in user.
     *
     * `tablesReady` is now set from a probe of what exists, not from having been
     * the instance that created it.
     */
    async ensureTables(): Promise<void> {
        if (this.tablesReady) return;

        const ddl = drizzleDdlBootstrapper(this.db, "channel-presence");

        await ddl.ensureObject("rebase schema", "CREATE SCHEMA IF NOT EXISTS rebase");

        // Keyed by (channel, client_id): a client id is globally unique, so the
        // instance is a column rather than part of the identity — a client that
        // reconnects onto another replica replaces its own row instead of
        // appearing twice in the roster.
        await ddl.ensureObject("channel_presence table", `
            CREATE TABLE IF NOT EXISTS rebase.channel_presence (
                channel TEXT NOT NULL,
                client_id TEXT NOT NULL,
                instance_id TEXT NOT NULL,
                state JSONB NOT NULL DEFAULT '{}'::jsonb,
                last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (channel, client_id)
            )
        `);

        // The sweep's access path; the roster read rides the primary key.
        await ddl.ensureObject("channel_presence last_seen index", `
            CREATE INDEX IF NOT EXISTS idx_channel_presence_last_seen
            ON rebase.channel_presence (last_seen)
        `);

        // The roster of every client on every channel, with no RLS — a row
        // policy has nothing to match on here, since a channel name is a string
        // a client invents rather than a row anyone owns. What guards it is the
        // channel gate in `realtimeService.authorizeChannelAction`: presence is
        // readable only to a client that has joined the channel, plus whatever
        // an installed `ChannelAuthorizer` adds. That gate is the entire reason
        // this table can sit outside the RLS model, so it fails closed —
        // see `docs/channel-authorization.md` for what it does *not*
        // yet decide. Revoke the schema-wide grant the driver handed out
        // before this table existed.
        //
        // Driven off the probe, not off who won the create: the privilege has to
        // come off whether this instance created the table or found it.
        if (await ddl.isReadable("rebase.channel_presence")) {
            await ddl.step("channel_presence revoke", () =>
                this.db.execute(sql.raw(revokeInternalTableSql("rebase", "channel_presence")))
            );
            this.tablesReady = true;
        }
    }

    /** Record (or refresh) a client's presence. */
    async track(channel: string, clientId: string, state: Record<string, unknown>): Promise<void> {
        await this.db.execute(sql`
            INSERT INTO rebase.channel_presence (channel, client_id, instance_id, state, last_seen)
            VALUES (${channel}, ${clientId}, ${this.instanceId}, ${JSON.stringify(state ?? {})}::jsonb, NOW())
            ON CONFLICT (channel, client_id) DO UPDATE
            SET state = EXCLUDED.state,
                instance_id = EXCLUDED.instance_id,
                last_seen = NOW()
        `);
    }

    /** Drop one client's presence in one channel. */
    async remove(channel: string, clientId: string): Promise<void> {
        await this.db.execute(sql`
            DELETE FROM rebase.channel_presence
            WHERE channel = ${channel} AND client_id = ${clientId}
        `);
    }

    /** Drop a client from every channel — used when its socket closes. */
    async removeClient(clientId: string): Promise<void> {
        await this.db.execute(sql`
            DELETE FROM rebase.channel_presence WHERE client_id = ${clientId}
        `);
    }

    /** The global roster for a channel. */
    async roster(channel: string): Promise<Record<string, Record<string, unknown>>> {
        const result = await this.db.execute(sql`
            SELECT client_id, state FROM rebase.channel_presence WHERE channel = ${channel}
        `);

        const presences: Record<string, Record<string, unknown>> = {};
        for (const row of result.rows as Array<{ client_id: string; state: Record<string, unknown> | null }>) {
            presences[row.client_id] = row.state ?? {};
        }
        return presences;
    }

    /**
     * Reap rows this instance is not responsible for and that have gone quiet.
     *
     * Own rows are excluded because the in-process sweep already handles them —
     * and handles them better, since it can tell "the socket is gone" from "the
     * heartbeat is late". What is left is precisely the interesting case: rows
     * written by an instance that is no longer writing.
     *
     * Returns what was removed, so the caller can announce it.
     */
    async sweepStale(ttlMs: number): Promise<PresenceRow[]> {
        const result = await this.db.execute(sql`
            DELETE FROM rebase.channel_presence
            WHERE instance_id <> ${this.instanceId}
              AND last_seen < NOW() - MAKE_INTERVAL(secs => ${ttlMs / 1000})
            RETURNING channel, client_id, state
        `);

        return (result.rows as Array<{ channel: string; client_id: string; state: Record<string, unknown> | null }>)
            .map(row => ({ channel: row.channel, clientId: row.client_id, state: row.state ?? {} }));
    }

    /**
     * Remove every row this instance owns. Called on graceful shutdown so a
     * rolling deploy does not leave a TTL window of ghosts in every roster.
     */
    async removeInstance(): Promise<void> {
        await this.db.execute(sql`
            DELETE FROM rebase.channel_presence WHERE instance_id = ${this.instanceId}
        `);
    }
}
