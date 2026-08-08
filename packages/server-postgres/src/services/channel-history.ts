/**
 * Ordered, replayable per-channel message history.
 *
 * Broadcast on its own is fire-and-forget to whoever is connected at the
 * instant it is sent: fine for presence and for "someone saved" notifications,
 * not enough for op-based collaborative editing, where a client that blinks
 * out for two seconds has to resync a whole document rather than catch up on
 * the four operations it missed. This adds the missing half — every retained
 * broadcast gets a per-channel sequence number, and a client can ask for
 * everything after the last one it saw.
 *
 * Three decisions worth stating, because each rules out a simpler-looking one:
 *
 *  - **Retention is server-side and opt-in.** A channel is created by whoever
 *    names it, so a client-supplied history depth would let any visitor commit
 *    the backend to unbounded storage. And presence channels — the common case
 *    — must not pay for this: with no rules configured nothing is written, no
 *    table is created, and `broadcast` runs exactly the code it ran before.
 *
 *  - **Sequence numbers come from the database, not from a counter in this
 *    process.** They have to survive a restart and be shared across instances;
 *    an in-memory counter would restart at 1 after a deploy and hand a
 *    reconnecting client a replay from the wrong era, silently.
 *
 *  - **The cursor row outlives the messages it numbered.** Pruning is what
 *    makes retention affordable, but pruning the cursor along with the messages
 *    would restart the sequence and make `sinceSeq` mean something different
 *    before and after — the worst kind of bug, because replay would still
 *    return rows and they would look plausible. Cursors are tiny and are kept
 *    forever; see {@link prune}, which touches only `channel_messages`.
 */

import { sql } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { ChannelHistoryEntry, ChannelRetentionRule } from "@rebasepro/types";
import { logger } from "@rebasepro/server";
import { revokeInternalTableSql } from "@rebasepro/common";

/** How many messages a replay returns when the caller does not say. */
const DEFAULT_REPLAY_LIMIT = 200;

/**
 * Hard ceiling on one replay, whatever the caller asks for.
 *
 * A reconnecting client names its own `limit`, so this is the only thing
 * standing between a stale `sinceSeq` and a single frame carrying a channel's
 * entire retained history. A client that is further behind than this is told so
 * via `latestSeq` and can decide to resync wholesale instead of paging.
 */
const MAX_REPLAY_LIMIT = 1000;

/** Minimum gap between two prunes of the same channel. */
const PRUNE_THROTTLE_MS = 30_000;

/**
 * Parse a retention TTL into milliseconds.
 *
 * Accepts a raw millisecond count or a short duration string (`"30s"`, `"15m"`,
 * `"24h"`, `"7d"`). Returns undefined for anything unparseable, which the
 * caller treats as "no TTL" — a misspelt duration must not silently become an
 * aggressive one.
 */
export function parseTtlMs(ttl: number | string | undefined): number | undefined {
    if (ttl === undefined || ttl === null) return undefined;
    if (typeof ttl === "number") return Number.isFinite(ttl) && ttl > 0 ? ttl : undefined;

    const match = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)\s*$/i.exec(ttl);
    if (!match) {
        logger.warn(`⚠️ [ChannelHistory] Ignoring unparseable retention ttl "${ttl}" — expected e.g. "30s", "15m", "24h", "7d".`);
        return undefined;
    }
    const value = parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    const multiplier = unit === "ms" ? 1
        : unit === "s" ? 1_000
            : unit === "m" ? 60_000
                : unit === "h" ? 3_600_000
                    : 86_400_000;
    const ms = value * multiplier;
    return ms > 0 ? ms : undefined;
}

/**
 * Whether `channel` is covered by `rule`.
 *
 * Exact match, or a trailing `*` acting as a prefix. Not a general glob: this
 * decides what reaches disk, and a pattern language whose reach is not obvious
 * at a glance is the wrong tool for that job.
 */
export function channelMatchesRule(channel: string, rule: ChannelRetentionRule): boolean {
    const pattern = rule.match;
    if (pattern === "*") return true;
    if (pattern.endsWith("*")) return channel.startsWith(pattern.slice(0, -1));
    return channel === pattern;
}

/** A rule with its TTL already resolved to milliseconds. */
export interface ResolvedRetention {
    limit?: number;
    ttlMs?: number;
}

/**
 * Persistence and replay for retained channels.
 *
 * Inert unless constructed with at least one rule: {@link enabled} is false,
 * {@link ensureTables} does nothing, and {@link retentionFor} answers undefined
 * for every channel, so the realtime service never reaches the SQL below.
 */
export class ChannelHistoryStore {
    private rules: ChannelRetentionRule[];
    /** Resolved rule per channel name, so the match runs once per channel. */
    private resolved = new Map<string, ResolvedRetention | null>();
    /** Channel → timestamp of its last prune, for {@link PRUNE_THROTTLE_MS}. */
    private lastPruned = new Map<string, number>();
    private tablesReady = false;

    constructor(private db: NodePgDatabase<Record<string, unknown>>, rules: ChannelRetentionRule[] = []) {
        this.rules = rules.filter(rule => {
            if (!rule?.match) {
                logger.warn("⚠️ [ChannelHistory] Ignoring a retention rule with no `match`.");
                return false;
            }
            const hasBound = rule.limit !== undefined || rule.ttl !== undefined;
            if (!hasBound) {
                // Unbounded retention is almost never intended and cannot be
                // walked back once the table has grown, so it is refused rather
                // than honoured.
                logger.warn(`⚠️ [ChannelHistory] Retention rule "${rule.match}" sets neither \`limit\` nor \`ttl\` — ignoring it, as it would retain forever.`);
                return false;
            }
            return true;
        });
    }

    /** Whether any channel retains anything at all. */
    get enabled(): boolean {
        return this.rules.length > 0;
    }

    /**
     * The retention that applies to `channel`, or undefined when none does.
     *
     * First matching rule wins, so callers order them most-specific first.
     */
    retentionFor(channel: string): ResolvedRetention | undefined {
        if (!this.enabled || !channel) return undefined;

        const cached = this.resolved.get(channel);
        if (cached !== undefined) return cached ?? undefined;

        const rule = this.rules.find(r => channelMatchesRule(channel, r));
        const resolved: ResolvedRetention | null = rule
            ? { limit: rule.limit, ttlMs: parseTtlMs(rule.ttl) }
            : null;

        // Bounded by the number of distinct channel names seen, which is the
        // same thing the in-memory channel and presence maps are bounded by.
        this.resolved.set(channel, resolved);
        return resolved ?? undefined;
    }

    /**
     * Create the history tables. Idempotent, and a no-op when no rule is set —
     * a deployment that never retains anything gets no schema for it.
     */
    async ensureTables(): Promise<void> {
        if (!this.enabled || this.tablesReady) return;

        await this.db.execute(sql`CREATE SCHEMA IF NOT EXISTS rebase`);

        // The primary key is exactly the replay query's access path
        // (`channel = $1 AND seq > $2 ORDER BY seq`), so it needs no further
        // index of its own.
        await this.db.execute(sql`
            CREATE TABLE IF NOT EXISTS rebase.channel_messages (
                channel TEXT NOT NULL,
                seq BIGINT NOT NULL,
                event TEXT NOT NULL,
                payload JSONB,
                sender_id TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (channel, seq)
            )
        `);

        // Only for the TTL arm of pruning; the limit arm rides the primary key.
        await this.db.execute(sql`
            CREATE INDEX IF NOT EXISTS idx_channel_messages_created
            ON rebase.channel_messages (created_at)
        `);

        // Never pruned — see the note at the top of this file. One row per
        // channel that has ever retained a message.
        await this.db.execute(sql`
            CREATE TABLE IF NOT EXISTS rebase.channel_cursors (
                channel TEXT PRIMARY KEY,
                last_seq BIGINT NOT NULL
            )
        `);

        // Retained broadcasts for every channel in one table, with no RLS: who
        // may replay a channel is decided before the read, by the channel gate
        // in `realtimeService.authorizeChannelAction` — a replay is answered
        // only for a client that has joined the channel, plus whatever an
        // installed `ChannelAuthorizer` adds. That gate is the entire reason
        // this table can sit outside the RLS model, so it fails closed; the
        // rule language it does not yet have is written up in
        // `docs/channel-authorization.md`. The driver's schema-wide
        // grant reaches these (created here, after it ran), so take the
        // privilege back.
        await this.db.execute(sql.raw(revokeInternalTableSql("rebase", "channel_messages")));
        await this.db.execute(sql.raw(revokeInternalTableSql("rebase", "channel_cursors")));

        this.tablesReady = true;
        logger.info(`✅ [ChannelHistory] Retained channels ready (${this.rules.length} rule(s)).`);
    }

    /**
     * Append a broadcast and return the sequence number it was given.
     *
     * The sequence is allocated by the same statement that stores the message,
     * so a crash between the two is not a possibility. `ON CONFLICT DO UPDATE`
     * takes a row lock on the channel's cursor, which is what makes concurrent
     * broadcasts to one channel line up in a single order — and what keeps
     * different channels from contending with each other at all.
     */
    async append(
        channel: string,
        event: string,
        payload: unknown,
        senderId?: string
    ): Promise<{ seq: number; at: string }> {
        const result = await this.db.execute(sql`
            WITH next AS (
                INSERT INTO rebase.channel_cursors (channel, last_seq)
                VALUES (${channel}, 1)
                ON CONFLICT (channel)
                DO UPDATE SET last_seq = rebase.channel_cursors.last_seq + 1
                RETURNING last_seq
            )
            INSERT INTO rebase.channel_messages (channel, seq, event, payload, sender_id)
            SELECT ${channel}, next.last_seq, ${event}, ${JSON.stringify(payload ?? null)}::jsonb, ${senderId ?? null}
            FROM next
            RETURNING seq, created_at
        `);

        const row = result.rows[0] as { seq: string | number; created_at: Date | string } | undefined;
        if (!row) throw new Error(`Failed to append to channel history for "${channel}"`);

        return {
            // BIGINT comes back as a string from node-postgres; the wire type is
            // a number, and a channel would need 2^53 messages to notice.
            seq: Number(row.seq),
            at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at)
        };
    }

    /**
     * Everything retained for `channel` after `sinceSeq`, oldest first.
     *
     * `latestSeq` is reported whether or not the messages were capped, so a
     * client that is further behind than one page can tell.
     */
    async replay(
        channel: string,
        sinceSeq = 0,
        limit = DEFAULT_REPLAY_LIMIT
    ): Promise<{ messages: ChannelHistoryEntry[]; latestSeq: number }> {
        const capped = Math.max(1, Math.min(Math.floor(limit) || DEFAULT_REPLAY_LIMIT, MAX_REPLAY_LIMIT));
        const after = Number.isFinite(sinceSeq) && sinceSeq > 0 ? Math.floor(sinceSeq) : 0;

        const result = await this.db.execute(sql`
            SELECT seq, event, payload, sender_id, created_at
            FROM rebase.channel_messages
            WHERE channel = ${channel} AND seq > ${after}
            ORDER BY seq ASC
            LIMIT ${capped}
        `);

        const messages = (result.rows as Array<{
            seq: string | number;
            event: string;
            payload: unknown;
            sender_id: string | null;
            created_at: Date | string;
        }>).map(row => ({
            seq: Number(row.seq),
            event: row.event,
            payload: row.payload,
            senderId: row.sender_id ?? undefined,
            at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at)
        }));

        // Read from the cursor rather than from the messages: the cursor is the
        // authority on how far the channel has got, and still says so after
        // pruning has removed the messages it counted.
        const cursor = await this.db.execute(sql`
            SELECT last_seq FROM rebase.channel_cursors WHERE channel = ${channel}
        `);
        const cursorRow = cursor.rows[0] as { last_seq: string | number } | undefined;
        const latestSeq = cursorRow ? Number(cursorRow.last_seq) : 0;

        return { messages, latestSeq };
    }

    /**
     * One retained message by its address.
     *
     * This is what makes the cross-instance pointer path work: a broadcast too
     * large to travel inside a `pg_notify` payload is already stored here, so
     * the notification carries `(channel, seq)` and each receiving instance
     * reads the body back. Returns null when the message has since been pruned
     * — a receiver that is that far behind has nothing useful to deliver, and
     * the client's own `channel_history` replay is the repair path.
     */
    async getBySeq(channel: string, seq: number): Promise<ChannelHistoryEntry | null> {
        const result = await this.db.execute(sql`
            SELECT seq, event, payload, sender_id, created_at
            FROM rebase.channel_messages
            WHERE channel = ${channel} AND seq = ${seq}
        `);

        const row = result.rows[0] as {
            seq: string | number;
            event: string;
            payload: unknown;
            sender_id: string | null;
            created_at: Date | string;
        } | undefined;
        if (!row) return null;

        return {
            seq: Number(row.seq),
            event: row.event,
            payload: row.payload,
            senderId: row.sender_id ?? undefined,
            at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at)
        };
    }

    /**
     * Enforce a channel's retention bounds.
     *
     * Throttled per channel, so a burst of operations prunes once rather than
     * once per message — the cost then tracks elapsed time instead of write
     * volume, which is what makes retention affordable on a hot channel.
     */
    async prune(channel: string, retention: ResolvedRetention): Promise<number> {
        const now = Date.now();
        const last = this.lastPruned.get(channel) ?? 0;
        if (now - last < PRUNE_THROTTLE_MS) return 0;
        this.lastPruned.set(channel, now);

        let deleted = 0;

        if (retention.ttlMs !== undefined) {
            const result = await this.db.execute(sql`
                DELETE FROM rebase.channel_messages
                WHERE channel = ${channel}
                  AND created_at < NOW() - MAKE_INTERVAL(secs => ${retention.ttlMs / 1000})
            `);
            deleted += result.rowCount ?? 0;
        }

        if (retention.limit !== undefined && retention.limit > 0) {
            // OFFSET past the newest `limit` rows to find the highest seq that
            // is no longer wanted, then delete everything at or below it. Fewer
            // rows than the limit leaves the subquery empty, and the comparison
            // with NULL deletes nothing.
            const result = await this.db.execute(sql`
                DELETE FROM rebase.channel_messages
                WHERE channel = ${channel}
                  AND seq <= (
                      SELECT seq FROM rebase.channel_messages
                      WHERE channel = ${channel}
                      ORDER BY seq DESC
                      OFFSET ${Math.floor(retention.limit)} LIMIT 1
                  )
            `);
            deleted += result.rowCount ?? 0;
        }

        return deleted;
    }

    /** Forget throttle and match caches. Called on shutdown. */
    clear(): void {
        this.resolved.clear();
        this.lastPruned.clear();
    }
}
