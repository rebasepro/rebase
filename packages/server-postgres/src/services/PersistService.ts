import { eq, and, isNotNull, isNull, sql, SQL } from "drizzle-orm";
import { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
// import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { CollectionConfig, FilterValues, JUNCTION_PIVOT_KEY, type LogicalCondition, Properties, ResolvedRelation, type ResolvedManyToMany, isManyToMany, hasForeignKeyOnTarget, joinConditions } from "@rebasepro/types";
import { getTableName, resolveCollectionRelations, fieldKeyForColumn } from "@rebasepro/common";
import { DrizzleConditionBuilder } from "../utils/drizzle-conditions";
import {
    assertWritableColumns,
    getCollectionByPath,
    getTableForCollection,
    getPrimaryKeys,
    idCanAddressTable,
    requirePrimaryKeys,
    rowIdentityCondition,
    parseIdValues,
    buildCompositeId
} from "./collection-helpers";
import { sanitizeAndConvertDates, serializeDataToServer } from "../data-transformer";
import { rowsOfResult } from "../utils/result-rows";
import { RelationService } from "./RelationService";
import { beforeQueryCondition, type ReadCallContextProvider } from "./read-scope";
import { RelationWriteService } from "./RelationWriteService";
import { FetchService } from "./FetchService";
import { DrizzleClient } from "../interfaces";
import { PostgresTableRegistry } from "../model/PostgresTableRegistry";
import {
    assertNoReadOnlyRelationValues,
    assertWritableThrough,
    isJunctionBackedRelation,
    isNestedPath,
    resolveNestedPath,
    type NestedPathHop
} from "./nested-path";
import { ApiError, logger, splitFieldOps } from "@rebasepro/server";
import { brokenFieldOpBounds, compileFieldOpBounds, compileFieldOps, fieldOpBoundsError } from "./field-op-sql";
import { extractPgError, extractCauseMessage, pgErrorToFriendlyMessage, isRowLevelSecurityDenial } from "../utils/pg-error-utils";
import { explainZeroRowWrite } from "./write-denial";
import { currentWriteDepth } from "./write-depth";
import { currentWriteScope } from "./write-transaction-scope";
import { resolveSoftDelete, rowInTrashError, softDeleteColumn } from "./soft-delete";
import { commitWithNextStatement } from "../pipelined-transaction";

/**
 * The top-level properties whose value is stamped once, when the row is
 * created: `on_create` dates and `user_on_create` identities.
 *
 * What they hold is a fact about the row's creation, so a write to a row that
 * already exists has nothing to say about them — an update, and the
 * conflict-update of an upsert that met a stored row. Top level only: a stamp
 * nested inside a `map` is part of that map's value, not a column a write can
 * leave out.
 */
export function createStampKeys(properties: Properties | undefined): string[] {
    const keys: string[] = [];
    for (const [key, property] of Object.entries(properties ?? {})) {
        if ((property?.type === "date" && property.autoValue === "on_create")
            || (property?.type === "string" && property.autoValue === "user_on_create")) {
            keys.push(key);
        }
    }
    return keys;
}

/** How {@link PersistService.save} writes a row that may already be stored. */
export interface PersistSaveOptions {
    /** INSERT ... ON CONFLICT DO UPDATE. See `SaveProps.upsert`. */
    upsert?: boolean;
    /** The conflict target, instead of the primary key. See `SaveProps.onConflict`. */
    onConflict?: readonly string[];
    /**
     * Keys of `values` that belong to the INSERT alone: what the create
     * pipeline filled in rather than what the caller wrote — a declared
     * `defaultValue`, a tenant stamp. When an upsert's INSERT meets a stored
     * row, those columns keep the value they have. The create-time stamps
     * (`on_create`, `user_on_create`) are left out of the conflict-update
     * without being named here.
     */
    insertOnlyKeys?: readonly string[];
    /**
     * The caller did not read the row this update addresses, so the write is
     * what establishes it is there: an UPDATE that matched nothing is the 404
     * (`explainZeroRowWrite`), and an update that sets no column reads the row
     * instead of assuming it.
     */
    unreadRow?: boolean;
    /**
     * Nothing follows this write in its transaction, so its last statement
     * may carry the `COMMIT` — see `commitWithNextStatement`. Honoured only
     * where the row is the last thing written (no relation or junction
     * write after it).
     */
    commitsTransaction?: boolean;
}

/**
 * How an upsert treats a row already on its conflict target, beyond replacing
 * it: leave it as it is (`ignoreDuplicates`), or replace it only when it
 * matches `conflictWhere`. A row left alone is answered as `undefined`.
 */
export interface ConflictRule {
    /** `ON CONFLICT DO NOTHING`. */
    ignoreDuplicates?: boolean;
    /** `ON CONFLICT DO UPDATE … WHERE`, over the stored row's columns. */
    conflictWhere?: FilterValues<string>;
}

/** One row of a {@link PersistService.saveRows} batch: its values and what its INSERT alone may write. */
export interface PersistBatchRow {
    values: Record<string, unknown>;
    insertOnlyKeys?: readonly string[];
}

/**
 * The most rows one INSERT of a batch carries, and the most values: Postgres
 * takes at most 65,535 parameters in a statement.
 */
const BATCH_MAX_ROWS = 1000;
const BATCH_MAX_PARAMS = 30_000;

/**
 * Run `write` in a transaction of its own — a SAVEPOINT inside a write — or,
 * when nothing could catch its failure and carry on, straight on `db`.
 *
 * The savepoint exists for a write a hook started (`context.data`): a hook may
 * catch the database refusing it, and the write it runs inside must stay
 * usable. A write a caller started directly inside a request's transaction
 * (frame depth 1, an open write scope) has no such catcher — the REST route,
 * the socket handler and the bulk and batch loops all rethrow, and the
 * request's transaction rolls back whole — so its savepoint only cost two
 * round trips per row: 2,000 of a 1,000-row bulk's statements. Outside a
 * request's transaction (`db` is the pool) a real transaction is still opened,
 * so the row and its relation writes land together.
 */
function inOwnTransactionUnlessTopLevel<T>(db: DrizzleClient, write: (tx: DrizzleClient) => Promise<T>): Promise<T> {
    // `rollback` is what a transaction handle has and the pool does not.
    if ("rollback" in db && currentWriteDepth() === 1 && currentWriteScope()?.tx !== undefined) return write(db);
    return db.transaction(tx => write(tx));
}

/**
 * A filtered write whose filter compiled to no condition: it would address
 * every row, and is refused rather than run.
 */
export function filterRequired(collectionPath: string): ApiError {
    return ApiError.badRequest(
        `A filtered write to "${collectionPath}" needs at least one condition: without one it would address every row.`,
        "FILTER_REQUIRED"
    );
}

/** A column's SQL type as a cast can name it: the serial pseudo-types are their integers. */
function castableType(sqlType: string): string {
    const serial: Record<string, string> = { smallserial: "smallint", serial: "integer", bigserial: "bigint" };
    return serial[sqlType.toLowerCase()] ?? sqlType;
}

/**
 * Service for handling all row write operations.
 * Handles saving, deleting, and updating rows.
 */
export class PersistService {
    /** Reads: whether a row is under a parent, the key a link joins on. */
    private relationService: RelationService;
    /** Writes: junction membership, foreign-key stamping, links. */
    private relationWrites: RelationWriteService;
    private fetchService: FetchService;

    constructor(
        private db: DrizzleClient,
        private registry: PostgresTableRegistry,
        /**
         * How this service's reads reach the identity their `beforeQuery` hooks
         * run as. Passed by the driver that constructed it; absent only in a
         * test, where a collection declaring the hook is refused rather than
         * read unnarrowed. See `read-scope.ts`.
         */
        private callContext?: ReadCallContextProvider
    ) {
        this.relationService = new RelationService(db, registry, callContext);
        this.relationWrites = new RelationWriteService(db, registry, callContext);
        this.fetchService = new FetchService(db, registry, callContext);
    }


    /**
     * Set the columns of one many-to-many link, without touching the membership.
     *
     * `collectionPath` is the nested address — `posts/1/tags` — and `targetId`
     * the row on the far side, so this is `PATCH posts/1/tags/5` with a
     * `_pivot` body. Separate from {@link save} because the two mean different
     * things at the same URL: a body of the target's own columns edits the tag,
     * a body of `_pivot` edits the *link* to it, and conflating them would let
     * a caller who meant one silently perform the other.
     */
    async updateRelationPivot(
        collectionPath: string,
        targetId: string | number,
        pivot: Record<string, unknown>
    ): Promise<void> {
        const hop = isNestedPath(collectionPath) ? resolveNestedPath(collectionPath, this.registry) : undefined;
        if (!hop) {
            throw ApiError.badRequest(
                `"${collectionPath}" is not a relation on a row, so there is no link to update. ` +
                `A \`${JUNCTION_PIVOT_KEY}\` write addresses \`<collection>/<id>/<relation>/<targetId>\`.`,
                "VALIDATION_UNKNOWN_FIELDS",
                { path: collectionPath }
            );
        }
        assertWritableThrough(hop, collectionPath);

        // Membership first, for the same reason `delete` establishes it: the
        // update below matches on both keys, so "no such link" and "a policy
        // refused the write" would otherwise be the same zero rows.
        if (!await this.relationService.isRelated(hop, targetId)) {
            throw ApiError.notFound(`No row "${targetId}" in "${collectionPath}" to update the link of.`);
        }

        // In a transaction of its own — a savepoint inside a write — like every
        // write here; see `delete`.
        await this.db.transaction(tx => this.relationWrites.updateRelationPivot(tx, hop, targetId, pivot));
    }


    /**
     * Explain a row write that matched nothing — see {@link explainZeroRowWrite}
     * for why a zero-row write cannot be reported as success.
     */
    private explainZeroRowWrite(
        handle: DrizzleClient,
        table: PgTable,
        conditions: SQL[],
        collectionPath: string,
        id: string | number,
        operation: "update" | "delete"
    ): Promise<ApiError> {
        return explainZeroRowWrite(
            handle,
            table,
            conditions,
            `Not allowed to ${operation} "${id}" in "${collectionPath}": a row-level security policy rejected the write.`,
            `No row "${id}" in "${collectionPath}" to ${operation}.`
        );
    }

    /**
     * Lock one row against every other write to it until this transaction
     * ends: `FOR NO KEY UPDATE`, the lock an UPDATE of it takes anyway.
     *
     * For a conditional write (`If-Match`): taken before the row is read and
     * compared, so a write that lands meanwhile is either already committed and
     * read, or waits for this one. Without it two writes carrying the same tag
     * both read the old row, both passed, and the second overwrote the first.
     *
     * Under row-level security the lock reads through the caller's UPDATE
     * policies as well as their SELECT ones, so a row they may read but not
     * update is simply not locked — and their write is refused by the database
     * all the same. A nested address locks the row it ends in.
     */
    async lockRow(collectionPath: string, id: string | number): Promise<void> {
        const hop = isNestedPath(collectionPath) ? resolveNestedPath(collectionPath, this.registry) : undefined;
        const collection = hop ? hop.targetCollection : getCollectionByPath(collectionPath, this.registry);
        const table = getTableForCollection(collection, this.registry);
        const idInfoArray = requirePrimaryKeys(collection, this.registry);
        // An id the key cannot hold names no row, and the read after this
        // answers that as a 404 — sent to Postgres it is a 22P02 that aborts
        // the write's transaction instead.
        if (!idCanAddressTable(id, table, idInfoArray)) return;
        const condition = rowIdentityCondition(table, idInfoArray, id, collectionPath);
        await this.db.select({ locked: sql`1` }).from(table).where(condition).for("no key update");
    }

    /**
     * Delete a row by ID. `options.commitsTransaction`: see
     * {@link PersistSaveOptions.commitsTransaction}.
     */
    async delete(
        collectionPath: string,
        id: string | number,
        _databaseId?: string,
        options?: { commitsTransaction?: boolean }
    ): Promise<void> {
        // A nested address deletes *through* a relation, and what that removes
        // depends on who owns the target row.
        const hop = isNestedPath(collectionPath) ? resolveNestedPath(collectionPath, this.registry) : undefined;
        if (hop) {
            assertWritableThrough(hop, collectionPath);

            if (!await this.relationService.isRelated(hop, id)) {
                throw ApiError.notFound(`No row "${id}" in "${collectionPath}" to delete.`);
            }

            if (isJunctionBackedRelation(hop.relation)) {
                // Shared target: drop the link, not the row.
                if (!isManyToMany(hop.relation)) {
                    throw ApiError.badRequest(
                        `"${collectionPath}" reaches '${hop.targetCollection.slug}' through a multi-hop joinPath, ` +
                        `so there is no single link to remove. Delete the row at "${hop.targetCollection.slug}" ` +
                        "directly if that is what you meant.",
                        "RELATION_NOT_UNLINKABLE"
                    );
                }
                await this.db.transaction(tx => this.relationWrites.unlinkRelatedEntity(tx, hop, id));
                return;
            }
            // Owned child (inverse FK): deleting the row is the right meaning,
            // and membership above has established it is this parent's child.
        }

        const collection = getCollectionByPath(collectionPath, this.registry);
        const table = getTableForCollection(collection, this.registry);
        // `requirePrimaryKeys`: with no key there is no condition, and a DELETE
        // without one empties the table.
        const condition = rowIdentityCondition(table, requirePrimaryKeys(collection, this.registry), id, collectionPath);

        // In a transaction of its own, as `save` is: inside a write's
        // transaction that is a SAVEPOINT, so a delete the database refuses (a
        // foreign key, a trigger) is undone on its own and leaves the write
        // usable. Without one, a hook that caught a failed
        // `context.data.<c>.delete()` — which the platform says is safe to
        // catch — had aborted the whole transaction, and the write answered
        // TRANSACTION_ABORTED (or a 25P02 from the history entry after it).
        let result;
        try {
            result = await inOwnTransactionUnlessTopLevel(this.db, tx => {
                const statement = tx.delete(table).where(condition);
                if (options?.commitsTransaction) commitWithNextStatement();
                return statement;
            });
        } catch (error: unknown) {
            throw this.toUserFriendlyError(error, collection.slug, collection, "delete");
        }

        if ((result.rowCount ?? 0) === 0) {
            throw await this.explainZeroRowWrite(this.db, table, [condition], collectionPath, id, "delete");
        }
    }

    /**
     * Delete all rows from a collection
     */
    async deleteAll(collectionPath: string, _databaseId?: string): Promise<void> {
        const collection = getCollectionByPath(collectionPath, this.registry);
        const table = getTableForCollection(collection, this.registry);
        await this.db.delete(table);
    }

    /**
     * The field on the *target* row that records the parent, for a create under
     * a nested one-to-many path.
     *
     * A **field**, not the column: the value is stamped into the caller's
     * payload, which is keyed by wire names — `authorId`, never the `author_id`
     * the relation names its link by. Stamping the column instead put a key on
     * the payload that no property answers to, and `strictWrites` rejected the
     * request the framework had just written to.
     *
     * Returns `undefined` when the link is not a column at all (a multi-hop
     * `joinPath`), so the caller writes the row without stamping anything.
     *
     * `relation.localKey` is deliberately not consulted: it names a column on
     * the *source* table. Falling back to it here — which is what this used to
     * do, and first — stamped the parent's own foreign key onto the child row.
     */
    private resolveParentForeignKeyColumn(hop: NestedPathHop): string | undefined {
        const { relation } = hop;

        switch (relation.kind) {
            case "hasOne":
            case "hasMany":
                return fieldKeyForColumn(hop.targetCollection, relation.foreignKeyOnTarget);

            case "via":
                // The link lives in an intermediate table, not in a column on
                // the target — nothing to stamp.
                // A step with alternatives names no one column either; a list
                // of one names its one.
                return relation.joinPath.length === 1 && joinConditions(relation.joinPath[0]).length === 1
                    ? fieldKeyForColumn(
                        hop.targetCollection,
                        DrizzleConditionBuilder.getColumnNamesFromColumns(joinConditions(relation.joinPath[0])[0].to)[0]
                    )
                    : undefined;

            default:
                // `belongsTo` names a column on the *parent*, and `manyToMany`
                // is written as a junction row. Neither is a column here, and
                // `assertWritableThrough` has already rejected the first.
                return undefined;
        }
    }

    /**
     * Save an row (create or update)
     *
     * With `options.upsert`, the row is written with INSERT ... ON CONFLICT DO
     * UPDATE rather than a plain UPDATE. That is one statement, so it cannot
     * lose a race the way a read-then-write can, and it does not care whether
     * the row already exists — which is what a re-runnable import needs. The
     * conflict is matched on the primary key unless `options.onConflict` names
     * other columns; see {@link SaveProps.onConflict} for why that matters.
     * When the INSERT meets a stored row, the conflict-update sets what the
     * caller wrote and nothing the create alone decides — see
     * {@link PersistSaveOptions.insertOnlyKeys} — and only on a row the caller's
     * `beforeQuery` scope reaches.
     *
     * `values` may carry field operations (`{ views: { $inc: 1 } }`). They are
     * split out here rather than at the REST boundary because every request
     * boundary — HTTP, the WebSocket, in-process `context.data` — reaches this
     * one method, and a rule applied at one door is a rule the other doors do
     * not have. What they compile to is `field-op-sql.ts`.
     */
    async save<M extends Record<string, unknown>>(
        collectionPath: string,
        values: Partial<M>,
        id?: string | number,
        databaseId?: string,
        options?: PersistSaveOptions
    ): Promise<Record<string, unknown>> {
        const saved = await this.saveUnlessKept<M>(collectionPath, values, id, databaseId, options);
        // Only a conflict rule keeps a stored row, and none was passed.
        if (!saved) throw new Error(`Saving a row in "${collectionPath}" answered no row.`);
        return saved;
    }

    /**
     * {@link save}, for an upsert with a {@link ConflictRule}: `undefined`
     * when the rule left the stored row on the conflict target as it was.
     */
    async saveUnlessKept<M extends Record<string, unknown>>(
        collectionPath: string,
        values: Partial<M>,
        id?: string | number,
        databaseId?: string,
        options?: PersistSaveOptions & ConflictRule
    ): Promise<Record<string, unknown> | undefined> {
        // If saving under a nested relation path, resolve the relation it ends in.
        let effectiveCollectionPath = collectionPath;
        const effectiveValues: Partial<M> = { ...values };
        let junctionTableInfo: { parentCollection: CollectionConfig; parentId: string | number; relation: ResolvedManyToMany; relationKey: string; } | undefined;

        const hop = isNestedPath(collectionPath) ? resolveNestedPath(collectionPath, this.registry) : undefined;

        if (hop) {
            assertWritableThrough(hop, collectionPath);
            effectiveCollectionPath = hop.targetCollection.slug;

            const parentIdForWrite = () => {
                const parentPks = getPrimaryKeys(hop.parentCollection, this.registry);
                return parseIdValues(hop.parentId, parentPks)[parentPks[0].fieldName];
            };

            if (isManyToMany(hop.relation)) {
                // A junction path addresses set membership, so a write through it
                // asserts "this row is in this parent's set" — on create *and* on
                // update. The junction row is written after the main write below,
                // idempotently, which is what makes `PUT parent/id/child/childId`
                // able to attach a row that already exists.
                //
                // Unlike an owning foreign key, this takes the row from nobody:
                // its other parents keep it. That is why linking is safe here
                // where reparenting (below) is not.
                junctionTableInfo = {
                    parentCollection: hop.parentCollection,
                    parentId: parentIdForWrite(),
                    relation: hop.relation,
                    relationKey: hop.relationKey
                };
            } else if (id !== undefined) {
                // Updating an existing row *through* an owning parent. The parent
                // segment is an assertion about where the row already lives, not
                // an instruction to move it there: injecting the FK here silently
                // reparented whatever id was named, so `PUT authors/1/posts/43`
                // stole post 43 from its real author. Check membership instead,
                // and leave the FK to an explicit value in the body.
                if (!await this.relationService.isRelated(hop, id)) {
                    throw ApiError.notFound(`No row "${id}" in "${collectionPath}" to update.`);
                }
            } else {
                // One-to-many create: stamp the parent's key onto the child's FK.
                const targetColumnName = this.resolveParentForeignKeyColumn(hop);

                if (targetColumnName) {
                    // Not necessarily the id in the path: a link with a
                    // `sourceKey` is pointed at a column on the parent row, and
                    // stamping the id would create a child that belongs to
                    // nobody — a row the read path would never return again.
                    const parentKeyValue = hasForeignKeyOnTarget(hop.relation)
                        ? await this.relationService.parentKeyValue(hop.parentCollection, hop.relation, hop.parentId)
                        : parentIdForWrite();

                    if (parentKeyValue === undefined) {
                        throw ApiError.badRequest(
                            `Cannot create under "${collectionPath}": the parent row has no value in ` +
                            `\`sourceKey\`, so the new row has nothing to point at.`
                        );
                    }

                    const existingValue = (effectiveValues as Record<string, unknown>)[targetColumnName];
                    if (existingValue !== undefined && existingValue !== null && existingValue !== parentKeyValue) {
                        logger.warn(`Overriding provided value '${existingValue}' for FK '${targetColumnName}' with path parent key '${parentKeyValue}'.`);
                    }
                    (effectiveValues as Record<string, unknown>)[targetColumnName] = parentKeyValue;
                }
            }
        }

        const collection = getCollectionByPath(effectiveCollectionPath, this.registry);
        // Before anything is written or even planned: see the function.
        assertNoReadOnlyRelationValues(effectiveValues as Record<string, unknown>, collection);
        const table = getTableForCollection(collection, this.registry);
        const idInfoArray = getPrimaryKeys(collection, this.registry);
        const primaryKeyFields = idInfoArray.map(info => info.fieldName);

        // Build an object mapping required for dynamic returning
        const returningKeys: Record<string, AnyPgColumn> = {};
        idInfoArray.forEach(info => {
            const field = table[info.fieldName as keyof typeof table] as AnyPgColumn;
            if (!field) throw new Error(`Primary key field '${info.fieldName}' not found in table '${effectiveCollectionPath}'`);
            returningKeys[info.fieldName] = field;
        });

        // Operations on the stored value, held back from every step below:
        // `serializeDataToServer` would read `{ $inc: 1 }` on a number column
        // as a value to coerce, and `sanitizeAndConvertDates` would hand the
        // marker object to the column as data.
        const { values: plainValues, fieldOps } = splitFieldOps(
            effectiveValues as Record<string, unknown>,
            this.registry.getTable(collection.slug)?.descriptor
        );
        const fieldOpKeys = Object.keys(fieldOps);
        if (fieldOpKeys.length > 0) {
            // An operation describes a change to a value that is already
            // stored, so there is nothing for it to act on here. Saying so is
            // the whole point: `views + 1` over a row being inserted is just
            // `1`, and accepting it would make `$inc` mean two different things
            // depending on a race the caller cannot observe.
            if (!id) {
                throw ApiError.badRequest(
                    `Field operations (${fieldOpKeys.map(k => `'${k}'`).join(", ")}) need an existing row to act on, ` +
                    `and this write to "${effectiveCollectionPath}" is an insert. Send the value itself instead.`,
                    "INVALID_FIELD_OPERATION"
                );
            }
            if (options?.upsert) {
                throw ApiError.badRequest(
                    `Field operations (${fieldOpKeys.map(k => `'${k}'`).join(", ")}) cannot be combined with an upsert: ` +
                    "an upsert may insert, and there would be no stored value to operate on. " +
                    "Use an update, or send the value itself.",
                    "INVALID_FIELD_OPERATION"
                );
            }
        }

        // Separate relations that require special handling
        const relationValues: Record<string, unknown> = {};
        const otherValues: Partial<M> = { ...(plainValues as Partial<M>) };
        const resolvedRelations = resolveCollectionRelations(collection);

        for (const key in resolvedRelations) {
            const relation = resolvedRelations[key];
            if (relation && relation.cardinality === "many") {
                if (Object.prototype.hasOwnProperty.call(otherValues, key)) {
                    relationValues[key] = otherValues[key as keyof M];
                    delete otherValues[key as keyof M];
                }
            }
        }

        let savedId: string | number;
        /** The row a plain INSERT handed back, already rendered as the read-back would render it. */
        let returnedRow: Record<string, unknown> | undefined;
        try {
            // Transform relations to IDs, then sanitize
            const serializedResult = serializeDataToServer(otherValues as M, collection.properties as Properties, collection, this.registry);

            // Extract relation updates from the typed result
            const inverseRelationUpdates = serializedResult.inverseRelationUpdates;
            const joinPathRelationUpdates = serializedResult.joinPathRelationUpdates;
            // Whether the INSERT is the last thing this save writes. Anything
            // written after it — a relation, a junction row — may change the
            // row (a self-reference, a trigger), so then it is read back.
            const rowIsWrittenLast = inverseRelationUpdates.length === 0 && joinPathRelationUpdates.length === 0
                && Object.keys(relationValues).length === 0 && !junctionTableInfo;

            const entityData = sanitizeAndConvertDates(serializedResult.scalarData);

            // Everything below builds SQL from the table's own column list, so
            // a key that is not a column is silently left out rather than
            // refused. Say so here, while the key is still in hand.
            assertWritableColumns(entityData as Record<string, unknown>, table, effectiveCollectionPath);
            // The same check for the operated columns. They never reach
            // `entityData` — they are SQL, not values — so without this a
            // `$inc` on a property with no column would be dropped from the
            // statement and answered 200, which is the silent-write defect
            // `assertWritableColumns` exists to prevent.
            if (fieldOpKeys.length > 0) {
                assertWritableColumns(
                    Object.fromEntries(fieldOpKeys.map(key => [key, null])),
                    table,
                    effectiveCollectionPath
                );
            }

            // The last statement this save sends, when nothing is written
            // after the row: it carries the transaction's COMMIT.
            const lastStatement = () => {
                if (options?.commitsTransaction && rowIsWrittenLast) commitWithNextStatement();
            };
            const conditional = Boolean(options?.ignoreDuplicates || options?.conflictWhere);
            const kept = await inOwnTransactionUnlessTopLevel(this.db, async (tx): Promise<string | number | undefined> => {
                let currentId: string | number;

                if (id && !options?.upsert) {
                    // Update existing row
                    currentId = id; // `id` is already the formatted composite or singular string

                    // Apply joinPath one-to-one relation updates BEFORE the main UPDATE.
                    // This ensures parentSourceCol reads the pre-update FK value, preventing
                    // stale joinPath values from corrupting related rows when an
                    // intermediate FK (e.g., author_id) changes in the same save.
                    // Example: changing author A→B with stale profile P1 (A's):
                    //   reads old author_id=A → clears P1.author_id → re-sets P1.author_id=A (no-op).
                    if (joinPathRelationUpdates.length > 0) {
                        await this.relationWrites.updateJoinPathOneToOneRelations(tx, collection, currentId, joinPathRelationUpdates);
                    }

                    // Only issue an UPDATE if there are scalar columns to set.
                    // When the payload contains only relation data, entityData is
                    // empty after relation stripping and Drizzle throws "No values to set".
                    const scalarKeys = Object.keys(entityData as Record<string, unknown>);
                    // Compiled here, inside the transaction that will run them:
                    // an operation is an expression over the row's current
                    // value, so it is only correct while the row is locked by
                    // the very statement that reads it.
                    const compiledOps = fieldOpKeys.length > 0
                        ? compileFieldOps(table, fieldOps, { collectionPath: effectiveCollectionPath })
                        : undefined;
                    // What each operation produces, held to the property's
                    // declared bounds by the same statement — see
                    // `compileFieldOpBounds` for why it cannot be a read first.
                    const bounds = fieldOpKeys.length > 0
                        ? compileFieldOpBounds(table, fieldOps, collection.properties ?? {}, { collectionPath: effectiveCollectionPath })
                        : [];
                    const condition = rowIdentityCondition(table, idInfoArray, id, effectiveCollectionPath);
                    if (scalarKeys.length > 0 || compiledOps) {
                        const updateQuery = tx.update(table).set({
                            ...(entityData as Record<string, unknown>),
                            ...(compiledOps ?? {})
                        });
                        // The whole row, when it can stand in for the read back
                        // below, as for an INSERT: the UPDATE's own RETURNING.
                        const returning = rowIsWrittenLast ? this.fetchService.insertReturning(collection.slug) : undefined;
                        const statement = updateQuery
                            .where(and(condition, ...bounds.map(bound => bound.holds)))
                            .returning(returning?.columns ?? returningKeys);
                        lastStatement();
                        const updated = await statement;
                        if (returning && updated[0]) returnedRow = returning.render(updated[0]);

                        // Throwing rolls the transaction back, so relation writes
                        // already applied above do not survive a rejected update.
                        if (updated.length === 0) {
                            const broken = await brokenFieldOpBounds(tx, table, [condition], bounds);
                            if (broken.length > 0) throw fieldOpBoundsError(collection.slug, broken);
                            throw await this.explainZeroRowWrite(
                                tx, table, [condition], effectiveCollectionPath, currentId, "update"
                            );
                        }
                    } else if (options?.unreadRow) {
                        // Nothing to set, so no UPDATE says whether the row is
                        // there; read it, as the caller would have.
                        const [present] = await tx.select(returningKeys).from(table).where(condition).limit(1);
                        if (!present) throw ApiError.notFound(`No row "${id}" in "${effectiveCollectionPath}" to update.`);
                    }
                } else {
                    const dataForInsert = { ...(entityData as Record<string, unknown>) };

                    // An explicit id given alongside upsert is the conflict target,
                    // so fold it into the row before the empty-key strip below.
                    if (id && options?.upsert) {
                        Object.assign(dataForInsert, parseIdValues(id, idInfoArray));
                    }

                    // Strip empty primary keys so the database defaults (e.g. uuid_gen(), auto-increment) can trigger
                    for (const info of idInfoArray) {
                        if (dataForInsert[info.fieldName] === "" || dataForInsert[info.fieldName] === null || dataForInsert[info.fieldName] === undefined) {
                            delete dataForInsert[info.fieldName];
                        }
                    }

                    const insertQuery = tx.insert(table).values(dataForInsert);

                    // ON CONFLICT needs a real conflict target. The primary key
                    // is the one guaranteed to exist and is the default; a
                    // caller may name another column set, which the REST layer
                    // has already checked carries a uniqueness guarantee (see
                    // `resolveConflictTarget`). Either way every target column
                    // must be present in the row, or there is nothing to match
                    // on — the row is a plain insert and a duplicate should
                    // still raise.
                    const targetFields = options?.onConflict && options.onConflict.length > 0
                        ? [...options.onConflict]
                        : idInfoArray.map((info) => info.fieldName);
                    const hasFullKey = targetFields.length > 0
                        && targetFields.every((field) => dataForInsert[field] !== undefined);

                    let result;
                    if (options?.upsert && hasFullKey) {
                        const target = targetFields.map((field) => {
                            const column = table[field as keyof typeof table] as AnyPgColumn | undefined;
                            if (!column) {
                                throw ApiError.badRequest(
                                    `'${field}' is not a column of "${effectiveCollectionPath}", so it cannot be an upsert target.`,
                                    "INVALID_CONFLICT_TARGET"
                                );
                            }
                            return column;
                        });
                        const set = { ...dataForInsert };
                        // Never reassign the target columns to themselves in the
                        // UPDATE branch; Postgres rejects that against the
                        // conflict target. The primary key is excluded as well
                        // when the target is a natural key: a conflict means the
                        // stored row already has a key, and overwriting it with
                        // one the caller invented would move the row.
                        for (const info of idInfoArray) delete set[info.fieldName];
                        for (const field of targetFields) delete set[field];

                        // A conflict means the row was already there, so its
                        // create-time stamps (`on_create`, `user_on_create`)
                        // are facts about the past and not this write's to
                        // redecide. Bulk rows are saved with `status: "new"` on
                        // purpose (an import's rows carry a natural key for
                        // rows that may not exist), which computes the stamps
                        // for every row — and the conflict-update then wrote
                        // them over the originals. A nightly re-import reset
                        // `createdAt` on everything it touched, and handed
                        // `createdBy` to whoever ran it. The INSERT branch keeps
                        // the values: they are right there.
                        for (const key of createStampKeys(collection.properties as Properties | undefined)) {
                            delete set[key];
                        }
                        // The same for everything else the create alone filled
                        // in. A `defaultValue` describes a row the caller did
                        // not finish describing, not one that exists: written
                        // here it reset every omitted field of every stored row
                        // an import touched — `status` back to "draft".
                        for (const key of options.insertOnlyKeys ?? []) delete set[key];

                        // Only a row the caller's `beforeQuery` scope reaches is
                        // theirs to update. Their UPDATE is refused before it
                        // runs when the row is out of scope; here the stored row
                        // is only known once the INSERT meets it, so the scope
                        // rides along as the conflict-update's own WHERE.
                        const scope = await this.writeScope(collection, effectiveCollectionPath, table);
                        // And never a row in the trash. The driver refuses an
                        // upsert onto a trashed key before it gets here (see
                        // `findUpsertTarget`); this is the same rule held by
                        // the statement, for the row that read could not see
                        // or that was trashed since.
                        const runtime = this.registry.requireTable(collection.slug);
                        const softDelete = resolveSoftDelete(runtime);
                        const trashColumn = softDelete ? softDeleteColumn(runtime, table) : undefined;
                        const writable = trashColumn
                            ? (scope ? and(scope, isNull(trashColumn)) : isNull(trashColumn))
                            : scope;
                        const updating = Object.keys(set).length > 0 && !options.ignoreDuplicates;
                        // The caller's condition on the stored row, beside the
                        // scope: `ON CONFLICT DO UPDATE … WHERE`.
                        const condition = options.conflictWhere
                            ? this.fetchService.buildFilterConditions(options.conflictWhere, table, effectiveCollectionPath)
                            : [];
                        const setWhere = condition.length > 0 ? and(...(writable ? [writable] : []), ...condition) : writable;
                        // The whole row, when it can stand in for the read back
                        // below — whichever branch wrote it.
                        const returning = rowIsWrittenLast ? this.fetchService.insertReturning(collection.slug) : undefined;
                        const statement = updating
                            ? insertQuery.onConflictDoUpdate({ target, set, setWhere }).returning(returning?.columns ?? returningKeys)
                            : insertQuery.onConflictDoNothing({ target }).returning(returning?.columns ?? returningKeys);
                        lastStatement();
                        result = await statement;
                        if (returning && result[0]) returnedRow = returning.render(result[0]);

                        // A stored row the rule left alone. Out of scope or in
                        // the trash it is still the refusal below; with
                        // neither to ask about, the rule is all that kept it.
                        if (result.length === 0 && conditional && (options.ignoreDuplicates
                            || !await this.storedRowRefusesWrite(tx, table, target.map((column, i) => eq(column, dataForInsert[targetFields[i]])), scope, trashColumn))) {
                            return undefined;
                        }

                        if (result.length === 0) {
                            // The key is taken and the statement changed nothing:
                            // the stored row is outside the caller's scope, in
                            // the trash, or there was nothing to change on it.
                            // Asked of the row itself, through the same scope,
                            // rather than falling back to an id the caller may
                            // not address — which then failed the read-back
                            // below as a 500.
                            const keyConditions: SQL[] = target.map((column, i) => eq(column, dataForInsert[targetFields[i]]));
                            if (scope) keyConditions.push(scope);
                            const keyLabel = targetFields.map((field) => String(dataForInsert[field])).join(", ");
                            if (softDelete && trashColumn) {
                                const [inTrash] = await tx.select(returningKeys).from(table)
                                    .where(and(...keyConditions, isNotNull(trashColumn))).limit(1);
                                if (inTrash) throw rowInTrashError(effectiveCollectionPath, keyLabel, softDelete);
                            }
                            const missing = `No row "${keyLabel}" in "${effectiveCollectionPath}" to update.`;
                            if (updating) {
                                throw await explainZeroRowWrite(
                                    tx, table, keyConditions,
                                    `Not allowed to update "${keyLabel}" in "${effectiveCollectionPath}": a row-level security policy rejected the write.`,
                                    missing
                                );
                            }
                            result = await tx.select(returningKeys).from(table).where(and(...keyConditions)).limit(1);
                            if (result.length === 0) throw ApiError.notFound(missing);
                        }
                    } else {
                        // The whole row, when it can stand in for the read
                        // back below — see `FetchService.insertReturning`.
                        const returning = rowIsWrittenLast ? this.fetchService.insertReturning(collection.slug) : undefined;
                        const statement = insertQuery.returning(returning?.columns ?? returningKeys);
                        lastStatement();
                        result = await statement;
                        if (returning && result[0]) returnedRow = returning.render(result[0]);
                    }

                    // DO NOTHING returns no row when it skipped, and an upsert whose
                    // UPDATE branch is filtered by RLS returns none either. Fall back
                    // to the id we were given rather than reading undefined.
                    const resultRow = result[0];
                    if (!resultRow) {
                        if (id) {
                            currentId = id;
                        } else {
                            throw ApiError.forbidden(
                                `Not allowed to write to "${effectiveCollectionPath}": the row was rejected by a row-level security policy.`,
                                "WRITE_DENIED"
                            );
                        }
                    } else {
                        currentId = buildCompositeId(resultRow, idInfoArray);
                    }

                    // For inserts, apply joinPath after since the parent row didn't exist before
                    if (joinPathRelationUpdates.length > 0) {
                        await this.relationWrites.updateJoinPathOneToOneRelations(tx, collection, currentId, joinPathRelationUpdates);
                    }
                }

                // Handle inverse relation updates
                if (inverseRelationUpdates.length > 0) {
                    await this.relationWrites.updateInverseRelations(tx, collection, currentId, inverseRelationUpdates);
                }

                // Update many-to-many relations
                if (Object.keys(relationValues).length > 0) {
                    await this.relationWrites.updateRelationsUsingJoins(tx, collection, currentId, relationValues);
                }

                // Attach the row to the parent's set. Runs for updates as well as
                // creates — it used to be gated on `!id`, which is why a row that
                // already existed could never be added to a parent through its
                // path. The insert is idempotent, so re-asserting a link is a
                // no-op rather than a duplicate-key error.
                if (junctionTableInfo) {
                    await this.relationWrites.handleJunctionTableCreation(tx, currentId, junctionTableInfo);
                }

                return currentId;
            });
            if (kept === undefined) return undefined;
            savedId = kept;
        } catch (error: unknown) {
            throw this.toUserFriendlyError(error, collection.slug, collection);
        }

        // Fetch the saved row back through the same walk `GET /:id` serves, so a
        // write's answer is the read that follows it. This used to be `fetchOne`
        // — the admin view-model walk — whose `__type: "relation"` refs then
        // leaked into REST responses, afterSave callbacks, history records and
        // app-level realtime payloads, none of which see that shape from any
        // read path. The admin does not need them here either: its rows arrive
        // over the realtime subscription refetch, which still serves the
        // view-model walk.
        //
        // `withDeleted` on the read-back, which is not the same question the
        // caller's own read asks. A soft delete IS a save — it stamps
        // `deleted_at` — and the default read hides stamped rows, so this walk
        // could not see the row it had just written and threw "Could not fetch
        // row after save." inside the transaction, which rolled the stamp back.
        // Delete answered 500 on every soft-delete collection and the row
        // stayed live: the feature did not work at all.
        //
        // Showing it is also the correct answer on its own terms. Whoever just
        // wrote this row is the one party who must be able to see the result of
        // their own write, whatever its deleted state — and an ordinary save is
        // unaffected, because an undeleted row is visible either way.
        //
        // A plain INSERT that was the last thing written already handed this
        // row back: the same columns of the same row, rendered the same way.
        // A bulk create of 1,000 rows was 1,000 of these reads.
        if (returnedRow) return returnedRow;
        const finalEntity = await this.fetchService.fetchOneForRest(
            collection.slug, savedId, undefined, databaseId, { withDeleted: true }
        );
        if (!finalEntity) throw new Error("Could not fetch row after save.");
        return finalEntity;
    }

    /**
     * Write a batch of new rows — inserted, or upserted with `options.upsert` —
     * as multi-row statements, and return each row as {@link save} returns it.
     *
     * The statements are the ones {@link save} sends for one row, carrying up
     * to {@link BATCH_MAX_ROWS} rows each: the same columns, defaults, conflict
     * target, conflict-update and scope. A batch of 1,000 rows is one or two
     * statements instead of a thousand.
     *
     * `undefined`, before anything is written, for a batch that needs what
     * only the row-by-row save does: a nested path, a relation or field
     * operation in a row, an upsert row without its whole conflict key, or a
     * collection whose rows cannot be returned by the write itself (a
     * `beforeQuery` or per-field read access). The caller then saves the rows
     * one by one.
     *
     * Run inside the caller's transaction, which a statement the database
     * refuses aborts: the caller undoes the batch and replays its rows one by
     * one to say which row failed.
     *
     * Rows go out in order, in consecutive runs: a run ends where the next
     * row's conflict-update would set other columns, or where an upsert names
     * a key the run already holds (one statement cannot update a row twice),
     * so a key written twice still ends with the later values.
     */
    async saveRows(
        collectionPath: string,
        rows: readonly PersistBatchRow[],
        options?: { upsert?: boolean; onConflict?: readonly string[]; commitsTransaction?: boolean } & ConflictRule
    ): Promise<(Record<string, unknown> | undefined)[] | undefined> {
        if (isNestedPath(collectionPath)) return undefined;
        const collection = getCollectionByPath(collectionPath, this.registry);
        const returning = this.fetchService.insertReturning(collection.slug);
        if (!returning) return undefined;
        const table = getTableForCollection(collection, this.registry);
        const idInfoArray = getPrimaryKeys(collection, this.registry);
        const resolvedRelations = resolveCollectionRelations(collection);
        const manyRelationKeys = Object.keys(resolvedRelations).filter(key => resolvedRelations[key]?.cardinality === "many");
        const upsert = options?.upsert === true;
        const targetFields = options?.onConflict && options.onConflict.length > 0
            ? [...options.onConflict]
            : idInfoArray.map(info => info.fieldName);
        const createStamps = createStampKeys(collection.properties as Properties | undefined);

        // Each row as `save` would write it, or `undefined` for the batch.
        const prepared: { data: Record<string, unknown>; set: string[]; key: string }[] = [];
        for (const row of rows) {
            assertNoReadOnlyRelationValues(row.values, collection);
            const { values: plainValues, fieldOps } = splitFieldOps(row.values, this.registry.getTable(collection.slug)?.descriptor);
            if (Object.keys(fieldOps).length > 0) return undefined;
            if (manyRelationKeys.some(key => Object.prototype.hasOwnProperty.call(plainValues, key))) return undefined;
            const serialized = serializeDataToServer(plainValues, collection.properties as Properties, collection, this.registry);
            if (serialized.inverseRelationUpdates.length > 0 || serialized.joinPathRelationUpdates.length > 0) return undefined;
            const data = { ...(sanitizeAndConvertDates(serialized.scalarData) as Record<string, unknown>) };
            assertWritableColumns(data, table, collectionPath);
            for (const info of idInfoArray) {
                if (data[info.fieldName] === "" || data[info.fieldName] === null || data[info.fieldName] === undefined) {
                    delete data[info.fieldName];
                }
            }
            let set: string[] = [];
            let key = "";
            if (upsert) {
                if (targetFields.length === 0 || targetFields.some(field => data[field] === undefined)) return undefined;
                const excluded = new Set([...idInfoArray.map(info => info.fieldName), ...targetFields, ...createStamps, ...(row.insertOnlyKeys ?? [])]);
                set = Object.keys(data).filter(field => !excluded.has(field)).sort();
                key = JSON.stringify(targetFields.map(field => String(data[field])));
            }
            prepared.push({ data, set, key });
        }

        const target = upsert ? targetFields.map(field => {
            const column = table[field as keyof typeof table] as AnyPgColumn | undefined;
            if (!column) {
                throw ApiError.badRequest(
                    `'${field}' is not a column of "${collectionPath}", so it cannot be an upsert target.`,
                    "INVALID_CONFLICT_TARGET"
                );
            }
            return column;
        }) : [];
        const scope = upsert ? await this.writeScope(collection, collectionPath, table) : undefined;
        const runtime = this.registry.requireTable(collection.slug);
        const softDelete = upsert ? resolveSoftDelete(runtime) : undefined;
        const trashColumn = softDelete ? softDeleteColumn(runtime, table) : undefined;
        const writable = trashColumn ? (scope ? and(scope, isNull(trashColumn)) : isNull(trashColumn)) : scope;
        const conditional = Boolean(options?.ignoreDuplicates || options?.conflictWhere);
        const condition = upsert && options?.conflictWhere
            ? this.fetchService.buildFilterConditions(options.conflictWhere, table, collectionPath)
            : [];
        const setWhere = condition.length > 0 ? and(...(writable ? [writable] : []), ...condition) : writable;
        // The last statement may carry the COMMIT unless a row it leaves out
        // is then saved on its own below, which may write: an upsert onto a
        // row out of the caller's scope or in the trash.
        const lastCommits = options?.commitsTransaction === true
            && (!upsert || options.ignoreDuplicates === true || (!scope && !trashColumn));

        // Consecutive runs, as the method comment says.
        const runs: { start: number; end: number }[] = [];
        let start = 0;
        let params = 0;
        let keys = new Set<string>();
        for (let i = 0; i < prepared.length; i++) {
            const row = prepared[i];
            const width = Object.keys(row.data).length;
            const breaks = i > start && (
                i - start >= BATCH_MAX_ROWS
                || params + width > BATCH_MAX_PARAMS
                || (upsert && (keys.has(row.key) || row.set.join(",") !== prepared[start].set.join(",")))
            );
            if (breaks) {
                runs.push({ start, end: i });
                start = i;
                params = 0;
                keys = new Set();
            }
            params += width;
            keys.add(row.key);
        }
        if (prepared.length > 0) runs.push({ start, end: prepared.length });

        const written: (Record<string, unknown> | undefined)[] = new Array(prepared.length);
        for (const run of runs) {
            const slice = prepared.slice(run.start, run.end);
            const insertQuery = this.db.insert(table).values(slice.map(row => row.data));
            const last = run === runs[runs.length - 1];
            if (!upsert) {
                const statement = insertQuery.returning(returning.columns);
                if (last && lastCommits) commitWithNextStatement();
                const result = await statement;
                if (result.length !== slice.length) {
                    throw new Error(`Inserted ${slice.length} rows into "${collectionPath}" and got ${result.length} back.`);
                }
                result.forEach((row, i) => { written[run.start + i] = returning.render(row); });
                continue;
            }
            const setColumns = slice[0].set;
            const set: Record<string, SQL> = {};
            for (const field of setColumns) {
                const column = table[field as keyof typeof table] as AnyPgColumn;
                set[field] = sql`excluded.${sql.identifier(column.name)}`;
            }
            const statement = setColumns.length > 0 && !options?.ignoreDuplicates
                ? insertQuery.onConflictDoUpdate({ target, set, setWhere }).returning(returning.columns)
                : insertQuery.onConflictDoNothing({ target }).returning(returning.columns);
            if (last && lastCommits) commitWithNextStatement();
            const result = await statement;
            // Matched back by key: a row the conflict branch left alone
            // (out of scope, in the trash, nothing to set) is not returned.
            const byKey = new Map<string, Record<string, unknown>>();
            for (const row of result) {
                byKey.set(JSON.stringify(targetFields.map(field => String(row[field]))), row);
            }
            slice.forEach((row, i) => {
                const stored = byKey.get(row.key);
                if (stored) written[run.start + i] = returning.render(stored);
            });
        }

        // A row its statement did not return is saved on its own, which
        // answers for it as a single upsert does: the stored row, a refusal,
        // or a row in the trash. Under a conflict rule, a row the rule kept
        // is `undefined` — asked of the row on its own only when a scope or
        // a trash could be what kept it instead.
        const saved: (Record<string, unknown> | undefined)[] = [];
        for (let i = 0; i < rows.length; i++) {
            if (written[i]) {
                saved.push(written[i]);
            } else if (conditional && (options?.ignoreDuplicates || (!scope && !trashColumn))) {
                saved.push(undefined);
            } else {
                saved.push(await this.saveUnlessKept(collectionPath, rows[i].values, undefined, collection.databaseId, {
                    upsert,
                    onConflict: options?.onConflict,
                    insertOnlyKeys: rows[i].insertOnlyKeys,
                    ignoreDuplicates: options?.ignoreDuplicates,
                    conflictWhere: options?.conflictWhere
                }));
            }
        }
        return saved;
    }

    /**
     * Update rows by id, each with its own values, as
     * `UPDATE … FROM (VALUES …) … RETURNING` statements, and return each row as
     * {@link save} returns it — or `undefined`, before anything is written,
     * for updates that need what only the row-by-row update does: a nested
     * path, a relation or field operation in a row, a collection whose rows the
     * write cannot return (`beforeQuery`, per-field read access) or that has a
     * trash. Consecutive updates setting the same columns share a statement;
     * an id named twice starts a new one, so the later values win.
     *
     * An id the statement did not update — not there, or not the caller's to
     * update — fails the call: the caller replays the updates one by one to say
     * which, and why.
     */
    async updateRows(
        collectionPath: string,
        updates: readonly { id: string | number; values: Record<string, unknown> }[]
    ): Promise<Record<string, unknown>[] | undefined> {
        if (isNestedPath(collectionPath)) return undefined;
        const collection = getCollectionByPath(collectionPath, this.registry);
        if (resolveSoftDelete(this.registry.requireTable(collection.slug))) return undefined;
        const returning = this.fetchService.insertReturning(collection.slug);
        if (!returning) return undefined;
        const table = getTableForCollection(collection, this.registry);
        const idInfoArray = requirePrimaryKeys(collection, this.registry);
        const resolvedRelations = resolveCollectionRelations(collection);
        const manyRelationKeys = Object.keys(resolvedRelations).filter(key => resolvedRelations[key]?.cardinality === "many");
        const columnOf = (field: string): AnyPgColumn => table[field as keyof typeof table] as AnyPgColumn;

        const prepared: { key: Record<string, unknown>; data: Record<string, unknown>; columns: string; id: string }[] = [];
        for (const { id, values } of updates) {
            assertNoReadOnlyRelationValues(values, collection);
            const { values: plainValues, fieldOps } = splitFieldOps(values, this.registry.getTable(collection.slug)?.descriptor);
            if (Object.keys(fieldOps).length > 0) return undefined;
            if (manyRelationKeys.some(key => Object.prototype.hasOwnProperty.call(plainValues, key))) return undefined;
            const serialized = serializeDataToServer(plainValues, collection.properties as Properties, collection, this.registry);
            if (serialized.inverseRelationUpdates.length > 0 || serialized.joinPathRelationUpdates.length > 0) return undefined;
            const data = { ...(sanitizeAndConvertDates(serialized.scalarData) as Record<string, unknown>) };
            assertWritableColumns(data, table, collectionPath);
            for (const info of idInfoArray) delete data[info.fieldName];
            if (Object.keys(data).length === 0) return undefined;
            if (!idCanAddressTable(id, table, idInfoArray)) return undefined;
            const key = parseIdValues(String(id), idInfoArray);
            prepared.push({ key, data, columns: Object.keys(data).sort().join(","), id: JSON.stringify(idInfoArray.map(info => String(key[info.fieldName]))) });
        }

        // Consecutive runs that set the same columns, without an id twice.
        const runs: { start: number; end: number }[] = [];
        let start = 0;
        let ids = new Set<string>();
        for (let i = 0; i < prepared.length; i++) {
            const row = prepared[i];
            const width = idInfoArray.length + Object.keys(row.data).length;
            if (i > start && (i - start >= BATCH_MAX_ROWS || (i - start) * width > BATCH_MAX_PARAMS
                || ids.has(row.id) || row.columns !== prepared[start].columns)) {
                runs.push({ start, end: i });
                start = i;
                ids = new Set();
            }
            ids.add(row.id);
        }
        if (prepared.length > 0) runs.push({ start, end: prepared.length });

        const written: Record<string, unknown>[] = new Array(prepared.length);
        for (const run of runs) {
            const slice = prepared.slice(run.start, run.end);
            const keyFields = idInfoArray.map(info => info.fieldName);
            const setFields = slice[0].columns.split(",");
            // Each value typed as its column, so the VALUES list is not read as
            // text, and encoded as drizzle encodes it for that column.
            const valueOf = (field: string, value: unknown) => {
                const column = columnOf(field);
                return sql`${sql.param(value ?? null, column)}::${sql.raw(castableType(column.getSQLType()))}`;
            };
            const rows = slice.map(row => sql`(${sql.join([
                ...keyFields.map(field => valueOf(field, row.key[field])),
                ...setFields.map(field => valueOf(field, row.data[field]))
            ], sql`, `)})`);
            const names = [...keyFields.map((_, i) => `k${i}`), ...setFields.map((_, i) => `c${i}`)];
            const returnedColumns = Object.entries(returning.columns);
            const result = await this.db.execute(sql`UPDATE ${table} SET ${sql.join(
                setFields.map((field, i) => sql`${sql.identifier(columnOf(field).name)} = ${sql.identifier("v")}.${sql.identifier(`c${i}`)}`),
                sql`, `
            )} FROM (VALUES ${sql.join(rows, sql`, `)}) AS ${sql.identifier("v")}(${sql.raw(names.map(name => `"${name}"`).join(", "))}) WHERE ${sql.join(
                keyFields.map((field, i) => sql`${columnOf(field)} = ${sql.identifier("v")}.${sql.identifier(`k${i}`)}`),
                sql` AND `
            )} RETURNING ${sql.join(returnedColumns.map(([, column]) => sql`${column}`), sql`, `)}`);

            // Decoded as a select decodes them, keyed by field.
            const byId = new Map<string, Record<string, unknown>>();
            for (const raw of rowsOfResult(result)) {
                const row: Record<string, unknown> = {};
                for (const [field, column] of returnedColumns) {
                    const value = raw[column.name];
                    row[field] = value === null || value === undefined ? null : column.mapFromDriverValue(value);
                }
                byId.set(JSON.stringify(keyFields.map(field => String(row[field]))), row);
            }
            slice.forEach((row, i) => {
                const stored = byId.get(row.id);
                if (!stored) {
                    throw new Error(`Update ${run.start + i} of ${prepared.length} matched no row in "${collectionPath}".`);
                }
                written[run.start + i] = returning.render(stored);
            });
        }
        return written;
    }

    /**
     * Update every row the conditions match, in one
     * `UPDATE … SET … WHERE … RETURNING` statement, and return each row as
     * {@link save} returns it. Field operations are compiled as for one row,
     * and their declared bounds are checked by the same statement: a matched
     * row an operation would take out of bounds fails the call.
     *
     * `undefined`, before anything is written, for a write that needs what
     * only the row-by-row update does: a relation in the values, or a
     * collection whose rows the statement cannot return (`beforeQuery`,
     * per-field read access). `options.commitsTransaction`: see
     * {@link PersistSaveOptions.commitsTransaction}; not honoured when bounds
     * are checked, which takes a statement after the update.
     */
    async updateWhere(
        collectionPath: string,
        filter: FilterValues<string> | undefined,
        logical: LogicalCondition | undefined,
        values: Record<string, unknown>,
        options?: { commitsTransaction?: boolean }
    ): Promise<Record<string, unknown>[] | undefined> {
        const collection = getCollectionByPath(collectionPath, this.registry);
        const returning = this.fetchService.insertReturning(collection.slug);
        if (!returning) return undefined;
        assertNoReadOnlyRelationValues(values, collection);
        const table = getTableForCollection(collection, this.registry);
        const { values: plainValues, fieldOps } = splitFieldOps(values, this.registry.getTable(collection.slug)?.descriptor);
        const resolvedRelations = resolveCollectionRelations(collection);
        if (Object.keys(resolvedRelations).some(key => resolvedRelations[key]?.cardinality === "many"
            && Object.prototype.hasOwnProperty.call(plainValues, key))) return undefined;
        const serialized = serializeDataToServer(plainValues, collection.properties as Properties, collection, this.registry);
        if (serialized.inverseRelationUpdates.length > 0 || serialized.joinPathRelationUpdates.length > 0) return undefined;
        const data = { ...(sanitizeAndConvertDates(serialized.scalarData) as Record<string, unknown>) };
        assertWritableColumns(data, table, collectionPath);
        const fieldOpKeys = Object.keys(fieldOps);
        if (fieldOpKeys.length > 0) {
            assertWritableColumns(Object.fromEntries(fieldOpKeys.map(key => [key, null])), table, collectionPath);
        }
        if (Object.keys(data).length === 0 && fieldOpKeys.length === 0) {
            throw ApiError.badRequest(
                `A filtered update of "${collectionPath}" sets nothing: send at least one field to set.`,
                "INVALID_BULK_BODY"
            );
        }
        const compiledOps = fieldOpKeys.length > 0 ? compileFieldOps(table, fieldOps, { collectionPath }) : {};
        const bounds = fieldOpKeys.length > 0
            ? compileFieldOpBounds(table, fieldOps, collection.properties ?? {}, { collectionPath })
            : [];
        const conditions = this.fetchService.buildWriteConditions(filter, logical, table, collectionPath);
        if (conditions.length === 0) throw filterRequired(collectionPath);
        try {
            const statement = this.db.update(table)
                .set({ ...data, ...compiledOps })
                .where(and(...conditions, ...bounds.map(bound => bound.holds)))
                .returning(returning.columns);
            if (options?.commitsTransaction && bounds.length === 0) commitWithNextStatement();
            const updated = await statement;
            if (bounds.length > 0) {
                const broken = await brokenFieldOpBounds(this.db, table, conditions, bounds);
                if (broken.length > 0) throw fieldOpBoundsError(collection.slug, broken);
            }
            return updated.map(row => returning.render(row));
        } catch (error: unknown) {
            throw this.toUserFriendlyError(error, collection.slug, collection);
        }
    }

    /**
     * Delete every row the conditions match, in one `DELETE … WHERE …
     * RETURNING` statement, and return each deleted row's key columns.
     * `options.commitsTransaction`: see {@link PersistSaveOptions.commitsTransaction}.
     */
    async deleteWhere(
        collectionPath: string,
        filter: FilterValues<string> | undefined,
        logical: LogicalCondition | undefined,
        options?: { commitsTransaction?: boolean }
    ): Promise<Record<string, unknown>[]> {
        const collection = getCollectionByPath(collectionPath, this.registry);
        const table = getTableForCollection(collection, this.registry);
        const keyColumns: Record<string, AnyPgColumn> = Object.fromEntries(
            requirePrimaryKeys(collection, this.registry).map(info => [info.fieldName, table[info.fieldName as keyof typeof table] as AnyPgColumn])
        );
        const conditions = this.fetchService.buildWriteConditions(filter, logical, table, collectionPath);
        if (conditions.length === 0) throw filterRequired(collectionPath);
        try {
            const statement = this.db.delete(table).where(and(...conditions)).returning(keyColumns);
            if (options?.commitsTransaction) commitWithNextStatement();
            return await statement;
        } catch (error: unknown) {
            throw this.toUserFriendlyError(error, collection.slug, collection, "delete");
        }
    }

    /**
     * Whether the row `id` addresses matches `filter`, as the caller reads
     * it: for an upsert under a `conflictWhere` that found its row first.
     */
    async rowMatches(collectionPath: string, id: string | number, filter: FilterValues<string>): Promise<boolean> {
        const collection = getCollectionByPath(collectionPath, this.registry);
        const table = getTableForCollection(collection, this.registry);
        const condition = rowIdentityCondition(table, requirePrimaryKeys(collection, this.registry), id, collectionPath);
        const [row] = await this.db.select({ one: sql`1` }).from(table)
            .where(and(condition, ...this.fetchService.buildFilterConditions(filter, table, collectionPath))).limit(1);
        return row !== undefined;
    }

    /**
     * Whether the stored row on an upsert's conflict target is one the
     * caller's write may not change at all — outside their `beforeQuery`
     * scope, or in the trash — rather than one a {@link ConflictRule} kept.
     * Asked only when there is a scope or a trash: without either, nothing
     * but the rule can have kept it, and no statement is sent.
     */
    private async storedRowRefusesWrite(
        tx: DrizzleClient,
        table: PgTable,
        key: SQL[],
        scope: SQL | undefined,
        trashColumn: AnyPgColumn | undefined
    ): Promise<boolean> {
        if (!scope && !trashColumn) return false;
        const writable = [...(scope ? [scope] : []), ...(trashColumn ? [isNull(trashColumn)] : [])];
        const [row] = await tx.select({ writable: sql<boolean>`${and(...writable)}` }).from(table).where(and(...key)).limit(1);
        return row !== undefined && row.writable !== true;
    }

    /**
     * The caller's `beforeQuery` scope over this table, as one condition: what
     * a stored row must satisfy for a write that meets it to change it. The
     * same scope the update gate and the single get apply; `undefined` when the
     * collection declares no hook.
     */
    private writeScope(collection: CollectionConfig, collectionPath: string, table: PgTable): Promise<SQL | undefined> {
        const [key] = getPrimaryKeys(collection, this.registry);
        return beforeQueryCondition(
            { registry: this.registry, callContext: this.callContext },
            collection, collectionPath, table as PgTable<never>,
            { operation: "get", query: {} },
            {
                collection,
                registry: this.registry,
                sourceIdColumn: key ? table[key.fieldName as keyof typeof table] as AnyPgColumn | undefined : undefined
            }
        );
    }

    /**
     * Get the RelationService instance for external use
     */
    getRelationService(): RelationService {
        return this.relationService;
    }

    /**
     * The write half, for external use. Separate from
     * {@link getRelationService} because they are separate objects now: reads
     * answer questions, writes change rows, and the callers of one are not the
     * callers of the other.
     */
    getRelationWriteService(): RelationWriteService {
        return this.relationWrites;
    }

    /**
     * Get the FetchService instance for external use
     */
    getFetchService(): FetchService {
        return this.fetchService;
    }

    /**
     * Translate raw PostgreSQL / Drizzle errors into user-friendly messages.
     *
     * `collection` is passed so the SQLSTATE can be turned into a *field*: the
     * error carries a physical column and the caller only ever sees wire names,
     * so `author_id` had to be translated to `authorId` by whoever read the
     * message — which nothing does. See `pgFieldViolations`.
     */
    private toUserFriendlyError(
        error: unknown,
        collectionSlug: string,
        collection?: CollectionConfig,
        operation: "save" | "delete" = "save"
    ): Error {
        // Deliberate API errors already carry their own status, code and wording.
        // Re-wrapping one flattens it into a generic Error, and the status is lost
        // on the way out — a policy rejection would surface as a 500. Matched by
        // name as well as instance: a duplicated module copy breaks `instanceof`.
        if (error instanceof ApiError || (error as Error)?.name === "ApiError") {
            return error as Error;
        }

        const pgError = extractPgError(error);

        if (pgError) {
            const { message, code, violations } = pgErrorToFriendlyMessage(pgError, collectionSlug, { collection });
            /** `details` for a 4xx, carrying the field(s) — never the values. */
            const details = violations.length > 0
                ? { collection: collectionSlug, violations }
                : undefined;
            // This is the only layer that holds the SQLSTATE, so it is the only
            // one that can say whose fault a failure was. Returning a bare
            // `Error` threw that away, and the REST layer compensated by calling
            // *every* unclassified error a 400 — so an unreachable database was
            // reported to callers as a bad request. Classes 22 (data exception)
            // and 23 (integrity constraint violation) are the caller's data;
            // everything else — a dropped connection, a missing column, a
            // *privilege* problem — is ours, and stays a 500.
            //
            // Within class 23, a conflict with rows already there is a 409
            // rather than a 400: a duplicate key, and a row other rows still
            // reference. A delete refused by a foreign key is the second
            // whichever way the key is declared — `RESTRICT` raises 23001,
            // `NO ACTION` raises 23503 — while a *save* raising 23503 named a
            // target that does not exist, which is the caller's data.
            if (/^2[23]/.test(code)) {
                const conflict = code === "23505" || code === "23001"
                    || (code === "23503" && operation === "delete");
                return conflict
                    ? ApiError.conflict(message, `PG_${code}`, details)
                    : ApiError.badRequest(message, `PG_${code}`, details);
            }
            // With one exception inside class 42: a row-level-security policy
            // refusing the caller is not a fault at all, it is access control
            // working. It fell through to the 500 below, so the client could not
            // tell "you may not do this" from "the server is broken" — and a
            // 500's message is sanitized on the way out, so the reason was lost
            // too. `expected`, because a caller attempting what their policies
            // forbid is routine and should not page anyone; that is the same
            // treatment `unauthenticated()` gets one status code down.
            // `WRITE_DENIED`, the same code `explainZeroRowWrite` returns for an
            // UPDATE or DELETE that RLS refused. Those already answered 403; only
            // INSERT reached here, because a failed `WITH CHECK` raises 42501 while
            // a refused UPDATE simply matches no rows. Two spellings of one denial
            // should not be two status codes.
            //
            // Left at the default log level rather than `expected`: `ApiError`'s
            // own documentation puts "a permission the database refused" in the
            // stays-at-warn column, and the status code is the defect here. The
            // log level is a separate decision that already has an answer.
            if (isRowLevelSecurityDenial(error)) {
                return ApiError.forbidden(message, "WRITE_DENIED");
            }
            // `{ cause }` is load-bearing, not tidiness. The API error handler
            // walks the cause chain for a SQLSTATE and classifies from it: a
            // `42P01` becomes `SCHEMA_DRIFT` with "table X does not exist. Run
            // `rebase db push`", and a `42501` becomes `DB_PERMISSION_DENIED`
            // naming row-level security. A bare `new Error(message)` severs the
            // chain, so every write against a table the code expects and the
            // database lacks answered `INTERNAL_ERROR` / "An unexpected error
            // occurred" — the one failure with the most actionable fix in the
            // product, reported as the least actionable message in it. Reads
            // were classified correctly the whole time, which is why the
            // asymmetry went unnoticed.
            return new Error(message, { cause: error });
        }

        // No PG error found — try to extract a useful message from the
        // Drizzle wrapper instead of leaking the raw SQL query + params.
        const causeMessage = extractCauseMessage(error);
        if (causeMessage) {
            return new Error(`Database error in "${collectionSlug}": ${causeMessage}`, { cause: error });
        }

        // Last resort: generic message, never leak raw SQL
        if (error instanceof Error && error.message.startsWith("Failed query:")) {
            return new Error(`Failed to save row in "${collectionSlug}". Check server logs for details.`, { cause: error });
        }
        return new Error(`Database error in "${collectionSlug}": ${String(error)}`, { cause: error });
    }
}
