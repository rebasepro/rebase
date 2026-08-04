// import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { FilterValues, LogicalCondition } from "@rebasepro/types";
import type { VectorSearchParams } from "@rebasepro/types";
import { FetchService } from "./FetchService";
import { PersistService } from "./PersistService";
import { RelationService } from "./RelationService";
import { DataRepository, FetchCollectionOptions, SearchOptions, CountOptions, DrizzleClient } from "../interfaces";
import { PostgresCollectionRegistry } from "../collections/PostgresCollectionRegistry";

// Re-export data transformer functions for external use
export { sanitizeAndConvertDates, serializeDataToServer, parseDataFromServer } from "../data-transformer";

// Re-export service classes for direct use
export { FetchService } from "./FetchService";
export { PersistService } from "./PersistService";
export { RelationService } from "./RelationService";

// Re-export interfaces
export * from "../interfaces";

/**
 * DataService - Facade for row operations.
 *
 * This class provides a unified API for row CRUD operations by delegating
 * to specialized services:
 * - FetchService: Read operations (fetch, search, count)
 * - PersistService: Write operations (save, delete)
 * - RelationService: Relation operations (fetch related, update relations)
 *
 * Implements the DataRepository interface for database abstraction.
 */
export class DataService implements DataRepository {
    private fetchService: FetchService;
    private persistService: PersistService;

    constructor(private db: DrizzleClient, private registry: PostgresCollectionRegistry) {
        this.fetchService = new FetchService(db, registry);
        this.persistService = new PersistService(db, registry);
    }

    // =============================================================
    // READ OPERATIONS - Delegated to FetchService
    // =============================================================

    /**
     * Fetch a single row by ID
     */
    async fetchOne<M extends Record<string, unknown>>(
        collectionPath: string,
        id: string | number,
        databaseId?: string
    ): Promise<Record<string, unknown> | undefined> {
        return this.fetchService.fetchOne<M>(collectionPath, id, databaseId);
    }

    /**
     * Fetch a collection of rows with optional filtering, ordering, and pagination
     */
    async fetchCollection<M extends Record<string, unknown>>(
        collectionPath: string,
        options: {
            filter?: FilterValues<Extract<keyof M, string>>;
            /** An `or(...)`/`and(...)` group, applied alongside `filter`. */
            logical?: LogicalCondition;
            orderBy?: string;
            order?: "desc" | "asc";
            limit?: number;
            offset?: number;
            startAfter?: Record<string, unknown>;
            searchString?: string;
            databaseId?: string;
            vectorSearch?: VectorSearchParams;
        } = {}
    ): Promise<Record<string, unknown>[]> {
        return this.fetchService.fetchCollection<M>(collectionPath, options);
    }

    /**
     * Search rows by text
     */
    async searchRows<M extends Record<string, unknown>>(
        collectionPath: string,
        searchString: string,
        options: {
            filter?: FilterValues<Extract<keyof M, string>>;
            orderBy?: string;
            order?: "desc" | "asc";
            limit?: number;
            databaseId?: string;
        } = {}
    ): Promise<Record<string, unknown>[]> {
        return this.fetchService.searchRows<M>(collectionPath, searchString, options);
    }

    /**
     * Count rows in a collection
     */
    async count<M extends Record<string, unknown>>(
        collectionPath: string,
        options: {
            filter?: FilterValues<Extract<keyof M, string>>;
            /** An `or(...)`/`and(...)` group, applied alongside `filter`. */
            logical?: LogicalCondition;
            searchString?: string;
            databaseId?: string;
        } = {}
    ): Promise<number> {
        return this.fetchService.count<M>(collectionPath, options);
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
     * Fetch rows related to a parent row
     */
    async fetchRelatedEntities<M extends Record<string, unknown>>(
        parentCollectionPath: string,
        parentId: string | number,
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
    ): Promise<Record<string, unknown>[]> {
        const rows = await this.fetchService.getRelationService().fetchRelatedEntities<M>(
            parentCollectionPath,
            parentId,
            relationKey,
            options
        );
        return rows.map(e => ({ ...e.values, id: e.id }));
    }

    // =============================================================
    // WRITE OPERATIONS - Delegated to PersistService
    // =============================================================

    /**
     * Save an row (create or update)
     */
    async save<M extends Record<string, unknown>>(
        collectionPath: string,
        values: Partial<M>,
        id?: string | number,
        databaseId?: string,
        options?: { upsert?: boolean }
    ): Promise<Record<string, unknown>> {
        return this.persistService.save<M>(collectionPath, values, id, databaseId, options);
    }

    /**
     * Delete an row by ID
     */
    async delete(
        collectionPath: string,
        id: string | number,
        databaseId?: string
    ): Promise<void> {
        return this.persistService.delete(collectionPath, id, databaseId);
    }

    /**
     * Delete all rows from a collection
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
     * Get the underlying FetchService for advanced use
     */
    getFetchService(): FetchService {
        return this.fetchService;
    }

    /**
     * Get the underlying PersistService for advanced use
     */
    getPersistService(): PersistService {
        return this.persistService;
    }

    /**
     * Get the underlying RelationService for advanced use
     */
    getRelationService(): RelationService {
        return this.fetchService.getRelationService();
    }
}
