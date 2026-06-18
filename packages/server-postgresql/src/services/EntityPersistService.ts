import { eq, and } from "drizzle-orm";
import { AnyPgColumn } from "drizzle-orm/pg-core";
// import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Entity, EntityCollection, Properties, Relation } from "@rebasepro/types";
import { getTableName, resolveCollectionRelations, findRelation } from "@rebasepro/common";
import { DrizzleConditionBuilder } from "../utils/drizzle-conditions";
import {
    getCollectionByPath,
    getTableForCollection,
    getPrimaryKeys,
    parseIdValues,
    buildCompositeId
} from "./entity-helpers";
import { sanitizeAndConvertDates, serializeDataToServer } from "../data-transformer";
import { RelationService } from "./RelationService";
import { EntityFetchService } from "./EntityFetchService";
import { DrizzleClient } from "../interfaces";
import { PostgresCollectionRegistry } from "../collections/PostgresCollectionRegistry";
import { logger } from "@rebasepro/server-core";

/** Shape of PostgreSQL errors with diagnostic metadata. */
interface PostgresError extends Error {
    code?: string;
    detail?: string;
    hint?: string;
    constraint?: string;
    column?: string;
    table?: string;
    dataType?: string;
    cause?: unknown;
}

/**
 * Service for handling all entity write operations.
 * Handles saving, deleting, and updating entities.
 */
export class EntityPersistService {
    private relationService: RelationService;
    private fetchService: EntityFetchService;

    constructor(private db: DrizzleClient, private registry: PostgresCollectionRegistry) {
        this.relationService = new RelationService(db, registry);
        this.fetchService = new EntityFetchService(db, registry);
    }


    /**
     * Delete an entity by ID
     */
    async deleteEntity(collectionPath: string, entityId: string | number, _databaseId?: string): Promise<void> {
        const collection = getCollectionByPath(collectionPath, this.registry);
        const table = getTableForCollection(collection, this.registry);
        const idInfoArray = getPrimaryKeys(collection, this.registry);
        const idInfo = idInfoArray[0];
        const idField = table[idInfo.fieldName as keyof typeof table] as AnyPgColumn;

        if (!idField) {
            throw new Error(`ID field '${idInfo.fieldName}' not found in table for collection '${collectionPath}'`);
        }

        const parsedIdObj = parseIdValues(entityId, idInfoArray);
        const parsedId = parsedIdObj[idInfo.fieldName];

        await this.db
            .delete(table)
            .where(eq(idField, parsedId));
    }

    /**
     * Delete all entities from a collection
     */
    async deleteAll(collectionPath: string, _databaseId?: string): Promise<void> {
        const collection = getCollectionByPath(collectionPath, this.registry);
        const table = getTableForCollection(collection, this.registry);
        await this.db.delete(table);
    }

    /**
     * Save an entity (create or update)
     */
    async saveEntity<M extends Record<string, unknown>>(
        collectionPath: string,
        values: Partial<M>,
        entityId?: string | number,
        databaseId?: string
    ): Promise<Entity<M>> {
        // If saving under a nested relation path, resolve the parent and inject FK
        let effectiveCollectionPath = collectionPath;
        const effectiveValues: Partial<M> = { ...values };
        let junctionTableInfo: { parentCollection: EntityCollection; parentId: string | number; relation: Relation; relationKey: string; } | undefined;

        if (collectionPath.includes("/")) {
            const segments = collectionPath.split("/").filter(Boolean);
            if (segments.length >= 3 && segments.length % 2 === 1) {
                const rootSegment = segments[0];
                let currentCollection = getCollectionByPath(rootSegment, this.registry);
                let currentEntityId: string | number = segments[1];

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
                            const parsedParentIdObj = parseIdValues(currentEntityId, parentIdInfoArray);
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
                            // We shouldn't inject the parent ID directly into the target entity payload.
                            break;
                        } else {
                            throw new Error(`Relation '${relationKey}' lacks configuration for path-based saving.`);
                        }

                        const parentIdInfoArray = getPrimaryKeys(currentCollection, this.registry);
                        const parentIdInfo = parentIdInfoArray[0];
                        const parsedParentIdObj = parseIdValues(currentEntityId, parentIdInfoArray);
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
                        currentEntityId = nextEntityId;
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

        // Transform relations to IDs, then sanitize
        const serializedResult = serializeDataToServer(otherValues as M, collection.properties as Properties, collection, this.registry);

        // Extract relation updates from the typed result
        const inverseRelationUpdates = serializedResult.inverseRelationUpdates;
        const joinPathRelationUpdates = serializedResult.joinPathRelationUpdates;

        const entityData = sanitizeAndConvertDates(serializedResult.scalarData);

        let savedId: string | number;
        try {
            savedId = await this.db.transaction(async (tx) => {
                let currentId: string | number;

                if (entityId) {
                    // Update existing entity
                    currentId = entityId; // `entityId` is already the formatted composite or singular string
                    const idValues = parseIdValues(entityId, idInfoArray);

                    // Apply joinPath one-to-one relation updates BEFORE the main UPDATE.
                    // This ensures parentSourceCol reads the pre-update FK value, preventing
                    // stale joinPath values from corrupting related entities when an
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

                        await updateQuery.where(and(...conditions));
                    }
                } else {
                    const dataForInsert = { ...(entityData as Record<string, unknown>) };

                    // Strip empty primary keys so the database defaults (e.g. uuid_gen(), auto-increment) can trigger
                    for (const info of idInfoArray) {
                        if (dataForInsert[info.fieldName] === "" || dataForInsert[info.fieldName] === null || dataForInsert[info.fieldName] === undefined) {
                            delete dataForInsert[info.fieldName];
                        }
                    }

                    const result = await tx
                        .insert(table)
                        .values(dataForInsert)
                        .returning(returningKeys);

                    const resultRow = result[0];
                    currentId = buildCompositeId(resultRow, idInfoArray);

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
                if (junctionTableInfo && !entityId) {
                    await this.relationService.handleJunctionTableCreation(tx, currentId, junctionTableInfo);
                }

                return currentId;
            });
        } catch (error: unknown) {
            throw this.toUserFriendlyError(error, collection.slug);
        }

        // Fetch the updated/created entity to return with proper relation objects
        const finalEntity = await this.fetchService.fetchEntity<M>(collection.slug, savedId, databaseId);
        if (!finalEntity) throw new Error("Could not fetch entity after save.");
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
    getFetchService(): EntityFetchService {
        return this.fetchService;
    }

    /**
     * Translate raw PostgreSQL / Drizzle errors into user-friendly messages.
     */
    private toUserFriendlyError(error: unknown, collectionSlug: string): Error {
        // Dig into Drizzle's wrapper to find the underlying PG error
        const pgError = this.extractPgError(error);

        if (pgError) {
            const detail = pgError.detail as string | undefined;
            const hint = pgError.hint as string | undefined;
            const constraint = pgError.constraint as string | undefined;
            const column = pgError.column as string | undefined;
            const table = pgError.table as string | undefined;
            const dataType = pgError.dataType as string | undefined;
            const pgMessage = pgError.message || "Unknown database error";

            const suffix = hint ? ` Hint: ${hint}` : "";
            const tableRef = table ?? collectionSlug;

            switch (pgError.code) {
                case "23503": // foreign_key_violation
                    return new Error(
                        detail
                            ? `Foreign key constraint violated: ${detail}${suffix}`
                            : `Cannot save: a foreign key constraint${constraint ? ` (${constraint})` : ""} was violated in "${collectionSlug}".${suffix}`
                    );
                case "23505": // unique_violation
                    return new Error(
                        detail
                            ? `Duplicate value: ${detail}${suffix}`
                            : `Cannot save: a unique constraint${constraint ? ` (${constraint})` : ""} was violated in "${collectionSlug}".${suffix}`
                    );
                case "23502": // not_null_violation
                    return new Error(
                        `Missing required field: "${column ?? "unknown"}" in "${tableRef}" cannot be empty.${suffix}`
                    );
                case "23514": // check_violation
                    return new Error(
                        `Validation failed: a check constraint${constraint ? ` (${constraint})` : ""} was violated in "${collectionSlug}".${suffix}`
                    );
                case "22P02": // invalid_text_representation (e.g. invalid UUID, wrong enum value)
                    return new Error(
                        `Invalid data format in "${collectionSlug}": ${pgMessage}${suffix}`
                    );
                case "22001": // string_data_right_truncation (value too long)
                    return new Error(
                        `Value too long for column "${column ?? "unknown"}" in "${tableRef}": ${pgMessage}${suffix}`
                    );
                case "22003": // numeric_value_out_of_range
                    return new Error(
                        `Numeric value out of range for column "${column ?? "unknown"}" in "${tableRef}": ${pgMessage}${suffix}`
                    );
                case "42703": // undefined_column
                    return new Error(
                        `Unknown column in "${tableRef}": ${pgMessage}. Check if your schema is up to date (run migrations).${suffix}`
                    );
                case "42P01": // undefined_table
                    return new Error(
                        `Table not found for "${collectionSlug}": ${pgMessage}. Check if your schema is up to date (run migrations).${suffix}`
                    );
                default: {
                    // Unhandled PG code — still surface the actual database message
                    const parts = [`Database error in "${collectionSlug}" [${pgError.code}]: ${pgMessage}`];
                    if (detail) parts.push(`Detail: ${detail}`);
                    if (column) parts.push(`Column: ${column}`);
                    if (dataType) parts.push(`Data type: ${dataType}`);
                    if (constraint) parts.push(`Constraint: ${constraint}`);
                    if (hint) parts.push(`Hint: ${hint}`);
                    return new Error(parts.join(". "));
                }
            }
        }

        // No PG error found — try to extract a useful message from the
        // Drizzle wrapper instead of leaking the raw SQL query + params.
        const causeMessage = this.extractCauseMessage(error);
        if (causeMessage) {
            return new Error(`Database error in "${collectionSlug}": ${causeMessage}`);
        }

        // Last resort: use the original error message but strip the SQL query
        if (error instanceof Error) {
            const cleaned = this.stripSqlFromMessage(error.message, collectionSlug);
            return new Error(cleaned);
        }
        return new Error(`Database error in "${collectionSlug}": ${String(error)}`);
    }

    /**
     * Walk the error cause chain and return the deepest meaningful message.
     */
    private extractCauseMessage(error: unknown): string | null {
        if (!error || typeof error !== "object") return null;
        if (!(error instanceof Error)) return null;

        if (error.cause && typeof error.cause === "object") {
            const deeper = this.extractCauseMessage(error.cause);
            if (deeper) return deeper;
            // The cause itself has a message
            if (error.cause instanceof Error && error.cause.message) {
                return error.cause.message;
            }
        }
        return null;
    }

    /**
     * Strip the raw SQL query from a Drizzle "Failed query: ..." message,
     * keeping only the error description.
     */
    private stripSqlFromMessage(message: string, collectionSlug: string): string {
        // Drizzle format: "Failed query: <SQL>\nparams: <params>"
        if (message.startsWith("Failed query:")) {
            return `Failed to save entity in "${collectionSlug}". Check server logs for details.`;
        }
        return message;
    }

    /**
     * Extract the underlying PostgreSQL error from a Drizzle wrapper.
     * Drizzle wraps PG errors in a `cause` property.
     */
    private extractPgError(error: unknown): PostgresError | null {
        if (!error || typeof error !== "object") return null;
        if (!(error instanceof Error)) {
            // Check non-Error objects for a cause chain (Drizzle sometimes wraps oddly)
            if ("cause" in error && (error as Record<string, unknown>).cause && typeof (error as Record<string, unknown>).cause === "object") {
                return this.extractPgError((error as Record<string, unknown>).cause);
            }
            return null;
        }

        // Check if the error itself has a PG error code
        if ("code" in error && typeof (error as PostgresError).code === "string" && /^[0-9A-Z]{5}$/.test((error as PostgresError).code!)) {
            return error as PostgresError;
        }

        // Check the cause chain (Drizzle wraps PG errors)
        if (error.cause && typeof error.cause === "object") {
            return this.extractPgError(error.cause);
        }

        return null;
    }
}
