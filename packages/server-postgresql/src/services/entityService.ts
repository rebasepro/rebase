// import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Entity, FilterValues } from "@rebasepro/types";
import type { VectorSearchParams } from "@rebasepro/types";
import { EntityFetchService } from "./EntityFetchService";
import { EntityPersistService } from "./EntityPersistService";
import { RelationService } from "./RelationService";
import { EntityRepository, FetchCollectionOptions, SearchOptions, CountOptions, DrizzleClient } from "../interfaces";
import { PostgresCollectionRegistry } from "../collections/PostgresCollectionRegistry";

// Re-export data transformer functions for external use
export { sanitizeAndConvertDates, serializeDataToServer, parseDataFromServer } from "../data-transformer";

// Re-export service classes for direct use
export { EntityFetchService } from "./EntityFetchService";
export { EntityPersistService } from "./EntityPersistService";
export { RelationService } from "./RelationService";

// Re-export interfaces
export * from "../interfaces";

/**
 * EntityService - Facade for entity operations.
 *
 * This class provides a unified API for entity CRUD operations by delegating
 * to specialized services:
 * - EntityFetchService: Read operations (fetch, search, count)
 * - EntityPersistService: Write operations (save, delete)
 * - RelationService: Relation operations (fetch related, update relations)
 *
 * Implements the EntityRepository interface for database abstraction.
 */
export class EntityService implements EntityRepository {
    private fetchService: EntityFetchService;
    private persistService: EntityPersistService;

    constructor(private db: DrizzleClient, private registry: PostgresCollectionRegistry) {
        this.fetchService = new EntityFetchService(db, registry);
        this.persistService = new EntityPersistService(db, registry);
    }

    // =============================================================
    // READ OPERATIONS - Delegated to EntityFetchService
    // =============================================================

    /**
     * Fetch a single entity by ID
     */
    async fetchEntity<M extends Record<string, unknown>>(
        collectionPath: string,
        entityId: string | number,
        databaseId?: string
    ): Promise<Entity<M> | undefined> {
        return this.fetchService.fetchEntity<M>(collectionPath, entityId, databaseId);
    }

    /**
     * Fetch a collection of entities with optional filtering, ordering, and pagination
     */
    async fetchCollection<M extends Record<string, unknown>>(
        collectionPath: string,
        options: {
            filter?: FilterValues<Extract<keyof M, string>>;
            orderBy?: string;
            order?: "desc" | "asc";
            limit?: number;
            offset?: number;
            startAfter?: Record<string, unknown>;
            searchString?: string;
            databaseId?: string;
            vectorSearch?: VectorSearchParams;
        } = {}
    ): Promise<Entity<M>[]> {
        return this.fetchService.fetchCollection<M>(collectionPath, options);
    }

    /**
     * Search entities by text
     */
    async searchEntities<M extends Record<string, unknown>>(
        collectionPath: string,
        searchString: string,
        options: {
            filter?: FilterValues<Extract<keyof M, string>>;
            orderBy?: string;
            order?: "desc" | "asc";
            limit?: number;
            databaseId?: string;
        } = {}
    ): Promise<Entity<M>[]> {
        return this.fetchService.searchEntities<M>(collectionPath, searchString, options);
    }

    /**
     * Count entities in a collection
     */
    async countEntities<M extends Record<string, unknown>>(
        collectionPath: string,
        options: {
            filter?: FilterValues<Extract<keyof M, string>>;
            searchString?: string;
            databaseId?: string;
        } = {}
    ): Promise<number> {
        return this.fetchService.countEntities<M>(collectionPath, options);
    }

    /**
     * Check if a field value is unique in a collection
     */
    async checkUniqueField(
        collectionPath: string,
        fieldName: string,
        value: unknown,
        excludeEntityId?: string,
        databaseId?: string
    ): Promise<boolean> {
        return this.fetchService.checkUniqueField(collectionPath, fieldName, value, excludeEntityId, databaseId);
    }

    /**
     * Fetch entities related to a parent entity
     */
    async fetchRelatedEntities<M extends Record<string, unknown>>(
        parentCollectionPath: string,
        parentEntityId: string | number,
        relationKey: string,
        options: {
            filter?: FilterValues<Extract<keyof M, string>>;
            orderBy?: string;
            order?: "desc" | "asc";
            limit?: number;
            startAfter?: Record<string, unknown>;
            searchString?: string;
            databaseId?: string;
        } = {}
    ): Promise<Entity<M>[]> {
        return this.fetchService.getRelationService().fetchRelatedEntities<M>(
            parentCollectionPath,
            parentEntityId,
            relationKey,
            options
        );
    }

    // =============================================================
    // WRITE OPERATIONS - Delegated to EntityPersistService
    // =============================================================

    /**
     * Save an entity (create or update)
     */
    async saveEntity<M extends Record<string, unknown>>(
        collectionPath: string,
        values: Partial<M>,
        entityId?: string | number,
        databaseId?: string
    ): Promise<Entity<M>> {
        return this.persistService.saveEntity<M>(collectionPath, values, entityId, databaseId);
    }

    /**
     * Delete an entity by ID
     */
    async deleteEntity(
        collectionPath: string,
        entityId: string | number,
        databaseId?: string
    ): Promise<void> {
        return this.persistService.deleteEntity(collectionPath, entityId, databaseId);
    }

    /**
     * Delete all entities from a collection
     */
    async deleteAll(collectionPath: string, databaseId?: string): Promise<void> {
        return this.persistService.deleteAll(collectionPath, databaseId);
    }


    /**
     * Execute raw SQL
     */
    async executeSql(sqlText: string, params?: unknown[]): Promise<Record<string, unknown>[]> {
        if (process.env.NODE_ENV !== "production") {
            console.debug("Executing raw SQL:", sqlText, params?.length ? `with ${params.length} params` : "");
        }
        const { sql } = await import("drizzle-orm");

        let result;
        if (params && params.length > 0) {
            // Build a parameterized query using Drizzle's sql tagged template.
            // Split the SQL text on $1, $2, … placeholders and interleave
            // with sql.param() calls so the underlying pg driver binds them safely.
            const parts = sqlText.split(/\$(\d+)/);
            const chunks: ReturnType<typeof sql.raw | typeof sql.param>[] = [];
            for (let i = 0; i < parts.length; i++) {
                if (i % 2 === 0) {
                    // Literal SQL text fragment
                    if (parts[i].length > 0) {
                        chunks.push(sql.raw(parts[i]));
                    }
                } else {
                    // Parameter reference — $N (1-indexed)
                    const paramIndex = Number(parts[i]) - 1;
                    chunks.push(sql.param(params[paramIndex]));
                }
            }
            const query = sql.join(chunks, sql.raw(""));
            result = await this.db.execute(query);
        } else {
            result = await this.db.execute(sql.raw(sqlText));
        }

        const rows = result.rows;
        if (process.env.NODE_ENV !== "production") {
            console.debug(`SQL executed successfully. Returned ${Array.isArray(rows) ? rows.length : "non-array"} rows.`);
        }
        return rows as Record<string, unknown>[];
    }

    // =============================================================
    // SERVICE ACCESSORS
    // =============================================================

    /**
     * Get the underlying EntityFetchService for advanced use
     */
    getFetchService(): EntityFetchService {
        return this.fetchService;
    }

    /**
     * Get the underlying EntityPersistService for advanced use
     */
    getPersistService(): EntityPersistService {
        return this.persistService;
    }

    /**
     * Get the underlying RelationService for advanced use
     */
    getRelationService(): RelationService {
        return this.fetchService.getRelationService();
    }
}
