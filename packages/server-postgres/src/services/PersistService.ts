import { eq, and, sql, SQL } from "drizzle-orm";
import { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
// import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { CollectionConfig, Properties, Relation } from "@rebasepro/types";
import { getTableName, resolveCollectionRelations, findRelation } from "@rebasepro/common";
import { DrizzleConditionBuilder } from "../utils/drizzle-conditions";
import {
    getCollectionByPath,
    getTableForCollection,
    getPrimaryKeys,
    parseIdValues,
    buildCompositeId
} from "./collection-helpers";
import { sanitizeAndConvertDates, serializeDataToServer } from "../data-transformer";
import { RelationService } from "./RelationService";
import { FetchService } from "./FetchService";
import { DrizzleClient } from "../interfaces";
import { PostgresCollectionRegistry } from "../collections/PostgresCollectionRegistry";
import { ApiError, logger } from "@rebasepro/server";
import { extractPgError, extractCauseMessage, pgErrorToFriendlyMessage } from "../utils/pg-error-utils";

/**
 * Service for handling all row write operations.
 * Handles saving, deleting, and updating rows.
 */
export class PersistService {
    private relationService: RelationService;
    private fetchService: FetchService;

    constructor(private db: DrizzleClient, private registry: PostgresCollectionRegistry) {
        this.relationService = new RelationService(db, registry);
        this.fetchService = new FetchService(db, registry);
    }


    /**
     * Explain a write that matched no rows.
     *
     * Row-level security filters UPDATE and DELETE through the policy's USING
     * clause instead of raising: a denied write is reported by Postgres exactly
     * like a successful one that happened to match nothing. Left unchecked, a
     * caller cannot tell "denied" from "done" — the write returns 200/204 and
     * the row is untouched.
     *
     * Re-reading the target over the *same* RLS-scoped handle separates the two
     * cases. A visible row means the policy rejected the write (403); an
     * invisible one means there is nothing there to write for this caller (404,
     * matching what a GET would say). The re-read is bound by the caller's own
     * policies, so it discloses nothing a plain read wouldn't.
     *
     * Only reached when zero rows matched, so the happy path pays nothing.
     */
    private async explainZeroRowWrite(
        handle: DrizzleClient,
        table: PgTable,
        conditions: SQL[],
        collectionPath: string,
        id: string | number,
        operation: "update" | "delete"
    ): Promise<ApiError> {
        const visible = await handle
            .select({ present: sql<number>`1` })
            .from(table)
            .where(and(...conditions))
            .limit(1);

        if (visible.length > 0) {
            return ApiError.forbidden(
                `Not allowed to ${operation} "${id}" in "${collectionPath}": a row-level security policy rejected the write.`,
                "WRITE_DENIED"
            );
        }

        return ApiError.notFound(
            `No row "${id}" in "${collectionPath}" to ${operation}.`
        );
    }

    /**
     * Delete an row by ID
     */
    async delete(collectionPath: string, id: string | number, _databaseId?: string): Promise<void> {
        const collection = getCollectionByPath(collectionPath, this.registry);
        const table = getTableForCollection(collection, this.registry);
        const idInfoArray = getPrimaryKeys(collection, this.registry);

        const parsedIdObj = parseIdValues(id, idInfoArray);

        const conditions = [];
        for (const info of idInfoArray) {
            const field = table[info.fieldName as keyof typeof table] as AnyPgColumn;
            if (!field) {
                throw new Error(`ID field '${info.fieldName}' not found in table for collection '${collectionPath}'`);
            }
            conditions.push(eq(field, parsedIdObj[info.fieldName]));
        }

        const result = await this.db
            .delete(table)
            .where(and(...conditions));

        if ((result.rowCount ?? 0) === 0) {
            throw await this.explainZeroRowWrite(this.db, table, conditions, collectionPath, id, "delete");
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
     * Save an row (create or update)
     *
     * With `options.upsert`, the row is written with INSERT ... ON CONFLICT DO
     * UPDATE against the primary key rather than a plain UPDATE. That is one
     * statement, so it cannot lose a race the way a read-then-write can, and it
     * does not care whether the row already exists — which is what a re-runnable
     * import needs.
     */
    async save<M extends Record<string, unknown>>(
        collectionPath: string,
        values: Partial<M>,
        id?: string | number,
        databaseId?: string,
        options?: { upsert?: boolean }
    ): Promise<Record<string, unknown>> {
        // If saving under a nested relation path, resolve the parent and inject FK
        let effectiveCollectionPath = collectionPath;
        const effectiveValues: Partial<M> = { ...values };
        let junctionTableInfo: { parentCollection: CollectionConfig; parentId: string | number; relation: Relation; relationKey: string; } | undefined;

        if (collectionPath.includes("/")) {
            const segments = collectionPath.split("/").filter(Boolean);
            if (segments.length >= 3 && segments.length % 2 === 1) {
                const rootSegment = segments[0];
                let currentCollection = getCollectionByPath(rootSegment, this.registry);
                let currentId: string | number = segments[1];

                for (let i = 2; i < segments.length; i += 2) {
                    const relationKey = segments[i];
                    const resolvedRelations = resolveCollectionRelations(currentCollection);
                    const relation = findRelation(resolvedRelations, relationKey);

                    if (!relation) {
                        const available = Object.keys(resolvedRelations).join(", ") || "(none)";
                        throw new Error(`Relation '${relationKey}' not found in collection '${currentCollection.slug}'. Available relations: [${available}]`);
                    }

                    if (i === segments.length - 1) {
                        const targetCollection = relation.target();
                        effectiveCollectionPath = targetCollection.slug;

                        // Handle many-to-many with junction table
                        if (relation.cardinality === "many" && relation.through) {
                            const parentIdInfoArray = getPrimaryKeys(currentCollection, this.registry);
                            const parentIdInfo = parentIdInfoArray[0];
                            const parsedParentIdObj = parseIdValues(currentId, parentIdInfoArray);
                            const parsedParentId = parsedParentIdObj[parentIdInfo.fieldName];

                            junctionTableInfo = {
                                parentCollection: currentCollection,
                                parentId: parsedParentId,
                                relation: relation,
                                relationKey: relationKey
                            };
                            break;
                        }

                        // Find the FK column that should store the parent ID
                        let targetColumnName: string;

                        if (relation.localKey) {
                            targetColumnName = relation.localKey;
                        } else if (relation.foreignKeyOnTarget) {
                            targetColumnName = relation.foreignKeyOnTarget;
                        } else if (relation.joinPath && relation.joinPath.length === 1) {
                            const targetTableName = getTableName(targetCollection);
                            const relevantJoinStep = relation.joinPath.find(joinStep => joinStep.table === targetTableName);

                            if (relevantJoinStep) {
                                const targetColumnNames = DrizzleConditionBuilder.getColumnNamesFromColumns(relevantJoinStep.on.to);
                                targetColumnName = targetColumnNames[0];
                            } else {
                                logger.warn(`Could not find specific join step for target table ${targetTableName} in relation '${relationKey}'.`);
                                const targetColumnNames = DrizzleConditionBuilder.getColumnNamesFromColumns(relation.joinPath[0].on.to);
                                targetColumnName = targetColumnNames[0];
                            }
                        } else if (relation.joinPath && relation.joinPath.length > 1) {
                            // For multi-hop relations (like many-to-many through a junction table),
                            // there is no direct foreign key on the target table pointing to the parent.
                            // The relationship is managed via the junction table.
                            // We shouldn't inject the parent ID directly into the target row payload.
                            break;
                        } else {
                            throw new Error(`Relation '${relationKey}' lacks configuration for path-based saving.`);
                        }

                        const parentIdInfoArray = getPrimaryKeys(currentCollection, this.registry);
                        const parentIdInfo = parentIdInfoArray[0];
                        const parsedParentIdObj = parseIdValues(currentId, parentIdInfoArray);
                        const parsedParentId = parsedParentIdObj[parentIdInfo.fieldName];

                        const existingValue = (effectiveValues as Record<string, unknown>)[targetColumnName];
                        if (existingValue !== undefined && existingValue !== null && existingValue !== parsedParentId) {
                            logger.warn(`Overriding provided value '${existingValue}' for FK '${targetColumnName}' with path parent id '${parsedParentId}'.`);
                        }
                        (effectiveValues as Record<string, unknown>)[targetColumnName] = parsedParentId;
                        break;
                    } else {
                        const nextEntityId = segments[i + 1];
                        currentCollection = relation.target();
                        currentId = nextEntityId;
                    }
                }
            }
        }

        const collection = getCollectionByPath(effectiveCollectionPath, this.registry);
        const table = getTableForCollection(collection, this.registry);
        const idInfoArray = getPrimaryKeys(collection, this.registry);
        const primaryKeyFields = idInfoArray.map(info => info.fieldName);

        // Build an object mapping required for dynamic returning
        const returningKeys: Record<string, AnyPgColumn> = {};
        idInfoArray.forEach(info => {
            const field = table[info.fieldName as keyof typeof table] as AnyPgColumn;
            if (!field) throw new Error(`Primary key field '${info.fieldName}' not found in table for collection '${effectiveCollectionPath}'`);
            returningKeys[info.fieldName] = field;
        });

        // Separate relations that require special handling
        const relationValues: Record<string, unknown> = {};
        const otherValues: Partial<M> = { ...effectiveValues };
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
        try {
            // Transform relations to IDs, then sanitize
            const serializedResult = serializeDataToServer(otherValues as M, collection.properties as Properties, collection, this.registry);

            // Extract relation updates from the typed result
            const inverseRelationUpdates = serializedResult.inverseRelationUpdates;
            const joinPathRelationUpdates = serializedResult.joinPathRelationUpdates;

            const entityData = sanitizeAndConvertDates(serializedResult.scalarData);

            savedId = await this.db.transaction(async (tx) => {
                let currentId: string | number;

                if (id && !options?.upsert) {
                    // Update existing row
                    currentId = id; // `id` is already the formatted composite or singular string
                    const idValues = parseIdValues(id, idInfoArray);

                    // Apply joinPath one-to-one relation updates BEFORE the main UPDATE.
                    // This ensures parentSourceCol reads the pre-update FK value, preventing
                    // stale joinPath values from corrupting related rows when an
                    // intermediate FK (e.g., author_id) changes in the same save.
                    // Example: changing author A→B with stale profile P1 (A's):
                    //   reads old author_id=A → clears P1.author_id → re-sets P1.author_id=A (no-op).
                    if (joinPathRelationUpdates.length > 0) {
                        await this.relationService.updateJoinPathOneToOneRelations(tx, collection, currentId, joinPathRelationUpdates);
                    }

                    // Only issue an UPDATE if there are scalar columns to set.
                    // When the payload contains only relation data, entityData is
                    // empty after relation stripping and Drizzle throws "No values to set".
                    const scalarKeys = Object.keys(entityData as Record<string, unknown>);
                    if (scalarKeys.length > 0) {
                        const updateQuery = tx.update(table).set(entityData as Record<string, unknown>);
                        const conditions = [];
                        for (const info of idInfoArray) {
                            const field = table[info.fieldName as keyof typeof table] as AnyPgColumn;
                            conditions.push(eq(field, idValues[info.fieldName]));
                        }

                        const updateResult = await updateQuery.where(and(...conditions));

                        // Throwing rolls the transaction back, so relation writes
                        // already applied above do not survive a rejected update.
                        if ((updateResult.rowCount ?? 0) === 0) {
                            throw await this.explainZeroRowWrite(
                                tx, table, conditions, effectiveCollectionPath, currentId, "update"
                            );
                        }
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

                    // ON CONFLICT needs a real conflict target, and the only one
                    // guaranteed to exist is the primary key. Without every key
                    // column present there is nothing to match on, so the row is a
                    // plain insert and a duplicate should still raise.
                    const hasFullKey = idInfoArray.length > 0
                        && idInfoArray.every((info) => dataForInsert[info.fieldName] !== undefined);

                    let result;
                    if (options?.upsert && hasFullKey) {
                        const target = idInfoArray.map((info) => table[info.fieldName as keyof typeof table] as AnyPgColumn);
                        const set = { ...dataForInsert };
                        // Never reassign the key columns to themselves in the UPDATE
                        // branch; Postgres rejects that against the conflict target.
                        for (const info of idInfoArray) delete set[info.fieldName];

                        result = Object.keys(set).length > 0
                            ? await insertQuery.onConflictDoUpdate({ target, set }).returning(returningKeys)
                            : await insertQuery.onConflictDoNothing({ target }).returning(returningKeys);
                    } else {
                        result = await insertQuery.returning(returningKeys);
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
                        await this.relationService.updateJoinPathOneToOneRelations(tx, collection, currentId, joinPathRelationUpdates);
                    }
                }

                // Handle inverse relation updates
                if (inverseRelationUpdates.length > 0) {
                    await this.relationService.updateInverseRelations(tx, collection, currentId, inverseRelationUpdates);
                }

                // Update many-to-many relations
                if (Object.keys(relationValues).length > 0) {
                    await this.relationService.updateRelationsUsingJoins(tx, collection, currentId, relationValues);
                }

                // Handle junction table creation for many-to-many path-based saves
                if (junctionTableInfo && !id) {
                    await this.relationService.handleJunctionTableCreation(tx, currentId, junctionTableInfo);
                }

                return currentId;
            });
        } catch (error: unknown) {
            throw this.toUserFriendlyError(error, collection.slug);
        }

        // Fetch the updated/created row to return with proper relation objects
        const finalEntity = await this.fetchService.fetchOne<M>(collection.slug, savedId, databaseId);
        if (!finalEntity) throw new Error("Could not fetch row after save.");
        return finalEntity;
    }

    /**
     * Get the RelationService instance for external use
     */
    getRelationService(): RelationService {
        return this.relationService;
    }

    /**
     * Get the FetchService instance for external use
     */
    getFetchService(): FetchService {
        return this.fetchService;
    }

    /**
     * Translate raw PostgreSQL / Drizzle errors into user-friendly messages.
     */
    private toUserFriendlyError(error: unknown, collectionSlug: string): Error {
        // Deliberate API errors already carry their own status, code and wording.
        // Re-wrapping one flattens it into a generic Error, and the status is lost
        // on the way out — a policy rejection would surface as a 500. Matched by
        // name as well as instance: a duplicated module copy breaks `instanceof`.
        if (error instanceof ApiError || (error as Error)?.name === "ApiError") {
            return error as Error;
        }

        const pgError = extractPgError(error);

        if (pgError) {
            const { message } = pgErrorToFriendlyMessage(pgError, collectionSlug);
            return new Error(message);
        }

        // No PG error found — try to extract a useful message from the
        // Drizzle wrapper instead of leaking the raw SQL query + params.
        const causeMessage = extractCauseMessage(error);
        if (causeMessage) {
            return new Error(`Database error in "${collectionSlug}": ${causeMessage}`);
        }

        // Last resort: generic message, never leak raw SQL
        if (error instanceof Error && error.message.startsWith("Failed query:")) {
            return new Error(`Failed to save row in "${collectionSlug}". Check server logs for details.`);
        }
        return new Error(`Database error in "${collectionSlug}": ${String(error)}`);
    }
}
