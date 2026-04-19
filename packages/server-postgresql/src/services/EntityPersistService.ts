import { eq, and } from "drizzle-orm";
import { AnyPgColumn } from "drizzle-orm/pg-core";
// import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Entity, EntityCollection, Properties, Relation } from "@rebasepro/types";
import { getTableName, resolveCollectionRelations } from "@rebasepro/common";
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
     * Save an entity (create or update)
     */
    async saveEntity<M extends Record<string, any>>(
        collectionPath: string,
        values: Partial<M>,
        entityId?: string | number,
        databaseId?: string
    ): Promise<Entity<M>> {
        // If saving under a nested relation path, resolve the parent and inject FK
        let effectiveCollectionPath = collectionPath;
        const effectiveValues: Partial<M> = { ...values };

        if (collectionPath.includes("/")) {
            const segments = collectionPath.split("/").filter(Boolean);
            if (segments.length >= 3 && segments.length % 2 === 1) {
                const rootSegment = segments[0];
                let currentCollection = getCollectionByPath(rootSegment, this.registry);
                let currentEntityId: string | number = segments[1];

                for (let i = 2; i < segments.length; i += 2) {
                    const relationKey = segments[i];
                    const resolvedRelations = resolveCollectionRelations(currentCollection as import("@rebasepro/types").PostgresCollection<any, any>);
                    const relation = resolvedRelations[relationKey];

                    if (!relation) {
                        throw new Error(`Relation '${relationKey}' not found in collection '${currentCollection.slug}'`);
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

                            (effectiveValues as Record<string, unknown>).__junction_table_info = {
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
                        } else if (relation.joinPath && relation.joinPath.length > 0) {
                            const targetTableName = getTableName(targetCollection);
                            const relevantJoinStep = relation.joinPath.find(joinStep => joinStep.table === targetTableName);

                            if (relevantJoinStep) {
                                const targetColumnNames = DrizzleConditionBuilder.getColumnNamesFromColumns(relevantJoinStep.on.to);
                                targetColumnName = targetColumnNames[0];
                            } else {
                                console.warn(`Could not find specific join step for target table ${targetTableName} in relation '${relationKey}'.`);
                                const targetColumnNames = DrizzleConditionBuilder.getColumnNamesFromColumns(relation.joinPath[0].on.to);
                                targetColumnName = targetColumnNames[0];
                            }
                        } else {
                            throw new Error(`Relation '${relationKey}' lacks configuration for path-based saving.`);
                        }

                        const parentIdInfoArray = getPrimaryKeys(currentCollection, this.registry);
                        const parentIdInfo = parentIdInfoArray[0];
                        const parsedParentIdObj = parseIdValues(currentEntityId, parentIdInfoArray);
                        const parsedParentId = parsedParentIdObj[parentIdInfo.fieldName];

                        const existingValue = (effectiveValues as Record<string, unknown>)[targetColumnName];
                        if (existingValue !== undefined && existingValue !== null && existingValue !== parsedParentId) {
                            console.warn(`Overriding provided value '${existingValue}' for FK '${targetColumnName}' with path parent id '${parsedParentId}'.`);
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
        const resolvedRelations = resolveCollectionRelations(collection as import("@rebasepro/types").PostgresCollection<any, any>);

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
        const processedData = serializeDataToServer(otherValues as M, collection.properties as Properties, collection, this.registry);

        // Extract relation updates before sanitizing
        const inverseRelationUpdates = ((processedData as Record<string, unknown>).__inverseRelationUpdates as Array<{ relationKey: string; relation: Relation; newValue: unknown; currentEntityId?: string | number; }>) || [];
        const joinPathRelationUpdates = ((processedData as Record<string, unknown>).__joinPathRelationUpdates as Array<{ relationKey: string; relation: Relation; newTargetId: string | number | null; }>) || [];
        const junctionTableInfo = (processedData as Record<string, unknown>).__junction_table_info as { parentCollection: EntityCollection<any, any>; parentId: string | number; relation: Relation; relationKey: string; } | undefined;
        delete (processedData as Record<string, unknown>).__inverseRelationUpdates;
        delete (processedData as Record<string, unknown>).__joinPathRelationUpdates;
        delete (processedData as Record<string, unknown>).__junction_table_info;

        const entityData = sanitizeAndConvertDates(processedData);

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
                        let updateQuery = tx.update(table).set(entityData as Record<string, unknown>);
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
            const constraint = pgError.constraint as string | undefined;
            const column = pgError.column as string | undefined;
            const table = pgError.table as string | undefined;

            switch (pgError.code) {
                case "23503": // foreign_key_violation
                    return new Error(
                        detail
                            ? `Foreign key constraint violated: ${detail}`
                            : `Cannot save: a foreign key constraint${constraint ? ` (${constraint})` : ""} was violated in "${collectionSlug}".`
                    );
                case "23505": // unique_violation
                    return new Error(
                        detail
                            ? `Duplicate value: ${detail}`
                            : `Cannot save: a unique constraint${constraint ? ` (${constraint})` : ""} was violated in "${collectionSlug}".`
                    );
                case "23502": // not_null_violation
                    return new Error(
                        `Missing required field: "${column ?? "unknown"}" in "${table ?? collectionSlug}" cannot be empty.`
                    );
                case "23514": // check_violation
                    return new Error(
                        `Validation failed: a check constraint${constraint ? ` (${constraint})` : ""} was violated in "${collectionSlug}".`
                    );
            }
        }

        // Fall through: re-throw original
        if (error instanceof Error) return error;
        return new Error(String(error));
    }

    /**
     * Extract the underlying PostgreSQL error from a Drizzle wrapper.
     * Drizzle wraps PG errors in a `cause` property.
     */
    private extractPgError(error: unknown): (Error & { code?: string; detail?: unknown; constraint?: unknown; column?: unknown; table?: unknown }) | null {
        if (!error || typeof error !== "object") return null;

        const err = error as Error & { code?: string; cause?: unknown; detail?: unknown };

        // Check if the error itself has a PG error code
        if (err.code && /^[0-9]{5}$/.test(err.code)) {
            return err as Error & { code: string; detail?: unknown; constraint?: unknown; column?: unknown; table?: unknown };
        }

        // Check the cause chain (Drizzle wraps PG errors)
        if (err.cause && typeof err.cause === "object") {
            return this.extractPgError(err.cause);
        }

        return null;
    }
}
