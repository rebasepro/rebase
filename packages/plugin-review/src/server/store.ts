/**
 * Where proposed changes wait: `rebase.staged_changes`.
 *
 * Every statement runs on the owner connection (`rebase.sql`), because the
 * table is not a collection: it has no RLS, the end-user role holds nothing on
 * it, and who may see or decide which change is the routes' business
 * (`./function.ts`). The table is created on first use, idempotently, so
 * installing the plugin needs no migration.
 *
 * @module
 */

import { revokeInternalTableSql } from "@rebasepro/common";
import type { StagedChange, StagedChangeOperation, StagedChangeStatus } from "../config/types";

/** Runs one parameterised statement on the owner connection and returns its rows. @group Review */
export type SqlExecutor = (query: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const TABLE = "rebase.staged_changes";

/** The columns a staged change is returned with, in `StagedChange` order. */
const COLUMNS = [
    "id", "collection_slug", "operation", "target_record_id", "before_data", "proposed_data", "status",
    "actor_type", "actor_id", "actor_label", "reason", "reviewed_by", "reviewed_at", "review_note", "created_at"
].join(", ");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether `value` is shaped like a staged change's id, checked before it meets a `uuid` cast. @group Review */
export function isStagedChangeId(value: unknown): value is string {
    return typeof value === "string" && UUID.test(value);
}

/** What a new staged change is made of, already validated by the route that took it. @group Review */
export interface NewStagedChange {
    collection_slug: string;
    operation: StagedChangeOperation;
    target_record_id: string | null;
    before_data: Record<string, unknown> | null;
    proposed_data: Record<string, unknown> | null;
    actor_type: "api_key" | "user";
    actor_id: string | null;
    actor_label: string | null;
    reason: string | null;
}

/** Which staged changes a listing returns. @group Review */
export interface StagedChangeFilter {
    /** The collections whose changes the caller reviews. */
    reviewable: readonly string[];
    /** The caller's own id: their proposals are listed whatever the collection. */
    actorId?: string;
    collection?: string;
    status?: StagedChangeStatus;
    limit: number;
    offset: number;
}

/** @group Review */
export interface StagedChangeStore {
    /** Create `rebase.staged_changes` if it is missing. Idempotent; called before first use. */
    ensureTable(): Promise<void>;
    insert(change: NewStagedChange): Promise<StagedChange>;
    /** The changes with these ids, in the order asked; an unknown id is left out. */
    getMany(ids: readonly string[]): Promise<StagedChange[]>;
    /** A page of the changes the filter admits, newest first, and how many it admits in all. */
    list(filter: StagedChangeFilter): Promise<{ changes: StagedChange[]; total: number }>;
    /**
     * Decide pending changes: set the status, the reviewer, the time and the
     * note on each of `ids` that is still pending. Returns the ones it decided
     * — fewer than asked when another reviewer got there first.
     */
    decide(ids: readonly string[], decision: { status: "approved" | "rejected"; reviewedBy: string; note: string | null }): Promise<StagedChange[]>;
    /** Put decided changes back to pending: an approval whose write failed. */
    reopen(ids: readonly string[]): Promise<void>;
}

/** A JSONB object as the driver hands it back: parsed, or JSON text. */
function jsonObject(value: unknown): Record<string, unknown> | null {
    let raw = value;
    if (typeof raw === "string") {
        try {
            raw = JSON.parse(raw);
        } catch {
            return null;
        }
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    return Object.fromEntries(Object.entries(raw));
}

const text = (value: unknown): string | null => value === null || value === undefined ? null : String(value);
const timestamp = (value: unknown): string | null => value ? new Date(String(value)).toISOString() : null;

function rowToStagedChange(row: Record<string, unknown>): StagedChange {
    return {
        id: String(row.id),
        collection_slug: String(row.collection_slug),
        operation: row.operation === "insert" || row.operation === "delete" ? row.operation : "update",
        target_record_id: text(row.target_record_id),
        before_data: jsonObject(row.before_data),
        proposed_data: jsonObject(row.proposed_data),
        status: row.status === "approved" || row.status === "rejected" ? row.status : "pending",
        actor_type: row.actor_type === "user" ? "user" : "api_key",
        actor_id: text(row.actor_id),
        actor_label: text(row.actor_label),
        reason: text(row.reason),
        reviewed_by: text(row.reviewed_by),
        reviewed_at: timestamp(row.reviewed_at),
        review_note: text(row.review_note),
        created_at: timestamp(row.created_at) ?? new Date(0).toISOString()
    };
}

/**
 * A {@link StagedChangeStore} over an owner-connection SQL executor.
 *
 * @group Review
 */
export function createStagedChangeStore(sql: SqlExecutor): StagedChangeStore {
    let ensured: Promise<void> | undefined;

    return {
        ensureTable(): Promise<void> {
            ensured ??= (async () => {
                await sql("CREATE SCHEMA IF NOT EXISTS rebase");
                await sql(`
                    CREATE TABLE IF NOT EXISTS ${TABLE} (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        collection_slug TEXT NOT NULL,
                        operation TEXT NOT NULL CHECK (operation IN ('insert', 'update', 'delete')),
                        target_record_id TEXT,
                        before_data JSONB,
                        proposed_data JSONB,
                        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
                        actor_type TEXT NOT NULL DEFAULT 'api_key',
                        actor_id TEXT,
                        actor_label TEXT,
                        reason TEXT,
                        reviewed_by TEXT,
                        reviewed_at TIMESTAMPTZ,
                        review_note TEXT,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )`);
                // The queue's one question: this collection's changes in this
                // state, newest first.
                await sql(`CREATE INDEX IF NOT EXISTS idx_staged_changes_lookup
                           ON ${TABLE} (collection_slug, status, created_at DESC)`);
                // Proposals and their snapshots are the server's alone: the
                // end-user role must not read another caller's proposal, nor
                // approve its own by updating the status. The Postgres driver's
                // blanket grant on `rebase` reaches tables made after it.
                await sql(revokeInternalTableSql("rebase", "staged_changes"));
            })().catch((error: unknown) => {
                ensured = undefined;
                throw error;
            });
            return ensured;
        },

        async insert(change: NewStagedChange): Promise<StagedChange> {
            const rows = await sql(
                `INSERT INTO ${TABLE} (collection_slug, operation, target_record_id, before_data, proposed_data,
                                       actor_type, actor_id, actor_label, reason)
                 VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9)
                 RETURNING ${COLUMNS}`,
                [
                    change.collection_slug,
                    change.operation,
                    change.target_record_id,
                    change.before_data === null ? null : JSON.stringify(change.before_data),
                    change.proposed_data === null ? null : JSON.stringify(change.proposed_data),
                    change.actor_type,
                    change.actor_id,
                    change.actor_label,
                    change.reason
                ]
            );
            return rowToStagedChange(rows[0]);
        },

        async getMany(ids: readonly string[]): Promise<StagedChange[]> {
            const valid = ids.filter(isStagedChangeId).map(id => id.toLowerCase());
            if (valid.length === 0) return [];
            const rows = await sql(`SELECT ${COLUMNS} FROM ${TABLE} WHERE id = ANY($1::uuid[])`, [valid]);
            const byId = new Map(rows.map(row => [String(row.id), rowToStagedChange(row)]));
            return valid.flatMap(id => byId.get(id) ?? []);
        },

        async list(filter: StagedChangeFilter): Promise<{ changes: StagedChange[]; total: number }> {
            const params: unknown[] = [[...filter.reviewable], filter.actorId ?? null];
            const where = ["(collection_slug = ANY($1::text[]) OR ($2::text IS NOT NULL AND actor_id = $2::text))"];
            if (filter.collection !== undefined) {
                params.push(filter.collection);
                where.push(`collection_slug = $${params.length}`);
            }
            if (filter.status !== undefined) {
                params.push(filter.status);
                where.push(`status = $${params.length}`);
            }
            const counted = await sql(`SELECT count(*) AS total FROM ${TABLE} WHERE ${where.join(" AND ")}`, params);
            const rows = await sql(
                `SELECT ${COLUMNS} FROM ${TABLE}
                 WHERE ${where.join(" AND ")}
                 ORDER BY created_at DESC, id
                 LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
                [...params, filter.limit, filter.offset]
            );
            return { changes: rows.map(rowToStagedChange),
total: Number(counted[0]?.total ?? 0) };
        },

        async decide(ids, decision): Promise<StagedChange[]> {
            const valid = ids.filter(isStagedChangeId);
            if (valid.length === 0) return [];
            const rows = await sql(
                `UPDATE ${TABLE}
                 SET status = $2, reviewed_by = $3, reviewed_at = NOW(), review_note = $4
                 WHERE id = ANY($1::uuid[]) AND status = 'pending'
                 RETURNING ${COLUMNS}`,
                [valid, decision.status, decision.reviewedBy, decision.note]
            );
            return rows.map(rowToStagedChange);
        },

        async reopen(ids: readonly string[]): Promise<void> {
            const valid = ids.filter(isStagedChangeId);
            if (valid.length === 0) return;
            await sql(
                `UPDATE ${TABLE}
                 SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL, review_note = NULL
                 WHERE id = ANY($1::uuid[])`,
                [valid]
            );
        }
    };
}
